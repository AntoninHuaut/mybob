import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
// Side effects required for picking, shadows, and collision coordination.
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject, Level, Point2 } from '../model/types';
import { bounds, floorElevationAt, pointInPolygon } from '../model/geometry';
import { buildHouse, poseDoor, type HouseScene } from './buildHouse';
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
import {
  applyEyeHeight,
  findVisitDestination,
  isSceneVisitDestination,
  sectionPlane,
  wallFacesCamera,
} from './navigation';
import { cameraYaw, planHeading, setPlanView, stopOrbit, usePlanCoordinates } from './coordinates';

export type ViewMode = 'overview' | 'plan' | 'walk';
export interface FrameInfo {
  position: Point2;
  headingDegrees: number;
  planUpDegrees: number;
  roomId?: string;
  nearDoor: boolean;
  locked: boolean;
}
export interface Measurement {
  a: Point2;
  b?: Point2;
  distance?: number;
}

/** Babylon scales pan deltas by the inverse of this value, in world metres. */
export function configureOrbitInteractions(camera: ArcRotateCamera) {
  camera.panningSensibility = 1000;
}

export class HouseViewer {
  readonly engine: Engine;
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
  goToMode = false;
  private eyeHeight = EYE_HEIGHT;
  private walkSpeed = DEFAULT_WALK_SPEED;
  private lookSensitivity = 1;
  private cutaway = false;
  private sectionHeight?: number;
  private exteriorMeshes: {
    wall: Level['walls'][number];
    meshes: { mesh: AbstractMesh; visibility: number; pickable: boolean }[];
  }[] = [];
  private dimensions: LinesMesh[] = [];
  private measureMeshes: AbstractMesh[] = [];
  private keyState = new Set<string>();
  private hemispheric!: HemisphericLight;
  private sun!: DirectionalLight;
  private lightOn = true;
  private ceilingOn = false;
  private dimensionOn = false;
  private paused = false;
  private planZoom = 1;
  private resizeObserver: ResizeObserver;
  private pointerLockError = () => this.onPointerLockError?.();
  private orbitPointerDown = (event: PointerEvent) => this.recoverOrbitControls(event);

  constructor(readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(
      canvas,
      true,
      { alpha: true, stencil: true, powerPreference: 'high-performance' },
      false,
    );
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
      if (this.scene) this.scene.render();
    });
  }

  load(project: HouseProject, levelId?: string) {
    this.scene?.dispose();
    this.exterior = undefined;
    this.exteriorFrame = undefined;
    this.exteriorView = false;
    this.keyState.clear();
    this.measurement = undefined;
    this.measureMode = false;
    this.measureMeshes = [];
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
    configureOrbitInteractions(this.orbit);
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
    this.sun = new DirectionalLight('sunlight', new Vector3(0.5, -1, -0.45), scene);
    this.sun.position = new Vector3(
      extent.center[0] - 9,
      level.elevation + 16,
      extent.center[1] + 12,
    );
    this.sun.intensity = 1.3;
    this.sun.diffuse = Color3.FromHexString('#fff5df');
    const shadow = new ShadowGenerator(2048, this.sun);
    shadow.usePercentageCloserFiltering = true;
    shadow.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadow.bias = 0.001;
    shadow.normalBias = 0.025;
    shadow.setDarkness(0.2);
    this.house = buildHouse(level, scene, createMaterials(scene, project.finishes), shadow);
    this.exterior = buildExterior(project, level, scene);
    if (project.site && this.exterior) {
      this.exteriorFrame = siteOverviewLevel(level, project.site, this.exterior.height);
      for (const mesh of this.exterior.meshes) {
        mesh.receiveShadows = true;
        if (this.exterior.roofMeshes.includes(mesh)) shadow.addShadowCaster(mesh);
      }
    }
    this.exteriorMeshes = level.walls
      .filter((wall) => wall.exterior)
      .map((wall) => ({
        wall,
        meshes: [
          ...(scene.getTransformNodeByName(`wall:${wall.id}`)?.getChildMeshes() ?? []),
          ...(this.exterior?.facadeMeshes.filter((mesh) => mesh.metadata?.wallId === wall.id) ??
            []),
        ].map((mesh) => ({
          mesh,
          visibility: mesh.visibility,
          pickable: mesh.isPickable,
        })),
      }));
    this.buildDimensions();
    this.setMode('overview');
    scene.onPointerObservable.add((event) => {
      if (event.type !== PointerEventTypes.POINTERTAP || event.event.button !== 0) return;
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
        if (hit?.pickedPoint) this.addMeasurement([hit.pickedPoint.x, hit.pickedPoint.z]);
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
    this.updateLighting();
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
    if (
      !this.scene ||
      this.mode === 'walk' ||
      this.paused ||
      ![0, 2].includes(event.button) ||
      this.orbit.inputs.attachedToElement
    )
      return;
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

  reset() {
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
  setCeiling(enabled: boolean) {
    this.ceilingOn = enabled;
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
    if (this.mode === 'overview') this.fitOverview();
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
    this.cutaway = enabled;
    this.updateCutaway();
  }

  setSectionHeight(height: number | undefined) {
    this.sectionHeight = height;
    this.updateSection();
  }

  private updateSection() {
    this.scene.clipPlane =
      this.mode === 'walk' || this.exteriorView
        ? null
        : sectionPlane(this.level, this.sectionHeight);
  }

  private updateCutaway() {
    const camera: Point2 = [this.orbit.position.x, this.orbit.position.z];
    for (const { wall, meshes } of this.exteriorMeshes) {
      const hidden =
        this.cutaway &&
        !this.exteriorView &&
        this.mode === 'overview' &&
        wallFacesCamera(this.level, wall, camera);
      // Visibility is independent of Babylon's collision flag. Restore completely in a visit.
      for (const { mesh, visibility, pickable } of meshes) {
        mesh.visibility = hidden ? 0 : visibility;
        mesh.isPickable = hidden ? false : pickable;
      }
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

  private updateLighting() {
    const interior = this.mode === 'walk';
    this.house.ceiling.setEnabled(interior || (this.ceilingOn && this.mode === 'overview'));
    this.house.fixtures.forEach((f) =>
      f.setEnabled(interior || (this.ceilingOn && this.mode === 'overview')),
    );
    this.house.pointLights.forEach((l) => l.setEnabled(this.lightOn));
    this.hemispheric.intensity = interior ? 0.42 : 0.55;
    this.sun.intensity = 0.95;
    if (interior) this.house.highlights.forEach((m) => m.setEnabled(false));
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
      const hit = this.scene.pickWithRay(this.walk.getForwardRay(2.4));
      this.onFrame?.({
        position: [p.x, p.z],
        headingDegrees: planHeading(this.walk),
        planUpDegrees: this.planUpDegrees(),
        roomId: room?.id,
        nearDoor: hit?.pickedMesh?.metadata?.kind === 'door',
        locked: document.pointerLockElement === this.canvas,
      });
    } else {
      this.onFrame?.({
        position: [this.walk.position.x, this.walk.position.z],
        headingDegrees: planHeading(this.walk),
        planUpDegrees: this.planUpDegrees(),
        nearDoor: false,
        locked: false,
      });
    }
  }

  private keydown = (event: KeyboardEvent) => {
    if (
      this.mode !== 'walk' ||
      this.paused ||
      (document.activeElement !== this.canvas && document.pointerLockElement !== this.canvas)
    )
      return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code))
      event.preventDefault();
    if (event.code === 'KeyE' && !event.repeat) {
      const hit = this.scene.pickWithRay(this.walk.getForwardRay(2.4));
      if (hit?.pickedMesh?.metadata?.kind === 'door') this.toggleDoor(hit.pickedMesh.metadata.id);
    }
    this.keyState.add(event.code);
  };
  private planUpDegrees() {
    const center = bounds(this.level.outline).center;
    const origin = this.project(center),
      up = this.project([center[0], center[1] - 1]);
    return (Math.atan2(up.x - origin.x, origin.y - up.y) * 180) / Math.PI;
  }
  private keyup = (event: KeyboardEvent) => {
    this.keyState.delete(event.code);
  };
  private clearKeys = () => {
    this.keyState.clear();
    this.walk?.cameraDirection.setAll(0);
  };
  private planWheel = (event: WheelEvent) => {
    if (this.mode !== 'plan') return;
    event.preventDefault();
    this.planZoom = Math.max(0.18, Math.min(4, this.planZoom * Math.exp(event.deltaY * 0.001)));
    this.setOrthoSize();
  };

  private addMeasurement(point: Point2) {
    if (!this.measurement || this.measurement.b) {
      this.measureMeshes.forEach((m) => m.dispose());
      this.measureMeshes = [];
      this.measurement = { a: point };
    } else {
      this.measurement.b = point;
      this.measurement.distance = Math.hypot(
        point[0] - this.measurement.a[0],
        point[1] - this.measurement.a[1],
      );
      const a = this.measurement.a;
      const line = MeshBuilder.CreateLines(
        'measurement',
        {
          points: [
            new Vector3(a[0], floorElevationAt(this.level, a) + 0.04, a[1]),
            new Vector3(point[0], floorElevationAt(this.level, point) + 0.04, point[1]),
          ],
        },
        this.scene,
      );
      line.color = Color3.FromHexString('#27634e');
      line.isPickable = false;
      this.measureMeshes.push(line);
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
    this.onMeasure?.(this.measurement);
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
