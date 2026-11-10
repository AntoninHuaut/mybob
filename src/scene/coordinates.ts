import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { Scene } from '@babylonjs/core/scene';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { Level } from '../model/types';
import { bounds } from '../model/geometry';

/** Match the plan: x increases to the right, z down the page, y upward. */
export function usePlanCoordinates(scene: Scene) {
  scene.useRightHandedSystem = true;
}

export function stopOrbit(camera: ArcRotateCamera) {
  camera.inertialAlphaOffset = camera.inertialBetaOffset = camera.inertialRadiusOffset = 0;
  camera.inertialPanningX = camera.inertialPanningY = 0;
}

export function setPlanView(camera: ArcRotateCamera, level: Level) {
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.alpha = Math.PI / 2;
  camera.beta = 0.001;
  camera.lowerAlphaLimit = camera.upperAlphaLimit = Math.PI / 2;
  camera.lowerBetaLimit = camera.upperBetaLimit = 0.001;
  const center = bounds(level.outline).center;
  camera.setTarget(new Vector3(center[0], level.elevation, center[1]), false, true, true);
}

/** Preserve v1 project files: yaw 0 faces plan-south, PI faces plan-north. */
export function cameraYaw(planYaw: number, rightHanded: boolean) {
  return rightHanded ? planYaw - Math.PI : planYaw;
}

export function walkMovement(camera: UniversalCamera, forward: number, side: number): Vector3 {
  const ahead = camera.getDirection(Vector3.Forward(camera.getScene().useRightHandedSystem));
  const right = camera.getDirection(Vector3.Right());
  ahead.y = 0;
  right.y = 0;
  ahead.normalize();
  right.normalize();
  return ahead.scale(forward).add(right.scale(side));
}

/** Walk camera yaw (right-handed scene) that looks along a world direction, ignoring pitch. */
export function yawFromDirection(direction: Vector3): number {
  return Math.atan2(-direction.x, -direction.z);
}

/** SVG heading clockwise from the top of the reference plan. */
export function planHeading(camera: Camera): number {
  const direction = camera.getDirection(Vector3.Forward(camera.getScene().useRightHandedSystem));
  return (Math.atan2(direction.x, -direction.z) * 180) / Math.PI;
}
