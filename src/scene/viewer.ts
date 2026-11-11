import { createScreenLines } from './screenLines';
import { refreshFixtureLights } from './fixtureLights';
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
import type { GreasedLineMesh } from '@babylonjs/core/Meshes/GreasedLine/greasedLineMesh';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
// Side effects required for picking, shadows, and collision coordination.
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject, Level, Point2, ProjectSite } from '../model/types';
import { bounds, floorElevationAt, groundElevationAt, pointInPolygon } from '../model/geometry';
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
import { builtOutline, exteriorOverview, fitOverview, fitPlan, siteOverviewLevel } from './framing';
import { panOrbitWithKeys } from './orbitNavigation';
import { buildPlanOpenings, type PlanOpenings } from './planOpenings';
import { ShadowRefresh } from './shadowRefresh';
import { furnitureRevision, furnitureObstaclesRevision } from '../furniture/layer';
import { RenderScheduler, WAKE_EVENTS } from './renderScheduler';
import { nextPaint, viewKey, ViewWarmth, warmFrames } from './shaderWarmup';
import { shaderLog } from './shaderLog';
import { AdaptiveResolution } from './adaptiveResolution';
import {
  AUTO_CUT_HEIGHT,
  buildWallCutaway,
  type WallCutaway,
  type WallDisplay,
} from './wallCutaway';
import type { SolarPosition } from './solar';
import {
  applyEyeHeight,
  findVisitDestination,
  isParcelDestination,
  isSceneVisitDestination,
  isVisitArea,
  sectionPlane,
} from './navigation';
import {
  cameraYaw,
  planHeading,
  setPlanView,
  stopOrbit,
  usePlanCoordinates,
  yawFromDirection,
} from './coordinates';
import {
  INTERIOR_FIXTURE_INTENSITY,
  INTERIOR_FIXTURE_RANGE,
  INTERIOR_GROUND_COLOR,
} from './interiorAmbience';
import { ViewEffects } from './viewEffects';
import type { OcclusionState } from './diagnostics';
import type { ImmersiveWalk } from './xrWalk';

export type ViewMode = 'overview' | 'plan' | 'walk';

/** True when this browser can open a headset session (Quest browser, desktop VR). */
export async function isImmersiveSupported(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false;
  } catch {
    return false;
  }
}

/** Fetches the headset code ahead of the click: a slow import would outlive the user gesture. */
export function preloadImmersive() {
  return import('./xrWalk');
}
export interface FrameInfo {
  cameraMoved?: boolean;
  furnitureObstaclesRevision?: number;
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
  private currentExteriorView = false;
  get exteriorView(): boolean {
    return this.currentExteriorView;
  }
  private exteriorFrame?: Level;
  /** Parcel corners the exterior framing must keep on screen, in world coordinates. */
  private parcelInView: Vector3[] | undefined;
  /** Built silhouette corners, ground to roof apex, to grade the exterior azimuth. */
  private exteriorSubject: Vector3[] = [];
  /** Parcel of the loaded project: the visit may walk on it, outside the house. */
  private site?: ProjectSite;
  level!: Level;
  private currentMode: ViewMode = 'overview';
  get mode(): ViewMode {
    return this.currentMode;
  }
  measureMode = false;
  measurement?: Measurement;
  onSelectRoom?: (id: string) => void;
  onFrame?: (frame: FrameInfo) => void;
  onMeasure?: (measurement?: Measurement) => void;
  onPointerLockError?: () => void;
  /** Optional host policy, checked before any transition side effects. */
  canChangeMode?: (mode: ViewMode) => boolean;
  onViewChange?: (mode: ViewMode) => void;
  onDestination?: (point: Point2) => void;
  onDestinationRejected?: () => void;
  onEditFurniture?: (id: string) => void;
  /** The headset session started (true) or ended (false). */
  onImmersiveChange?: (active: boolean) => void;
  goToMode = false;
  /** The visit in a headset, a state of the walk: `mode` stays `walk` meanwhile. */
  private immersive?: ImmersiveWalk;
  private immersiveStarting = false;
  /** Walk post-processing in the headset; B or Y switches it to compare frame rates. */
  private immersiveEffects = true;
  private eyeHeight = EYE_HEIGHT;
  private walkSpeed = DEFAULT_WALK_SPEED;
  private lookSensitivity = 1;
  private wallDisplay: WallDisplay = 'auto';
  private wallCutaway?: WallCutaway;
  private cutawaySelection = '';
  private shadowRefresh?: ShadowRefresh;
  private furnitureRevision = -1;
  private walkRayDirty = true;
  private walkHit?: PickingInfo | null;
  private readonly renderScheduler = new RenderScheduler();
  private readonly warmth = new ViewWarmth();
  private preparing = false;
  /** The host shows its overlay while shaders are linked; `first` is the start-up, not a switch. */
  onPreparing?: (active: boolean, first: boolean) => void;
  private readonly adaptiveResolution = new AdaptiveResolution(
    Math.min(window.devicePixelRatio || 1, 1.6),
  );
  /** Hardware scaling at full resolution: the screen's pixel ratio, capped. */
  private readonly baseScaling = 1 / Math.min(window.devicePixelRatio || 1, 1.6);
  private renderScale = 1;
  private lastRenderAt?: number;
  /** Any input anywhere in the page may change what the scene shows. */
  private wake = () => this.renderScheduler.request();
  private sectionHeight?: number;
  private planOpenings?: PlanOpenings;
  private dimensions: GreasedLineMesh[] = [];
  private measureMeshes: AbstractMesh[] = [];
  private pinnedMeasurements: AbstractMesh[] = [];
  private measureLine?: GreasedLineMesh;
  private measureCursor?: Point2;
  private keyState = new Set<string>();
  private hemispheric!: HemisphericLight;
  private sun!: DirectionalLight;
  private planLighting?: { diffuse: Color3; ground: Color3 };
  private baseGround?: Color3;
  private viewEffects?: ViewEffects;
  private shadowsBeforeReadability?: boolean;
  private solarPosition?: SolarPosition;
  private baseSun?: { direction: Vector3; position: Vector3; diffuse: Color3 };
  private lightOn = true;
  private dimensionOn = false;
  private paused = false;
  private capturing = false;
  private planZoom = 1;
  private resizeObserver: ResizeObserver;
  private pointerLockError = () => this.onPointerLockError?.();
  private captureRetry: number | undefined;
  private orbitTour: { from: number; to: number; start: number; duration: number } | undefined;
  private orbitPointerDown = (event: PointerEvent) => {
    this.cancelOrbitTour();
    // In walk mode without a locked pointer, a click in the view must take the
    // capture back: the toast after a failed capture sends the user here.
    if (
      this.mode === 'walk' &&
      !this.paused &&
      event.button === 0 &&
      document.pointerLockElement !== this.canvas
    ) {
      this.captureMouse();
      return;
    }
    this.recoverOrbitControls(event);
  };

  constructor(
    readonly canvas: HTMLCanvasElement,
    engine: AbstractEngine,
  ) {
    this.engine = engine;
    this.engine.setHardwareScalingLevel(this.baseScaling);
    shaderLog.attach(engine);
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
    for (const type of WAKE_EVENTS)
      window.addEventListener(type, this.wake, { capture: true, passive: true });
    this.engine.runRenderLoop(() => {
      this.stepOrbitTour();
      if (!this.scene) return;
      // A view whose shaders are not linked yet is prepared behind the host's overlay
      // instead of freezing the page for seconds while it draws.
      if (this.preparing || (!this.immersive && this.warmth.isCold(this.currentViewKey()))) {
        if (!this.preparing) void this.prepareView();
        this.lastRenderAt = undefined;
        return;
      }
      const now = performance.now();
      // A headset shows the last image again on a skipped frame, which judders:
      // in a session every frame is drawn, at the resolution the headset chose.
      const render =
        !!this.immersive ||
        this.renderScheduler.shouldRender(now, this.cameraSignature(), () => this.busy());
      if (!this.immersive) this.applyRenderScale(now, render);
      if (render) {
        this.scene.render();
        this.updateOrbitBloom();
      }
      this.lastRenderAt = render ? now : undefined;
    });
  }

  /** Release scene-owned resources before replacing the scene or disposing the viewer. */
  private releaseScene() {
    // The session belongs to the scene about to be disposed.
    this.immersive?.dispose();
    this.immersive = undefined;
    this.wallCutaway?.dispose();
    this.wallCutaway = undefined;
    this.planOpenings?.dispose();
    this.planOpenings = undefined;
    this.viewEffects?.dispose();
    this.viewEffects = undefined;
    if (this.scene) {
      this.scene.dispose();
      this.engine.releaseEffects();
    }
    this.planLighting = undefined;
    this.shadowsBeforeReadability = undefined;
    this.baseSun = undefined;
    this.baseGround = undefined;
    this.exterior = undefined;
    this.exteriorFrame = undefined;
    this.parcelInView = undefined;
    this.exteriorSubject = [];
    this.currentExteriorView = false;
    this.keyState.clear();
    this.measurement = undefined;
    this.measureMode = false;
    this.measureMeshes = [];
    this.pinnedMeasurements = [];
    this.measureLine = undefined;
    this.measureCursor = undefined;
    this.dimensions = [];
  }

  load(project: HouseProject, levelId?: string) {
    // Optional: scene tests build a viewer from its prototype, without the constructor.
    this.warmth?.reset();
    this.requestRender();
    this.cancelOrbitTour();
    this.releaseScene();
    this.level = project.levels.find((l) => l.id === levelId) ?? project.levels[0];
    this.site = project.site;
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
    this.shadowRefresh = new ShadowRefresh(shadow);
    this.cutawaySelection = '';
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
    // The exterior is the building's, not the displayed level's: the façades
    // are those of the lowest level, the roof covers the rest, and the upper
    // levels' openings are cut through it. Building from the attic only showed
    // the roof, and put the lawn at its altitude.
    const ground = project.levels.reduce((low, candidate) =>
      candidate.elevation < low.elevation ? candidate : low,
    );
    this.exterior = buildExterior(project, ground, scene);
    refreshFixtureLights(scene);
    const exteriorScene = this.exterior;
    if (project.site && exteriorScene) {
      const site = project.site;
      this.exteriorFrame = siteOverviewLevel(ground, site, exteriorScene.height);
      // The plot stays a visible background: framing does not follow it, it
      // fits it in the whole image without making it the frame.
      const yard = ground.elevation + site.elevation;
      this.parcelInView = site.boundary.map(([x, z]) => new Vector3(x, yard, z));
      this.exteriorSubject = builtOutline(ground, site).flatMap(([x, z]) => [
        new Vector3(x, yard, z),
        new Vector3(x, ground.elevation + exteriorScene.height, z),
      ]);
      for (const mesh of this.exterior.meshes) {
        mesh.receiveShadows = true;
        if (this.exterior.roofMeshes.includes(mesh)) shadow.addShadowCaster(mesh);
      }
    }
    this.planOpenings = buildPlanOpenings(scene, level);
    this.wallCutaway = buildWallCutaway(scene, level);
    this.buildDimensions();
    refreshFixtureLights(scene);
    this.setMode('overview');
    this.attachSceneInput(scene, level);
    this.resize();
  }

  /** Babylon clears both observers when this scene is disposed. */
  private attachSceneInput(scene: Scene, level: Level) {
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
  }

  setMode(mode: ViewMode, exterior = false, destination?: Point2): boolean {
    if (!this.scene || this.canChangeMode?.(mode) === false) return false;
    if (this.immersive && mode === 'walk') return true;
    if (mode === 'walk') {
      const current: Point2 = [this.walk.position.x, this.walk.position.z];
      // Coming back from the plan while standing on the parcel keeps that spot:
      // the visit is not only an interior viewpoint any more.
      const point =
        destination !== undefined
          ? isSceneVisitDestination(this.scene, this.level, destination)
            ? destination
            : undefined
          : (findVisitDestination(this.scene, this.level, current) ??
            (isParcelDestination(this.level, this.site, current) ? current : undefined));
      if (!point) {
        this.onDestinationRejected?.();
        return false;
      }
      this.walk.position.set(
        point[0],
        groundElevationAt(this.level, this.site, point) + this.eyeHeight,
        point[1],
      );
    }
    this.requestRender();
    this.cancelOrbitTour();
    if (this.immersive) {
      // The session ends asynchronously; `leaveImmersive` then restores this mode's camera.
      void this.immersive.exit();
    }
    this.clearKeys();
    this.cancelCaptureRetry();
    stopOrbit(this.orbit);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.orbit.detachControl();
    this.walk.detachControl();
    this.currentMode = mode;
    this.currentExteriorView = exterior && mode === 'overview' && !!this.exteriorFrame;
    this.exterior?.root.setEnabled(mode !== 'plan');
    this.updateRoofVisibility();
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
      this.updateOrbitBloom();
    } catch (error) {
      console.info(
        `[visite] ambiance indisponible : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.dimensions.forEach((mesh) => mesh.setEnabled(this.dimensionOn && mode !== 'walk'));
    this.updateSection();
    this.updateCutaway();
    if (this.exteriorView && this.exteriorFrame) {
      exteriorOverview(
        this.orbit,
        this.exteriorFrame,
        this.exteriorSubject,
        this.parcelInView,
        this.canvas.clientWidth,
        this.canvas.clientHeight,
      );
    }
    this.onViewChange?.(mode);
    return true;
  }

  private currentViewKey(): string {
    return viewKey(this.mode, this.exteriorView);
  }

  private async prepareView() {
    const scene = this.scene;
    const key = this.currentViewKey();
    const first = this.warmth.untouched;
    this.preparing = true;
    shaderLog.mark(`préparation : ${key}`);
    this.onPreparing?.(true, first);
    try {
      await nextPaint();
      await warmFrames({
        renderFrame: () => {
          if (scene !== this.scene || scene.isDisposed) return;
          scene.render();
          this.updateOrbitBloom();
        },
        effectsReady: () => this.engine.areAllEffectsReady(),
      });
    } catch (error) {
      console.info(
        `[vue] préchauffage des shaders interrompu : ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // A scene replaced meanwhile has released its effects: it stays cold.
      if (scene === this.scene) this.warmth.markWarm(key);
      shaderLog.mark(`prête : ${key}`);
      this.preparing = false;
      this.requestRender();
      this.onPreparing?.(false, first);
    }
  }

  /** Resolves once the current view is drawn for real; gives up after `timeoutMs`. */
  async whenReady(timeoutMs = 20000): Promise<void> {
    const end = performance.now() + timeoutMs;
    while (
      this.scene &&
      (this.preparing || this.warmth.isCold(this.currentViewKey())) &&
      performance.now() < end
    )
      await new Promise((resolve) => setTimeout(resolve, 16));
  }

  captureMouse() {
    this.canvas.focus();
    this.cancelCaptureRetry();
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function')
        result.catch(() => this.scheduleCaptureRetry());
    } catch {
      this.scheduleCaptureRetry();
    }
  }

  /**
   * Chromium refuses a new capture for about a second after the pointer lock
   * left through the keyboard (Escape): a request inside that window rejects.
   * Retry once at the end of the window, while the click's activation still
   * holds; only a second failure is reported to the user.
   */
  private scheduleCaptureRetry() {
    this.captureRetry = window.setTimeout(() => {
      this.captureRetry = undefined;
      if (this.mode !== 'walk' || this.paused || document.pointerLockElement === this.canvas)
        return;
      try {
        const result = this.canvas.requestPointerLock();
        if (result && typeof result.catch === 'function')
          result.catch(() => this.onPointerLockError?.());
      } catch {
        this.onPointerLockError?.();
      }
    }, 1300);
  }

  private cancelCaptureRetry() {
    if (this.captureRetry === undefined) return;
    window.clearTimeout(this.captureRetry);
    this.captureRetry = undefined;
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
      if (enter && this.mode !== 'walk' && !this.setMode('walk', false, point)) return;
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
    }
    this.house.highlights.forEach((m, key) => m.setEnabled(this.mode !== 'walk' && key === id));
  }

  /**
   * Preview rotation: shows the drag gesture without changing the target or the framing.
   * Any interaction with the scene interrupts it.
   */
  tourOrbit(radians = Math.PI / 3, duration = 1800) {
    if (this.mode !== 'overview' || this.exteriorView || !this.orbit) return false;
    stopOrbit(this.orbit);
    // The motion is decorative: without animation, the rotation stays immediate.
    const immediate = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.orbitTour = {
      from: this.orbit.alpha,
      to: this.orbit.alpha + radians,
      start: performance.now(),
      duration: immediate ? 0 : duration,
    };
    this.canvas.dataset.orbitTour = 'running';
    this.canvas.dataset.orbitTourAngle = '0';
    if (immediate) this.stepOrbitTour();
    return true;
  }

  private cancelOrbitTour() {
    if (this.orbitTour) this.canvas.dataset.orbitTour = 'cancelled';
    this.orbitTour = undefined;
  }

  private stepOrbitTour() {
    const tour = this.orbitTour;
    if (!tour || !this.orbit) return;
    const progress =
      tour.duration <= 0 ? 1 : Math.min(1, (performance.now() - tour.start) / tour.duration);
    const eased = progress * progress * (3 - 2 * progress);
    this.orbit.alpha = tour.from + (tour.to - tour.from) * eased;
    this.canvas.dataset.orbitTourAngle = String(this.orbit.alpha - tour.from);
    if (progress >= 1) {
      this.orbitTour = undefined;
      this.canvas.dataset.orbitTour = 'complete';
    }
  }

  reset() {
    this.cancelOrbitTour();
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
    this.eyeHeight = applyEyeHeight(
      this.walk,
      this.level,
      heightMeters,
      groundElevationAt(this.level, this.site, [this.walk.position.x, this.walk.position.z]),
    );
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
    if (!this.setMode('walk', false, point)) return false;
    this.walk.cameraDirection.setAll(0);
    this.canvas.focus();
    const room = this.level.rooms.find((r) => pointInPolygon(point, r.polygon));
    if (room) this.onSelectRoom?.(room.id);
    this.onDestination?.(point);
    return true;
  }

  setExteriorView(enabled: boolean) {
    return this.setMode('overview', enabled);
  }

  /**
   * The roof is what makes the house whole from outside: the exterior view shows
   * it, and so does the visit, which can now step out onto the parcel. Inside, the
   * ceiling hides it.
   */
  private updateRoofVisibility() {
    const visible = this.mode === 'walk' || (this.exteriorView && this.mode === 'overview');
    this.exterior?.roofMeshes.forEach((mesh) => mesh.setEnabled(visible));
    this.shadowRefresh?.invalidate();
  }

  /**
   * What the visit did with its own ambience, for the diagnostic report. The
   * occlusion is created on entering the visit, so an absent pipeline outside the
   * visit means "not asked for", not "failed".
   */
  get ambience(): { environment: boolean; occlusion: OcclusionState } {
    return (
      this.viewEffects?.status(this.mode === 'walk') ?? {
        environment: false,
        occlusion: this.mode === 'walk' ? 'unavailable' : 'idle',
      }
    );
  }

  private fitOverview() {
    // The plot only enters the computation in exterior view: the interior frames
    // on the level, as before.
    const frame = this.exteriorView && this.exteriorFrame ? this.exteriorFrame : this.level;
    fitOverview(
      this.orbit,
      frame,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
      this.exteriorView && this.exteriorFrame ? this.parcelInView : undefined,
    );
  }

  setCutaway(enabled: boolean) {
    this.setWallDisplay(enabled ? 'auto' : 'full');
  }

  setWallDisplay(mode: WallDisplay) {
    this.requestRender();
    this.wallDisplay = mode;
    this.updateCutaway();
    this.updateShadowPolicy();
  }

  setSectionHeight(height: number | undefined) {
    this.requestRender();
    this.sectionHeight = height;
    this.updateSection();
    this.updateCutaway();
    this.updateShadowPolicy();
  }

  setSolar(position?: SolarPosition) {
    this.requestRender();
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
    // Every caller changed the mode, the cut, the sun or the walls on show.
    this.shadowRefresh?.invalidate();
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
    // Only a different set of cut walls changes the casters.
    const selection = [...selected].join('|');
    if (selection !== this.cutawaySelection) {
      this.cutawaySelection = selection;
      this.shadowRefresh?.invalidate();
    }
    if (this.mode !== 'plan') {
      this.planOpenings?.setVisible(
        active && (explicitSection || selected.size > 0),
        explicitSection ? this.sectionHeight : AUTO_CUT_HEIGHT,
        {
          markers: false,
          wallIds: explicitSection ? undefined : selected,
          continuous: true,
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

  /**
   * Screen overlays project through the unjittered camera. The temporal pipeline writes
   * its sample offset into the camera's cached projection matrix; the still image is the
   * average of those offsets, so a label or a measure tag read through the jittered matrix
   * trembles on every settle frame. The cached matrix is put back so the next geometry
   * pass keeps its own sample.
   */
  private overlayTransform(): Matrix {
    const camera = this.scene.activeCamera!;
    const jittered = camera.getProjectionMatrix().clone();
    const clean = camera.getProjectionMatrix(true).clone();
    camera.getProjectionMatrix().copyFrom(jittered);
    return camera.getViewMatrix().multiply(clean);
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
      this.overlayTransform(),
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
      const render = () => this.scene.render(false, true);
      if (this.viewEffects) this.viewEffects.renderCapture(render);
      else render();
      context.drawImage(this.canvas, 0, 0);
      return output;
    } finally {
      for (const [mesh, enabled] of changed) if (!mesh.isDisposed()) mesh.setEnabled(enabled);
      this.capturing = false;
      this.scene.activeCamera?.resetViewHistory?.();
      this.requestRender();
    }
  }

  private updateLighting() {
    const interior = this.mode === 'walk';
    const plan = this.mode === 'plan';
    this.updateShadowPolicy();
    this.house.ceiling.setEnabled(interior);
    this.house.fixtures.forEach((f) => f.setEnabled(interior));
    let rangesChanged = false;
    this.house.pointLights.forEach((l) => {
      l.setEnabled(this.lightOn && !plan);
      // Written on every call: a per-fixture intensity from project data would be lost here.
      l.intensity = interior ? INTERIOR_FIXTURE_INTENSITY : FIXTURE_LIGHT_INTENSITY;
      const range = interior ? INTERIOR_FIXTURE_RANGE : FIXTURE_LIGHT_RANGE;
      rangesChanged ||= l.range !== range;
      l.range = range;
    });
    if (rangesChanged) refreshFixtureLights(this.scene);
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
      this.hemispheric.intensity = interior ? 0.42 : 0.45;
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
    this.viewEffects ??= new ViewEffects(this.scene, undefined, undefined, () =>
      this.requestRender(),
    );
    this.viewEffects.updateEnvironment(this.mode, this.sun.direction);
    if (interior) this.house.highlights.forEach((m) => m.setEnabled(false));
  }

  /**
   * Visit-only ambience. The plan keeps its neutral lighting and the overview its
   * façade cutaways, so both must stay exactly as they were: the environment and
   * the geometry buffer are attached on entering the visit and released on leaving.
   */
  private updateInteriorAmbience() {
    if (!this.scene) return;
    this.viewEffects ??= new ViewEffects(this.scene, undefined, undefined, () =>
      this.requestRender(),
    );
    this.viewEffects.updateWalk({
      active: this.mode === 'walk',
      camera: this.immersive?.camera ?? this.walk,
      headset: Boolean(this.immersive),
      effectsEnabled: this.immersiveEffects,
      effectTier: this.currentEffectTier,
    });
    this.viewEffects.updateEnvironment(this.mode, this.sun.direction);
  }

  private rebuildWalkPipelines() {
    if (!this.scene) return;
    this.viewEffects?.releaseWalkPipelines();
    try {
      this.updateInteriorAmbience();
    } catch (error) {
      console.info(
        `[visite] ambiance indisponible : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.requestRender();
  }

  get immersiveActive(): boolean {
    return !!this.immersive;
  }

  /**
   * Opens the visit in a headset, from the walk only. Rejects with the browser's
   * error when the session cannot start (no headset, permission refused).
   */
  async enterImmersive() {
    if (this.immersive || this.immersiveStarting || this.mode !== 'walk' || !this.scene) return;
    this.immersiveStarting = true;
    try {
      const { startImmersiveWalk } = await preloadImmersive();
      this.clearKeys();
      this.cancelCaptureRetry();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      const scene = this.scene;
      const walk = await startImmersiveWalk({
        scene,
        level: this.level,
        site: this.site,
        start: { point: [this.walk.position.x, this.walk.position.z], yaw: this.walk.rotation.y },
        isDestination: (point) =>
          isSceneVisitDestination(scene, this.level, point) ||
          isParcelDestination(this.level, this.site, point),
        toggleDoor: (id) => this.toggleDoor(id),
        toggleEffects: () => {
          this.immersiveEffects = !this.immersiveEffects;
          this.rebuildWalkPipelines();
        },
        // Built on the first headset frame: before it, the framebuffer may have no size
        // yet and the pipelines' textures would be created empty, hiding the whole scene.
        onReady: (ready) => {
          if (this.immersive === ready) this.rebuildWalkPipelines();
        },
        onEnd: (ended) => this.leaveImmersive(ended),
      });
      // A project load or a mode change may have happened while the session started.
      if (this.scene !== scene || this.mode !== 'walk' || !walk.active) {
        walk.dispose();
        return;
      }
      this.immersive = walk;
      // The screen walk's pipelines are bound to its camera: dropped until the headset is ready.
      this.viewEffects?.releaseWalkPipelines();
      this.onImmersiveChange?.(true);
    } finally {
      this.immersiveStarting = false;
    }
  }

  async exitImmersive() {
    await this.immersive?.exit();
  }

  /** Back to the screen where the headset left the visitor, at the chosen eye height. */
  private leaveImmersive(walk: ImmersiveWalk) {
    if (this.immersive !== walk) return;
    const [x, z] = walk.position;
    const forward = walk.camera.getDirection(Vector3.Forward(true));
    this.immersive = undefined;
    walk.dispose();
    if (!this.scene || !this.walk) return;
    this.walk.position.set(x, groundElevationAt(this.level, this.site, [x, z]) + this.eyeHeight, z);
    this.walk.rotation.set(0, yawFromDirection(forward), 0);
    this.walk.cameraDirection.setAll(0);
    // Babylon restored the camera that was active on entry; the mode may have changed since.
    this.walk.detachControl();
    this.orbit.detachControl();
    if (this.mode === 'walk') {
      this.scene.activeCamera = this.walk;
      this.walk.attachControl(this.canvas, true);
    } else {
      this.scene.activeCamera = this.orbit;
      this.orbit.attachControl(this.canvas, true);
    }
    this.rebuildWalkPipelines();
    this.onImmersiveChange?.(false);
  }

  /**
   * Orbit bloom: the 3D view (cut façades) and the Exterior (sun,
   * roof, sky). Plan shares the camera in orthographic mode — a plan must
   * bloom nothing, the pipeline is turned off without being destroyed: rebuilding it
   * on every switch would cost recreating a post-processing chain.
   */
  private updateOrbitBloom() {
    if (!this.scene || !this.orbit) return;
    this.viewEffects?.updateOrbit(this.mode === 'overview', this.orbit);
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

  /** Asks for images until the scene is still again; the loop skips them otherwise. */
  requestRender() {
    this.walkRayDirty = true;
    // Optional: scene tests build a viewer from its prototype, without the constructor.
    this.renderScheduler?.request();
  }

  /** True while the loop only redraws once a second because nothing moves. */
  get renderingIdle(): boolean {
    return this.renderScheduler?.idle ?? false;
  }

  /**
   * Fewer pixels on a machine too slow for 40 fps, at rest and in motion alike: a resize
   * hitches, so it never follows the camera (`adaptiveResolution.ts`).
   */
  private applyRenderScale(now: number, render: boolean) {
    const frameMs = render && this.lastRenderAt !== undefined ? now - this.lastRenderAt : undefined;
    const scale = this.adaptiveResolution.update(frameMs);
    this.applyEffectTier();
    if (scale === this.renderScale) return;
    this.renderScale = scale;
    this.engine.setHardwareScalingLevel(this.baseScaling / scale);
    // The targets were resized: the image is drawn again and settled.
    this.renderScheduler.request();
  }

  /**
   * Lighter visit effects once the resolution is at its floor and the machine is still
   * under 40 fps (`adaptiveResolution.ts`). Idempotent: also called as the pipelines are built.
   */
  private applyEffectTier() {
    if (this.viewEffects?.applyEffectTier(this.currentEffectTier)) this.requestRender();
  }

  /** Effect tier in use on this machine (0 = full quality), for the diagnostic. */
  get currentEffectTier(): number {
    return this.adaptiveResolution?.effectTier ?? 0;
  }

  /** Render scale in use on this machine (1 = full resolution), for the diagnostic. */
  get currentRenderScale(): number {
    return this.adaptiveResolution?.scale ?? 1;
  }

  /** Everything about the active camera that changes the image, rounded under visibility. */
  private cameraSignature(): string {
    const camera = this.scene.activeCamera;
    if (!camera) return '';
    const values = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
      camera.fov,
      camera.mode,
      camera.orthoLeft ?? 0,
      camera.orthoRight ?? 0,
      camera.orthoTop ?? 0,
      camera.orthoBottom ?? 0,
      // The canvas size, not the render size: the adaptive resolution changes the
      // latter, and must not read as a camera motion.
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    ];
    if (camera === this.orbit) {
      const o = this.orbit;
      values.push(o.alpha, o.beta, o.radius, o.target.x, o.target.y, o.target.z);
      // Inertia still to spend moves the camera on the next images.
      values.push(
        o.inertialAlphaOffset,
        o.inertialBetaOffset,
        o.inertialRadiusOffset,
        o.inertialPanningX,
        o.inertialPanningY,
      );
    } else if (camera === this.walk) {
      const w = this.walk;
      values.push(w.rotation.x, w.rotation.y, w.rotation.z);
      values.push(w.cameraDirection.x, w.cameraDirection.y, w.cameraDirection.z);
      values.push(w.cameraRotation.x, w.cameraRotation.y);
    }
    return values.map((value) => value.toFixed(4)).join(',');
  }

  /** Changes on screen that no event announces: held keys, swinging doors, compiling shaders. */
  private busy(): boolean {
    return (
      this.keyState.size > 0 ||
      this.orbitTour !== undefined ||
      this.capturing ||
      !!this.house?.doors.some((door) => Math.abs(door.progress - door.target) > 0.001) ||
      (this.shadowRefresh !== undefined && !this.shadowRefresh.settled) ||
      !this.engine.areAllEffectsReady() ||
      this.scene.getWaitingItemsCount() > 0
    );
  }

  private resize() {
    this.requestRender();
    this.engine.resize();
    if (this.mode === 'plan' && this.level) this.setOrthoSize();
    else if (this.mode === 'overview' && this.level && this.orbit) this.fitOverview();
  }

  private beforeFrame() {
    if (this.capturing) return;
    const revision = furnitureRevision(this.scene);
    if (revision !== this.furnitureRevision) {
      this.furnitureRevision = revision;
      this.walkRayDirty = true;
      const map = this.sun?.getShadowGenerator()?.getShadowMap();
      if (map?.renderList) {
        map.renderList = map.renderList.filter(
          (mesh) => mesh.metadata?.kind !== 'furniture' && !mesh.isDisposed(),
        );
        map.renderList.push(
          ...this.scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture'),
        );
      }
      this.shadowRefresh?.invalidate();
    }
    // Prototype-based scene tests have no scheduler; treat their explicit frames
    // as fresh observations rather than reusing an untracked camera signature.
    const cameraMoved = this.renderScheduler?.cameraMoved ?? true;
    if (cameraMoved && this.mode === 'overview' && !this.exteriorView) this.updateCutaway();
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.045);
    // Match the collision displacement to frame time, including the garage step.
    this.scene.gravity.y = -15 * dt;
    let doorsMoved = false;
    for (const door of this.house.doors) {
      if (Math.abs(door.progress - door.target) > 0.001) {
        door.progress +=
          Math.sign(door.target - door.progress) *
          Math.min(Math.abs(door.target - door.progress), dt * 2.5);
        poseDoor(door);
        doorsMoved = true;
        this.shadowRefresh?.invalidate();
      }
    }
    this.shadowRefresh?.step();
    if (this.immersive) {
      this.immersive.step(dt);
      const position = this.immersive.position;
      this.onFrame?.({
        cameraMoved,
        furnitureObstaclesRevision: furnitureObstaclesRevision(this.scene),
        position,
        headingDegrees: planHeading(this.immersive.camera),
        planUpDegrees: this.planUpDegrees(),
        roomId: this.level.rooms.find((r) => pointInPolygon(position, r.polygon))?.id,
        nearDoor: false,
        locked: true,
      });
      return;
    }
    if (this.mode === 'walk') {
      const p = this.walk.position;
      // The visit may leave the house onto the parcel, but never the modeled ground:
      // outside the parcel, under the floor, or above the ceiling.
      if (
        !isVisitArea(this.level, this.site, [p.x, p.z]) ||
        p.y < groundElevationAt(this.level, this.site, [p.x, p.z]) + 0.7 ||
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
      prepareWalkStep(this.walk, this.level, movement, this.site);
      this.walk.cameraDirection.addInPlace(movement);
      const room = this.level.rooms.find((r) => pointInPolygon([p.x, p.z], r.polygon));
      if (cameraMoved || doorsMoved || this.walkRayDirty) {
        this.walkHit = this.scene.pickWithRay(this.walk.getForwardRay(3));
        this.walkRayDirty = false;
      }
      const hit = this.walkHit;
      this.onFrame?.({
        cameraMoved,
        furnitureObstaclesRevision: furnitureObstaclesRevision(this.scene),
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
        cameraMoved,
        furnitureObstaclesRevision: furnitureObstaclesRevision(this.scene),
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
    if (this.measureLine) this.measureLine.setPoints([points]);
    else {
      this.measureLine = createScreenLines(
        'measurement',
        [points],
        this.scene,
        Color3.FromHexString('#5e9377'),
      );
      this.measureMeshes.push(this.measureLine);
    }
    this.measureLine.greasedLineMaterial!.color = Color3.FromHexString('#5e9377');
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
      if (this.measureLine)
        this.measureLine.greasedLineMaterial!.color = Color3.FromHexString('#27634e');
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
    const polylines: Point2[][] = [
      [
        [b.minX, b.maxZ + 0.25],
        [b.minX, b.maxZ + 0.6],
        [b.maxX, b.maxZ + 0.6],
        [b.maxX, b.maxZ + 0.25],
      ],
      [
        [b.maxX + 0.25, b.minZ],
        [b.maxX + 0.6, b.minZ],
        [b.maxX + 0.6, b.maxZ],
        [b.maxX + 0.25, b.maxZ],
      ],
    ];
    this.dimensions.push(
      createScreenLines(
        'overall-dimensions',
        polylines.map((points) => points.map(([x, z]) => new Vector3(x, y, z))),
        this.scene,
        Color3.FromHexString('#88938a'),
      ),
    );
    this.dimensions.forEach((m) => m.setEnabled(false));
  }

  dispose() {
    this.cancelCaptureRetry();
    this.releaseScene();
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.clearKeys);
    document.removeEventListener('pointerlockchange', this.clearKeys);
    document.removeEventListener('pointerlockerror', this.pointerLockError);
    this.canvas.removeEventListener('blur', this.clearKeys);
    this.resizeObserver.disconnect();
    this.engine.dispose();
    this.canvas.removeEventListener('wheel', this.planWheel);
    this.canvas.removeEventListener('pointerdown', this.orbitPointerDown, true);
    for (const type of WAKE_EVENTS) window.removeEventListener(type, this.wake, true);
  }
}
