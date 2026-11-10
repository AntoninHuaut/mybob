import { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper';
import type { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Ray } from '@babylonjs/core/Culling/ray';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, Point2, ProjectSite } from '../model/types';
import { groundElevationAt } from '../model/geometry';
import { isVisitArea } from './navigation';
import { VISITOR_RADIUS } from './walkCamera';

/**
 * The visit in a WebXR headset (Quest browser). It is a state of the walk, not a
 * fourth view mode: `viewer.mode` stays `walk`, this module only replaces the
 * camera and the controls while the session lasts.
 *
 * Controls, xr-standard gamepad mapping (Quest Touch):
 * - left stick: walk, relative to where the head looks, with wall collisions;
 * - right stick sideways: snap turn; pushed forward then released: teleport;
 * - trigger, either hand: open or close the door the controller points at;
 * - B or Y: switch the walk post-processing on or off, to judge its cost.
 *
 * Controller models are never downloaded: the session reads the gamepads directly
 * and draws its own pointers, so the visit keeps working without the network.
 */

/** Headset walking speed. Slower than the keyboard default: fast smooth motion makes people sick. */
export const XR_WALK_SPEED = 1.6;
export const SNAP_TURN_DEGREES = 30;
export const STICK_DEADZONE = 0.2;
/** How far a controller reaches a door, like the keyboard's E (2.4 m) plus an arm. */
export const XR_DOOR_REACH = 3;
export const XR_TELEPORT_REACH = 12;
/** Body collider below the head: walls stop the visitor, a 20 cm step does not. */
export const XR_BODY_HALF_HEIGHT = 0.5;
export const XR_BODY_DROP = 0.6;

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

/** Height to add to the camera so the real floor matches the ground under the visitor. */
export function floorCorrection(cameraY: number, realWorldHeight: number, ground: number): number {
  return ground + realWorldHeight - cameraY;
}

/** Snap turn as a yaw delta, in radians. Right-handed y-up: turning right is negative. */
export function snapTurnAngle(turn: -1 | 0 | 1): number {
  return turn === 0 ? 0 : (-turn * SNAP_TURN_DEGREES * Math.PI) / 180;
}

export interface ControllerState {
  x: number;
  y: number;
  trigger: boolean;
  secondary: boolean;
}

/** xr-standard mapping: thumbstick on axes 2-3, trigger on button 0, B/Y on button 5. */
export function readControllerGamepad(gamepad: Gamepad | null | undefined): ControllerState {
  if (!gamepad) return { x: 0, y: 0, trigger: false, secondary: false };
  const axes = gamepad.axes;
  const stick = axes.length >= 4 ? 2 : 0;
  return {
    x: applyDeadzone(axes[stick] ?? 0),
    y: applyDeadzone(axes[stick + 1] ?? 0),
    trigger: !!gamepad.buttons[0]?.pressed,
    secondary: !!gamepad.buttons[5]?.pressed,
  };
}

export interface ImmersiveHost {
  scene: Scene;
  level: Level;
  site?: ProjectSite;
  /** A floor point where the visitor may stand: inside a room or on the parcel. */
  isDestination(point: Point2): boolean;
  toggleDoor(id: string): void;
  toggleEffects(): void;
  /** The session ended, whoever ended it: the headset menu, the page or an error. */
  onEnd(walk: ImmersiveWalk): void;
}

interface Pointer {
  handedness: XRHandedness;
  root: Mesh;
  ray: Mesh;
  trigger: boolean;
  secondary: boolean;
}

const READY = new Color3(0.92, 0.92, 0.88);
const VALID = new Color3(0.35, 0.85, 0.5);
const INVALID = new Color3(0.9, 0.35, 0.3);

export async function startImmersiveWalk(host: ImmersiveHost): Promise<ImmersiveWalk> {
  const helper = await WebXRExperienceHelper.CreateAsync(host.scene);
  const walk = new ImmersiveWalk(host, helper);
  try {
    await helper.enterXRAsync('immersive-vr', 'local-floor');
  } catch (error) {
    walk.dispose();
    throw error;
  }
  return walk;
}

export class ImmersiveWalk {
  readonly camera: WebXRCamera;
  private readonly pointers = new Map<XRInputSource, Pointer>();
  private readonly material: StandardMaterial;
  private readonly marker: Mesh;
  private turnArmed = true;
  private aiming = false;
  private target?: Point2;
  private lastValid?: Point2;
  private ended = false;
  private disposed = false;

  constructor(
    private readonly host: ImmersiveHost,
    private readonly helper: WebXRExperienceHelper,
  ) {
    const camera = (this.camera = helper.camera);
    camera.minZ = 0.04;
    camera.maxZ = 300;
    camera.inertia = 0;
    camera.checkCollisions = true;
    camera.applyGravity = false;
    // FreeCamera puts the collider centre at position - ellipsoid.y + offset.
    camera.ellipsoid.set(VISITOR_RADIUS, XR_BODY_HALF_HEIGHT, VISITOR_RADIUS);
    camera.ellipsoidOffset.set(0, XR_BODY_HALF_HEIGHT - XR_BODY_DROP, 0);
    const scene = host.scene;
    this.material = new StandardMaterial('xr-pointer', scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = READY;
    this.marker = MeshBuilder.CreateDisc('xr-target', { radius: 0.25, tessellation: 32 }, scene);
    this.marker.rotation.x = Math.PI / 2;
    this.marker.material = this.material;
    this.marker.isPickable = false;
    this.marker.setEnabled(false);
    helper.sessionManager.onXRSessionEnded.addOnce(() => this.end());
  }

  /** Called once per frame by the viewer, before the camera applies its movement. */
  step(seconds: number) {
    const manager = this.helper.sessionManager;
    const frame = manager.currentFrame;
    const session = manager.session;
    if (!frame || !session || this.ended) return;
    const camera = this.camera;
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
      if (state.secondary && !pointer.secondary) this.host.toggleEffects();
      pointer.trigger = state.trigger;
      pointer.secondary = state.secondary;
    }

    if (move && (move.x || move.y)) {
      const forward = camera.getDirection(Vector3.Forward(true));
      camera.cameraDirection.addInPlace(
        stickDisplacement(forward, move.x, move.y, XR_WALK_SPEED, seconds),
      );
    }
    if (aim) {
      const turn = snapTurn(this.aiming ? 0 : aim.x, this.turnArmed);
      this.turnArmed = turn.armed;
      if (turn.turn) {
        const rotation = Quaternion.RotationAxis(Vector3.Up(), snapTurnAngle(turn.turn));
        camera.rotationQuaternion.copyFrom(rotation.multiply(camera.rotationQuaternion));
      }
      this.updateTeleport(aim);
    }

    const point: Point2 = [camera.position.x, camera.position.z];
    // Room-scale walking is free, but the visit never leaves the modelled ground.
    if (isVisitArea(this.host.level, this.host.site, point)) this.lastValid = point;
    else if (this.lastValid) {
      camera.position.x = this.lastValid[0];
      camera.position.z = this.lastValid[1];
    }
    const ground = groundElevationAt(this.host.level, this.host.site, [
      camera.position.x,
      camera.position.z,
    ]);
    const height = camera.realWorldHeight;
    const correction = floorCorrection(camera.position.y, height, ground);
    if (height > 0 && Math.abs(correction) > 0.002) camera.position.y += correction;
  }

  async exit() {
    if (this.ended) return;
    await this.helper.exitXRAsync();
  }

  /** False once the session has ended, even if it ended while starting. */
  get active(): boolean {
    return !this.ended;
  }

  get position(): Point2 {
    return [this.camera.position.x, this.camera.position.z];
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const pointer of this.pointers.values()) pointer.root.dispose();
    this.pointers.clear();
    this.marker.dispose();
    this.material.dispose();
    this.helper.dispose();
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
    if (aim.y < -0.2 || !this.target) {
      this.target = undefined;
      return;
    }
    const camera = this.camera;
    const height = camera.realWorldHeight;
    camera.position.set(
      this.target[0],
      groundElevationAt(this.host.level, this.host.site, this.target) + height,
      this.target[1],
    );
    this.lastValid = this.target;
    this.target = undefined;
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
    const root = MeshBuilder.CreateBox(
      `xr-controller-${source.handedness}`,
      { width: 0.035, height: 0.025, depth: 0.1 },
      scene,
    );
    root.bakeTransformIntoVertices(Matrix.Translation(0, 0, 0.04));
    root.material = this.material;
    root.isPickable = false;
    const ray = MeshBuilder.CreateBox(
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
      secondary: false,
    };
    this.pointers.set(source, pointer);
    return pointer;
  }
}
