import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Move across the ground in screen directions, without tilting or changing zoom. */
export function panOrbitWithKeys(
  camera: ArcRotateCamera,
  forward: number,
  side: number,
  seconds: number,
  fast = false,
) {
  const right = camera.getDirection(Vector3.Right());
  right.y = 0;
  right.normalize();
  const ahead = Vector3.Cross(Vector3.UpReadOnly, right);
  const direction = ahead.scale(forward).add(right.scale(side));
  if (direction.lengthSquared() < 1e-12) return;
  const span =
    camera.mode === Camera.ORTHOGRAPHIC_CAMERA
      ? Math.abs((camera.orthoTop ?? 10) - (camera.orthoBottom ?? -10))
      : 2 * camera.radius * Math.tan(camera.fov / 2);
  const speed = Math.max(0.4, Math.min(20, span * 0.25)) * (fast ? 2 : 1);
  const delta = direction.normalize().scale(speed * Math.max(0, Math.min(seconds, 0.05)));
  camera.setTarget(camera.target.add(delta), false, true, true);
  // A pan applied here does not pass through the camera's own inputs, and the temporal
  // antialiasing only notices motion through them: left alone it blends the previous
  // camera view into the new one, which smears the image while the key is held. Dropping
  // its history is the documented cut for a view that jumps outside the input path, and
  // costs nothing at rest because an idle key returns above.
  camera.resetViewHistory();
}
