import { createScreenLines } from './screenLines';
import { refreshFixtureLights } from './fixtureLights';
import { createSkyLayer, WALK_SKY_GAIN } from './sky';
import type { Layer } from '@babylonjs/core/Layers/layer';
import { installCanonicalDefineOrder } from './canonicalDefines';
import { installSunShadowSkip } from './sunShadowSkip';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HouseOrbitPointersInput } from './orbitPointerInput';
import { MeasureTool, type Measurement } from './measureTool';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { GreasedLineMesh } from '@babylonjs/core/Meshes/GreasedLine/greasedLineMesh';
// Side effects required for picking, shadows, and collision coordination.
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject, Level, Point2, ProjectSite } from '../model/types';
import { levelAbove, stairPassage, stairsDown, type StairDirection } from '../model/stairs';
import { bounds, floorElevationAt, groundElevationAt, pointInPolygon } from '../model/geometry';
import { buildHouse, type HouseScene } from './buildHouse';
import { createMaterials, type Materials } from './materials';
import { buildExterior, type ExteriorScene } from './buildExterior';
import {
  applyLookSensitivity,
  createWalkCamera,
  DEFAULT_WALK_SPEED,
  EYE_HEIGHT,
} from './walkCamera';
import { builtOutline, exteriorOverview, fitOverview, fitPlan, siteOverviewLevel } from './framing';
import { panOrbitWithKeys } from './orbitNavigation';
import {
  anySwinging,
  editableFurnitureId,
  HeldKeys,
  outsideVisit,
  stepSwings,
  stepWalk,
  WALK_REACH,
  WalkAim,
} from './frameMotion';
import { buildPlanOpenings, type PlanOpenings } from './planOpenings';
import { ShadowRefresh } from './shadowRefresh';
import { furnitureRevision, furnitureObstaclesRevision } from '../furniture/layer';
import { RenderScheduler, WAKE_EVENTS, wakesScene } from './renderScheduler';
import {
  isSoftwareRenderer,
  nextPaint,
  PreparationProgress,
  viewKey,
  ViewWarmth,
  warmFrames,
} from './shaderWarmup';
import { RefreshRateEstimator } from './deviceProfile';
import { pluginSummary, shaderLog } from './shaderLog';
import {
  MAX_PIXEL_RATIO,
  upscaleCap,
  ViewResolutions,
  type Quality,
  type QualityStart,
} from './adaptiveResolution';
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
  applyFixtureLights,
  applyShadowTier,
  createSceneLighting,
  type SceneLighting,
} from './sceneLighting';
import { ViewEffects } from './viewEffects';
import { buildWallPaint, pickWallFace } from './wallPaint';
import type { OcclusionState } from './diagnostics';
import type { ImmersiveWalk } from './xrWalk';
import { HeadsetSession } from './headsetSession';
import { roofWindowWells } from '../model/ceiling';

export type ViewMode = 'overview' | 'plan' | 'walk';
/** Plan pointer events offered to an edit tool before the camera and the default click. */
export type PlanPointerKind = 'down' | 'move' | 'up' | 'tap';
export interface PlanView {
  target: [number, number, number];
  halfHeight: number;
}

export interface FrameInfo {
  cameraMoved?: boolean;
  furnitureObstaclesRevision?: number;
  position: Point2;
  headingDegrees: number;
  planUpDegrees: number;
  roomId?: string;
  nearDoor: boolean;
  /** A stair tread within reach ahead, and the way it leads. */
  nearStair?: StairDirection;
  nearFurnitureId?: string;
  locked: boolean;
}
export type { Measurement } from './measureTool';

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
  /**
   * The project's other levels, built without lights nor furniture, never picked nor
   * collided: Vue 3D stacks the levels under the displayed one, Extérieur shows them
   * all behind their windows.
   */
  private otherLevels: { level: Level; house: HouseScene }[] = [];
  /** Levels the view shows stacked but not built yet: built on the next image. */
  private levelsPending = false;
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
  /** « Mesurer »; optional because scene tests build a viewer from its prototype. */
  private measureTool?: MeasureTool = new MeasureTool({
    scene: () => this.scene,
    level: () => this.level,
    markerMaterial: () => this.house.highlights.values().next().value?.material ?? null,
    changed: (measurement) => this.onMeasure?.(measurement),
  });
  get measurement(): Measurement | undefined {
    return this.measureTool?.measurement;
  }
  onSelectRoom?: (id: string) => void;
  onFrame?: (frame: FrameInfo) => void;
  /**
   * The same frame, once the image has been drawn. Screen overlays are projected here: before
   * the render the camera still holds last frame's matrices, so a label trails its room by one
   * frame while the camera moves, and settles when it stops.
   */
  onRendered?: (frame: FrameInfo) => void;
  private lastFrame?: FrameInfo;
  onMeasure?: (measurement?: Measurement) => void;
  /**
   * A Plan tool (wall drawing) offered moves and clicks in plan coordinates; returns whether it
   * took them, so that room selection does not also run.
   */
  planPointer?: (type: PlanPointerKind, point: Point2, event: PointerEvent) => boolean;
  onPointerLockError?: () => void;
  /** Optional host policy, checked before any transition side effects. */
  canChangeMode?: (mode: ViewMode) => boolean;
  onViewChange?: (mode: ViewMode) => void;
  onDestination?: (point: Point2) => void;
  onDestinationRejected?: () => void;
  onEditFurniture?: (id: string) => void;
  /**
   * The visit took a stair: the displayed level changed inside the same scene, so a headset
   * session survives it. The host re-mounts what belongs to a level (furniture, room list).
   */
  onLevelChange?: (levelId: string) => void;
  private loadedProject?: HouseProject;
  private materials?: Materials;
  private shadow?: ShadowGenerator;
  /** The headset session started (true) or ended (false, with its frame report). */
  onImmersiveChange?: (active: boolean, report?: string) => void;
  goToMode = false;
  /** The visit in a headset, a state of the walk: `mode` stays `walk` meanwhile. */
  private readonly headset = new HeadsetSession();
  /** The headset visit while one runs. */
  private get immersive() {
    // Optional: scene tests build a viewer from its prototype, without the constructor.
    return this.headset?.walk;
  }
  /** Share of the visible meshes ready at the last headset readiness check. */
  private eyeHeight = EYE_HEIGHT;
  private walkSpeed = DEFAULT_WALK_SPEED;
  private lookSensitivity = 1;
  private wallDisplay: WallDisplay = 'auto';
  private wallCutaway?: WallCutaway;
  private cutawaySelection = '';
  private shadowRefresh?: ShadowRefresh;
  private furnitureRevision = -1;
  private readonly aim = new WalkAim();
  private readonly renderScheduler = new RenderScheduler();
  private readonly signatureValues = new Float64Array(24);
  private planUp?: number;
  private planUpLevel?: Level;
  private readonly refresh = new RefreshRateEstimator();
  private readonly warmth = new ViewWarmth();
  private preparing = false;
  /** How long the last `load` spent on each part of the scene, for the start-up report. */
  loadTimings?: { materialsMs: number; levelsMs: number; exteriorMs: number; totalMs: number };
  /**
   * A GPU rather than a software rasteriser (`isSoftwareRenderer`): only then are views
   * prepared behind the overlay and does Vue 3D get its occlusion. CI's SwiftShader
   * gets neither, which keeps its e2e scenarios within their timeouts.
   */
  private readonly hardwareRenderer: boolean;
  /** The browser draws with a CPU rasteriser: graphics acceleration is off or unavailable. */
  get softwareRendering(): boolean {
    return !this.hardwareRenderer;
  }
  /** The host shows its overlay while shaders are linked; `first` is the start-up, not a switch. */
  onPreparing?: (active: boolean, first: boolean) => void;
  /** Share of the current preparation done, 0 to 1, for the overlay's bar. */
  onPreparingProgress?: (fraction: number) => void;
  private readonly resolutions = new ViewResolutions(
    upscaleCap(window.screen?.width ?? 0, window.screen?.height ?? 0, window.devicePixelRatio || 1),
  );
  /** The current view's dynamic resolution (`ViewResolutions`). */
  private get adaptiveResolution() {
    return this.resolutions.for(this.currentViewKey());
  }
  /** Hardware scaling at full resolution: the screen's pixel ratio, capped (`MAX_PIXEL_RATIO`). */
  private readonly baseScaling = 1 / Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  private renderScale = 1;
  private reportedTier = 0;
  /** The tier and view `applyEffectTier` last applied: a lower tier gives effects back. */
  private appliedTier = 0;
  private appliedView = '';
  private lastRenderAt?: number;
  /** Open `holdRendering` calls: every image is drawn while one is held. */
  private renderingHolds = 0;
  /** Open `freezeQuality` calls: the resolution and effect tier stay as they are. */
  private qualityFreezes = 0;
  /** Any input anywhere in the page may change what the scene shows. */
  private wake = (event?: Event) => {
    // A locked pointer turns the walk camera, which Babylon applies only while rendering:
    // its signature cannot change before an image is drawn, so the move itself must wake.
    const hover = this.measureMode || document.pointerLockElement === this.canvas;
    if (!event || wakesScene(event, this.canvas, hover)) this.renderScheduler.request();
  };
  private sectionHeight?: number;
  private planOpenings?: PlanOpenings;
  private dimensions: GreasedLineMesh[] = [];
  private readonly keys = new HeldKeys();
  private lighting!: SceneLighting;
  private viewEffects?: ViewEffects;
  private sky?: Layer;
  private solarPosition?: SolarPosition;
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
    installCanonicalDefineOrder();
    installSunShadowSkip();
    this.engine = engine;
    this.engine.setHardwareScalingLevel(this.baseScaling);
    shaderLog.attach(engine);
    this.hardwareRenderer = !isSoftwareRenderer(
      (engine as { getGlInfo?(): { renderer?: string } }).getGlInfo?.().renderer,
    );
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement!);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    window.addEventListener('blur', this.clearKeys);
    window.addEventListener('blur', this.pauseMeasure);
    window.addEventListener('focus', this.pauseMeasure);
    document.addEventListener('visibilitychange', this.pauseMeasure);
    document.addEventListener('pointerlockchange', this.clearKeys);
    document.addEventListener('pointerlockerror', this.pointerLockError);
    canvas.addEventListener('blur', this.clearKeys);
    canvas.addEventListener('wheel', this.planWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.orbitPointerDown, true);
    for (const type of WAKE_EVENTS)
      window.addEventListener(type, this.wake, { capture: true, passive: true });
    // A tab that comes back may have lost its drawing buffer, and the idle redraw that
    // used to heal that does not run while a temporal effect is on screen.
    document.addEventListener('visibilitychange', this.wake);
    this.engine.runRenderLoop(() => {
      this.stepOrbitTour();
      if (!this.scene) return;
      // A view whose shaders are not linked yet is prepared behind the host's overlay
      // instead of freezing the page for seconds while it draws.
      if (
        this.preparing ||
        (this.hardwareRenderer && !this.immersive && this.warmth.isCold(this.currentViewKey()))
      ) {
        if (!this.preparing) void this.prepareView();
        this.lastRenderAt = undefined;
        return;
      }
      const now = performance.now();
      // A headset shows the last image again on a skipped frame, which judders:
      // in a session every frame is drawn, at the resolution the headset chose.
      const render =
        !!this.immersive ||
        this.renderingHolds > 0 ||
        this.renderScheduler.shouldRender(
          now,
          this.cameraSignature(),
          () => this.busy(),
          !this.viewEffects?.temporalActive,
        );
      // A profile forces images the user did not ask for: they are not the machine's
      // cadence, and a scale taken for them would be kept for the session.
      if (!this.immersive) this.applyRenderScale(now, render && this.renderingHolds === 0);
      if (render) {
        this.scene.render();
        this.updateOrbitBloom();
      }
      this.refresh.tick(now, render);
      this.lastRenderAt = render ? now : undefined;
    });
  }

  /** Release scene-owned resources before replacing the scene or disposing the viewer. */
  private releaseScene() {
    // The session belongs to the scene about to be disposed.
    this.headset?.dispose();
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
    this.exterior = undefined;
    this.exteriorFrame = undefined;
    this.parcelInView = undefined;
    this.exteriorSubject = [];
    this.currentExteriorView = false;
    this.keys.clear();
    this.measureMode = false;
    this.measureTool?.forget();
    this.dimensions = [];
  }

  load(project: HouseProject, levelId?: string) {
    const loadStarted = performance.now();
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
    const { lighting, shadow } = createSceneLighting(scene, level);
    this.lighting = lighting;
    this.shadowRefresh = new ShadowRefresh(shadow);
    this.cutawaySelection = '';
    this.loadedProject = project;
    const startedAt = performance.now();
    this.materials = createMaterials(scene, project.finishes);
    const materialsAt = performance.now();
    this.shadow = shadow;
    this.buildLevels(project, level);
    const levelsAt = performance.now();
    // The exterior is the building's, not the displayed level's: the façades
    // are those of the lowest level, the roof covers the rest, and the upper
    // levels' openings are cut through it. Building from the attic only showed
    // the roof, and put the lawn at its altitude.
    const ground = project.levels.reduce((low, candidate) =>
      candidate.elevation < low.elevation ? candidate : low,
    );
    this.exterior = buildExterior(project, ground, scene);
    const exteriorAt = performance.now();
    this.sky = createSkyLayer(scene);
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
        if (this.exterior.roofMeshes.includes(mesh) || this.exterior.boundaryMeshes.includes(mesh))
          shadow.addShadowCaster(mesh);
      }
    }
    this.buildLevelOverlays();
    refreshFixtureLights(scene);
    this.setMode('overview');
    this.attachSceneInput(scene);
    this.resize();
    this.loadTimings = {
      materialsMs: materialsAt - startedAt,
      levelsMs: levelsAt - materialsAt,
      exteriorMs: exteriorAt - levelsAt,
      totalMs: performance.now() - loadStarted,
    };
  }

  /**
   * The displayed level only, with its lights, collisions and picking. The other levels are
   * built the first time a view shows them stacked (`buildPendingLevels`): Plan and Visite
   * never do, so a multi-level house starts as fast as a single level.
   */
  private buildLevels(project: HouseProject, level: Level) {
    const scene = this.scene;
    const materials = this.materials!;
    this.otherLevels = [];
    this.levelsPending = false;
    // The level above owns the stairwell opening: it also pierces this ceiling.
    this.house = buildHouse(
      level,
      scene,
      materials,
      this.shadow,
      levelAbove(project, level)?.floorVoids ?? [],
      roofWindowWells(project, level),
      stairsDown(project, level),
    );
  }

  /** The displayed level's plan openings, façade cutaway and overall dimensions. */
  private buildLevelOverlays() {
    this.planOpenings = buildPlanOpenings(this.scene, this.level);
    this.wallCutaway = buildWallCutaway(this.scene, this.level);
    this.buildDimensions();
  }

  /** Disposes what `buildLevels` and `buildLevelOverlays` made; the shared materials stay. */
  private releaseLevels() {
    for (const { house } of this.otherLevels) house.root.dispose(false, false);
    this.otherLevels = [];
    this.house.pointLights.forEach((light) => light.dispose());
    this.house.root.dispose(false, false);
    this.wallCutaway?.dispose();
    this.wallCutaway = undefined;
    this.planOpenings?.dispose();
    this.planOpenings = undefined;
    this.dimensions.forEach((mesh) => mesh.dispose());
    this.dimensions = [];
  }

  /** Babylon clears both observers when this scene is disposed. */
  private attachSceneInput(scene: Scene) {
    scene.onPointerObservable.add((event) => {
      const move = event.type === PointerEventTypes.POINTERMOVE;
      // A quick second click may come as a double tap, as with « Mesurer ».
      const tap =
        (event.type === PointerEventTypes.POINTERTAP ||
          event.type === PointerEventTypes.POINTERDOUBLETAP) &&
        event.event.button === 0;
      const down = event.type === PointerEventTypes.POINTERDOWN && event.event.button === 0;
      const up = event.type === PointerEventTypes.POINTERUP;
      if (this.planPointer && this.mode === 'plan' && (move || tap || down || up)) {
        const point = this.groundPoint(scene.pointerX, scene.pointerY);
        const kind = move ? 'move' : tap ? 'tap' : down ? 'down' : 'up';
        if (point && this.planPointer(kind, point, event.event as PointerEvent)) return;
      }
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
          this.measureTool?.preview(
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
        this.useAhead();
        return;
      }
      if (this.measureMode) {
        const hit = scene.pick(
          scene.pointerX,
          scene.pointerY,
          (mesh) => mesh.metadata?.kind === 'floor',
        );
        if (hit?.pickedPoint)
          this.measureTool?.add(
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
        const room = this.level.rooms.find((r) => pointInPolygon(p, r.polygon));
        if (room) this.onSelectRoom?.(room.id);
      }
    });
    this.watchFrames(scene);
  }

  /** Input is prepared before Babylon updates its active camera; overlays follow the drawn image. */
  private watchFrames(scene: Scene) {
    scene.onBeforeAnimationsObservable.add(() => this.beforeFrame());
    scene.onAfterRenderObservable.add(() => this.frameRendered());
  }

  /** The frame is built only when someone listens: some of its fields are not free. */
  private emitFrame(build: () => FrameInfo) {
    if (!this.onFrame && !this.onRendered) return;
    const frame = build();
    this.lastFrame = frame;
    this.onFrame?.(frame);
  }

  private frameRendered() {
    const frame = this.lastFrame;
    this.lastFrame = undefined;
    if (frame) this.onRendered?.(frame);
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
      void this.headset.exit();
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
    this.updateOtherLevels();
    this.updateSky();
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
    shaderLog.markView(key, 'start', pluginSummary(scene.materials));
    const progress = new PreparationProgress();
    this.onPreparingProgress?.(0);
    this.onPreparing?.(true, first);
    // Programs that existed before this preparation are not its work.
    const effects = () =>
      (this.engine as unknown as { _compiledEffects?: Record<string, { isReady(): boolean }> })
        ._compiledEffects ?? {};
    const before = new Set(Object.keys(effects()));
    try {
      await nextPaint();
      if (scene !== this.scene || scene.isDisposed || key !== this.currentViewKey()) return;
      let image = 0;
      // Keep the view's lighting while drawing both wall material variants and restoring its cut.
      const variants: Array<WallDisplay | undefined> =
        key === 'overview' &&
        (this.wallDisplay ?? 'auto') === 'auto' &&
        this.sectionHeight === undefined
          ? ['full', 'low', undefined]
          : [undefined];
      let variant = 0;
      const selectVariant = () => {
        const mode = variants[variant];
        if (mode) this.wallCutaway?.apply(mode, [this.orbit.position.x, this.orbit.position.z]);
        else this.updateCutaway();
        this.shadowRefresh?.invalidate();
      };
      selectVariant();
      await warmFrames({
        renderFrame: () => {
          if (scene !== this.scene || scene.isDisposed) return;
          scene.render();
          this.updateOrbitBloom();
          const fresh = Object.entries(effects()).filter(([key]) => !before.has(key));
          this.onPreparingProgress?.(
            progress.update(
              variant,
              variants.length,
              fresh.filter(([, effect]) => effect.isReady()).length,
              fresh.length,
            ),
          );
          shaderLog.mark(
            `  image ${++image} · effets ${shaderLog.effectCount} · prêts ${this.engine.areAllEffectsReady()} · ombre ${this.shadowRefresh?.settled ?? '-'} · attente ${scene.getWaitingItemsCount()} · actifs ${scene.getActiveMeshes().length}`,
          );
        },
        // Not only the effects: a receiver relinks once the sun shadow map is ready,
        // which only happens after its own settling frames.
        effectsReady: () =>
          scene !== this.scene ||
          scene.isDisposed ||
          (this.engine.areAllEffectsReady() &&
            (this.shadowRefresh?.settled ?? true) &&
            scene.getWaitingItemsCount() === 0),
        nextVariant: () => {
          if (
            scene !== this.scene ||
            scene.isDisposed ||
            key !== this.currentViewKey() ||
            ++variant >= variants.length
          )
            return false;
          selectVariant();
          return true;
        },
      });
    } catch (error) {
      console.info(
        `[vue] préchauffage des shaders interrompu : ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // A scene replaced meanwhile has released its effects: it stays cold.
      if (scene === this.scene && !scene.isDisposed) {
        this.updateCutaway();
        if (key === this.currentViewKey()) this.warmth.markWarm(key);
      }
      shaderLog.markView(key, 'end', pluginSummary(scene.materials));
      this.preparing = false;
      this.requestRender();
      this.onPreparingProgress?.(1);
      this.onPreparing?.(false, first);
    }
  }

  /** Resolves once the current view is drawn for real; gives up after `timeoutMs`. */
  async whenReady(timeoutMs = 20000): Promise<void> {
    const end = performance.now() + timeoutMs;
    while (
      this.scene &&
      this.hardwareRenderer &&
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

  /** E or a click in the visit: the door ahead opens or closes, the stair ahead is taken. */
  private useAhead() {
    const hit = this.scene.pickWithRay(this.walk.getForwardRay(WALK_REACH));
    const metadata = hit?.pickedMesh?.metadata;
    if (metadata?.kind === 'door') this.toggleDoor(metadata.id);
    else if (metadata?.kind === 'stair') this.takeStair(metadata.id, metadata.direction);
  }

  /**
   * The visit takes a stair: the arrival level replaces the displayed one inside the same
   * scene (a headset session belongs to the scene and survives), and the visitor lands past
   * the flight, facing the way it was walked. False when the stair leads nowhere modelled.
   */
  takeStair(stairId: string, direction: StairDirection): boolean {
    const project = this.loadedProject;
    if (!project || !this.scene || this.mode !== 'walk') return false;
    const passage = stairPassage(project, this.level, stairId, direction);
    const next = passage && project.levels.find((level) => level.id === passage.levelId);
    if (!passage || !next) return false;
    this.cancelOrbitTour();
    this.clearKeys();
    this.releaseLevels();
    this.level = next;
    this.buildLevels(project, next);
    this.buildLevelOverlays();
    refreshFixtureLights(this.scene);
    this.cutawaySelection = '';
    this.aim.forget();
    // The host mounts the new level's furniture before the landing is checked against it.
    this.onLevelChange?.(next.id);
    const arrival = findVisitDestination(this.scene, next, passage.arrival) ?? passage.arrival;
    const yaw = yawFromDirection(new Vector3(passage.heading[0], 0, passage.heading[1]));
    const immersive = this.immersive;
    if (immersive) {
      immersive.arrive(arrival, yaw);
      this.refreshDisplayedLevel();
    } else {
      // A new level is a new set of shaders: the walk is prepared again behind the overlay.
      this.warmth.reset();
      this.walk.rotation.set(0, yaw, 0);
      this.walk.cameraDirection.setAll(0);
      this.setMode('walk', false, arrival);
    }
    this.requestRender();
    return true;
  }

  /** What `setMode` would redo for the displayed level, without leaving the headset. */
  private refreshDisplayedLevel() {
    this.updateRoofVisibility();
    this.updateOtherLevels();
    try {
      this.updateLighting();
      this.updateInteriorAmbience();
    } catch (error) {
      console.info(
        `[visite] ambiance indisponible : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.dimensions.forEach((mesh) => mesh.setEnabled(false));
    this.updateSection();
    this.updateCutaway();
  }

  toggleDoor(id: string) {
    const door =
      this.house.doors.find((d) => d.id === id) ?? this.exterior?.gates.find((g) => g.id === id);
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

  pickWallFace(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return pickWallFace(
      this.scene,
      this.level,
      this.house.wallNodes,
      clientX - rect.left,
      clientY - rect.top,
    );
  }

  /**
   * A room's `wallColor` changed on the displayed level: only its paint is rebuilt, then
   * the façade cutaway, which must know the new meshes to clip them with their walls.
   */
  repaintWalls() {
    if (!this.house || !this.materials) return;
    this.wallCutaway?.dispose();
    this.wallCutaway = undefined;
    this.house.paint.forEach((mesh) => mesh.dispose());
    this.house.paint = buildWallPaint(
      this.level,
      this.scene,
      this.materials,
      this.house.wallNodes,
      this.house.wallPieces,
    );
    this.wallCutaway = buildWallCutaway(this.scene, this.level);
    this.cutawaySelection = '';
    this.updateCutaway();
    this.shadowRefresh?.invalidate();
    this.requestRender();
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
  /**
   * Vue 3D stacks the levels under the displayed one, which stays on top with its
   * cutaway; Extérieur shows every level, seen through the windows and roof windows.
   * Plan and Visite keep the displayed level alone.
   */
  private updateOtherLevels() {
    this.house?.stairsDown?.forEach((step) => step.setEnabled(this.mode === 'walk'));
    for (const { level, house } of this.otherLevels ?? []) house.root.setEnabled(this.shows(level));
    this.levelsPending = Boolean(
      this.loadedProject?.levels.some(
        (level) =>
          level.id !== this.level.id &&
          this.shows(level) &&
          !this.otherLevels.some((built) => built.level.id === level.id),
      ),
    );
    this.shadowRefresh?.invalidate();
  }

  /** Whether the view shows another level stacked with the displayed one. */
  private shows(level: Level): boolean {
    return (
      this.mode === 'overview' && (this.exteriorView || level.elevation < this.level.elevation)
    );
  }

  private buildPendingLevels() {
    const project = this.loadedProject;
    if (!project || !this.materials) return;
    for (const other of project.levels) {
      if (other.id === this.level.id || !this.shows(other)) continue;
      if (this.otherLevels.some((built) => built.level.id === other.id)) continue;
      const house = buildHouse(
        other,
        this.scene,
        this.materials,
        undefined,
        levelAbove(project, other)?.floorVoids ?? [],
        roofWindowWells(project, other),
        stairsDown(project, other),
        false,
      );
      for (const mesh of house.root.getChildMeshes()) {
        mesh.isPickable = false;
        mesh.checkCollisions = false;
        // Floor picks use their own predicate, which ignores `isPickable`.
        mesh.metadata = { otherLevel: other.id };
      }
      this.otherLevels.push({ level: other, house });
    }
    // The fixture assignment lists every mesh it lights or excludes: the new ones included.
    refreshFixtureLights(this.scene);
    this.updateOtherLevels();
  }

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
    this.solarPosition = position;
    this.updateLighting();
  }

  /**
   * The sky everywhere but the plan, which keeps its flat background, and a
   * headset, where a screen-space gradient would turn with the head. Brighter in
   * Visite, where the view through a window is meant to bloom.
   */
  private updateSky() {
    if (!this.sky) return;
    this.sky.isEnabled = this.mode !== 'plan' && !this.immersive;
    const gain = this.mode === 'walk' ? WALK_SKY_GAIN : 1;
    this.sky.color.set(gain, gain, gain, 1);
  }

  private updateShadowPolicy() {
    if (!this.scene) return;
    // Every caller changed the mode, the cut, the sun or the walls on show.
    this.shadowRefresh?.invalidate();
    const explicitSection = this.sectionHeight !== undefined && Number.isFinite(this.sectionHeight);
    // The headset has no sun shadows: their lookup is too costly for a Quest 2, and the
    // 1024 px map's soft, jagged edges show more in a headset than on a screen.
    const suppressed =
      !!this.immersive ||
      this.mode === 'plan' ||
      (this.mode === 'overview' &&
        !this.exteriorView &&
        !explicitSection &&
        (this.wallDisplay ?? 'auto') !== 'full');
    this.lighting?.suppressShadows(suppressed);
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
    let selected: ReadonlySet<string>;
    if (this.scene.clipPlane && (!active || explicitSection)) {
      this.wallCutaway.holdForSection(this.scene.clipPlane);
      selected = new Set();
    } else
      selected = this.wallCutaway.apply(
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

  /** The level's floor plane under a canvas pixel, in plan coordinates. */
  groundPoint(x: number, y: number): Point2 | undefined {
    const camera = this.scene.activeCamera;
    if (!camera) return;
    const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), camera);
    if (Math.abs(ray.direction.y) < 1e-9) return;
    const t = (this.level.elevation - ray.origin.y) / ray.direction.y;
    return [ray.origin.x + t * ray.direction.x, ray.origin.z + t * ray.direction.z];
  }

  /** Plan metres covered by one CSS pixel of the canvas, for on-screen snap distances. */
  planMetresPerPixel() {
    const width = (this.orbit.orthoRight ?? 0) - (this.orbit.orthoLeft ?? 0);
    return width > 0 && this.canvas.clientWidth > 0 ? width / this.canvas.clientWidth : 0.01;
  }

  setMeasureMode(enabled: boolean) {
    this.measureMode = enabled && this.mode !== 'walk';
    if (this.measureMode) this.setGoToMode(false);
    this.canvas.classList.toggle('measuring', this.measureMode);
    if (!this.measureMode) this.measureTool?.cancel();
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
    return this.projector()(point, height);
  }

  /**
   * `project` for many points of one frame: the camera transform and the canvas size are
   * read once. Each `project` recomputes the projection matrix and reads the canvas's
   * client size, which after a label's style write forces a layout: the Plan labels
   * paid it once per room and per corner, every frame.
   */
  projector(): (point: Point2, height?: number) => { x: number; y: number; visible: boolean } {
    const camera = this.scene.activeCamera!;
    const renderWidth = this.engine.getRenderWidth();
    const renderHeight = this.engine.getRenderHeight();
    const viewport = camera.viewport.toGlobal(renderWidth, renderHeight);
    const transform = this.overlayTransform();
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const elevation = this.level.elevation;
    const world = new Vector3();
    const v = new Vector3();
    return (point, pointHeight = 0.04) => {
      world.set(point[0], elevation + pointHeight, point[1]);
      Vector3.ProjectToRef(world, Matrix.IdentityReadOnly, transform, viewport, v);
      const x = (v.x / renderWidth) * width;
      const y = (v.y / renderHeight) * height;
      return {
        x,
        y,
        visible: v.z > 0 && v.z < 1 && x > -30 && y > -30 && x < width + 30 && y < height + 30,
      };
    };
  }

  /** Copy WebGL synchronously before the browser discards its drawing buffer. */
  captureCanvas(dimensions = false, background = true): HTMLCanvasElement {
    // An image is exported at full resolution, whatever « Qualité » lowered on screen.
    const lowered = this.renderScale < 1;
    if (lowered) this.engine.setHardwareScalingLevel(this.baseScaling);
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
    let skyWasEnabled = false;
    try {
      this.capturing = true;
      // A transparent export leaves the sky out, as it leaves out the page behind it.
      skyWasEnabled = this.sky?.isEnabled ?? false;
      if (this.sky && !background) this.sky.isEnabled = false;
      for (const mesh of this.dimensions) set(mesh, dimensions && this.mode !== 'walk');
      if (!dimensions) for (const mesh of this.measureTool?.meshes ?? []) set(mesh, false);
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
      if (this.sky) this.sky.isEnabled = skyWasEnabled;
      this.capturing = false;
      if (lowered) this.engine.setHardwareScalingLevel(this.baseScaling / this.renderScale);
      this.scene.activeCamera?.resetViewHistory?.();
      this.requestRender();
    }
  }

  private updateLighting() {
    const interior = this.mode === 'walk';
    this.updateShadowPolicy();
    this.house.ceiling.setEnabled(interior);
    this.house.fixtures.forEach((f) => f.setEnabled(interior));
    applyFixtureLights(this.scene, this.house.pointLights, this.mode, this.lightOn);
    this.lighting.apply(this.mode, this.level, this.solarPosition);
    this.viewEffects ??= new ViewEffects(this.scene, undefined, undefined, () =>
      this.requestRender(),
    );
    this.viewEffects.updateEnvironment(this.mode, this.lighting.sun.direction);
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
      effectTier: this.currentEffectTier,
    });
    this.viewEffects.updateEnvironment(this.mode, this.lighting.sun.direction);
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
    if (this.headset.busy || this.mode !== 'walk' || !this.scene) return;
    this.clearKeys();
    this.cancelCaptureRetry();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    const scene = this.scene;
    const viewer = this;
    const opened = await this.headset.open({
      scene,
      engine: this.engine,
      get level() {
        return viewer.level;
      },
      site: this.site,
      eyeHeight: this.eyeHeight,
      start: { point: [this.walk.position.x, this.walk.position.z], yaw: this.walk.rotation.y },
      isDestination: (point) =>
        isSceneVisitDestination(scene, this.level, point) ||
        isParcelDestination(this.level, this.site, point),
      toggleDoor: (id) => this.toggleDoor(id),
      takeStair: (id, direction) => this.takeStair(id, direction),
      // A project load or a mode change may happen while the session starts.
      isCurrent: () => this.scene === scene && this.mode === 'walk',
      onEnd: (ended) => this.leaveImmersive(ended),
    });
    if (!opened) return;
    this.updateSky();
    this.updateShadowPolicy();
    // The screen walk's pipelines are bound to its camera: dropped until the headset is ready.
    this.viewEffects?.releaseWalkPipelines();
    this.onImmersiveChange?.(true);
  }

  async exitImmersive() {
    await this.headset.exit();
  }

  /** Back to the screen where the headset left the visitor, at the chosen eye height. */
  private leaveImmersive(walk: ImmersiveWalk) {
    const [x, z] = walk.position;
    const forward = walk.camera.getDirection(Vector3.Forward(true));
    if (!this.headset.release(walk)) return;
    const report = walk.frameReport();
    this.updateSky();
    this.updateShadowPolicy();
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
    this.onImmersiveChange?.(false, report);
  }

  /**
   * Orbit bloom: the 3D view (cut façades) and the Exterior (sun,
   * roof, sky). Plan shares the camera in orthographic mode — a plan must
   * bloom nothing, the pipeline is turned off without being destroyed: rebuilding it
   * on every switch would cost recreating a post-processing chain.
   */
  private updateOrbitBloom() {
    if (!this.scene || !this.orbit) return;
    this.viewEffects?.updateOrbit(this.mode === 'overview', this.orbit, {
      occlusion: !this.exteriorView && this.hardwareRenderer,
      effectTier: this.currentEffectTier,
    });
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
    // Optional: scene tests build a viewer from its prototype, without the constructor.
    this.aim?.invalidate();
    // Optional: scene tests build a viewer from its prototype, without the constructor.
    this.renderScheduler?.request();
  }

  /** True while the loop only redraws once a second because nothing moves. */
  /**
   * Draws every image, still or not, until the returned function is called: what
   * `mybob.profile()` needs to measure the cost of an image of a still view.
   */
  holdRendering(): () => void {
    this.renderingHolds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.renderingHolds--;
      this.renderScheduler.request();
    };
  }

  /**
   * Keeps the resolution and effect tier until the returned function is called: the pass
   * breakdown compares images that differ by one pass only (`passBreakdown.ts`).
   */
  freezeQuality(): () => void {
    this.qualityFreezes++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.qualityFreezes--;
      // The frames drawn meanwhile measured a partial chain, not this view.
      this.adaptiveResolution?.resume();
    };
  }

  get renderingIdle(): boolean {
    return this.renderScheduler?.idle ?? false;
  }

  /**
   * Fewer pixels on a machine too slow for 40 fps in this view, at rest and in motion
   * alike: a resize hitches, so it never follows the camera (`adaptiveResolution.ts`).
   */
  private applyRenderScale(now: number, render: boolean) {
    if (this.qualityFreezes > 0) return;
    // A late shader or texture is preparation work, not the machine's steady frame rate.
    if (!this.engine.areAllEffectsReady() || this.scene.getWaitingItemsCount() > 0) {
      this.adaptiveResolution.resume();
      return;
    }
    const frameMs = render && this.lastRenderAt !== undefined ? now - this.lastRenderAt : undefined;
    const scale = this.adaptiveResolution.update(frameMs, this.refresh?.hz);
    const tier = this.currentEffectTier;
    this.applyEffectTier();
    const rescaled = scale !== this.renderScale;
    if (rescaled || tier !== this.reportedTier) {
      this.reportedTier = tier;
      this.onQualityChange?.(this.currentViewKey(), { scale, tier });
    }
    if (!rescaled) return;
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
    const tier = this.currentEffectTier;
    const view = this.currentViewKey();
    const givenBack = view === this.appliedView && tier < this.appliedTier;
    this.appliedView = view;
    this.appliedTier = tier;
    let changed = this.viewEffects?.applyEffectTier(tier) ?? false;
    // The visit's chain is rebuilt whole so its order holds; the orbit rebuilds on its next image.
    if (givenBack && this.mode === 'walk') this.rebuildWalkPipelines();
    // The plan shows no sun shadow: keeping the filtering of the view left avoids a relink.
    if (this.shadow && this.mode !== 'plan' && applyShadowTier(this.shadow, tier)) changed = true;
    if (changed) this.requestRender();
  }

  /**
   * Development bench only: pins the effect tier and rebuilds the visit pipelines, which
   * is the one way to go back down (a real tier is never lifted).
   */
  forceEffectTier(tier?: number): void {
    this.resolutions.force(tier);
    this.rebuildWalkPipelines();
  }

  /** Effect tier in use on this machine (0 = full quality), for the diagnostic. */
  get currentEffectTier(): number {
    return this.adaptiveResolution?.effectTier ?? 0;
  }

  /** A view changed scale or tier: the host remembers it as the next session's start. */
  onQualityChange?: (view: string, start: QualityStart) => void;

  /** The window now sits on a screen with another cap (multi-screen): views start over. */
  setScreenCap(cap: number) {
    if (!this.resolutions.setCap(cap)) return;
    this.renderScale = Number.NaN;
    this.requestRender();
  }

  /**
   * « Qualité » for every view: automatic views start at `starts[view]`, where this machine
   * left them, or at `seed` (`qualitySeed`). Effects a lower tier removed are built again.
   */
  setQuality(quality: Quality, starts: Record<string, QualityStart>, seed?: QualityStart) {
    this.resolutions.configure(quality, starts, seed);
    this.renderScale = Number.NaN; // the next image applies the policy's scale
    if (!this.scene) return;
    this.applyEffectTier();
    this.updateOrbitBloom();
  }

  /** Display refresh rate read while the view was still, for the diagnostic. */
  get refreshRate(): number | undefined {
    return this.refresh.hz;
  }

  /** Render scale in use on this machine (1 = full resolution), for the diagnostic. */
  get currentRenderScale(): number {
    return this.adaptiveResolution?.scale ?? 1;
  }

  /**
   * Everything about the active camera that changes the image, written into one reused
   * buffer: this runs on every display frame, drawn or not (`RenderScheduler` rounds it).
   */
  private cameraSignature(): Float64Array {
    const values = this.signatureValues;
    values.fill(0);
    const camera = this.scene.activeCamera;
    if (!camera) return values;
    let index = 0;
    const put = (value: number) => (values[index++] = value);
    put(camera.position.x);
    put(camera.position.y);
    put(camera.position.z);
    put(camera.fov);
    put(camera.mode);
    put(camera.orthoLeft ?? 0);
    put(camera.orthoRight ?? 0);
    put(camera.orthoTop ?? 0);
    put(camera.orthoBottom ?? 0);
    // The canvas size, not the render size: the adaptive resolution changes the
    // latter, and must not read as a camera motion.
    put(this.canvas.clientWidth);
    put(this.canvas.clientHeight);
    // The camera's kind, so an orbit and a walk signature never match through the zero padding.
    if (camera === this.orbit) {
      const o = this.orbit;
      put(1);
      put(o.alpha);
      put(o.beta);
      put(o.radius);
      put(o.target.x);
      put(o.target.y);
      put(o.target.z);
      // Inertia still to spend moves the camera on the next images.
      put(o.inertialAlphaOffset);
      put(o.inertialBetaOffset);
      put(o.inertialRadiusOffset);
      put(o.inertialPanningX);
      put(o.inertialPanningY);
    } else if (camera === this.walk) {
      const w = this.walk;
      put(2);
      put(w.rotation.x);
      put(w.rotation.y);
      put(w.rotation.z);
      put(w.cameraDirection.x);
      put(w.cameraDirection.y);
      put(w.cameraDirection.z);
      put(w.cameraRotation.x);
      put(w.cameraRotation.y);
    }
    return values;
  }

  /** Changes on screen that no event announces: held keys, swinging doors, compiling shaders. */
  private busy(): boolean {
    return (
      this.keys.any ||
      this.orbitTour !== undefined ||
      this.capturing ||
      anySwinging(this.house?.doors, this.exterior?.gates) ||
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
    if (this.levelsPending) this.buildPendingLevels();
    const revision = furnitureRevision(this.scene);
    if (revision !== this.furnitureRevision) {
      this.furnitureRevision = revision;
      this.aim.invalidate();
      const map = this.shadow?.getShadowMap();
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
    if (cameraMoved && !this.preparing && this.mode === 'overview' && !this.exteriorView)
      this.updateCutaway();
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.045);
    // Match the collision displacement to frame time, including the garage step.
    this.scene.gravity.y = -15 * dt;
    const doorsMoved = stepSwings(dt, this.house.doors, this.exterior?.gates);
    if (doorsMoved) this.shadowRefresh?.invalidate();
    this.shadowRefresh?.step();
    const immersive = this.immersive;
    // Nothing in the page is seen from the headset: no 2D overlay frame while immersive.
    if (immersive) {
      immersive.step(dt);
      return;
    }
    if (this.mode === 'walk') {
      const p = this.walk.position;
      if (outsideVisit(this.level, this.site, p)) this.reset();
      const active =
        document.activeElement === this.canvas || document.pointerLockElement === this.canvas;
      const axes = !this.paused && active ? this.keys.axes() : undefined;
      stepWalk(this.walk, this.level, this.site, axes, this.walkSpeed, dt);
      const room = this.level.rooms.find((r) => pointInPolygon([p.x, p.z], r.polygon));
      const aim = this.aim.update(this.scene, this.walk, cameraMoved || doorsMoved);
      this.emitFrame(() => ({
        cameraMoved,
        furnitureObstaclesRevision: furnitureObstaclesRevision(this.scene),
        position: [p.x, p.z],
        headingDegrees: planHeading(this.walk),
        planUpDegrees: this.planUpDegrees(cameraMoved),
        roomId: room?.id,
        nearDoor: aim.nearDoor,
        nearStair: aim.nearStair,
        nearFurnitureId: this.paused ? undefined : aim.furnitureId,
        locked: document.pointerLockElement === this.canvas,
      }));
    } else {
      if (
        !this.paused &&
        document.activeElement === this.canvas &&
        this.orbit.inputs.attachedToElement
      ) {
        const { forward, side, fast } = this.keys.axes();
        panOrbitWithKeys(this.orbit, forward, side, dt, fast);
      }
      this.emitFrame(() => ({
        cameraMoved,
        furnitureObstaclesRevision: furnitureObstaclesRevision(this.scene),
        position: [this.walk.position.x, this.walk.position.z],
        headingDegrees: planHeading(this.walk),
        planUpDegrees: this.planUpDegrees(cameraMoved),
        nearDoor: false,
        locked: false,
      }));
    }
  }

  private keydown = (event: KeyboardEvent) => this.handleKeydown(event);

  private handleKeydown(event: KeyboardEvent) {
    this.resnapMeasurement(event);
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
    if (this.mode === 'walk' && event.code === 'KeyE' && !event.repeat) this.useAhead();
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
    this.keys.press(event.code);
  }
  /** The plan's north on screen, measured again only when the camera or the level changed. */
  private planUpDegrees(cameraMoved: boolean) {
    if (cameraMoved || this.planUp === undefined || this.planUpLevel !== this.level) {
      const center = bounds(this.level.outline).center;
      const origin = this.project(center),
        up = this.project([center[0], center[1] - 1]);
      this.planUp = (Math.atan2(up.x - origin.x, origin.y - up.y) * 180) / Math.PI;
      this.planUpLevel = this.level;
    }
    return this.planUp;
  }
  private keyup = (event: KeyboardEvent) => {
    this.keys.release(event.code);
    this.resnapMeasurement(event);
  };
  /** Leaving or returning to the page: the next images say nothing about the machine. */
  private pauseMeasure = () => {
    this.resolutions.resume();
    this.lastRenderAt = undefined;
  };
  private clearKeys = () => {
    this.keys.clear();
    this.walk?.cameraDirection.setAll(0);
  };
  private planWheel = (event: WheelEvent) => {
    if (this.mode !== 'plan') return;
    event.preventDefault();
    this.zoomPlan(Math.exp(event.deltaY * 0.001));
  };

  /** The Plan framing, so that a plan edit, which reloads the project, does not reframe it. */
  planView(): PlanView | undefined {
    if (this.mode !== 'plan') return;
    const { x, y, z } = this.orbit.target;
    return { target: [x, y, z], halfHeight: this.orbit.orthoTop ?? 0 };
  }

  restorePlanView(view: PlanView) {
    if (this.mode !== 'plan' || !(view.halfHeight > 0)) return;
    this.orbit.setTarget(new Vector3(...view.target), false, true, true);
    // The zoom is relative to the outline's own framing, which the edit may have changed.
    this.planZoom = 1;
    this.setOrthoSize();
    this.planZoom = view.halfHeight / this.orbit.orthoTop!;
    this.setOrthoSize();
    this.requestRender();
  }

  private zoomPlan(factor: number) {
    if (this.mode !== 'plan' || !Number.isFinite(factor) || factor <= 0) return;
    this.planZoom = Math.max(0.18, Math.min(4, this.planZoom * factor));
    this.setOrthoSize();
  }

  /** Shift forces an axis, Alt frees the snap: the following measurement re-snaps at once. */
  private resnapMeasurement(event: KeyboardEvent) {
    const cursor = this.measureTool?.cursor;
    if (
      this.measureMode &&
      cursor &&
      ['ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'].includes(event.code)
    )
      this.measureTool!.preview(cursor, event.shiftKey, event.altKey);
  }

  /** Validated measurements stay on the floor until explicitly cleared. */
  clearPinnedMeasurements(): boolean {
    return this.measureTool?.clearPinned() ?? false;
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
    window.removeEventListener('blur', this.pauseMeasure);
    window.removeEventListener('focus', this.pauseMeasure);
    document.removeEventListener('visibilitychange', this.pauseMeasure);
    document.removeEventListener('pointerlockchange', this.clearKeys);
    document.removeEventListener('pointerlockerror', this.pointerLockError);
    this.canvas.removeEventListener('blur', this.clearKeys);
    this.resizeObserver.disconnect();
    this.engine.dispose();
    this.canvas.removeEventListener('wheel', this.planWheel);
    this.canvas.removeEventListener('pointerdown', this.orbitPointerDown, true);
    document.removeEventListener('visibilitychange', this.wake);
    for (const type of WAKE_EVENTS) window.removeEventListener(type, this.wake, true);
  }
}
