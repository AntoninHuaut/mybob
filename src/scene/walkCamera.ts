import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, ProjectSite } from '../model/types';
import { floorElevationAt, groundElevationAt } from '../model/geometry';
import { cameraYaw, walkMovement } from './coordinates';
import { pointInPolygon } from '../model/geometry';
import { Ray } from '@babylonjs/core/Culling/ray';

export const EYE_HEIGHT = 1.65;
export const VISITOR_RADIUS = 0.17;
export const ELLIPSOID_HALF_HEIGHT = 0.8;
export const DEFAULT_WALK_SPEED = 2.8;

/** One frame of travel in metres, independent of display refresh rate or diagonal input. */
export function walkDisplacement(
  camera: UniversalCamera,
  forward: number,
  side: number,
  speed: number,
  seconds: number,
  sprint = false,
) {
  const direction = walkMovement(camera, forward, side);
  return direction.normalize().scaleInPlace(speed * (sprint ? 1.7 : 1) * seconds);
}

export function applyLookSensitivity(camera: UniversalCamera, multiplier: number) {
  const value = Number.isFinite(multiplier) ? Math.max(0.5, Math.min(2, multiplier)) : 1;
  camera.angularSensibility = 900 / value;
  return value;
}

/** Lift over a small, unobstructed threshold; keep mesh collisions for walls and doors. */
export function prepareWalkStep(
  camera: UniversalCamera,
  level: Level,
  movement: Vector3,
  site?: ProjectSite,
) {
  camera.applyGravity = true;
  if (movement.lengthSquared() < 0.0000001) return;
  const direction = movement.clone();
  direction.y = 0;
  direction.normalize();
  const lookAhead = VISITOR_RADIUS + 0.2;
  const point: [number, number] = [
    camera.position.x + direction.x * lookAhead,
    camera.position.z + direction.z * lookAhead,
  ];
  const targetRoom = level.rooms.find((room) => pointInPolygon(point, room.polygon));
  if (!targetRoom) return;
  // The step is measured from the ground the visitor actually stands on: the lawn
  // outside is lower than the floor, and that rise is the one to climb.
  const currentFloor = groundElevationAt(level, site, [camera.position.x, camera.position.z]);
  const nextFloor = level.elevation + (targetRoom.floorOffset ?? 0);
  const rise = nextFloor - currentFloor;
  if (rise < 0.001 || rise > 0.2) return;
  const ray = new Ray(
    new Vector3(camera.position.x, currentFloor + 0.8, camera.position.z),
    direction,
    lookAhead,
  );
  const obstruction = camera
    .getScene()
    .pickWithRay(ray, (mesh) => mesh.checkCollisions && mesh.isEnabled());
  if (obstruction?.hit) return;
  const eyeHeight =
    typeof camera.metadata?.eyeHeight === 'number' ? camera.metadata.eyeHeight : EYE_HEIGHT;
  camera.position.y = Math.max(camera.position.y, nextFloor + eyeHeight + 0.008);
  camera.applyGravity = false;
}

export function createWalkCamera(scene: Scene, level: Level) {
  const camera = new UniversalCamera(
    'walk',
    new Vector3(
      level.spawn.position[0],
      floorElevationAt(level, level.spawn.position) + EYE_HEIGHT,
      level.spawn.position[1],
    ),
    scene,
  );
  camera.rotation.y = cameraYaw(level.spawn.yaw, scene.useRightHandedSystem);
  camera.minZ = 0.04;
  camera.maxZ = 300;
  // 68° vertical, chosen on the test house: 60° made rooms read smaller than they are.
  camera.fov = (68 * Math.PI) / 180;
  camera.checkCollisions = true;
  camera.applyGravity = true;
  camera.needMoveForGravity = true;
  camera.ellipsoid.set(VISITOR_RADIUS, ELLIPSOID_HALF_HEIGHT, VISITOR_RADIUS);
  // FreeCamera already subtracts ellipsoid.y before applying this offset.
  // Center = eye - halfHeight + offset; its bottom must coincide with the floor.
  camera.ellipsoidOffset.set(0, 2 * ELLIPSOID_HALF_HEIGHT - EYE_HEIGHT, 0);
  camera.inertia = 0;
  applyLookSensitivity(camera, 1);
  camera.inputs.removeByType('FreeCameraKeyboardMoveInput');
  return camera;
}
