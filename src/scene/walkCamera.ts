import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { Level } from '../model/types';

export const EYE_HEIGHT = 1.65;
export const VISITOR_RADIUS = .17;
export const ELLIPSOID_HALF_HEIGHT = .8;

export function createWalkCamera(scene: Scene, level: Level) {
  const camera = new UniversalCamera('walk', new Vector3(level.spawn.position[0], level.elevation + EYE_HEIGHT, level.spawn.position[1]), scene);
  camera.rotation.y = level.spawn.yaw;
  camera.minZ = .04; camera.maxZ = 300; camera.fov = 1.05;
  camera.checkCollisions = true; camera.applyGravity = true;
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
