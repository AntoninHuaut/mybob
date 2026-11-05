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
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
// Side effects required for picking, shadows, and collision coordination.
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject, Level, Point2 } from '../model/types';
import { bounds, pointInPolygon } from '../model/geometry';
import { buildHouse, poseDoor, type HouseScene } from './buildHouse';
import { createMaterials } from './materials';
import { createWalkCamera, EYE_HEIGHT } from './walkCamera';
import { fitOverview, frameInsets } from './framing';

export type ViewMode = 'overview' | 'plan' | 'walk';
export interface FrameInfo {
  position: Point2;
  yaw: number;
  roomId?: string;
  nearDoor: boolean;
  locked: boolean;
}
export interface Measurement { a: Point2; b?: Point2; distance?: number }

export class HouseViewer {
  readonly engine: Engine;
  scene!: Scene;
  orbit!: ArcRotateCamera;
  walk!: UniversalCamera;
  house!: HouseScene;
  level!: Level;
  mode: ViewMode = 'overview';
  measureMode = false;
  measurement?: Measurement;
  onSelectRoom?: (id: string) => void;
  onFrame?: (frame: FrameInfo) => void;
  onMeasure?: (measurement?: Measurement) => void;
  onPointerLockError?: () => void;
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

  constructor(readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { alpha: true, stencil: true, powerPreference: 'high-performance' }, false);
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.6));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.clearKeys);
    document.addEventListener('pointerlockchange', this.clearKeys);
    canvas.addEventListener('pointerlockerror', () => this.onPointerLockError?.());
    canvas.addEventListener('blur', this.clearKeys);
    canvas.addEventListener('wheel', this.planWheel, { passive: false });
    this.engine.runRenderLoop(() => {
      if (this.scene) this.scene.render();
    });
  }

  load(project: HouseProject, levelId?: string) {
    this.scene?.dispose();
    this.keyState.clear(); this.measurement = undefined; this.measureMode = false;
    this.measureMeshes = []; this.dimensions = [];
    this.level = project.levels.find(l => l.id === levelId) ?? project.levels[0];
    const level = this.level;
    const scene = this.scene = new Scene(this.engine);
    scene.clearColor = new Color4(.918, .925, .906, 0);
    scene.ambientColor = Color3.FromHexString('#dfdfd4');
    scene.collisionsEnabled = true;
    scene.gravity = new Vector3(0, -.25, 0);
    scene.imageProcessingConfiguration.exposure = 1.12;
    scene.imageProcessingConfiguration.contrast = 1.12;
    const extent = bounds(level.outline);
    const center = new Vector3(extent.center[0], level.elevation + .35, extent.center[1]);
    this.orbit = new ArcRotateCamera('overview', Math.PI * .66, .66, Math.max(extent.width, extent.depth) * 1.9, center, scene);
    this.orbit.lowerRadiusLimit = 2;
    this.orbit.upperRadiusLimit = Math.max(extent.width, extent.depth) * 6;
    this.orbit.lowerBetaLimit = .03; this.orbit.upperBetaLimit = Math.PI * .48;
    this.orbit.wheelPrecision = 35; this.orbit.panningSensibility = 85;
    this.orbit.minZ = .03; this.orbit.maxZ = 1000;
    this.orbit.fov = .66;
    this.orbit.inertia = .7;
    this.orbit.attachControl(this.canvas, true);

    this.walk = createWalkCamera(scene, level);
    this.hemispheric = new HemisphericLight('sky', new Vector3(.3, 1, -.1), scene);
    this.hemispheric.intensity = .9;
    this.hemispheric.groundColor = Color3.FromHexString('#b6b4a2');
    this.sun = new DirectionalLight('sunlight', new Vector3(.5, -1, -.45), scene);
    this.sun.position = new Vector3(extent.center[0] - 9, level.elevation + 16, extent.center[1] + 12);
    this.sun.intensity = 1.3;
    this.sun.diffuse = Color3.FromHexString('#fff5df');
    const shadow = new ShadowGenerator(2048, this.sun);
    shadow.usePercentageCloserFiltering = true;
    shadow.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadow.bias = .001; shadow.normalBias = .025;
    shadow.setDarkness(.2);
    this.house = buildHouse(level, scene, createMaterials(scene, project.finishes), shadow);
    this.buildDimensions();
    this.setMode('overview');
    scene.onPointerObservable.add(event => {
      if (event.type !== PointerEventTypes.POINTERTAP || event.event.button !== 0) return;
      if (this.mode === 'walk') {
        const hit = scene.pickWithRay(this.walk.getForwardRay(2.4));
        if (hit?.pickedMesh?.metadata?.kind === 'door') this.toggleDoor(hit.pickedMesh.metadata.id);
        return;
      }
      if (this.measureMode) {
        const hit = scene.pick(scene.pointerX, scene.pointerY, mesh => mesh.metadata?.kind === 'floor');
        if (hit?.pickedPoint) this.addMeasurement([hit.pickedPoint.x, hit.pickedPoint.z]);
        return;
      }
      const hit = event.pickInfo;
      if (hit?.pickedMesh?.metadata?.kind === 'door') {
        this.toggleDoor(hit.pickedMesh.metadata.id); return;
      }
      if (hit?.pickedPoint) {
        const p: Point2 = [hit.pickedPoint.x, hit.pickedPoint.z];
        const room = level.rooms.find(r => pointInPolygon(p, r.polygon));
        if (room) this.onSelectRoom?.(room.id);
      }
    });
    scene.onBeforeRenderObservable.add(() => this.beforeFrame());
    this.resize();
  }

  setMode(mode: ViewMode) {
    if (!this.scene) return;
    this.clearKeys();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.orbit.detachControl(); this.walk.detachControl();
    this.mode = mode;
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
        this.orbit.alpha = Math.PI / 2; this.orbit.beta = .001;
        this.orbit.lowerBetaLimit = .001; this.orbit.upperBetaLimit = .001;
        const extent = bounds(this.level.outline);
        this.orbit.setTarget(new Vector3(extent.center[0], this.level.elevation, extent.center[1]), false, true, true);
        this.setOrthoSize();
      } else {
        this.orbit.lowerBetaLimit = .03; this.orbit.upperBetaLimit = Math.PI * .48;
        this.orbit.beta = .66; this.orbit.alpha = Math.PI * .66;
        fitOverview(this.orbit, this.level, this.canvas.clientWidth, this.canvas.clientHeight);
      }
    }
    this.updateLighting();
    this.dimensions.forEach(mesh => mesh.setEnabled(this.dimensionOn && mode !== 'walk'));
  }

  captureMouse() {
    this.canvas.focus();
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => this.onPointerLockError?.());
    } catch { this.onPointerLockError?.(); }
  }

  focusRoom(id: string, enter = false) {
    const room = this.level.rooms.find(r => r.id === id);
    if (!room) return;
    if (enter || this.mode === 'walk') {
      this.walk.position.set(room.viewpoint[0], this.level.elevation + EYE_HEIGHT, room.viewpoint[1]);
      this.walk.rotation.set(0, this.level.spawn.yaw, 0);
      this.walk.cameraDirection.setAll(0);
      if (enter && this.mode !== 'walk') this.setMode('walk');
    }
    this.house.highlights.forEach((m, key) => m.setEnabled(this.mode !== 'walk' && key === id));
  }

  reset() {
    this.walk.position.set(this.level.spawn.position[0], this.level.elevation + EYE_HEIGHT, this.level.spawn.position[1]);
    this.walk.rotation.set(0, this.level.spawn.yaw, 0);
    this.walk.cameraDirection.setAll(0);
    const extent = bounds(this.level.outline);
    this.orbit.setTarget(new Vector3(extent.center[0], this.level.elevation + .35, extent.center[1]), false, true, true);
    this.orbit.radius = Math.max(extent.width, extent.depth) * 1.9;
    if (this.mode === 'plan') { this.planZoom = 1; this.setOrthoSize(); }
    else if (this.mode === 'overview') {
      this.orbit.alpha = Math.PI * .66; this.orbit.beta = .66;
      fitOverview(this.orbit, this.level, this.canvas.clientWidth, this.canvas.clientHeight);
    }
    this.clearKeys();
  }

  toggleDoor(id: string) {
    const door = this.house.doors.find(d => d.id === id);
    if (door) { door.open = !door.open; door.target = door.open ? 1 : 0; }
  }

  setInteriorDoors(open: boolean) {
    this.house.doors.filter(d => !d.exterior).forEach(d => { d.open = open; d.target = open ? 1 : 0; });
  }

  setLights(enabled: boolean) { this.lightOn = enabled; this.updateLighting(); }
  setCeiling(enabled: boolean) { this.ceilingOn = enabled; this.updateLighting(); }
  setDimensions(enabled: boolean) { this.dimensionOn = enabled; this.dimensions.forEach(m => m.setEnabled(enabled && this.mode !== 'walk')); }
  setPaused(paused: boolean) { this.paused = paused; this.clearKeys(); }

  setMeasureMode(enabled: boolean) {
    this.measureMode = enabled && this.mode !== 'walk';
    this.canvas.classList.toggle('measuring', this.measureMode);
    if (!this.measureMode) { this.measurement = undefined; this.measureMeshes.forEach(m => m.dispose()); this.measureMeshes = []; this.onMeasure?.(); }
  }

  project(point: Point2, height = .04) {
    const camera = this.scene.activeCamera!;
    const viewport = camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const v = Vector3.Project(new Vector3(point[0], this.level.elevation + height, point[1]), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), viewport);
    const x = v.x / this.engine.getRenderWidth() * this.canvas.clientWidth;
    const y = v.y / this.engine.getRenderHeight() * this.canvas.clientHeight;
    return { x, y, visible: v.z > 0 && v.z < 1 && x > -30 && y > -30 && x < this.canvas.clientWidth + 30 && y < this.canvas.clientHeight + 30 };
  }

  private updateLighting() {
    const interior = this.mode === 'walk';
    this.house.ceiling.setEnabled(interior || (this.ceilingOn && this.mode === 'overview'));
    this.house.fixtures.forEach(f => f.setEnabled(interior || (this.ceilingOn && this.mode === 'overview')));
    this.house.pointLights.forEach(l => l.setEnabled(this.lightOn));
    this.hemispheric.intensity = interior ? .64 : .92;
    this.sun.intensity = this.lightOn ? 1.15 : 1.35;
    if (interior) this.house.highlights.forEach(m => m.setEnabled(false));
  }

  private setOrthoSize() {
    const extent = bounds(this.level.outline);
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    const inset = frameInsets(width, height);
    const aspect = width / height;
    const halfHeight = Math.max((extent.depth + 1.4) * height / (height - 2 * Math.max(inset.top, inset.bottom)), (extent.width + 1.4) * height / (width - 2 * Math.max(inset.left, inset.right))) / 2 * this.planZoom;
    this.orbit.orthoTop = halfHeight; this.orbit.orthoBottom = -halfHeight;
    this.orbit.orthoLeft = -halfHeight * aspect; this.orbit.orthoRight = halfHeight * aspect;
  }

  private resize() {
    this.engine.resize();
    if (this.mode === 'plan' && this.level) this.setOrthoSize();
    else if (this.mode === 'overview' && this.level && this.orbit) fitOverview(this.orbit, this.level, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  private beforeFrame() {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, .045);
    for (const door of this.house.doors) {
      if (Math.abs(door.progress - door.target) > .001) {
        door.progress += Math.sign(door.target - door.progress) * Math.min(Math.abs(door.target - door.progress), dt * 2.5);
        poseDoor(door);
      }
    }
    if (this.mode === 'walk') {
      const p = this.walk.position;
      // Keep the first version inside the modeled level, including when an outside door is open.
      if (!pointInPolygon([p.x, p.z], this.level.outline) || p.y < this.level.elevation + .7 || p.y > this.level.elevation + this.level.ceilingHeight + 1) this.reset();
      const active = document.activeElement === this.canvas || document.pointerLockElement === this.canvas;
      if (!this.paused && active) {
        const forward = Number(this.keyState.has('KeyW') || this.keyState.has('KeyZ') || this.keyState.has('ArrowUp')) - Number(this.keyState.has('KeyS') || this.keyState.has('ArrowDown'));
        const side = Number(this.keyState.has('KeyD') || this.keyState.has('ArrowRight')) - Number(this.keyState.has('KeyA') || this.keyState.has('KeyQ') || this.keyState.has('ArrowLeft'));
        const yaw = this.walk.rotation.y;
        const movement = new Vector3(Math.sin(yaw) * forward + Math.cos(yaw) * side, 0, Math.cos(yaw) * forward - Math.sin(yaw) * side);
        if (movement.lengthSquared()) {
          movement.normalize().scaleInPlace((this.keyState.has('ShiftLeft') || this.keyState.has('ShiftRight') ? 3.6 : 2.1) * dt);
          this.walk.cameraDirection.addInPlace(movement);
        }
      }
      const room = this.level.rooms.find(r => pointInPolygon([p.x, p.z], r.polygon));
      const hit = this.scene.pickWithRay(this.walk.getForwardRay(2.4));
      this.onFrame?.({ position: [p.x, p.z], yaw: this.walk.rotation.y, roomId: room?.id, nearDoor: hit?.pickedMesh?.metadata?.kind === 'door', locked: document.pointerLockElement === this.canvas });
    } else {
      this.onFrame?.({ position: [this.walk.position.x, this.walk.position.z], yaw: this.walk.rotation.y, nearDoor: false, locked: false });
    }
  }

  private keydown = (event: KeyboardEvent) => {
    if (this.mode !== 'walk' || this.paused || (document.activeElement !== this.canvas && document.pointerLockElement !== this.canvas)) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    if (event.code === 'KeyE' && !event.repeat) {
      const hit = this.scene.pickWithRay(this.walk.getForwardRay(2.4));
      if (hit?.pickedMesh?.metadata?.kind === 'door') this.toggleDoor(hit.pickedMesh.metadata.id);
    }
    this.keyState.add(event.code);
  };
  private keyup = (event: KeyboardEvent) => { this.keyState.delete(event.code); };
  private clearKeys = () => { this.keyState.clear(); this.walk?.cameraDirection.setAll(0); };
  private planWheel = (event: WheelEvent) => {
    if (this.mode !== 'plan') return;
    event.preventDefault();
    this.planZoom = Math.max(.18, Math.min(4, this.planZoom * Math.exp(event.deltaY * .001)));
    this.setOrthoSize();
  };

  private addMeasurement(point: Point2) {
    if (!this.measurement || this.measurement.b) {
      this.measureMeshes.forEach(m => m.dispose()); this.measureMeshes = [];
      this.measurement = { a: point };
    } else {
      this.measurement.b = point;
      this.measurement.distance = Math.hypot(point[0] - this.measurement.a[0], point[1] - this.measurement.a[1]);
      const a = this.measurement.a;
      const line = MeshBuilder.CreateLines('measurement', { points: [new Vector3(a[0], this.level.elevation + .04, a[1]), new Vector3(point[0], this.level.elevation + .04, point[1])] }, this.scene);
      line.color = Color3.FromHexString('#27634e'); line.isPickable = false; this.measureMeshes.push(line);
    }
    const dot = MeshBuilder.CreateSphere('measure-point', { diameter: .07, segments: 12 }, this.scene);
    dot.position.set(point[0], this.level.elevation + .045, point[1]); dot.material = this.house.highlights.values().next().value?.material ?? null; dot.isPickable = false;
    this.measureMeshes.push(dot);
    this.onMeasure?.(this.measurement);
  }

  private buildDimensions() {
    const b = bounds(this.level.outline);
    const y = this.level.elevation + .02;
    const line = (name: string, points: Point2[]) => {
      const mesh = MeshBuilder.CreateLines(name, { points: points.map(([x, z]) => new Vector3(x, y, z)) }, this.scene);
      mesh.color = Color3.FromHexString('#88938a'); mesh.isPickable = false; this.dimensions.push(mesh);
    };
    line('width-dimension', [[b.minX, b.maxZ + .25], [b.minX, b.maxZ + .6], [b.maxX, b.maxZ + .6], [b.maxX, b.maxZ + .25]]);
    line('depth-dimension', [[b.maxX + .25, b.minZ], [b.maxX + .6, b.minZ], [b.maxX + .6, b.maxZ], [b.maxX + .25, b.maxZ]]);
    this.dimensions.forEach(m => m.setEnabled(false));
  }

  dispose() {
    window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup);
    window.removeEventListener('blur', this.clearKeys); document.removeEventListener('pointerlockchange', this.clearKeys);
    this.resizeObserver.disconnect(); this.scene?.dispose(); this.engine.dispose();
    this.canvas.removeEventListener('wheel', this.planWheel);
  }
}
