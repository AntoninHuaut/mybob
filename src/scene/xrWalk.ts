import { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper';
import type { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import type { Collider } from '@babylonjs/core/Collisions/collider';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Ray } from '@babylonjs/core/Culling/ray';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, Point2, ProjectSite } from '../model/types';
import { groundElevationAt } from '../model/geometry';
import { isVisitArea } from './navigation';
import { VISITOR_RADIUS } from './walkCamera';
import {
  FrameCounter,
  LoadingGate,
  XR_DEFAULT_LAYERS,
  XR_VEIL_LAYER,
  XrHud,
  XrVeil,
} from './xrHud';

/**
 * The visit in a WebXR headset (Quest browser). It is a state of the walk, not a
 * fourth view mode: `viewer.mode` stays `walk`, this module only replaces the
 * camera and the controls while the session lasts.
 *
 * Controls, xr-standard gamepad mapping (Quest Touch):
 * - left stick: walk, relative to where the head looks, with wall collisions;
 * - room-scale steps (the headset itself moving) meet the same walls;
 * - right stick sideways: snap turn; pushed forward then released: teleport;
 * - trigger, either hand: open or close the door the controller points at.
 *
 * The session opens behind a loading veil (`xrHud.ts`) until the house's shaders are linked,
 * like the page's overlay for the other views; the controls wait for it.
 *
 * The session renders without post-processing or sun shadows and with the strongest
 * fixed foveation the headset offers: the edges of each lens, blurred by the optics
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

/** Headset walking speed. Slower than the keyboard default: fast smooth motion makes people sick. */
export const XR_WALK_SPEED = 1.6;
/** Strongest fixed foveation: the cheapest frame, blur confined to the lens edges. */
export const XR_FIXED_FOVEATION = 1;
export const SNAP_TURN_DEGREES = 30;
export const STICK_DEADZONE = 0.2;
/** How far a controller reaches a door, like the keyboard's E (2.4 m) plus an arm. */
export const XR_DOOR_REACH = 3;
export const XR_TELEPORT_REACH = 12;
/** Body collider below the head: walls stop the visitor, a 20 cm step does not. */
export const XR_BODY_HALF_HEIGHT = 0.5;
export const XR_BODY_DROP = 0.6;
/** A head move larger than this in one frame is a tracking reset, not a step: it is not collided. */
export const XR_POSE_JUMP = 0.5;

export function applyDeadzone(value: number, threshold = STICK_DEADZONE): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) return 0;
  return (Math.sign(value) * (Math.min(1, magnitude) - threshold)) / (1 - threshold);
}

/**
 * One snap per push: the stick must come back near the centre before the next turn.
 * Returns the turn direction (+1 right, -1 left) and whether the next push counts.
 */
export function snapTurn(axis: number, armed: boolean): { turn: -1 | 0 | 1; armed: boolean } {
  if (!armed) return { turn: 0, armed: Math.abs(axis) < 0.3 };
  if (axis > 0.7) return { turn: 1, armed: false };
  if (axis < -0.7) return { turn: -1, armed: false };
  return { turn: 0, armed: true };
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

/** Snap turn as a yaw delta, in radians. Right-handed y-up: turning right is negative. */
export function snapTurnAngle(turn: -1 | 0 | 1): number {
  return turn === 0 ? 0 : (-turn * SNAP_TURN_DEGREES * Math.PI) / 180;
}

export interface ControllerState {
  x: number;
  y: number;
  trigger: boolean;
}

/** xr-standard mapping: thumbstick on axes 2-3, trigger on button 0. */
export function readControllerGamepad(gamepad: Gamepad | null | undefined): ControllerState {
  if (!gamepad) return { x: 0, y: 0, trigger: false };
  const axes = gamepad.axes;
  const stick = axes.length >= 4 ? 2 : 0;
  return {
    x: applyDeadzone(axes[stick] ?? 0),
    y: applyDeadzone(axes[stick + 1] ?? 0),
    trigger: !!gamepad.buttons[0]?.pressed,
  };
}

export interface ImmersiveHost {
  scene: Scene;
  level: Level;
  site?: ProjectSite;
  /** Where the screen walk stands and looks when the headset takes over. */
  start: { point: Point2; yaw: number };
  /** A floor point where the visitor may stand: inside a room or on the parcel. */
  isDestination(point: Point2): boolean;
  toggleDoor(id: string): void;
  /** Every visible mesh can be drawn; asking starts the links of those that cannot yet. */
  isReady(): boolean;
  /** The session ended, whoever ended it: the headset menu, the page or an error. */
  onEnd(walk: ImmersiveWalk): void;
}

interface Pointer {
  handedness: XRHandedness;
  root: Mesh;
  ray: Mesh;
  trigger: boolean;
}

const READY = new Color3(0.92, 0.92, 0.88);
const VALID = new Color3(0.35, 0.85, 0.5);
const INVALID = new Color3(0.9, 0.35, 0.3);

export async function startImmersiveWalk(host: ImmersiveHost): Promise<ImmersiveWalk> {
  const helper = await WebXRExperienceHelper.CreateAsync(host.scene);
  const walk = new ImmersiveWalk(host, helper);
  try {
    await helper.enterXRAsync('immersive-vr', 'local-floor');
    // 0 to 1; ignored by a browser or layer without fixed foveation.
    helper.sessionManager.fixedFoveation = XR_FIXED_FOVEATION;
  } catch (error) {
    walk.dispose();
    throw error;
  }
  walk.placeCamera();
  return walk;
}

export class ImmersiveWalk {
  readonly camera: WebXRCamera;
  /** Carries the visitor in the plan: the camera pose is local to it. */
  readonly rig: TransformNode;
  private readonly pointers = new Map<XRInputSource, Pointer>();
  private readonly material: StandardMaterial;
  private readonly marker: Mesh;
  private readonly hud: XrHud;
  private veil?: XrVeil;
  private readonly loading = new LoadingGate();
  private readonly counter = new FrameCounter();
  private limitHits = 0;
  private collider?: Collider;
  private turnArmed = true;
  private aiming = false;
  private target?: Point2;
  private lastValid?: Point2;
  /** Head position at the end of the previous frame, after every correction. */
  private lastHead?: Vector3;
  private ended = false;
  private disposed = false;

  constructor(
    private readonly host: ImmersiveHost,
    private readonly helper: WebXRExperienceHelper,
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
    this.hud = new XrHud(scene, camera);
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
    const fps = this.counter.tick(performance.now());
    if (fps !== undefined) this.hud.show(fps, this.limitHits);
    let move: ControllerState | undefined;
    let aim: ControllerState | undefined;
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
      if (source.handedness === 'left') move = state;
      else aim = state;
      const hit = this.pick(pointer, XR_DOOR_REACH);
      const door = hit?.pickedMesh?.metadata?.kind === 'door' ? hit.pickedMesh.metadata.id : '';
      pointer.ray.scaling.z = hit?.hit ? hit.distance : XR_DOOR_REACH;
      if (state.trigger && !pointer.trigger && door) this.host.toggleDoor(door);
      pointer.trigger = state.trigger;
    }

    if (move && (move.x || move.y)) {
      const forward = this.camera.getDirection(Vector3.Forward(true));
      this.walk(stickDisplacement(forward, move.x, move.y, XR_WALK_SPEED, seconds));
    }
    if (aim) {
      const turn = snapTurn(this.aiming ? 0 : aim.x, this.turnArmed);
      this.turnArmed = turn.armed;
      if (turn.turn) this.turn(snapTurnAngle(turn.turn));
      this.updateTeleport(aim);
    }

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
      return false;
    }
    this.camera.layerMask = XR_DEFAULT_LAYERS;
    this.veil?.dispose();
    this.veil = undefined;
    return true;
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
    for (const pointer of this.pointers.values()) pointer.root.dispose();
    this.pointers.clear();
    this.marker.dispose();
    this.material.dispose();
    this.hud.dispose();
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

  /** Snap turn on the spot: the rig rotates around the head. */
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
    this.rig.position.y = groundElevationAt(this.host.level, this.host.site, [head.x, head.z]);
  }

  private end() {
    if (this.ended) return;
    this.ended = true;
    this.host.onEnd(this);
  }

  private updateTeleport(aim: ControllerState) {
    const pointer = [...this.pointers.values()].find((p) => p.handedness === 'right');
    if (!pointer) return;
    if (aim.y < -0.6) {
      this.aiming = true;
      const hit = this.pick(pointer, XR_TELEPORT_REACH);
      const normal = hit?.hit ? hit.getNormal(true) : null;
      const point: Point2 | undefined =
        hit?.pickedPoint && normal && normal.y > 0.7
          ? [hit.pickedPoint.x, hit.pickedPoint.z]
          : undefined;
      this.target = point && this.host.isDestination(point) ? point : undefined;
      pointer.ray.scaling.z = hit?.hit ? hit.distance : XR_TELEPORT_REACH;
      this.material.emissiveColor = this.target ? VALID : INVALID;
      this.marker.setEnabled(!!point);
      if (hit?.pickedPoint)
        this.marker.position.copyFrom(hit.pickedPoint).addInPlaceFromFloats(0, 0.01, 0);
      return;
    }
    if (!this.aiming) return;
    // Stick released: jump if the last aimed point was valid.
    this.aiming = false;
    this.marker.setEnabled(false);
    this.material.emissiveColor = READY;
    const target = this.target;
    this.target = undefined;
    if (aim.y < -0.2 || !target) return;
    this.moveHeadTo(target);
    this.lastValid = target;
    this.followFloor();
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
    };
    this.pointers.set(source, pointer);
    return pointer;
  }
}
