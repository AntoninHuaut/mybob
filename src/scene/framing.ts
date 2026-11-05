import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { Level } from '../model/types';
import { bounds } from '../model/geometry';

export function frameInsets(width: number, height: number) {
  return {
    left: Math.min(32, width * 0.07),
    right: Math.min(82, width * 0.14),
    top: Math.min(130, height * 0.22),
    bottom: Math.min(92, height * 0.16),
  };
}

export function fitPlan(
  camera: ArcRotateCamera,
  level: Level,
  width: number,
  height: number,
  zoom = 1,
) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const b = bounds(level.outline),
    inset = frameInsets(width, height);
  const halfHeight =
    (Math.max(
      ((b.depth + 1.4) * height) / (height - 2 * Math.max(inset.top, inset.bottom)),
      ((b.width + 1.4) * height) / (width - 2 * Math.max(inset.left, inset.right)),
    ) /
      2) *
    zoom;
  camera.orthoTop = halfHeight;
  camera.orthoBottom = -halfHeight;
  camera.orthoLeft = (-halfHeight * width) / height;
  camera.orthoRight = (halfHeight * width) / height;
}

/** Fit the full 3D envelope, including dimension lines, inside the unobstructed canvas. */
export function fitOverview(camera: ArcRotateCamera, level: Level, width: number, height: number) {
  if (width < 1 || height < 1) return;
  const b = bounds(level.outline),
    inset = frameInsets(width, height);
  const availableWidth = width - inset.left - inset.right;
  const availableHeight = height - inset.top - inset.bottom;
  const desiredX = (inset.left + width - inset.right) / 2;
  const desiredY = (inset.top + height - inset.bottom) / 2;
  const points: Vector3[] = [];
  for (const x of [b.minX - 0.7, b.maxX + 0.7])
    for (const z of [b.minZ - 0.7, b.maxZ + 0.7])
      for (const y of [level.elevation - 0.18, level.elevation + level.ceilingHeight + 0.05])
        points.push(new Vector3(x, y, z));
  camera.setTarget(
    new Vector3(b.center[0], level.elevation + level.ceilingHeight / 2, b.center[1]),
    false,
    true,
    true,
  );
  camera.radius = Math.max(b.width, b.depth, level.ceilingHeight) * 1.3;
  const viewport = new Viewport(0, 0, width, height);
  for (let iteration = 0; iteration < 20; iteration++) {
    const view = camera.getViewMatrix(true);
    const transform = view.multiply(camera.getProjectionMatrix(true));
    const projected = points.map((p) =>
      Vector3.Project(p, Matrix.IdentityReadOnly, transform, viewport),
    );
    const minX = Math.min(...projected.map((p) => p.x)),
      maxX = Math.max(...projected.map((p) => p.x));
    const minY = Math.min(...projected.map((p) => p.y)),
      maxY = Math.max(...projected.map((p) => p.y));
    if (
      minX >= inset.left &&
      maxX <= width - inset.right &&
      minY >= inset.top &&
      maxY <= height - inset.bottom
    )
      break;
    const ratio = Math.max((maxX - minX) / availableWidth, (maxY - minY) / availableHeight);
    if (ratio > 1) camera.radius *= ratio * 1.025;
    const right = new Vector3(view.m[0], view.m[4], view.m[8]);
    const up = new Vector3(view.m[1], view.m[5], view.m[9]);
    const worldPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / height;
    const shift = right
      .scale(((minX + maxX) / 2 - desiredX) * worldPerPixel)
      .add(up.scale((desiredY - (minY + maxY) / 2) * worldPerPixel));
    camera.setTarget(camera.target.add(shift), false, true, true);
  }
  if (camera.upperRadiusLimit !== null && camera.upperRadiusLimit < camera.radius)
    camera.upperRadiusLimit = camera.radius * 1.1;
}
