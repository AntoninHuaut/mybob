import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Level } from '../model/types';
import { floorElevationAt } from '../model/geometry';
import { cameraYaw } from './coordinates';
import { pointInPolygon } from '../model/geometry';
import { Ray } from '@babylonjs/core/Culling/ray';

export const EYE_HEIGHT = 1.65;
export const VISITOR_RADIUS = 0.17;
export const ELLIPSOID_HALF_HEIGHT = 0.8;

/** Lift over a small, unobstructed threshold; keep mesh collisions for walls and doors. */
export function prepareWalkStep(camera: UniversalCamera, level: Level, movement: Vector3) {
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
  const currentFloor = floorElevationAt(level, [camera.position.x, camera.position.z]);
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
  camera.fov = 1.05;
  camera.checkCollisions = true;
  camera.applyGravity = true;
  camera.needMoveForGravity = true;
  camera.ellipsoid.set(VISITOR_RADIUS, ELLIPSOID_HALF_HEIGHT, VISITOR_RADIUS);
  // FreeCamera already subtracts ellipsoid.y before applying this offset.
  // Center = eye - halfHeight + offset; its bottom must coincide with the floor.
  camera.ellipsoidOffset.set(0, 2 * ELLIPSOID_HALF_HEIGHT - EYE_HEIGHT, 0);
  camera.inertia = 0;
  camera.angularSensibility = 2300;
  camera.inputs.removeByType('FreeCameraKeyboardMoveInput');
  return camera;
}
