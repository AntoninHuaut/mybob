import type { Point2 } from '../model/types';

/** Snap near the plan axes (10°); Shift forces an axis, Alt keeps a free angle. */
export function measurementEndpoint(a: Point2, point: Point2, forceAxis = false, free = false) {
  const dx = Math.abs(point[0] - a[0]),
    dz = Math.abs(point[1] - a[1]);
  if (
    free ||
    Math.max(dx, dz) < 1e-9 ||
    (!forceAxis && Math.min(dx, dz) / Math.max(dx, dz) > Math.tan(Math.PI / 18))
  )
    return { point: [...point] as Point2, aligned: false };
  return { point: (dx >= dz ? [point[0], a[1]] : [a[0], point[1]]) as Point2, aligned: true };
}
