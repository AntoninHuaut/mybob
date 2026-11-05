import type { Point2, Wall, Opening } from './types';

export function polygonArea(points: Point2[]): number {
  return Math.abs(points.reduce((area, a, i) => {
    const b = points[(i + 1) % points.length];
    return area + a[0] * b[1] - b[0] * a[1];
  }, 0)) / 2;
}

export function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
}

export interface WallSection { start: number; end: number; bottom: number; top: number }
/** Split wall solids around openings; no invisible collision boxes across doorways. */
export function wallSections(wall: Wall, height: number): WallSection[] {
  const result: WallSection[] = [];
  let cursor = 0;
  for (const opening of [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset)) {
    if (opening.offset > cursor) result.push({ start: cursor, end: opening.offset, bottom: 0, top: height });
    const sill = opening.sill ?? 0;
    if (sill > 0) result.push({ start: opening.offset, end: opening.offset + opening.width, bottom: 0, top: sill });
    if (sill + opening.height < height) result.push({ start: opening.offset, end: opening.offset + opening.width, bottom: sill + opening.height, top: height });
    cursor = opening.offset + opening.width;
  }
  if (cursor < wallLength(wall)) result.push({ start: cursor, end: wallLength(wall), bottom: 0, top: height });
  return result;
}

export function alongWall(wall: Wall, offset: number, normal = 0): Point2 {
  const length = wallLength(wall);
  const dx = (wall.end[0] - wall.start[0]) / length;
  const dz = (wall.end[1] - wall.start[1]) / length;
  return [wall.start[0] + dx * offset - dz * normal, wall.start[1] + dz * offset + dx * normal];
}

export function traversable(opening: Opening): boolean {
  return opening.kind === 'door' || opening.kind === 'sliding' || opening.kind === 'garage';
}

export function bounds(points: Point2[]) {
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, center: [(minX + maxX) / 2, (minZ + maxZ) / 2] as Point2 };
}
