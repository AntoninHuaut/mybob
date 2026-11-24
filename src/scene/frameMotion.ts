import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, ProjectSite } from '../model/types';
import { groundElevationAt } from '../model/geometry';
import type { StairDirection } from '../model/stairs';
import { poseDoor, type DoorInstance } from './buildHouse';
import { poseGate, type GateInstance } from './buildExterior';
import { isVisitArea } from './navigation';
import { prepareWalkStep, walkDisplacement } from './walkCamera';

/** How far E or a click reaches in the visit: a door or a stair ahead. */
export const WALK_REACH = 2.4;

export interface MoveAxes {
  forward: number;
  side: number;
  fast: boolean;
}

/** Held movement keys: ZQSD, WASD and arrows; Shift goes faster. */
export class HeldKeys {
  private readonly codes = new Set<string>();

  press(code: string) {
    this.codes.add(code);
  }
  release(code: string) {
    this.codes.delete(code);
  }
  clear() {
    this.codes.clear();
  }
  get any() {
    return this.codes.size > 0;
  }
  axes(): MoveAxes {
    const held = (...codes: string[]) => codes.some((code) => this.codes.has(code));
    return {
      forward: Number(held('KeyW', 'KeyZ', 'ArrowUp')) - Number(held('KeyS', 'ArrowDown')),
      side: Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'KeyQ', 'ArrowLeft')),
      fast: held('ShiftLeft', 'ShiftRight'),
    };
  }
}

const swinging = (swing: { progress: number; target: number }) =>
  Math.abs(swing.progress - swing.target) > 0.001;

/** True while a door or a gate has not reached its target yet. */
export function anySwinging(doors: DoorInstance[] = [], gates: GateInstance[] = []) {
  return doors.some(swinging) || gates.some(swinging);
}

/** Moves each swinging door and gate towards its target; true when one moved. */
export function stepSwings(dt: number, doors: DoorInstance[], gates: GateInstance[] = []) {
  const advance = (swing: { progress: number; target: number }) => {
    swing.progress +=
      Math.sign(swing.target - swing.progress) *
      Math.min(Math.abs(swing.target - swing.progress), dt * 2.5);
  };
  let moved = false;
  for (const door of doors.filter(swinging)) {
    advance(door);
    poseDoor(door);
    moved = true;
  }
  for (const gate of gates.filter(swinging)) {
    advance(gate);
    poseGate(gate);
    moved = true;
  }
  return moved;
}

/**
 * The visit may leave the house onto the parcel, but never the modelled ground: outside
 * the parcel, under the floor, or above the ceiling.
 */
export function outsideVisit(level: Level, site: ProjectSite | undefined, p: Vector3) {
  return (
    !isVisitArea(level, site, [p.x, p.z]) ||
    p.y < groundElevationAt(level, site, [p.x, p.z]) + 0.7 ||
    p.y > level.elevation + level.ceilingHeight + 1
  );
}

/** One frame of walking: no axes means standing still, which still lets gravity act. */
export function stepWalk(
  walk: UniversalCamera,
  level: Level,
  site: ProjectSite | undefined,
  axes: MoveAxes | undefined,
  speed: number,
  dt: number,
) {
  const movement = axes
    ? walkDisplacement(walk, axes.forward, axes.side, speed, dt, axes.fast)
    : Vector3.Zero();
  prepareWalkStep(walk, level, movement, site);
  walk.cameraDirection.addInPlace(movement);
}

export function editableFurnitureId(hit: PickingInfo | null | undefined) {
  const metadata = hit?.pickedMesh?.metadata;
  return metadata?.kind === 'furniture' && typeof metadata.id === 'string' && metadata.id
    ? (metadata.id as string)
    : undefined;
}

/**
 * What the visitor looks at, picked again only when the camera, a door or the scene
 * changed: a still visit reuses its last hit instead of casting a ray every frame.
 */
export class WalkAim {
  private hit?: PickingInfo | null;
  private dirty = true;

  invalidate() {
    this.dirty = true;
  }
  forget() {
    this.hit = undefined;
    this.dirty = true;
  }
  update(scene: Scene, camera: UniversalCamera, changed: boolean) {
    if (changed || this.dirty) {
      this.hit = scene.pickWithRay(camera.getForwardRay(3));
      this.dirty = false;
    }
    const hit = this.hit;
    const within = (kind: string) =>
      hit?.pickedMesh?.metadata?.kind === kind && hit.distance <= WALK_REACH;
    return {
      nearDoor: within('door'),
      nearStair: within('stair')
        ? (hit!.pickedMesh!.metadata.direction as StairDirection)
        : undefined,
      furnitureId: editableFurnitureId(hit),
    };
  }
}
