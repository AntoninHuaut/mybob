import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { Level, ProjectSite } from '../model/types';
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

/**
 * Stand-off added around the built footprint when framing the exterior view.
 * Proportional to the largest built dimension; kept modest so the house itself
 * fills the shot — the acceptance asks for at least half the image width.
 */
export const EXTERIOR_STANDOFF = 0.1;

/**
 * Built footprint for framing: the ground level contour plus the roof print.
 * The parcel gives scale, never the frame: the house is the subject.
 */
export function builtOutline(level: Level, site: ProjectSite, standoffRatio = EXTERIOR_STANDOFF) {
  const points = [...level.outline];
  for (const roof of site.roofs ?? [])
    for (const [x, , z] of roof.vertices) points.push([x, z] as [number, number]);
  const b = bounds(points);
  const standoff = Math.max(b.width, b.depth) * standoffRatio;
  return [
    [b.minX - standoff, b.minZ - standoff],
    [b.maxX + standoff, b.minZ - standoff],
    [b.maxX + standoff, b.maxZ + standoff],
    [b.minX - standoff, b.maxZ + standoff],
  ] as [number, number][];
}

/** Fit the full 3D envelope, including dimension lines, inside the unobstructed canvas. */
export function fitOverview(
  camera: ArcRotateCamera,
  level: Level,
  width: number,
  height: number,
  keepInView?: Vector3[],
) {
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
  const boxOf = (list: Vector3[], transform: Matrix) => {
    const projected = list.map((p) =>
      Vector3.Project(p, Matrix.IdentityReadOnly, transform, viewport),
    );
    return {
      minX: Math.min(...projected.map((p) => p.x)),
      maxX: Math.max(...projected.map((p) => p.x)),
      minY: Math.min(...projected.map((p) => p.y)),
      maxY: Math.max(...projected.map((p) => p.y)),
    };
  };
  const transformNow = () => camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
  // Zoom and recenter in separate steps: mixing both in one iteration walks away.
  for (let round = 0; round < 8; round++) {
    let box = boxOf(points, transformNow());
    let ratio = Math.max(
      (box.maxX - box.minX) / availableWidth,
      (box.maxY - box.minY) / availableHeight,
    );
    for (let zoom = 0; zoom < 30 && ratio > 1; zoom++) {
      camera.radius *= ratio * 1.03;
      box = boxOf(points, transformNow());
      ratio = Math.max(
        (box.maxX - box.minX) / availableWidth,
        (box.maxY - box.minY) / availableHeight,
      );
    }
    const fits =
      box.minX >= inset.left &&
      box.maxX <= width - inset.right &&
      box.minY >= inset.top &&
      box.maxY <= height - inset.bottom;
    const gapX = (box.minX + box.maxX) / 2 - desiredX;
    const gapY = (box.minY + box.maxY) / 2 - desiredY;
    if (fits && Math.abs(gapX) < 1 && Math.abs(gapY) < 1) break;
    const view = camera.getViewMatrix(true);
    const right = new Vector3(view.m[0], view.m[4], view.m[8]);
    const up = new Vector3(view.m[1], view.m[5], view.m[9]);
    const worldPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / height;
    const shift = right.scale(gapX * worldPerPixel).add(up.scale(-gapY * worldPerPixel));
    camera.setTarget(camera.target.add(shift), false, true, true);
  }
  if (keepInView?.length) {
    // The parcel is background: it must stay on screen, and the subject must keep
    // its insets. Slide the subject inside its margin band until both hold, zoom
    // out only when no translation can reconcile them.
    for (let iteration = 0; iteration < 60; iteration++) {
      const transform = transformNow();
      const subject = boxOf(points, transform);
      const keep = boxOf(keepInView, transform);
      const slideXLow = Math.max(inset.left - subject.minX, -keep.minX);
      const slideXHigh = Math.min(width - inset.right - subject.maxX, width - keep.maxX);
      const slideYLow = Math.max(inset.top - subject.minY, -keep.minY);
      const slideYHigh = Math.min(height - inset.bottom - subject.maxY, height - keep.maxY);
      if (slideXLow <= slideXHigh && slideYLow <= slideYHigh) {
        // Prefer the centred subject: only the parcel asks for the slide.
        const slideX = Math.min(
          Math.max(desiredX - (subject.minX + subject.maxX) / 2, slideXLow),
          slideXHigh,
        );
        const slideY = Math.min(
          Math.max(desiredY - (subject.minY + subject.maxY) / 2, slideYLow),
          slideYHigh,
        );
        if (Math.abs(slideX) < 0.5 && Math.abs(slideY) < 0.5) break;
        const view = camera.getViewMatrix(true);
        const right = new Vector3(view.m[0], view.m[4], view.m[8]);
        const up = new Vector3(view.m[1], view.m[5], view.m[9]);
        const worldPerPixel = (2 * camera.radius * Math.tan(camera.fov / 2)) / height;
        // Slide of the content: the camera follows the target, so the signs
        // mirror the screen axes (right-handed scene, y down on screen).
        const shift = right.scale(-slideX * worldPerPixel).add(up.scale(slideY * worldPerPixel));
        camera.setTarget(camera.target.add(shift), false, true, true);
      } else {
        camera.radius *= 1.08;
      }
    }
  }
  if (camera.upperRadiusLimit !== null && camera.upperRadiusLimit < camera.radius)
    camera.upperRadiusLimit = camera.radius * 1.1;
}

/**
 * Frame the built house and its roof print with a proportional stand-off, including
 * the ground below the finished floor. The parcel stays in view as background.
 */
export function siteOverviewLevel(level: Level, site: ProjectSite, roofHeight: number): Level {
  const ground = Math.min(site.elevation, 0);
  return {
    ...level,
    outline: builtOutline(level, site),
    elevation: level.elevation + ground,
    ceilingHeight: Math.max(level.ceilingHeight, roofHeight) - ground + 0.15,
  };
}

const CARDINAL_AZIMUTHS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

/**
 * Compose the exterior shot: among the current azimuth and the four cardinals,
 * keep the one where the house stays largest on screen once its whole parcel is
 * back in view. Only the azimuth moves, a framing choice; elevation stays the
 * user's, and no personal dimension enters the code.
 */
export function exteriorOverview(
  camera: ArcRotateCamera,
  frame: Level,
  subject: Vector3[],
  parcel: Vector3[] | undefined,
  width: number,
  height: number,
) {
  if (!parcel?.length || !subject.length || width < 1 || height < 1) {
    fitOverview(camera, frame, width, height);
    return camera.alpha;
  }
  const viewport = new Viewport(0, 0, width, height);
  const subjectWidth = () => {
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    let minX = Infinity,
      maxX = -Infinity;
    for (const point of subject) {
      const p = Vector3.Project(point, Matrix.IdentityReadOnly, transform, viewport);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
    return maxX - minX;
  };
  let best = camera.alpha;
  let bestWidth = -Infinity;
  for (const azimuth of [camera.alpha, ...CARDINAL_AZIMUTHS]) {
    camera.alpha = azimuth;
    fitOverview(camera, frame, width, height, parcel);
    const projected = subjectWidth();
    if (projected > bestWidth) {
      bestWidth = projected;
      best = azimuth;
    }
  }
  camera.alpha = best;
  fitOverview(camera, frame, width, height, parcel);
  return best;
}
