import type { Point2, Wall, Opening, Level, ProjectSite } from './types';

export function polygonArea(points: Point2[]): number {
  return (
    Math.abs(
      points.reduce((area, a, i) => {
        const b = points[(i + 1) % points.length];
        return area + a[0] * b[1] - b[0] * a[1];
      }, 0),
    ) / 2
  );
}

export function pointInPolygon(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function wallLength(wall: Wall): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
}

export interface WallSection {
  start: number;
  end: number;
  bottom: number;
  top: number;
}
/** Split wall solids around openings; no invisible collision boxes across doorways. */
export function wallSections(wall: Wall, height: number): WallSection[] {
  const result: WallSection[] = [];
  let cursor = 0;
  for (const opening of [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset)) {
    if (opening.offset > cursor)
      result.push({ start: cursor, end: opening.offset, bottom: 0, top: height });
    const sill = opening.sill ?? 0;
    if (sill > 0)
      result.push({
        start: opening.offset,
        end: opening.offset + opening.width,
        bottom: 0,
        top: sill,
      });
    if (sill + opening.height < height)
      result.push({
        start: opening.offset,
        end: opening.offset + opening.width,
        bottom: sill + opening.height,
        top: height,
      });
    cursor = opening.offset + opening.width;
  }
  if (cursor < wallLength(wall))
    result.push({ start: cursor, end: wallLength(wall), bottom: 0, top: height });
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

export function floorElevationAt(level: Level, point: Point2): number {
  const room = level.rooms.find(
    (room) => room.floorOffset !== undefined && pointInPolygon(point, room.polygon),
  );
  return level.elevation + (room?.floorOffset ?? 0);
}

/**
 * Ground under a point: the room's floor inside the house, the parcel's flat
 * terrain outside. A project without a site keeps the level datum outside.
 */
export function groundElevationAt(
  level: Level,
  site: ProjectSite | undefined,
  point: Point2,
): number {
  return pointInPolygon(point, level.outline)
    ? floorElevationAt(level, point)
    : level.elevation + (site?.elevation ?? 0);
}

export function bounds(points: Point2[]) {
  const xs = points.map((p) => p[0]),
    zs = points.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minZ = Math.min(...zs),
    maxZ = Math.max(...zs);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    center: [(minX + maxX) / 2, (minZ + maxZ) / 2] as Point2,
  };
}

const CONTAINMENT_TOLERANCE = 1e-7;
const cross2 = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];

function pointOnSegment(point: Point2, a: Point2, b: Point2): boolean {
  const edge: Point2 = [b[0] - a[0], b[1] - a[1]];
  const relative: Point2 = [point[0] - a[0], point[1] - a[1]];
  const length = Math.hypot(...edge);
  if (length <= CONTAINMENT_TOLERANCE) return Math.hypot(...relative) <= CONTAINMENT_TOLERANCE;
  if (Math.abs(cross2(edge, relative)) > CONTAINMENT_TOLERANCE * length) return false;
  const projection = (relative[0] * edge[0] + relative[1] * edge[1]) / (length * length);
  const tolerance = CONTAINMENT_TOLERANCE / length;
  return projection >= -tolerance && projection <= 1 + tolerance;
}

/** Boundary contact is permitted for room contours, unlike visitor positions. */
export function pointInOrOnPolygon(point: Point2, polygon: Point2[]): boolean {
  return (
    pointInPolygon(point, polygon) ||
    polygon.some((a, i) => pointOnSegment(point, a, polygon[(i + 1) % polygon.length]))
  );
}

/**
 * Validate every edge, not just the vertices: a chord can leave a concave outline.
 * Boundary intersections partition each edge into intervals entirely inside or
 * outside the outline. Checking their midpoints also handles vertex contacts and
 * segments collinear with the boundary without rejecting valid shared edges.
 */
export function polygonInsidePolygon(inner: Point2[], outer: Point2[]): boolean {
  if (inner.length < 3 || outer.length < 3 || !inner.every((p) => pointInOrOnPolygon(p, outer)))
    return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i],
      b = inner[(i + 1) % inner.length];
    const edge: Point2 = [b[0] - a[0], b[1] - a[1]];
    const lengthSquared = edge[0] * edge[0] + edge[1] * edge[1];
    const length = Math.sqrt(lengthSquared);
    if (length <= CONTAINMENT_TOLERANCE) continue;
    const parameters = [0, 1];
    const tolerance = CONTAINMENT_TOLERANCE / length;
    for (let j = 0; j < outer.length; j++) {
      const c = outer[j],
        d = outer[(j + 1) % outer.length];
      const boundary: Point2 = [d[0] - c[0], d[1] - c[1]];
      const relative: Point2 = [c[0] - a[0], c[1] - a[1]];
      const boundaryLength = Math.hypot(...boundary);
      const denominator = cross2(edge, boundary);
      if (Math.abs(denominator) > Number.EPSILON * Math.max(1, length * boundaryLength) * 16) {
        const t = cross2(relative, boundary) / denominator;
        const u = cross2(relative, edge) / denominator;
        const boundaryTolerance =
          CONTAINMENT_TOLERANCE / Math.max(boundaryLength, CONTAINMENT_TOLERANCE);
        if (
          t >= -tolerance &&
          t <= 1 + tolerance &&
          u >= -boundaryTolerance &&
          u <= 1 + boundaryTolerance
        )
          parameters.push(Math.max(0, Math.min(1, t)));
      } else {
        for (const endpoint of [c, d])
          if (pointOnSegment(endpoint, a, b)) {
            const t =
              ((endpoint[0] - a[0]) * edge[0] + (endpoint[1] - a[1]) * edge[1]) / lengthSquared;
            parameters.push(Math.max(0, Math.min(1, t)));
          }
      }
    }
    parameters.sort((x, y) => x - y);
    for (let j = 1; j < parameters.length; j++) {
      if (parameters[j] - parameters[j - 1] <= tolerance) continue;
      const t = (parameters[j] + parameters[j - 1]) / 2;
      if (!pointInOrOnPolygon([a[0] + t * edge[0], a[1] + t * edge[1]], outer)) return false;
    }
  }
  return true;
}
