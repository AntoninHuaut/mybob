import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HouseOrbitPointersInput } from './orbitPointerInput';
import { measurementEndpoint } from './measurement';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
// Side effects required for picking, shadows, and collision coordination.
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject, Level, Point2 } from '../model/types';
import { bounds, floorElevationAt, pointInPolygon } from '../model/geometry';
import {
  buildHouse,
  poseDoor,
  FIXTURE_LIGHT_INTENSITY,
  FIXTURE_LIGHT_RANGE,
  type HouseScene,
} from './buildHouse';
import { createMaterials } from './materials';
import { buildExterior, type ExteriorScene } from './buildExterior';
import {
  applyLookSensitivity,
  createWalkCamera,
  DEFAULT_WALK_SPEED,
  EYE_HEIGHT,
  prepareWalkStep,
  walkDisplacement,
} from './walkCamera';
import { fitOverview, fitPlan, siteOverviewLevel } from './framing';
import { panOrbitWithKeys } from './orbitNavigation';
import { buildPlanOpenings, type PlanOpenings } from './planOpenings';
import { buildWallCutaway, type WallCutaway, type WallDisplay } from './wallCutaway';
import type { SolarPosition } from './solar';
import {
  applyEyeHeight,
  findVisitDestination,
  isSceneVisitDestination,
  sectionPlane,
} from './navigation';
import { cameraYaw, planHeading, setPlanView, stopOrbit, usePlanCoordinates } from './coordinates';
import {
  createInteriorBloom,
  createInteriorEnvironment,
  createInteriorOcclusion,
  createInteriorTaa,
  nextOcclusionProbe,
  startOcclusionProbe,
  INTERIOR_ENVIRONMENT_INTENSITY,
  INTERIOR_FIXTURE_INTENSITY,
  INTERIOR_FIXTURE_RANGE,
  INTERIOR_GROUND_COLOR,
  type OcclusionProbe,
} from './interiorAmbience';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import type { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import type { TAARenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline';
import type { OcclusionState } from './diagnostics';

export type ViewMode = 'overview' | 'plan' | 'walk';
export interface FrameInfo {
  position: Point2;
  headingDegrees: number;
  planUpDegrees: number;
  roomId?: string;
  nearDoor: boolean;
  nearFurnitureId?: string;
  locked: boolean;
}
export interface Measurement {
  a: Point2;
  b?: Point2;
  distance?: number;
  preview?: boolean;
  aligned?: boolean;
}

/** Babylon scales pan deltas by the inverse of this value, in world metres. */
export function configureOrbitInteractions(
  camera: ArcRotateCamera,
  zoomPlan?: (factor: number) => void,
) {
  camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
  camera.inputs.removeByType('ArcRotateCameraPointersInput');
  camera.inputs.add(
    new HouseOrbitPointersInput(
      zoomPlan ??
        ((factor) => {
          for (const key of ['orthoLeft', 'orthoRight', 'orthoTop', 'orthoBottom'] as const)
            if (camera[key] !== null) camera[key] *= factor;
        }),
    ),
  );
  camera.panningSensibility = 1000;
}

function editableFurnitureId(hit: PickingInfo | null | undefined) {
  const metadata = hit?.pickedMesh?.metadata;
  return metadata?.kind === 'furniture' && typeof metadata.id === 'string' && metadata.id
    ? (metadata.id as string)
    : undefined;
}

/** Keep the first hit, so walls and closed doors occlude furniture editing. */
export function findEditableFurniture(camera: UniversalCamera, scene: Scene, distance = 3) {
  return editableFurnitureId(scene.pickWithRay(camera.getForwardRay(distance)));
}

export class HouseViewer {
  readonly engine: AbstractEngine;
  scene!: Scene;
  orbit!: ArcRotateCamera;
  walk!: UniversalCamera;
  house!: HouseScene;
  exterior?: ExteriorScene;
  private exteriorView = false;
  private exteriorFrame?: Level;
  level!: Level;
  mode: ViewMode = 'overview';
  measureMode = false;
  measurement?: Measurement;
  onSelectRoom?: (id: string) => void;
  onFrame?: (frame: FrameInfo) => void;
  onMeasure?: (measurement?: Measurement) => void;
  onPointerLockError?: () => void;
  onModeChange?: (mode: ViewMode) => void;
  onDestination?: (point: Point2) => void;
  onDestinationRejected?: () => void;
  onEditFurniture?: (id: string) => void;
  goToMode = false;
  private eyeHeight = EYE_HEIGHT;
  private walkSpeed = DEFAULT_WALK_SPEED;
  private lookSensitivity = 1;
  private wallDisplay: WallDisplay = 'auto';
  private wallCutaway?: WallCutaway;
  private sectionHeight?: number;
  private planOpenings?: PlanOpenings;
  private dimensions: LinesMesh[] = [];
  private measureMeshes: AbstractMesh[] = [];
  private pinnedMeasurements: AbstractMesh[] = [];
  private measureLine?: LinesMesh;
  private measureCursor?: Point2;
  private keyState = new Set<string>();
  private hemispheric!: HemisphericLight;
  private sun!: DirectionalLight;
  private planLighting?: { diffuse: Color3; ground: Color3 };
  private baseGround?: Color3;
  private interiorEnvironment?: RawCubeTexture;
  private interiorOcclusion?: SSAO2RenderingPipeline;
  private interiorTaa?: TAARenderingPipeline;
  private interiorBloom?: DefaultRenderingPipeline;
  private interiorAmbienceUnavailable = false;
  private occlusionProbe?: OcclusionProbe;
  private occlusionRefused = false;
  private occlusionUnavailable = false;
  private previousEnvironment?: BaseTexture | null;
  private previousEnvironmentIntensity = 1;
  private shadowsBeforeReadability?: boolean;
  private solarPosition?: SolarPosition;
  private baseSun?: { direction: Vector3; position: Vector3; diffuse: Color3 };
  private lightOn = true;
  private ceilingOn = false;
  private dimensionOn = false;
  private paused = false;
  private capturing = false;
  private planZoom = 1;
  private resizeObserver: ResizeObserver;
  private pointerLockError = () => this.onPointerLockError?.();
  private orbitTour: { from: number; to: number; start: number; duration: number } | undefined;
  private orbitPointerDown = (event: PointerEvent) => {
    this.orbitTour = undefined;
    this.recoverOrbitControls(event);
  };

  constructor(
    readonly canvas: HTMLCanvasElement,
    engine: AbstractEngine,
  ) {
    this.engine = engine;
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.6));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('pointerlockchange', this.clearKeys);
    document.addEventListener('pointerlockerror', this.pointerLockError);
    canvas.addEventListener('blur', this.clearKeys);
    canvas.addEventListener('wheel', this.planWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.orbitPointerDown, true);
    this.engine.runRenderLoop(() => {
      this.stepOrbitTour();
      if (this.scene) this.scene.render();
    });
  }

  load(project: HouseProject, levelId?: string) {
    this.orbitTour = undefined;
    this.wallCutaway?.dispose();
    this.wallCutaway = undefined;
    this.planOpenings?.dispose();
    this.scene?.dispose();
    this.planLighting = undefined;
    this.shadowsBeforeReadability = undefined;
    this.baseSun = undefined;
    this.baseGround = undefined;
    this.interiorEnvironment = undefined;
    this.interiorOcclusion = undefined;
    this.interiorTaa = undefined;
    this.interiorBloom = undefined;
    this.interiorAmbienceUnavailable = false;
    this.occlusionProbe = undefined;
    this.occlusionRefused = false;
    this.occlusionUnavailable = false;
    this.previousEnvironment = undefined;
    this.previousEnvironmentIntensity = 1;
    this.exterior = undefined;
    this.exteriorFrame = undefined;
    this.exteriorView = false;
    this.keyState.clear();
    this.measurement = undefined;
    this.measureMode = false;
    this.measureMeshes = [];
    this.pinnedMeasurements = [];
    this.measureLine = undefined;
    this.measureCursor = undefined;
    this.dimensions = [];
    this.level = project.levels.find((l) => l.id === levelId) ?? project.levels[0];
    const level = this.level;
    const scene = (this.scene = new Scene(this.engine));
    usePlanCoordinates(scene);
    scene.clearColor = new Color4(0.918, 0.925, 0.906, 0);
    scene.ambientColor = Color3.Black();
    scene.collisionsEnabled = true;
    scene.gravity = new Vector3(0, -0.25, 0);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType =
      ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 0.95;
    scene.imageProcessingConfiguration.contrast = 1.02;
    const extent = bounds(level.outline);
    const center = new Vector3(extent.center[0], level.elevation + 0.35, extent.center[1]);
    this.orbit = new ArcRotateCamera(
      'overview',
      Math.PI * 0.66,
      0.66,
      Math.max(extent.width, extent.depth) * 1.9,
      center,
      scene,
    );
    this.orbit.lowerRadiusLimit = 2;
    this.orbit.upperRadiusLimit = Math.max(extent.width, extent.depth) * 6;
    this.orbit.lowerBetaLimit = 0.03;
    this.orbit.upperBetaLimit = Math.PI * 0.48;
    this.orbit.wheelPrecision = 12;
    configureOrbitInteractions(this.orbit, (factor) => this.zoomPlan(factor));
    this.orbit.minZ = 0.03;
    this.orbit.maxZ = 1000;
    this.orbit.fov = 0.66;
    this.orbit.inertia = 0.7;
    this.orbit.attachControl(this.canvas, true);

    this.walk = createWalkCamera(scene, level);
    applyLookSensitivity(this.walk, this.lookSensitivity);
    this.eyeHeight = applyEyeHeight(this.walk, level, this.eyeHeight);
    this.hemispheric = new HemisphericLight('sky', new Vector3(0.3, 1, -0.1), scene);
    this.hemispheric.intensity = 0.9;
    this.hemispheric.groundColor = Color3.FromHexString('#b6b4a2');
    // Captured once, at build time: the visit and the plan both restore from it.
    this.baseGround = this.hemispheric.groundColor.clone();
    this.sun = new DirectionalLight('sunlight', new Vector3(0.5, -1, -0.45), scene);
    this.sun.position = new Vector3(
      extent.center[0] - 9,
      level.elevation + 16,
      extent.center[1] + 12,
    );
    this.sun.intensity = 1.3;
    this.sun.diffuse = Color3.FromHexString('#fff5df');
    this.captureSunPreset();
    this.sun.shadowMinZ = 0.1;
    this.sun.shadowMaxZ = 100;
    const shadow = new ShadowGenerator(2048, this.sun);
    shadow.usePercentageCloserFiltering = true;
    shadow.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadow.bias = 0.001;
    shadow.normalBias = 0.025;
    shadow.setDarkness(0.2);
    // The level above owns the stairwell opening: it also pierces this ceiling.
    const above = project.levels
      .filter((candidate) => candidate.elevation > level.elevation)
      .sort((a, b) => a.elevation - b.elevation)[0];
    this.house = buildHouse(
      level,
      scene,
      createMaterials(scene, project.finishes),
      shadow,
      above?.floorVoids ?? [],
    );
    // L'extérieur est celui du bâtiment, pas du niveau affiché : les façades
    // sont celles du niveau bas, et le toit couvre le reste. Construire depuis
    // les combles ne montrait que le toit, et posait la pelouse à leur altitude.
    const ground = project.levels.reduce((low, candidate) =>
      candidate.elevation < low.elevation ? candidate : low,
    );
    this.exterior = buildExterior(project, ground, scene);
    if (project.site && this.exterior) {
      this.exteriorFrame = siteOverviewLevel(ground, project.site, this.exterior.height);
      for (const mesh of this.exterior.meshes) {
        mesh.receiveShadows = true;
        if (this.exterior.roofMeshes.includes(mesh)) shadow.addShadowCaster(mesh);
      }
    }
    this.planOpenings = buildPlanOpenings(scene, level);
    this.wallCutaway = buildWallCutaway(scene, level);
    this.buildDimensions();
    this.setMode('overview');
    scene.onPointerObservable.add((event) => {
      if (
        this.measureMode &&
        event.type === PointerEventTypes.POINTERMOVE &&
        this.measurement?.preview
      ) {
        const hit = scene.pick(
          scene.pointerX,
          scene.pointerY,
          (mesh) => mesh.metadata?.kind === 'floor',
        );
        if (hit?.pickedPoint)
          this.previewMeasurement(
            [hit.pickedPoint.x, hit.pickedPoint.z],
            event.event.shiftKey,
            event.event.altKey,
          );
        return;
      }
      // A fast second measurement click may be classified as a double tap by Babylon.
      if (
        (event.type !== PointerEventTypes.POINTERTAP &&
          !(this.measureMode && event.type === PointerEventTypes.POINTERDOUBLETAP)) ||
        event.event.button !== 0
      )
        return;
      if (this.mode === 'walk') {
        const hit = scene.pickWithRay(this.walk.getForwardRay(2.4));
        if (hit?.pickedMesh?.metadata?.kind === 'door') this.toggleDoor(hit.pickedMesh.metadata.id);
        return;
      }
      if (this.measureMode) {
        const hit = scene.pick(
          scene.pointerX,
          scene.pointerY,
          (mesh) => mesh.metadata?.kind === 'floor',
        );
        if (hit?.pickedPoint)
          this.addMeasurement(
            [hit.pickedPoint.x, hit.pickedPoint.z],
            event.event.shiftKey,
            event.event.altKey,
          );
        return;
      }
      if (this.goToMode) {
        const hit = scene.pick(
          scene.pointerX,
          scene.pointerY,
          (mesh) => mesh.metadata?.kind === 'floor',
        );
        if (hit?.pickedPoint) {
          if (!this.goTo([hit.pickedPoint.x, hit.pickedPoint.z])) this.onDestinationRejected?.();
        }
        return;
      }
      const hit = event.pickInfo;
      if (hit?.pickedMesh?.metadata?.kind === 'furniture') return;
      if (hit?.pickedMesh?.metadata?.kind === 'door') {
        this.toggleDoor(hit.pickedMesh.metadata.id);
        return;
      }
      if (hit?.pickedPoint) {
        const p: Point2 = [hit.pickedPoint.x, hit.pickedPoint.z];
        const room = level.rooms.find((r) => pointInPolygon(p, r.polygon));
        if (room) this.onSelectRoom?.(room.id);
      }
    });
    // Input must be prepared before Babylon updates its active camera, not after rendering starts.
    scene.onBeforeAnimationsObservable.add(() => this.beforeFrame());
    this.resize();
  }

  setMode(mode: ViewMode) {
    if (!this.scene) return;
    this.orbitTour = undefined;
    if (mode === 'walk') {
      const point = findVisitDestination(this.scene, this.level, [
        this.walk.position.x,
        this.walk.position.z,
      ]);
      if (!point) {
        this.onDestinationRejected?.();
        return;
      }
      this.walk.position.set(
        point[0],
        floorElevationAt(this.level, point) + this.eyeHeight,
        point[1],
      );
    }
    this.clearKeys();
    stopOrbit(this.orbit);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.orbit.detachControl();
    this.walk.detachControl();
    this.mode = mode;
    if (mode !== 'overview') this.exteriorView = false;
    this.exterior?.root.setEnabled(mode !== 'plan');
    this.exterior?.roofMeshes.forEach((mesh) =>
      mesh.setEnabled(this.exteriorView && mode === 'overview'),
    );
    this.setGoToMode(false);
    this.setMeasureMode(false);
    if (mode === 'walk') {
      this.scene.activeCamera = this.walk;
      this.walk.attachControl(this.canvas, true);
    } else {
      this.scene.activeCamera = this.orbit;
      this.orbit.attachControl(this.canvas, true);
      this.orbit.mode = mode === 'plan' ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
      if (mode === 'plan') {
        this.planZoom = 1;
        setPlanView(this.orbit, this.level);
        this.setOrthoSize();
      } else {
        this.orbit.lowerAlphaLimit = this.orbit.upperAlphaLimit = null;
        this.orbit.lowerBetaLimit = 0.03;
        this.orbit.upperBetaLimit = Math.PI * 0.48;
        this.orbit.beta = 0.66;
        this.orbit.alpha = Math.PI * 0.66;
        this.fitOverview();
      }
    }
    // The ambience is the only part of a mode change that can fail on a given
    // backend. It must not take the rest with it: the section plane, the cutaways
    // and the chrome all depend on this method reaching its end.
    try {
      this.updateLighting();
      this.updateInteriorAmbience();
    } catch (error) {
      console.info(
        `[visite] ambiance indisponible : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.dimensions.forEach((mesh) => mesh.setEnabled(this.dimensionOn && mode !== 'walk'));
    this.updateSection();
    this.updateCutaway();
    this.onModeChange?.(mode);
  }

  captureMouse() {
    this.canvas.focus();
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function')
        result.catch(() => this.onPointerLockError?.());
    } catch {
      this.onPointerLockError?.();
    }
  }

  /** A previous interrupted furniture gesture must not strand the orbit controls. */
  private recoverOrbitControls(event: PointerEvent) {
    if (!this.scene || this.mode === 'walk' || this.paused || ![0, 2].includes(event.button))
      return;
    this.canvas.focus({ preventScroll: true });
    if (this.orbit.inputs.attachedToElement) return;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.scene.pick(event.clientX - rect.left, event.clientY - rect.top);
    if (hit?.pickedMesh?.metadata?.kind === 'furniture') return;
    this.orbit.attachControl(this.canvas, true);
  }

  focusRoom(id: string, enter = false) {
    const room = this.level.rooms.find((r) => r.id === id);
    if (!room) return;
    if (enter || this.mode === 'walk') {
      const point = findVisitDestination(this.scene, this.level, room.viewpoint);
      if (!point) {
        this.onDestinationRejected?.();
        return;
      }
      this.walk.position.set(
        point[0],
        floorElevationAt(this.level, point) + this.eyeHeight,
        point[1],
      );
      this.walk.rotation.set(
        0,
        cameraYaw(this.level.spawn.yaw, this.scene.useRightHandedSystem),
        0,
      );
      this.walk.cameraDirection.setAll(0);
      if (enter && this.mode !== 'walk') this.setMode('walk');
    }
    this.house.highlights.forEach((m, key) => m.setEnabled(this.mode !== 'walk' && key === id));
  }

  /**
   * Rotation d’aperçu : montre le geste de glisser sans changer la cible ni le cadrage.
   * Toute interaction avec la scène l’interrompt.
   */
  tourOrbit(radians = Math.PI / 3, duration = 1800) {
    if (this.mode !== 'overview' || this.exteriorView || !this.orbit) return false;
    stopOrbit(this.orbit);
    // Le mouvement est décoratif : sans animation, la rotation reste immédiate.
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.orbit.alpha += radians;
      this.orbitTour = undefined;
      return true;
    }
    this.orbitTour = {
      from: this.orbit.alpha,
      to: this.orbit.alpha + radians,
      start: performance.now(),
      duration,
    };
    return true;
  }

  private stepOrbitTour() {
    const tour = this.orbitTour;
    if (!tour || !this.orbit) return;
    const progress = Math.min(1, (performance.now() - tour.start) / tour.duration);
    const eased = progress * progress * (3 - 2 * progress);
    this.orbit.alpha = tour.from + (tour.to - tour.from) * eased;
    if (progress >= 1) this.orbitTour = undefined;
  }

  reset() {
    this.orbitTour = undefined;
    stopOrbit(this.orbit);
    const destination = findVisitDestination(this.scene, this.level, this.level.spawn.position);
    if (!destination && this.mode === 'walk') {
      this.setMode('overview');
      this.onDestinationRejected?.();
    }
    const point = destination ?? this.level.spawn.position;
    this.walk.position.set(
      point[0],
      floorElevationAt(this.level, point) + this.eyeHeight,
      point[1],
    );
    this.walk.rotation.set(0, cameraYaw(this.level.spawn.yaw, this.scene.useRightHandedSystem), 0);
    this.walk.cameraDirection.setAll(0);
    const extent = bounds(this.level.outline);
    this.orbit.setTarget(
      new Vector3(extent.center[0], this.level.elevation + 0.35, extent.center[1]),
      false,
      true,
      true,
    );
    this.orbit.radius = Math.max(extent.width, extent.depth) * 1.9;
    if (this.mode === 'plan') {
      this.planZoom = 1;
      this.setOrthoSize();
    } else if (this.mode === 'overview') {
      this.orbit.alpha = Math.PI * 0.66;
      this.orbit.beta = 0.66;
      this.fitOverview();
    }
    this.clearKeys();
  }

  toggleDoor(id: string) {
    const door = this.house.doors.find((d) => d.id === id);
    if (door) {
      door.open = !door.open;
      door.target = door.open ? 1 : 0;
    }
  }

  setInteriorDoors(open: boolean) {
    this.house.doors
      .filter((d) => !d.exterior)
      .forEach((d) => {
        d.open = open;
        d.target = open ? 1 : 0;
      });
  }

  setLights(enabled: boolean) {
    this.lightOn = enabled;
    this.updateLighting();
  }
  setDimensions(enabled: boolean) {
    this.dimensionOn = enabled;
    this.dimensions.forEach((m) => m.setEnabled(enabled && this.mode !== 'walk'));
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    this.clearKeys();
  }

  setEyeHeight(heightMeters: number) {
    this.eyeHeight = applyEyeHeight(this.walk, this.level, heightMeters);
    return this.eyeHeight;
  }

  setWalkSpeed(metersPerSecond: number) {
    this.walkSpeed = Number.isFinite(metersPerSecond)
      ? Math.max(1, Math.min(5, metersPerSecond))
      : DEFAULT_WALK_SPEED;
    return this.walkSpeed;
  }

  setLookSensitivity(multiplier: number) {
    this.lookSensitivity = applyLookSensitivity(this.walk, multiplier);
    return this.lookSensitivity;
  }

  setGoToMode(enabled: boolean) {
    this.goToMode = enabled && this.mode !== 'walk';
    if (this.goToMode) this.setMeasureMode(false);
    this.canvas.classList.toggle('going-to', this.goToMode);
    this.canvas.style.cursor = this.goToMode ? 'crosshair' : '';
  }

  /** Start a visit at a clear floor point; this is a viewpoint change, not an automatic walk. */
  goTo(point: Point2) {
    if (!isSceneVisitDestination(this.scene, this.level, point)) return false;
    this.walk.position.set(
      point[0],
      floorElevationAt(this.level, point) + this.eyeHeight,
      point[1],
    );
    this.walk.cameraDirection.setAll(0);
    this.setMode('walk');
    this.canvas.focus();
    const room = this.level.rooms.find((r) => pointInPolygon(point, r.polygon));
    if (room) this.onSelectRoom?.(room.id);
    this.onDestination?.(point);
    return true;
  }

  setExteriorView(enabled: boolean) {
    this.exteriorView = enabled && !!this.exteriorFrame && this.mode === 'overview';
    this.exterior?.roofMeshes.forEach((mesh) => mesh.setEnabled(this.exteriorView));
    this.setMeasureMode(false);
    this.setGoToMode(false);
    this.updateSection();
    this.updateCutaway();
    this.updateShadowPolicy();
    if (this.mode === 'overview') this.fitOverview();
  }

  /**
   * What the visit did with its own ambience, for the diagnostic report. The
   * occlusion is created on entering the visit, so an absent pipeline outside the
   * visit means "not asked for", not "refused".
   */
  get ambience(): { environment: boolean; occlusion: OcclusionState } {
    return {
      environment: Boolean(
        this.interiorEnvironment && this.scene?.environmentTexture === this.interiorEnvironment,
      ),
      occlusion:
        this.mode !== 'walk'
          ? 'idle'
          : this.interiorOcclusion
            ? 'active'
            : this.occlusionRefused
              ? 'refused'
              : 'unavailable',
    };
  }

  private fitOverview() {
    fitOverview(
      this.orbit,
      this.exteriorView && this.exteriorFrame ? this.exteriorFrame : this.level,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
  }

  setCutaway(enabled: boolean) {
    this.setWallDisplay(enabled ? 'auto' : 'full');
  }

  setWallDisplay(mode: WallDisplay) {
    this.wallDisplay = mode;
    this.updateCutaway();
    this.updateShadowPolicy();
  }

  setSectionHeight(height: number | undefined) {
    this.sectionHeight = height;
    this.updateSection();
    this.updateCutaway();
    this.updateShadowPolicy();
  }

  setSolar(position?: SolarPosition) {
    this.captureSunPreset();
    this.solarPosition = position;
    this.updateLighting();
  }

  private captureSunPreset() {
    if (!this.baseSun && this.sun?.direction && this.sun.position && this.sun.diffuse) {
      this.baseSun = {
        direction: this.sun.direction.clone(),
        position: this.sun.position.clone(),
        diffuse: this.sun.diffuse.clone(),
      };
    }
  }

  private updateShadowPolicy() {
    if (!this.scene) return;
    const explicitSection = this.sectionHeight !== undefined && Number.isFinite(this.sectionHeight);
    const suppressed =
      this.mode === 'plan' ||
      (this.mode === 'overview' &&
        !this.exteriorView &&
        !explicitSection &&
        (this.wallDisplay ?? 'auto') !== 'full');
    if (suppressed) {
      this.shadowsBeforeReadability ??= this.scene.shadowsEnabled;
      this.scene.shadowsEnabled = false;
    } else if (this.shadowsBeforeReadability !== undefined) {
      this.scene.shadowsEnabled = this.shadowsBeforeReadability;
      this.shadowsBeforeReadability = undefined;
    }
  }

  private updateSection() {
    const height =
      this.sectionHeight ??
      (this.mode === 'plan' ? Math.min(1.2, this.level.ceilingHeight - 0.1) : undefined);
    this.scene.clipPlane =
      this.mode === 'walk' || this.exteriorView ? null : sectionPlane(this.level, height);
    this.planOpenings?.setVisible(this.mode === 'plan' && !this.exteriorView, height);
  }

  private updateCutaway() {
    if (!this.scene || !this.level || !this.orbit) return;
    this.wallCutaway ??= buildWallCutaway(this.scene, this.level);
    const camera: Point2 = [this.orbit.position.x, this.orbit.position.z];
    const active = this.mode === 'overview' && !this.exteriorView;
    const explicitSection = this.sectionHeight !== undefined && Number.isFinite(this.sectionHeight);
    const selected = this.wallCutaway.apply(
      active && !explicitSection ? (this.wallDisplay ?? 'auto') : 'full',
      camera,
    );
    if (this.mode !== 'plan') {
      this.planOpenings?.setVisible(
        active && (explicitSection || selected.size > 0),
        explicitSection ? this.sectionHeight : 1.1,
        {
          markers: false,
          wallIds: explicitSection ? undefined : selected,
        },
      );
    }
  }

  setMeasureMode(enabled: boolean) {
    this.measureMode = enabled && this.mode !== 'walk';
    if (this.measureMode) this.setGoToMode(false);
    this.canvas.classList.toggle('measuring', this.measureMode);
    if (!this.measureMode) {
      this.measurement = undefined;
      this.measureMeshes.forEach((m) => m.dispose());
      this.measureMeshes = [];
      this.measureLine = undefined;
      this.measureCursor = undefined;
      this.onMeasure?.();
    }
  }

  project(point: Point2, height = 0.04) {
    const camera = this.scene.activeCamera!;
    const viewport = camera.viewport.toGlobal(
      this.engine.getRenderWidth(),
      this.engine.getRenderHeight(),
    );
    const v = Vector3.Project(
      new Vector3(point[0], this.level.elevation + height, point[1]),
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      viewport,
    );
    const x = (v.x / this.engine.getRenderWidth()) * this.canvas.clientWidth;
    const y = (v.y / this.engine.getRenderHeight()) * this.canvas.clientHeight;
    return {
      x,
      y,
      visible:
        v.z > 0 &&
        v.z < 1 &&
        x > -30 &&
        y > -30 &&
        x < this.canvas.clientWidth + 30 &&
        y < this.canvas.clientHeight + 30,
    };
  }

  /** Copy WebGL synchronously before the browser discards its drawing buffer. */
  captureCanvas(dimensions = false): HTMLCanvasElement {
    const output = document.createElement('canvas');
    output.width = this.engine.getRenderWidth();
    output.height = this.engine.getRenderHeight();
    const context = output.getContext('2d');
    if (!context) throw new Error('Export image indisponible dans ce navigateur.');
    const changed = new Map<AbstractMesh, boolean>();
    const set = (mesh: AbstractMesh, enabled: boolean) => {
      changed.set(mesh, mesh.isEnabled(false));
      mesh.setEnabled(enabled);
    };
    try {
      this.capturing = true;
      for (const mesh of this.dimensions) set(mesh, dimensions && this.mode !== 'walk');
      for (const mesh of this.measureMeshes) if (!dimensions) set(mesh, false);
      for (const mesh of this.pinnedMeasurements) if (!dimensions) set(mesh, false);
      for (const mesh of this.scene.meshes) {
        if (mesh.metadata?.kind !== 'furniture-overlay') continue;
        const dimension = !!mesh.metadata.label || mesh.name === 'furniture:dimension-label';
        set(mesh, dimensions && dimension);
      }
      // Freeze camera input and animations for this extra render: exporting is not navigation.
      this.scene.render(false, true);
      context.drawImage(this.canvas, 0, 0);
      return output;
    } finally {
      for (const [mesh, enabled] of changed) if (!mesh.isDisposed()) mesh.setEnabled(enabled);
      this.capturing = false;
    }
  }

  private updateLighting() {
    const interior = this.mode === 'walk';
    const plan = this.mode === 'plan';
    this.updateShadowPolicy();
    this.house.ceiling.setEnabled(interior);
    this.house.fixtures.forEach((f) => f.setEnabled(interior));
    this.house.pointLights.forEach((l) => {
      l.setEnabled(this.lightOn && !plan);
      // Written on every call: a per-fixture intensity from project data would be lost here.
      l.intensity = interior ? INTERIOR_FIXTURE_INTENSITY : FIXTURE_LIGHT_INTENSITY;
      l.range = interior ? INTERIOR_FIXTURE_RANGE : FIXTURE_LIGHT_RANGE;
    });
    if (plan) {
      this.planLighting ??= {
        diffuse: this.hemispheric.diffuse?.clone() ?? Color3.White(),
        // The base bounce, never the live one: entering the plan straight from the
        // visit would otherwise snapshot the darker interior colour.
        ground: (this.baseGround ?? this.hemispheric.groundColor)?.clone() ?? Color3.White(),
      };
      this.hemispheric.diffuse = Color3.White();
      this.hemispheric.groundColor = Color3.White();
      this.hemispheric.intensity = 0.9;
      this.sun.intensity = 0;
    } else {
      if (this.planLighting) {
        this.hemispheric.diffuse = this.planLighting.diffuse;
        this.hemispheric.groundColor = this.planLighting.ground;
        this.planLighting = undefined;
      }
      this.baseGround ??= this.hemispheric.groundColor.clone();
      this.hemispheric.groundColor = interior
        ? INTERIOR_GROUND_COLOR.clone()
        : this.baseGround.clone();
      this.hemispheric.intensity = interior ? 0.42 : 0.55;
      this.sun.intensity = 0.95;
      if (this.solarPosition) {
        const solar = this.solarPosition;
        const daylight = solar.daylight && solar.altitudeDeg > 0;
        const direction = new Vector3(
          solar.lightDirection.x,
          solar.lightDirection.y,
          solar.lightDirection.z,
        ).normalize();
        const centre = bounds(this.level.outline).center;
        this.sun.direction = direction;
        this.sun.position = new Vector3(
          centre[0],
          this.level.elevation + this.level.ceilingHeight / 2,
          centre[1],
        ).subtract(direction.scale(30));
        this.sun.intensity = daylight
          ? 0.8 * Math.sqrt(Math.max(0, Math.sin((solar.altitudeDeg * Math.PI) / 180)))
          : 0;
        this.sun.diffuse = Color3.Lerp(
          Color3.FromHexString('#ffbd7a'),
          Color3.FromHexString('#fff5e6'),
          Math.max(0, Math.min(1, solar.altitudeDeg / 35)),
        );
        this.hemispheric.intensity = daylight ? 0.35 : 0.1;
      } else if (this.baseSun) {
        this.sun.direction = this.baseSun.direction.clone();
        this.sun.position = this.baseSun.position.clone();
        this.sun.diffuse = this.baseSun.diffuse.clone();
      }
    }
    if (interior) this.house.highlights.forEach((m) => m.setEnabled(false));
  }

  /**
   * Visit-only ambience. The plan keeps its neutral lighting and the overview its
   * façade cutaways, so both must stay exactly as they were: the environment and
   * the geometry buffer are attached on entering the visit and released on leaving.
   */
  private updateInteriorAmbience() {
    if (!this.scene) return;
    if (this.mode === 'walk') {
      if (!this.interiorAmbienceUnavailable) {
        this.interiorEnvironment ??= createInteriorEnvironment(this.scene);
        if (!this.interiorEnvironment) this.interiorAmbienceUnavailable = true;
      }
      if (this.interiorEnvironment) {
        // Remember what was there, so leaving the visit restores it instead of
        // clearing an environment another feature may have installed.
        if (this.previousEnvironment === undefined) {
          this.previousEnvironment = this.scene.environmentTexture;
          this.previousEnvironmentIntensity = this.scene.environmentIntensity;
        }
        this.scene.environmentTexture = this.interiorEnvironment;
        this.scene.environmentIntensity = INTERIOR_ENVIRONMENT_INTENSITY;
      }
      // Built before the occlusion on purpose: Babylon appends each pipeline to the
      // end of the camera's chain, so the temporal pass has to exist first or it ends
      // up accumulating the AO noise instead of smoothing the scene.
      this.interiorTaa ??= createInteriorTaa(this.scene, this.walk);
      if (!this.occlusionRefused && !this.occlusionUnavailable && !this.interiorOcclusion) {
        this.interiorOcclusion = createInteriorOcclusion(this.scene, this.walk);
        // A backend without multiple render targets refuses every time: remember it
        // rather than throwing again on each visit entry.
        this.occlusionUnavailable = !this.interiorOcclusion;
        this.occlusionProbe = this.interiorOcclusion
          ? startOcclusionProbe(performance.now())
          : undefined;
      }
      // Last in the chain, for the same reason the temporal pass is first: the glow
      // belongs on the finished image, not on the occlusion's half-resolution buffer.
      this.interiorBloom ??= createInteriorBloom(this.scene, this.walk);
      return;
    }
    if (this.interiorEnvironment && this.scene.environmentTexture === this.interiorEnvironment) {
      this.scene.environmentTexture = this.previousEnvironment ?? null;
      this.scene.environmentIntensity = this.previousEnvironmentIntensity;
    }
    this.previousEnvironment = undefined;
    this.previousEnvironmentIntensity = 1;
    this.interiorOcclusion?.dispose(true);
    this.interiorOcclusion = undefined;
    this.interiorTaa?.dispose();
    this.interiorTaa = undefined;
    this.interiorBloom?.dispose();
    this.interiorBloom = undefined;
    // Both pipelines read the PrePass and nothing else does, so it goes with them.
    this.scene.disablePrePassRenderer();
    this.occlusionProbe = undefined;
  }

  /**
   * Ambient occlusion is the expensive part of the visit. The frame rate is
   * watched for as long as the visit lasts, so a room that turns out too heavy
   * later still drops the pipeline; the environment and the fixture lights keep
   * the room readable.
   */
  private probeOcclusionCost() {
    if (!this.occlusionProbe || !this.interiorOcclusion) return;
    const fps = this.engine.getFps();
    const result = nextOcclusionProbe(
      this.occlusionProbe,
      performance.now(),
      fps,
      document.visibilityState === 'visible',
    );
    this.occlusionProbe = result.probe;
    if (!result.refuse) return;
    this.interiorOcclusion.dispose(true);
    this.interiorOcclusion = undefined;
    this.occlusionProbe = undefined;
    this.occlusionRefused = true;
    console.info(`[visite] occlusion ambiante désactivée : ${Math.round(fps)} fps`);
  }

  private setOrthoSize() {
    fitPlan(
      this.orbit,
      this.level,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      this.planZoom,
    );
  }

  private resize() {
    this.engine.resize();
    if (this.mode === 'plan' && this.level) this.setOrthoSize();
    else if (this.mode === 'overview' && this.level && this.orbit) this.fitOverview();
  }

  private beforeFrame() {
    if (this.capturing) return;
    this.probeOcclusionCost();
    this.updateCutaway();
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.045);
    // Match the collision displacement to frame time, including the garage step.
    this.scene.gravity.y = -15 * dt;
    for (const door of this.house.doors) {
      if (Math.abs(door.progress - door.target) > 0.001) {
        door.progress +=
          Math.sign(door.target - door.progress) *
          Math.min(Math.abs(door.target - door.progress), dt * 2.5);
        poseDoor(door);
      }
    }
    if (this.mode === 'walk') {
      const p = this.walk.position;
      // Keep the first version inside the modeled level, including when an outside door is open.
      if (
        !pointInPolygon([p.x, p.z], this.level.outline) ||
        p.y < floorElevationAt(this.level, [p.x, p.z]) + 0.7 ||
        p.y > this.level.elevation + this.level.ceilingHeight + 1
      )
        this.reset();
      const active =
        document.activeElement === this.canvas || document.pointerLockElement === this.canvas;
      let movement = Vector3.Zero();
      if (!this.paused && active) {
        const forward =
          Number(
            this.keyState.has('KeyW') || this.keyState.has('KeyZ') || this.keyState.has('ArrowUp'),
          ) - Number(this.keyState.has('KeyS') || this.keyState.has('ArrowDown'));
        const side =
          Number(this.keyState.has('KeyD') || this.keyState.has('ArrowRight')) -
          Number(
            this.keyState.has('KeyA') ||
              this.keyState.has('KeyQ') ||
              this.keyState.has('ArrowLeft'),
          );
        movement = walkDisplacement(
          this.walk,
          forward,
          side,
          this.walkSpeed,
          dt,
          this.keyState.has('ShiftLeft') || this.keyState.has('ShiftRight'),
        );
      }
      prepareWalkStep(this.walk, this.level, movement);
      this.walk.cameraDirection.addInPlace(movement);
      const room = this.level.rooms.find((r) => pointInPolygon([p.x, p.z], r.polygon));
      const hit = this.scene.pickWithRay(this.walk.getForwardRay(3));
      this.onFrame?.({
        position: [p.x, p.z],
        headingDegrees: planHeading(this.walk),
        planUpDegrees: this.planUpDegrees(),
        roomId: room?.id,
        nearDoor: hit?.pickedMesh?.metadata?.kind === 'door' && hit.distance <= 2.4,
        nearFurnitureId: this.paused ? undefined : editableFurnitureId(hit),
        locked: document.pointerLockElement === this.canvas,
      });
    } else {
      if (
        !this.paused &&
        document.activeElement === this.canvas &&
        this.orbit.inputs.attachedToElement
      ) {
        const forward =
          Number(
            this.keyState.has('KeyW') || this.keyState.has('KeyZ') || this.keyState.has('ArrowUp'),
          ) - Number(this.keyState.has('KeyS') || this.keyState.has('ArrowDown'));
        const side =
          Number(this.keyState.has('KeyD') || this.keyState.has('ArrowRight')) -
          Number(
            this.keyState.has('KeyA') ||
              this.keyState.has('KeyQ') ||
              this.keyState.has('ArrowLeft'),
          );
        panOrbitWithKeys(
          this.orbit,
          forward,
          side,
          dt,
          this.keyState.has('ShiftLeft') || this.keyState.has('ShiftRight'),
        );
      }
      this.onFrame?.({
        position: [this.walk.position.x, this.walk.position.z],
        headingDegrees: planHeading(this.walk),
        planUpDegrees: this.planUpDegrees(),
        nearDoor: false,
        locked: false,
      });
    }
  }

  private keydown = (event: KeyboardEvent) => this.handleKeydown(event);

  private handleKeydown(event: KeyboardEvent) {
    if (
      this.measureMode &&
      this.measureCursor &&
      ['ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'].includes(event.code)
    )
      this.previewMeasurement(this.measureCursor, event.shiftKey, event.altKey);
    if (
      this.paused ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (document.activeElement !== this.canvas && document.pointerLockElement !== this.canvas)
    )
      return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code))
      event.preventDefault();
    if (this.mode === 'walk' && event.code === 'KeyE' && !event.repeat) {
      const hit = this.scene.pickWithRay(this.walk.getForwardRay(2.4));
      if (hit?.pickedMesh?.metadata?.kind === 'door') this.toggleDoor(hit.pickedMesh.metadata.id);
    }
    if (this.mode === 'walk' && event.code === 'KeyF') {
      if (!event.repeat) {
        const id = findEditableFurniture(this.walk, this.scene);
        if (id) {
          event.preventDefault();
          this.onEditFurniture?.(id);
        }
      }
      return;
    }
    this.keyState.add(event.code);
  }
  private planUpDegrees() {
    const center = bounds(this.level.outline).center;
    const origin = this.project(center),
      up = this.project([center[0], center[1] - 1]);
    return (Math.atan2(up.x - origin.x, origin.y - up.y) * 180) / Math.PI;
  }
  private keyup = (event: KeyboardEvent) => {
    this.keyState.delete(event.code);
    if (
      this.measureMode &&
      this.measureCursor &&
      ['ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'].includes(event.code)
    )
      this.previewMeasurement(this.measureCursor, event.shiftKey, event.altKey);
  };
  private clearKeys = () => {
    this.keyState.clear();
    this.walk?.cameraDirection.setAll(0);
  };
  private planWheel = (event: WheelEvent) => {
    if (this.mode !== 'plan') return;
    event.preventDefault();
    this.zoomPlan(Math.exp(event.deltaY * 0.001));
  };

  private zoomPlan(factor: number) {
    if (this.mode !== 'plan' || !Number.isFinite(factor) || factor <= 0) return;
    this.planZoom = Math.max(0.18, Math.min(4, this.planZoom * factor));
    this.setOrthoSize();
  }

  private previewMeasurement(point: Point2, forceAxis = false, free = false) {
    if (!this.measurement?.preview) return;
    this.measureCursor = point;
    const snapped = measurementEndpoint(this.measurement.a, point, forceAxis, free);
    this.measurement.b = snapped.point;
    this.measurement.aligned = snapped.aligned;
    this.measurement.distance = Math.hypot(
      snapped.point[0] - this.measurement.a[0],
      snapped.point[1] - this.measurement.a[1],
    );
    const points = [this.measurement.a, snapped.point].map(
      (p) => new Vector3(p[0], floorElevationAt(this.level, p) + 0.04, p[1]),
    );
    if (this.measureLine)
      MeshBuilder.CreateLines('measurement', { points, instance: this.measureLine }, this.scene);
    else {
      this.measureLine = MeshBuilder.CreateLines(
        'measurement',
        { points, updatable: true },
        this.scene,
      );
      this.measureLine.isPickable = false;
      this.measureMeshes.push(this.measureLine);
    }
    this.measureLine.color = Color3.FromHexString('#5e9377');
    this.onMeasure?.(this.measurement);
  }

  private addMeasurement(point: Point2, forceAxis = false, free = false) {
    if (!this.measurement?.preview) {
      this.measureMeshes.forEach((m) => m.dispose());
      this.measureMeshes = [];
      this.measureLine = undefined;
      this.measureCursor = undefined;
      this.measurement = { a: point, preview: true };
    } else {
      this.previewMeasurement(point, forceAxis, free);
      point = this.measurement.b!;
      this.measurement.preview = false;
      if (this.measureLine) this.measureLine.color = Color3.FromHexString('#27634e');
      this.measureCursor = undefined;
    }
    const dot = MeshBuilder.CreateSphere(
      'measure-point',
      { diameter: 0.07, segments: 12 },
      this.scene,
    );
    dot.position.set(point[0], floorElevationAt(this.level, point) + 0.045, point[1]);
    dot.material = this.house.highlights.values().next().value?.material ?? null;
    dot.isPickable = false;
    this.measureMeshes.push(dot);
    if (!this.measurement.preview) {
      this.pinnedMeasurements.push(...this.measureMeshes);
      this.measureMeshes = [];
      this.measureLine = undefined;
    }
    this.onMeasure?.(this.measurement);
  }

  /** Validated measurements stay on the floor until explicitly cleared. */
  clearPinnedMeasurements(): boolean {
    const had = this.pinnedMeasurements.length > 0;
    this.pinnedMeasurements.forEach((mesh) => mesh.dispose());
    this.pinnedMeasurements = [];
    return had;
  }

  private buildDimensions() {
    const b = bounds(this.level.outline);
    const y = this.level.elevation + 0.02;
    const line = (name: string, points: Point2[]) => {
      const mesh = MeshBuilder.CreateLines(
        name,
        { points: points.map(([x, z]) => new Vector3(x, y, z)) },
        this.scene,
      );
      mesh.color = Color3.FromHexString('#88938a');
      mesh.isPickable = false;
      this.dimensions.push(mesh);
    };
    line('width-dimension', [
      [b.minX, b.maxZ + 0.25],
      [b.minX, b.maxZ + 0.6],
      [b.maxX, b.maxZ + 0.6],
      [b.maxX, b.maxZ + 0.25],
    ]);
    line('depth-dimension', [
      [b.maxX + 0.25, b.minZ],
      [b.maxX + 0.6, b.minZ],
      [b.maxX + 0.6, b.maxZ],
      [b.maxX + 0.25, b.maxZ],
    ]);
    this.dimensions.forEach((m) => m.setEnabled(false));
  }

  dispose() {
    this.wallCutaway?.dispose();
    this.planOpenings?.dispose();
    this.interiorOcclusion?.dispose(true);
    this.interiorOcclusion = undefined;
    this.interiorTaa?.dispose();
    this.interiorTaa = undefined;
    this.interiorBloom?.dispose();
    this.interiorBloom = undefined;
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.clearKeys);
    document.removeEventListener('pointerlockchange', this.clearKeys);
    document.removeEventListener('pointerlockerror', this.pointerLockError);
    this.canvas.removeEventListener('blur', this.clearKeys);
    this.resizeObserver.disconnect();
    this.scene?.dispose();
    this.engine.dispose();
    this.canvas.removeEventListener('wheel', this.planWheel);
    this.canvas.removeEventListener('pointerdown', this.orbitPointerDown, true);
  }
}
