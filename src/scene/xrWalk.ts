import { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper';
import { WebXRManagedOutputCanvasOptions } from '@babylonjs/core/XR/webXRManagedOutputCanvas';
import {
  isTetheredHeadset,
  parseXrScale,
  startScale,
  XR_SCALE_STORAGE,
  XrScaleTuner,
} from './xrScale';
import type { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import type { Collider } from '@babylonjs/core/Collisions/collider';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Ray } from '@babylonjs/core/Culling/ray';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, Point2, ProjectSite } from '../model/types';
import type { StairDirection } from '../model/stairs';
import { groundElevationAt } from '../model/geometry';
import { isVisitArea } from './navigation';
import { VISITOR_RADIUS } from './walkCamera';
import { PreparationProgress } from './shaderWarmup';
import {
  FrameCounter,
  LoadingGate,
  XR_DEFAULT_LAYERS,
  XR_VEIL_LAYER,
  XrBlink,
  XrHud,
  XrVeil,
  XrVignette,
} from './xrHud';

/**
 * The visit in a WebXR headset (Quest browser). It is a state of the walk, not a
 * fourth view mode: `viewer.mode` stays `walk`, this module only replaces the
 * camera and the controls while the session lasts.
 *
 * Controls, xr-standard gamepad mapping (Quest Touch):
 * - left stick: walk, relative to where the head looks, with wall collisions;
 * - room-scale steps (the headset itself moving) meet the same walls;
 * - right stick sideways: smooth turn; pushed forward then released: teleport along an arc;
 *   aimed at a stair tread, the teleport takes the stair to the next level, behind the
 *   loading veil;
 * - trigger, either hand: open or close the door the controller points at;
 * - A: seated mode on or off (the eyes raised to the walk's eye height);
 * - X: frame counter shown or hidden;
 * - B or Y: teleport-only mode on or off. In it no stick glides the visitor: either stick
 *   pushed forward aims a teleport, sideways turns by 30° steps, and both happen behind a
 *   short blink to black. Remembered with the counter's visibility (`XR_PREFERENCES`).
 *
 * While the stick walks or turns, a comfort vignette (`XrVignette`, `xrHud.ts`) darkens the
 * edges of the view: the visual motion the inner ear does not feel is what makes people sick,
 * and most of it is seen in the periphery.
 *
 * The session opens behind a loading veil (`xrHud.ts`) until the house's shaders are linked,
 * like the page's overlay for the other views; the controls wait for it.
 *
 * The session renders without post-processing or sun shadows and with the medium
 * fixed foveation: the edges of each lens, blurred by the optics
 * anyway, are drawn at a lower resolution.
 *
 * A small counter carried by the head shows the frame rate, and how many times the visit was
 * sent back inside the modelled ground (`xrHud.ts`).
 *
 * Controller models are never downloaded: the session reads the gamepads directly
 * and draws its own pointers, so the visit keeps working without the network.
 *
 * The visitor is carried by a rig node, parent of the session camera: walking,
 * turning, teleporting and following the floor move the rig, never the camera.
 * Babylon would otherwise offset the XR reference space on every move, and an
 * emulator that ignores offset spaces (Immersive Web Emulator 2.0) then leaves
 * the visitor at the origin of the plan, outside the house.
 */

/** Headset walking speed, a calm human walk: fast smooth motion makes people sick. */
export const XR_WALK_SPEED = 1.3;
/** Smooth turn rate at full stick deflection, in degrees per second. */
export const XR_TURN_DEGREES_PER_SECOND = 75;
/**
 * Medium fixed foveation. The strongest (1) shimmered on the textured walls with every
 * micro-movement of a still head, which the owner saw as flicker on a Quest 2; medium keeps
 * most of the saving at the lens edges, blurred by the optics anyway.
 */
export const XR_FIXED_FOVEATION = 0.5;
export const STICK_DEADZONE = 0.2;
/** How far a controller reaches a door, like the keyboard's E (2.4 m) plus an arm. */
export const XR_DOOR_REACH = 3;
export const XR_TELEPORT_REACH = 12;
/** Body collider below the head: walls stop the visitor, a 20 cm step does not. */
export const XR_BODY_HALF_HEIGHT = 0.5;
export const XR_BODY_DROP = 0.6;
/** The display rate a session opens at; the session falls back when it cannot hold it. */
export const XR_TARGET_FRAME_RATE = 90;
/**
 * The highest display rate probed: a Quest 2 offers 120 Hz in its own browser. Once the
 * session holds its rate for `XR_RATE_PROBE_WINDOWS`, the next higher one is tried; one that
 * does not hold sends it back, for the rest of the session.
 */
export const XR_MAX_FRAME_RATE = 120;
/** Windows (500 ms) at 97 % of the rate before a higher one is tried: 5 s. */
export const XR_RATE_PROBE_WINDOWS = 10;
/**
 * Frame-rate windows (500 ms each) in a row below the rate before the next lower one is
 * asked: 3 s. At 1.5 s the hitches after loading pushed a Quest 2 down to 60 Hz for good.
 */
export const XR_RATE_FALLBACK_WINDOWS = 6;
/** Windows ignored after the session opens: shaders and textures still settle (3 s). */
export const XR_RATE_WARMUP_WINDOWS = 6;
/**
 * The lowest display rate ever asked. At 60 Hz a Quest 2's low-persistence screen flickers
 * over the whole image (owner, 2026-11-13: « the whole image flickers », a steady 60 fps in
 * the Quest Browser); 72 Hz is the headset's own default for that reason. A headset that
 * offers nothing at or above it keeps its own rates.
 */
export const XR_MIN_FRAME_RATE = 72;

/** The most the seated mode moves the visitor, up or down, in metres. */
export const XR_SEATED_MAX_RAISE = 1.2;
export const XR_SEATED_MAX_DROP = 1;

/**
 * How much the seated mode (A) moves the visitor: the walk's eye height minus the real head
 * height when it is switched on. It raises a seated visitor, and lowers one whose floor the
 * runtime misplaced (a seated owner once read 2.20 m over Link), within limits.
 */
export function seatedLift(headHeight: number, eyeHeight: number): number {
  if (!Number.isFinite(headHeight) || !Number.isFinite(eyeHeight)) return 0;
  return Math.max(-XR_SEATED_MAX_DROP, Math.min(XR_SEATED_MAX_RAISE, eyeHeight - headHeight));
}

/** How long the button hint shows once the headset view opens, in seconds. */
export const XR_HINT_SECONDS = 8;
export const XR_HINT = 'A : assis · B : téléportation · X : compteur';

/** The display rate to ask for: the highest supported one up to the target, if above the default. */
export function pickFrameRate(
  supported: ArrayLike<number> | undefined,
  target = XR_TARGET_FRAME_RATE,
): number | undefined {
  const rates = flickerFree(Array.from(supported ?? [])).filter((rate) => rate <= target + 0.5);
  return rates.length ? Math.max(...rates) : undefined;
}

/** The rates at or above `XR_MIN_FRAME_RATE`, or all of them if none is. */
export function flickerFree(rates: number[]): number[] {
  const steady = rates.filter((rate) => rate >= XR_MIN_FRAME_RATE - 0.5);
  return steady.length ? steady : rates;
}

/**
 * Adapts the asked display rate. Slow windows in a row under 90 % of the rate select the
 * next lower supported one: a missed frame is shown again by the headset, which reads as
 * flicker, a lower steady rate does not. Windows held at the rate try the next higher one,
 * up to `XR_MAX_FRAME_RATE`, until a rate had to be lowered. Each change is followed by a
 * warm-up, the time the headset takes to switch.
 */
export class FrameRateGovernor {
  private slow = 0;
  private steady = 0;
  /** A rate had to be lowered: no more probing upwards in this session. */
  private settled = false;
  private warmup = XR_RATE_WARMUP_WINDOWS;
  private readonly supported: number[];

  constructor(
    private rate: number | undefined,
    supported: number[],
  ) {
    this.supported = flickerFree(supported);
  }

  get current(): number | undefined {
    return this.rate;
  }

  /** The new rate to ask for after this window, if it changes. */
  observe(fps: number): number | undefined {
    if (this.rate === undefined) return undefined;
    if (this.warmup > 0) {
      this.warmup--;
      return undefined;
    }
    this.slow = fps < this.rate * 0.9 ? this.slow + 1 : 0;
    this.steady = fps >= this.rate * 0.97 ? this.steady + 1 : 0;
    if (this.slow >= XR_RATE_FALLBACK_WINDOWS) {
      this.slow = 0;
      this.steady = 0;
      this.settled = true;
      const lower = this.supported.filter((rate) => rate < this.rate! - 0.5);
      if (!lower.length) return undefined;
      this.rate = Math.max(...lower);
      this.warmup = XR_RATE_WARMUP_WINDOWS;
      return this.rate;
    }
    if (this.steady >= XR_RATE_PROBE_WINDOWS && !this.settled) {
      this.steady = 0;
      const higher = this.supported.filter(
        (rate) => rate > this.rate! + 0.5 && rate <= XR_MAX_FRAME_RATE + 0.5,
      );
      if (!higher.length) return undefined;
      this.rate = Math.min(...higher);
      this.warmup = XR_RATE_WARMUP_WINDOWS;
      return this.rate;
    }
    return undefined;
  }
}

/** Turn step of the teleport-only mode, in degrees. */
export const XR_SNAP_DEGREES = 30;
/** A snap turn fires past this deflection and re-arms once the stick is back under the lower one. */
export const XR_SNAP_FIRE = 0.7;
export const XR_SNAP_REARM = 0.3;

/**
 * One frame of the teleport-only turn: a single step when the stick crosses `XR_SNAP_FIRE`,
 * then nothing until it comes back near the centre. Right-handed y-up: right is negative.
 */
export function snapTurn(armed: boolean, axis: number): { angle: number; armed: boolean } {
  if (!armed) return { angle: 0, armed: Math.abs(axis) < XR_SNAP_REARM };
  if (Math.abs(axis) < XR_SNAP_FIRE) return { angle: 0, armed: true };
  return { angle: (-Math.sign(axis) * XR_SNAP_DEGREES * Math.PI) / 180, armed: false };
}

/** Launch speed, gravity and sampling of the teleport arc: about 8 m of reach from the hand. */
export const XR_ARC_SPEED = 8;
export const XR_ARC_GRAVITY = 9.81;
export const XR_ARC_STEP_SECONDS = 0.07;
export const XR_ARC_SEGMENTS = 28;

/**
 * The teleport arc: a throw from the controller, sampled every `XR_ARC_STEP_SECONDS`. A curve
 * reaches the far floor with the wrist raised, where a straight ray had to point down; and
 * it falls onto what lies beyond a doorway instead of a wall behind it.
 */
export function teleportArc(
  origin: Vector3,
  direction: Vector3,
  segments = XR_ARC_SEGMENTS,
): Vector3[] {
  const velocity = direction.normalizeToNew().scaleInPlace(XR_ARC_SPEED);
  const points = [origin.clone()];
  for (let i = 1; i <= segments; i++) {
    const t = i * XR_ARC_STEP_SECONDS;
    points.push(
      new Vector3(
        origin.x + velocity.x * t,
        origin.y + velocity.y * t - (XR_ARC_GRAVITY * t * t) / 2,
        origin.z + velocity.z * t,
      ),
    );
  }
  return points;
}

/** Headset choices kept between sessions, per browser. */
export const XR_PREFERENCES = 'maison-atelier:headset:v1';

export interface XrPreferences {
  /** Teleport-only locomotion: no stick glides the visitor. */
  teleport: boolean;
  /** The frame counter is shown. */
  counter: boolean;
}

export function readXrPreferences(storage?: Pick<Storage, 'getItem'>): XrPreferences {
  const preferences: XrPreferences = { teleport: false, counter: true };
  try {
    const saved = JSON.parse(storage?.getItem(XR_PREFERENCES) ?? '{}');
    if (typeof saved?.teleport === 'boolean') preferences.teleport = saved.teleport;
    if (typeof saved?.counter === 'boolean') preferences.counter = saved.counter;
  } catch {
    /* Defaults when the storage is unavailable or the value is damaged. */
  }
  return preferences;
}

function writeXrPreferences(preferences: XrPreferences, storage?: Pick<Storage, 'setItem'>) {
  try {
    storage?.setItem(XR_PREFERENCES, JSON.stringify(preferences));
  } catch {
    /* Not remembered: the choice still holds for this session. */
  }
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** How long the counter shows itself after a mode change while it is hidden, in seconds. */
export const XR_HUD_FLASH_SECONDS = 2.5;

/** A head move larger than this in one frame is a tracking reset, not a step: it is not collided. */
export const XR_POSE_JUMP = 0.5;

export function applyDeadzone(value: number, threshold = STICK_DEADZONE): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) return 0;
  return (Math.sign(value) * (Math.min(1, magnitude) - threshold)) / (1 - threshold);
}

/**
 * The right stick's turn axis: its sideways deflection, unless the push is mostly forward or
 * back, which aims a teleport. A diagonal push therefore never turns and aims at once.
 */
export function turnAxis(x: number, y: number): number {
  return Math.abs(x) > Math.abs(y) ? x : 0;
}

/**
 * Horizontal displacement for one frame. `forward` is the head direction in a
 * right-handed, y-up world; the stick's y axis is negative when pushed forward.
 */
export function stickDisplacement(
  forward: Vector3,
  x: number,
  y: number,
  speed: number,
  seconds: number,
): Vector3 {
  const ahead = new Vector3(forward.x, 0, forward.z);
  if (ahead.lengthSquared() < 1e-8 || (x === 0 && y === 0)) return Vector3.Zero();
  ahead.normalize();
  const right = Vector3.Cross(ahead, Vector3.Up());
  const length = Math.hypot(x, y);
  const scale = length > 1 ? 1 / length : 1;
  return ahead
    .scale(-y * scale)
    .addInPlace(right.scale(x * scale))
    .scaleInPlace(speed * seconds);
}

/** Rig position after a yaw turn around the head, so the visitor turns on the spot. */
export function turnAround(rig: Vector3, head: Vector3, angle: number): Vector3 {
  const dx = rig.x - head.x;
  const dz = rig.z - head.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Rotation about +y in a right-handed frame: x' = x cos + z sin, z' = -x sin + z cos.
  return new Vector3(head.x + dx * cos + dz * sin, rig.y, head.z - dx * sin + dz * cos);
}

/**
 * Smooth turn for one frame as a yaw delta, in radians, from the stick's sideways axis
 * (dead zone already applied). Right-handed y-up: turning right (axis > 0) is negative.
 */
export function smoothTurnAngle(axis: number, seconds: number): number {
  if (axis === 0) return 0;
  return (-axis * XR_TURN_DEGREES_PER_SECOND * Math.PI * seconds) / 180;
}

export interface ControllerState {
  x: number;
  y: number;
  trigger: boolean;
  /** The lower face button: A on the right controller, X on the left. */
  face: boolean;
  /** The upper face button: B on the right controller, Y on the left. */
  upper: boolean;
}

/** xr-standard mapping: thumbstick on axes 2-3, trigger on button 0, A/X on 4, B/Y on 5. */
export function readControllerGamepad(gamepad: Gamepad | null | undefined): ControllerState {
  if (!gamepad) return { x: 0, y: 0, trigger: false, face: false, upper: false };
  const axes = gamepad.axes;
  const stick = axes.length >= 4 ? 2 : 0;
  return {
    x: applyDeadzone(axes[stick] ?? 0),
    y: applyDeadzone(axes[stick + 1] ?? 0),
    trigger: !!gamepad.buttons[0]?.pressed,
    face: !!gamepad.buttons[4]?.pressed,
    upper: !!gamepad.buttons[5]?.pressed,
  };
}

export interface ImmersiveHost {
  scene: Scene;
  /** The displayed level, read each frame: taking a stair changes it. */
  readonly level: Level;
  site?: ProjectSite;
  /** The walk's eye height, given to the visitor in seated mode. */
  eyeHeight: number;
  /** Where the screen walk stands and looks when the headset takes over. */
  start: { point: Point2; yaw: number };
  /** A floor point where the visitor may stand: inside a room or on the parcel. */
  isDestination(point: Point2): boolean;
  toggleDoor(id: string): void;
  /** Changes the displayed level and calls `arrive`; false if the stair leads nowhere. */
  takeStair(id: string, direction: StairDirection): boolean;
  /** Every visible mesh can be drawn; asking starts the links of those that cannot yet. */
  isReady(): boolean;
  /** Share of the visible meshes ready to draw at the last `isReady`, 0 to 1. */
  readiness?(): number;
  /** The session ended, whoever ended it: the headset menu, the page or an error. */
  onEnd(walk: ImmersiveWalk): void;
  /** Where the headset choices are kept; the browser's localStorage when omitted. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

interface Pointer {
  handedness: XRHandedness;
  root: Mesh;
  ray: Mesh;
  trigger: boolean;
  face: boolean;
  upper: boolean;
  /** The teleport-only turn may fire again: the stick came back near the centre. */
  snapArmed: boolean;
}

const READY = new Color3(0.92, 0.92, 0.88);
const VALID = new Color3(0.35, 0.85, 0.5);
const INVALID = new Color3(0.9, 0.35, 0.3);

export async function startImmersiveWalk(host: ImmersiveHost): Promise<ImmersiveWalk> {
  const helper = await WebXRExperienceHelper.CreateAsync(host.scene);
  // A PC-driven headset opens at the scale its last session earned (`xrScale.ts`).
  let saved: number | undefined;
  try {
    saved = parseXrScale(localStorage.getItem(XR_SCALE_STORAGE));
  } catch {
    saved = undefined;
  }
  const tethered = isTetheredHeadset(navigator.userAgent);
  const scale = startScale(saved, tethered);
  const walk = new ImmersiveWalk(host, helper, tethered ? new XrScaleTuner(scale) : undefined);
  try {
    const options = WebXRManagedOutputCanvasOptions.GetDefaults(host.scene.getEngine());
    options.canvasOptions = { ...options.canvasOptions, framebufferScaleFactor: scale };
    await helper.enterXRAsync(
      'immersive-vr',
      'local-floor',
      helper.sessionManager.getWebXRRenderTarget(options),
    );
    // 0 to 1; ignored by a browser or layer without fixed foveation.
    helper.sessionManager.fixedFoveation = XR_FIXED_FOVEATION;
  } catch (error) {
    walk.dispose();
    throw error;
  }
  walk.placeCamera();
  walk.requestFrameRate();
  return walk;
}

export class ImmersiveWalk {
  readonly camera: WebXRCamera;
  /** Carries the visitor in the plan: the camera pose is local to it. */
  readonly rig: TransformNode;
  private readonly pointers = new Map<XRInputSource, Pointer>();
  private readonly material: StandardMaterial;
  private readonly marker: Mesh;
  /** Dots along the teleport arc, one thin instance per sample. */
  private readonly arc: Mesh;
  private readonly arcMatrices = new Float32Array(16 * (XR_ARC_SEGMENTS + 1));
  private readonly hud: XrHud;
  private readonly vignette: XrVignette;
  private readonly blink: XrBlink;
  private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
  private readonly preferences: XrPreferences;
  /** Seconds the counter still shows itself after a mode change while hidden. */
  private hudFlash = 0;
  private lastFps = 0;
  private veil?: XrVeil;
  private loading = new LoadingGate();
  private readiness = new PreparationProgress();
  private readonly counter = new FrameCounter();
  private governor?: FrameRateGovernor;
  /** Seconds left of the button hint (`XR_HINT`). */
  private hintSeconds = XR_HINT_SECONDS;
  /** Added to the floor in seated mode (A or X), in metres. */
  private seatedRaise = 0;
  private limitHits = 0;
  private collider?: Collider;
  /** The hand aiming a teleport, if any. */
  private aiming?: XRHandedness;
  private target?: Point2;
  private stair?: { id: string; direction: StairDirection };
  private lastValid?: Point2;
  /** Head position at the end of the previous frame, after every correction. */
  private lastHead?: Vector3;
  private ended = false;
  private disposed = false;

  constructor(
    private readonly host: ImmersiveHost,
    private readonly helper: WebXRExperienceHelper,
    /** Present on a PC-driven headset: tunes the next session's render scale. */
    private readonly scaleTuner?: XrScaleTuner,
  ) {
    const scene = host.scene;
    const camera = (this.camera = helper.camera);
    camera.minZ = 0.04;
    camera.maxZ = 300;
    camera.inertia = 0;
    // Collisions are resolved on the rig, see `walk`.
    camera.checkCollisions = false;
    camera.applyGravity = false;
    this.rig = new TransformNode('xr-rig', scene);
    this.rig.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), host.start.yaw);
    const [x, z] = host.start.point;
    this.rig.position.set(x, groundElevationAt(host.level, host.site, [x, z]), z);
    this.material = new StandardMaterial('xr-pointer', scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = READY;
    this.marker = CreateDisc('xr-target', { radius: 0.25, tessellation: 32 }, scene);
    this.marker.rotation.x = Math.PI / 2;
    this.marker.material = this.material;
    this.marker.isPickable = false;
    this.marker.setEnabled(false);
    this.arc = CreateSphere('xr-arc', { diameter: 0.025, segments: 4 }, scene);
    this.arc.material = this.material;
    this.arc.isPickable = false;
    this.arc.alwaysSelectAsActiveMesh = true;
    this.arc.thinInstanceSetBuffer('matrix', this.arcMatrices, 16, false);
    this.arc.thinInstanceCount = 0;
    this.arc.setEnabled(false);
    this.storage = host.storage ?? browserStorage();
    this.preferences = readXrPreferences(this.storage);
    this.hud = new XrHud(scene, camera);
    this.hud.visible = this.preferences.counter;
    this.vignette = new XrVignette(scene, camera);
    this.blink = new XrBlink(scene, camera);
    this.veil = new XrVeil(scene, camera);
    camera.layerMask = XR_VEIL_LAYER;
    helper.sessionManager.onXRSessionEnded.addOnce(() => this.end());
  }

  /**
   * Hands the camera to the rig. Babylon copied the screen camera into the session
   * camera on entry; undone here, the camera starts at the rig and only follows the
   * tracked pose from then on.
   */
  placeCamera() {
    const camera = this.camera;
    camera.parent = this.rig;
    camera.position.setAll(0);
    camera.rotationQuaternion.set(0, 0, 0, 1);
  }

  /** Called once per frame by the viewer, inside the headset frame. */
  step(seconds: number) {
    const manager = this.helper.sessionManager;
    const frame = manager.currentFrame;
    const session = manager.session;
    if (!frame || !session || this.ended) return;
    if (this.veil && !this.lift()) return;
    this.followPose();
    this.blink.update(seconds);
    if (this.hintSeconds > 0) {
      // The buttons, named once as the view opens; the counter keeps its own choice after.
      this.hintSeconds -= seconds;
      this.hud.visible = this.hintSeconds > 0 || this.preferences.counter;
      this.showHud();
    }
    const fps = this.counter.tick(performance.now());
    if (fps !== undefined) {
      this.lastFps = fps;
      this.showHud();
      const before = this.governor?.current;
      const rate = this.governor?.observe(fps);
      if (rate !== undefined) {
        this.setFrameRate(rate);
        // Only a lowered rate says the scale was too much; a probe upwards says nothing.
        if (before !== undefined && rate < before) this.scaleTuner?.markTooMuch();
      }
      this.scaleTuner?.observe(fps, this.governor?.current);
    }
    if (this.hudFlash > 0) {
      this.hudFlash -= seconds;
      if (this.hudFlash <= 0) this.hud.visible = this.preferences.counter;
    }
    const states = new Map<XRHandedness, ControllerState>();
    for (const source of session.inputSources) {
      if (source.targetRayMode !== 'tracked-pointer') continue;
      const pointer = this.pointer(source);
      const pose = frame.getPose(source.targetRaySpace, manager.referenceSpace);
      pointer.root.setEnabled(!!pose);
      if (!pose) continue;
      const p = pose.transform.position;
      const o = pose.transform.orientation;
      pointer.root.position.set(p.x, p.y, p.z);
      pointer.root.rotationQuaternion ??= new Quaternion();
      pointer.root.rotationQuaternion.set(o.x, o.y, o.z, o.w);
      const state = readControllerGamepad(source.gamepad);
      const hand: XRHandedness = source.handedness === 'left' ? 'left' : 'right';
      states.set(hand, state);
      const hit = this.pick(pointer, XR_DOOR_REACH);
      const door = hit?.pickedMesh?.metadata?.kind === 'door' ? hit.pickedMesh.metadata.id : '';
      pointer.ray.scaling.z = hit?.hit ? hit.distance : XR_DOOR_REACH;
      if (state.trigger && !pointer.trigger && door) this.host.toggleDoor(door);
      pointer.trigger = state.trigger;
      if (state.face && !pointer.face) {
        if (hand === 'left') this.toggleCounter();
        else this.toggleSeated();
      }
      pointer.face = state.face;
      if (state.upper && !pointer.upper) this.toggleTeleportOnly();
      pointer.upper = state.upper;
    }

    let motion = 0;
    if (this.preferences.teleport) {
      for (const [hand, state] of states) {
        const pointer = this.pointerFor(hand);
        if (!pointer) continue;
        const snap = snapTurn(pointer.snapArmed, this.aiming ? 0 : turnAxis(state.x, state.y));
        pointer.snapArmed = snap.armed;
        if (snap.angle) this.blink.start(() => this.turn(snap.angle));
        this.updateTeleport(state, hand);
      }
    } else {
      const move = states.get('left');
      const aim = states.get('right');
      if (move && (move.x || move.y)) {
        const forward = this.camera.getDirection(Vector3.Forward(true));
        this.walk(stickDisplacement(forward, move.x, move.y, XR_WALK_SPEED, seconds));
        motion = Math.min(1, Math.hypot(move.x, move.y));
      }
      if (aim) {
        const axis = this.aiming ? 0 : turnAxis(aim.x, aim.y);
        if (axis) {
          this.turn(smoothTurnAngle(axis, seconds));
          motion = Math.max(motion, Math.abs(axis));
        }
        this.updateTeleport(aim, 'right');
      }
    }
    this.vignette.update(motion, seconds);

    // Walls stop room-scale walking (`followPose`); the open edge of the modelled
    // ground has no wall, so the visit is sent back inside it.
    const head = this.head();
    const point: Point2 = [head.x, head.z];
    if (isVisitArea(this.host.level, this.host.site, point)) this.lastValid = point;
    else if (this.lastValid) {
      this.limitHits++;
      this.moveHeadTo(this.lastValid);
    }
    this.followFloor();
    this.lastHead = this.head();
  }

  /**
   * Room-scale walking: the tracked head moved since the previous frame. That move goes
   * through the same body collider as the stick, and the rig takes back what a wall
   * refused, so the head stops at the wall instead of crossing it. Without this, only
   * the terrain guard could react, and it threw the visitor back to the last valid point.
   */
  followPose() {
    const head = this.head();
    const previous = this.lastHead;
    this.lastHead = head;
    if (!previous) return;
    const delta = new Vector3(head.x - previous.x, 0, head.z - previous.z);
    const length = delta.length();
    if (length < 1e-5 || length > XR_POSE_JUMP) return;
    const allowed = this.collide(previous, delta);
    this.rig.position.x += allowed.x - delta.x;
    this.rig.position.z += allowed.z - delta.z;
    this.lastHead = this.head();
  }

  /** False while the veil stays: the first images show it alone, then it hides the house. */
  private lift(): boolean {
    const phase = this.loading.tick(performance.now(), () => this.host.isReady());
    if (phase === 'veil') return false;
    if (phase === 'compiling') {
      this.camera.layerMask = XR_DEFAULT_LAYERS | XR_VEIL_LAYER;
      this.veil?.progress(this.readiness.update(0, 1, this.host.readiness?.() ?? 0, 1));
      return false;
    }
    this.camera.layerMask = XR_DEFAULT_LAYERS;
    this.veil?.dispose();
    this.veil = undefined;
    return true;
  }

  /**
   * Lands on another level after a stair: the head at `point`, looking along `yaw` (the walk
   * camera's convention), the floor under it, and the loading veil back while the new
   * level's shaders link.
   */
  arrive(point: Point2, yaw: number) {
    const forward = this.camera.getDirection(Vector3.Forward(true));
    const current = Math.atan2(-forward.x, -forward.z);
    // The camera's yaw grows to the left; `turn` takes a right-handed yaw about +y.
    this.turn(yaw - current);
    this.moveHeadTo(point);
    this.lastValid = point;
    this.followFloor();
    this.lastHead = undefined;
    this.showVeil();
  }

  private showVeil() {
    this.veil ??= new XrVeil(this.host.scene, this.camera);
    this.vignette.hide();
    this.loading = new LoadingGate();
    this.readiness = new PreparationProgress();
    this.veil.progress(0);
    this.camera.layerMask = XR_VEIL_LAYER;
  }

  async exit() {
    if (this.ended) return;
    await this.helper.exitXRAsync();
  }

  /** False once the session has ended, even if it ended while starting. */
  get active(): boolean {
    return !this.ended;
  }

  /** Head position in the plan. */
  get position(): Point2 {
    const head = this.head();
    return [head.x, head.z];
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // The next session opens at the scale this one earned.
    if (this.scaleTuner)
      try {
        localStorage.setItem(XR_SCALE_STORAGE, JSON.stringify({ scale: this.scaleTuner.next }));
      } catch {
        /* optional persistence */
      }
    for (const pointer of this.pointers.values()) pointer.root.dispose();
    this.pointers.clear();
    this.marker.dispose();
    this.arc.dispose();
    this.material.dispose();
    this.hud.dispose();
    this.vignette.dispose();
    this.blink.dispose();
    this.veil?.dispose();
    this.veil = undefined;
    this.camera.layerMask = XR_DEFAULT_LAYERS;
    this.camera.parent = null;
    this.helper.dispose();
    this.rig.dispose();
  }

  /** World position of the head, the tracked pose carried by the rig. */
  head(): Vector3 {
    this.rig.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(this.camera.position, this.rig.getWorldMatrix());
  }

  /**
   * Smooth walk with the walk camera's collisions: an ellipsoid hung under the head,
   * so walls and doors stop the visitor and a 20 cm step does not.
   */
  walk(displacement: Vector3) {
    this.rig.position.addInPlace(this.collide(this.head(), displacement));
    this.lastHead = this.head();
  }

  /** The horizontal part of `displacement` a body hung under `head` can travel. */
  private collide(head: Vector3, displacement: Vector3): Vector3 {
    const scene = this.host.scene;
    const coordinator = scene.collisionCoordinator;
    if (!scene.collisionsEnabled || !coordinator)
      return new Vector3(displacement.x, 0, displacement.z);
    this.collider ??= coordinator.createCollider();
    this.collider._radius = new Vector3(VISITOR_RADIUS, XR_BODY_HALF_HEIGHT, VISITOR_RADIUS);
    const center = head.subtractFromFloats(0, XR_BODY_DROP, 0);
    const reached = coordinator.getNewPosition(
      center,
      displacement,
      this.collider,
      3,
      null,
      () => undefined,
      this.rig.uniqueId,
    );
    const moved = reached.subtract(center);
    moved.y = 0;
    return moved;
  }

  /** Turn on the spot: the rig rotates around the head. */
  turn(angle: number) {
    const head = this.head();
    this.rig.position.copyFrom(turnAround(this.rig.position, head, angle));
    const rotation = Quaternion.RotationAxis(Vector3.Up(), angle);
    this.rig.rotationQuaternion = rotation.multiply(
      this.rig.rotationQuaternion ?? Quaternion.Identity(),
    );
  }

  private moveHeadTo(point: Point2) {
    const head = this.head();
    this.rig.position.x += point[0] - head.x;
    this.rig.position.z += point[1] - head.z;
    this.lastHead = this.head();
  }

  /** The real floor stays on the ground under the head: room floor, step or lawn. */
  private followFloor() {
    const head = this.head();
    this.rig.position.y =
      groundElevationAt(this.host.level, this.host.site, [head.x, head.z]) + this.seatedRaise;
  }

  /** Raised above the real floor in seated mode, in metres. */
  get seatedOffset(): number {
    return this.seatedRaise;
  }

  /**
   * A or X: seated mode on or off. On, the floor is lowered so the eyes stand at the walk's
   * eye height from the current head height; off, the real height comes back. Switched by
   * hand, not guessed: a crouching or a tall visitor would be misread.
   */
  toggleSeated() {
    this.seatedRaise =
      this.seatedRaise !== 0 ? 0 : seatedLift(this.camera.position.y, this.host.eyeHeight);
    this.followFloor();
    this.lastHead = this.head();
    this.flashHud();
  }

  /** Teleport-only locomotion is on (B or Y). */
  get teleportOnly(): boolean {
    return this.preferences.teleport;
  }

  /** The frame counter is on screen. */
  get counterVisible(): boolean {
    return this.hud.visible;
  }

  /** B or Y: teleport-only locomotion on or off, remembered for the next sessions. */
  toggleTeleportOnly() {
    this.preferences.teleport = !this.preferences.teleport;
    this.cancelAim();
    this.vignette.hide();
    writeXrPreferences(this.preferences, this.storage);
    this.flashHud();
  }

  /** X: the frame counter shown or hidden, remembered for the next sessions. */
  toggleCounter() {
    this.preferences.counter = !this.preferences.counter;
    this.hudFlash = 0;
    this.hud.visible = this.preferences.counter;
    writeXrPreferences(this.preferences, this.storage);
    this.showHud();
  }

  /** A mode changed: the counter names it, and shows itself a moment if it is hidden. */
  private flashHud() {
    this.showHud();
    if (this.preferences.counter) return;
    this.hud.visible = true;
    this.hudFlash = XR_HUD_FLASH_SECONDS;
  }

  private showHud() {
    this.hud.show(
      this.lastFps,
      this.limitHits,
      this.seatedOffset !== 0,
      this.preferences.teleport,
      this.scaleTuner?.scale,
      this.hintSeconds > 0 ? XR_HINT : undefined,
    );
  }

  /** Asks the headset for the highest display rate up to the target; ignored where unsupported. */
  requestFrameRate() {
    const session = this.helper.sessionManager.session as
      | (XRSession & {
          supportedFrameRates?: Float32Array;
          updateTargetFrameRate?: (rate: number) => Promise<void>;
        })
      | undefined;
    if (!session?.updateTargetFrameRate) return;
    const supported = Array.from(session.supportedFrameRates ?? []);
    const rate = pickFrameRate(supported);
    if (rate === undefined) return;
    this.governor = new FrameRateGovernor(rate, supported);
    this.setFrameRate(rate);
  }

  private setFrameRate(rate: number) {
    const session = this.helper.sessionManager.session as
      (XRSession & { updateTargetFrameRate?: (rate: number) => Promise<void> }) | undefined;
    session?.updateTargetFrameRate?.(rate).catch(() => undefined);
  }

  private end() {
    if (this.ended) return;
    this.ended = true;
    this.host.onEnd(this);
  }

  private pointerFor(hand: XRHandedness): Pointer | undefined {
    return [...this.pointers.values()].find((p) => p.handedness === hand);
  }

  /** Drops an aim in progress without jumping. */
  private cancelAim() {
    const pointer = this.aiming && this.pointerFor(this.aiming);
    if (pointer) pointer.ray.setEnabled(true);
    this.aiming = undefined;
    this.target = undefined;
    this.stair = undefined;
    this.marker.setEnabled(false);
    this.arc.setEnabled(false);
    this.material.emissiveColor = READY;
  }

  /**
   * The stick of `hand` pushed forward aims a teleport along an arc; released, the visitor
   * lands on the last valid point. One hand aims at a time.
   */
  private updateTeleport(aim: ControllerState, hand: XRHandedness) {
    if (this.aiming && this.aiming !== hand) return;
    const pointer = this.pointerFor(hand);
    if (!pointer) return;
    if (aim.y < -0.6) {
      this.aiming = hand;
      pointer.ray.setEnabled(false);
      const hit = this.pickArc(pointer);
      const normal = hit?.hit ? hit.getNormal(true) : null;
      const point: Point2 | undefined =
        hit?.pickedPoint && normal && normal.y > 0.7
          ? [hit.pickedPoint.x, hit.pickedPoint.z]
          : undefined;
      const metadata = hit?.pickedMesh?.metadata;
      this.stair =
        point && metadata?.kind === 'stair'
          ? { id: metadata.id, direction: metadata.direction }
          : undefined;
      this.target = point && (this.stair || this.host.isDestination(point)) ? point : undefined;
      this.material.emissiveColor = this.target ? VALID : INVALID;
      this.marker.setEnabled(!!point);
      if (hit?.pickedPoint)
        this.marker.position.copyFrom(hit.pickedPoint).addInPlaceFromFloats(0, 0.01, 0);
      return;
    }
    if (this.aiming !== hand) return;
    // Stick released: jump if the last aimed point was valid.
    const target = this.target;
    const stair = this.stair;
    this.cancelAim();
    if (aim.y < -0.2 || !target) return;
    if (stair) {
      // The host rebuilds the level and calls `arrive`, which places the visitor behind the veil.
      this.host.takeStair(stair.id, stair.direction);
      return;
    }
    const land = () => {
      this.moveHeadTo(target);
      this.lastValid = target;
      this.followFloor();
    };
    if (this.preferences.teleport) this.blink.start(land);
    else land();
  }

  /** Follows the arc from the controller to the first surface it meets, and draws its dots. */
  private pickArc(pointer: Pointer) {
    const root = pointer.root;
    root.computeWorldMatrix(true);
    const direction = Vector3.TransformNormal(Vector3.Forward(true), root.getWorldMatrix());
    const points = teleportArc(root.getAbsolutePosition(), direction);
    let hit: ReturnType<Scene['pickWithRay']> = null;
    let drawn = points.length;
    for (let i = 1; i < points.length; i++) {
      const segment = points[i].subtract(points[i - 1]);
      const length = segment.length();
      const found = this.host.scene.pickWithRay(
        new Ray(points[i - 1], segment.scaleInPlace(1 / length), length),
      );
      if (found?.hit) {
        hit = found;
        drawn = i;
        break;
      }
    }
    for (let i = 0; i < drawn; i++)
      Matrix.Translation(points[i].x, points[i].y, points[i].z).copyToArray(
        this.arcMatrices,
        i * 16,
      );
    this.arc.thinInstanceBufferUpdated('matrix');
    this.arc.thinInstanceCount = drawn;
    this.arc.setEnabled(true);
    return hit;
  }

  private pick(pointer: Pointer, length: number) {
    const root = pointer.root;
    root.computeWorldMatrix(true);
    const origin = root.getAbsolutePosition().clone();
    const direction = Vector3.TransformNormal(Vector3.Forward(true), root.getWorldMatrix());
    direction.normalize();
    // The default predicate: pickable, enabled and visible. The pointers are not pickable.
    return this.host.scene.pickWithRay(new Ray(origin, direction, length));
  }

  private pointer(source: XRInputSource): Pointer {
    const existing = this.pointers.get(source);
    if (existing) return existing;
    const scene = this.host.scene;
    const root = CreateBox(
      `xr-controller-${source.handedness}`,
      { width: 0.035, height: 0.025, depth: 0.1 },
      scene,
    );
    root.bakeTransformIntoVertices(Matrix.Translation(0, 0, 0.04));
    root.material = this.material;
    root.isPickable = false;
    // Controller poses are in the session space, like the camera: the rig carries both.
    root.parent = this.rig;
    const ray = CreateBox(
      `xr-ray-${source.handedness}`,
      { width: 0.004, height: 0.004, depth: 1 },
      scene,
    );
    // Unit length along the pointing direction (-z), scaled to the hit each frame.
    ray.bakeTransformIntoVertices(Matrix.Translation(0, 0, -0.5));
    ray.parent = root;
    ray.material = this.material;
    ray.isPickable = false;
    const pointer: Pointer = {
      handedness: source.handedness,
      root,
      ray,
      trigger: false,
      face: false,
      upper: false,
      snapArmed: true,
    };
    this.pointers.set(source, pointer);
    return pointer;
  }
}
