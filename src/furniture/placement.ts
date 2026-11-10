import type { Level, Point2, Room } from '../model/types';
import { bounds, floorElevationAt, pointInPolygon, polygonInsidePolygon } from '../model/geometry';
import { footprint, footprintParts, type FurnitureItem } from './model';
import { polygonsOverlap, wallSolids, type FurnitureIssue } from './checks';

const EPS = 0.002;
const PARAM_EPS = 1e-10;
const clone = (item: FurnitureItem) => structuredClone(item);
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];

function buildingChecker(level: Level) {
  const solids = wallSolids(level);
  return (item: FurnitureItem): FurnitureIssue[] => {
    const result: FurnitureIssue[] = [];
    const add = (message: string) => result.push({ itemId: item.id, severity: 'error', message });
    const parts = footprintParts(item),
      floor = floorElevationAt(level, item.position) - level.elevation + (item.elevation ?? 0);
    if (!parts.every((part) => polygonInsidePolygon(part, level.outline)))
      add('Dépasse le contour de la maison.');
    if (floor + item.height > level.ceilingHeight + EPS) add('Dépasse la hauteur du plafond.');
    if (
      solids.some(
        (s) =>
          s.top > floor + EPS &&
          s.bottom < floor + item.height - EPS &&
          parts.some((part) => polygonsOverlap(part, s.polygon)),
      )
    )
      add('Chevauche un mur, un vitrage ou un linteau.');
    return result;
  };
}

/** Hard placement constraints only; furniture overlaps and clearances remain editable diagnostics. */
export function getBuildingPlacementIssues(item: FurnitureItem, level: Level): FurnitureIssue[] {
  return buildingChecker(level)(item);
}

/** Time interval of positive-area penetration under a linear translation (continuous SAT). */
function sweptInterval(a: Point2[], b: Point2[], movement: Point2): [number, number] | undefined {
  let enter = -Infinity,
    exit = Infinity;
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length < 1e-9) continue;
      const axis: Point2 = [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
      const ap = a.map((p) => dot(p, axis)),
        bp = b.map((p) => dot(p, axis));
      const amin = Math.min(...ap),
        amax = Math.max(...ap),
        bmin = Math.min(...bp),
        bmax = Math.max(...bp);
      const velocity = dot(movement, axis);
      if (Math.abs(velocity) < 1e-12) {
        if (Math.min(amax, bmax) - Math.max(amin, bmin) <= EPS) return;
        continue;
      }
      const first = (bmin + EPS - amax) / velocity,
        second = (bmax - EPS - amin) / velocity;
      enter = Math.max(enter, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
      if (enter >= exit) return;
    }
  if (exit <= 0 || enter >= 1) return;
  return [Math.max(0, enter), Math.min(1, exit)];
}

/** Add boundary-contact times for a translated point; also handles collinear travel. */
function contactTimes(point: Point2, movement: Point2, a: Point2, b: Point2, times: number[]) {
  const edge: Point2 = [b[0] - a[0], b[1] - a[1]];
  const relative: Point2 = [a[0] - point[0], a[1] - point[1]];
  const denominator = cross(movement, edge);
  if (Math.abs(denominator) > 1e-12) {
    const t = cross(relative, edge) / denominator,
      u = cross(relative, movement) / denominator;
    if (t > 0 && t < 1 && u >= -PARAM_EPS && u <= 1 + PARAM_EPS) times.push(t);
  } else if (Math.abs(cross(relative, movement)) < 1e-9) {
    const lengthSquared = dot(movement, movement);
    if (lengthSquared < 1e-16) return;
    for (const vertex of [a, b]) {
      const t = dot([vertex[0] - point[0], vertex[1] - point[1]], movement) / lengthSquared;
      if (t > 0 && t < 1) times.push(t);
    }
  }
}

function translated(item: FurnitureItem, movement: Point2, time: number): FurnitureItem {
  return {
    ...item,
    position: [item.position[0] + movement[0] * time, item.position[1] + movement[1] * time],
  };
}

/** Critical translation contacts, including narrow fits between two walls. */
export function buildingTranslationTimes(
  item: FurnitureItem,
  movement: Point2,
  level: Level,
): number[] {
  const parts = footprintParts(item),
    times = [0, 1];
  for (const solid of wallSolids(level))
    for (const part of parts) {
      const interval = sweptInterval(part, solid.polygon, movement);
      if (interval) times.push(...interval);
    }
  for (let i = 0; i < level.outline.length; i++) {
    const a = level.outline[i],
      b = level.outline[(i + 1) % level.outline.length];
    for (const part of parts) {
      for (const point of part) contactTimes(point, movement, a, b, times);
      for (let j = 0; j < part.length; j++)
        contactTimes(a, [-movement[0], -movement[1]], part[j], part[(j + 1) % part.length], times);
    }
  }
  const ordered = [...new Set(times)].sort((a, b) => a - b);
  return [...ordered, ...ordered.slice(1).map((t, i) => (ordered[i] + t) / 2)].sort(
    (a, b) => a - b,
  );
}

/**
 * Sweep a dragged footprint across the building. Endpoint-only checks would let
 * a fast pointer jump through a thin partition into another valid room.
 * Geometry changes are validated at the origin before the translation; the UI
 * handles absolute resize/rotation separately with getBuildingPlacementIssues.
 */
export function constrainFurnitureDrag(
  from: FurnitureItem,
  to: FurnitureItem,
  level: Level,
): FurnitureItem {
  if (from.locked) return clone(from);
  const valid = buildingChecker(level);
  const origin: FurnitureItem = { ...to, position: [...from.position] };
  const geometryChanged =
    from.width !== to.width ||
    from.depth !== to.depth ||
    from.height !== to.height ||
    from.rotation !== to.rotation ||
    (from.elevation ?? 0) !== (to.elevation ?? 0) ||
    JSON.stringify(from.sofa) !== JSON.stringify(to.sofa);
  if (geometryChanged && valid(origin).length) return clone(from);
  const movement: Point2 = [to.position[0] - from.position[0], to.position[1] - from.position[1]];
  if (Math.hypot(...movement) < 1e-10) return valid(to).length ? clone(from) : clone(to);
  const parts = footprintParts(origin),
    times = [0, 1];
  for (const solid of wallSolids(level)) {
    for (const part of parts) {
      const interval = sweptInterval(part, solid.polygon, movement);
      if (interval) times.push(...interval);
    }
  }
  // A translated polygon changes containment only at vertex/edge contacts.
  for (let i = 0; i < level.outline.length; i++) {
    const a = level.outline[i],
      b = level.outline[(i + 1) % level.outline.length];
    for (const part of parts) {
      for (const point of part) contactTimes(point, movement, a, b, times);
      for (let j = 0; j < part.length; j++)
        contactTimes(a, [-movement[0], -movement[1]], part[j], part[(j + 1) % part.length], times);
    }
  }
  // Floor datums alter ceiling/solid overlap when the footprint centre crosses a room edge.
  for (const room of level.rooms.filter((r) => r.floorOffset !== undefined))
    for (let i = 0; i < room.polygon.length; i++)
      contactTimes(
        origin.position,
        movement,
        room.polygon[i],
        room.polygon[(i + 1) % room.polygon.length],
        times,
      );
  const ordered = [...new Set(times)].sort((a, b) => a - b);
  let hasValid = valid(origin).length === 0,
    bestTime = 0;
  for (let i = 1; i < ordered.length; i++) {
    const start = ordered[i - 1],
      end = ordered[i];
    if (end - start < PARAM_EPS) continue;
    const middle = (start + end) / 2;
    if (!valid(translated(origin, movement, middle)).length) {
      hasValid = true;
      bestTime = middle;
      continue;
    }
    if (hasValid) {
      const backoff = Math.min((start - bestTime) / 2, 0.0001 / Math.hypot(...movement));
      const contact = Math.max(bestTime, start - Math.max(0, backoff));
      const result = translated(origin, movement, contact);
      return clone(valid(result).length ? translated(origin, movement, bestTime) : result);
    }
    // Legacy invalid positions may leave their initial obstruction, but once a
    // valid interval is reached, the same sweep prevents crossing another wall.
  }
  if (!valid(to).length) return clone(to);
  return hasValid ? clone(translated(origin, movement, bestTime)) : clone(from);
}

/** Deterministic free placement; a requested room is never silently abandoned. */
export function findFurniturePlacement(
  item: FurnitureItem,
  level: Level,
  existing: FurnitureItem[] = [],
  preferredRoom?: Room | string,
  /** Extra condition on a candidate, e.g. that the rest of a linked set also fits. */
  accept?: (candidate: FurnitureItem) => boolean,
): FurnitureItem | undefined {
  const requested =
    typeof preferredRoom === 'string'
      ? level.rooms.find((r) => r.id === preferredRoom)
      : preferredRoom && level.rooms.find((r) => r.id === preferredRoom.id);
  if (preferredRoom && !requested) return undefined;
  const validBuilding = buildingChecker(level);
  const free = (position: Point2) => {
    if (requested && !pointInPolygon(position, requested.polygon)) return false;
    const candidate = { ...item, position };
    if (validBuilding(candidate).length) return false;
    if (accept && !accept(candidate)) return false;
    const floor = floorElevationAt(level, position) + (candidate.elevation ?? 0),
      parts = footprintParts(candidate);
    return !existing.some((other) => {
      if (other.id === item.id) return false;
      const otherFloor = floorElevationAt(level, other.position) + (other.elevation ?? 0);
      return (
        Math.min(floor + item.height, otherFloor + other.height) >
          Math.max(floor, otherFloor) + EPS &&
        parts.some((part) =>
          footprintParts(other).some((otherPart) => polygonsOverlap(part, otherPart)),
        )
      );
    });
  };
  if (free(item.position)) return clone(item);
  const containingRoom = level.rooms.find((r) => pointInPolygon(item.position, r.polygon));
  const regions = requested
    ? [requested]
    : containingRoom
      ? [containingRoom, ...level.rooms.filter((r) => r.id !== containingRoom.id)]
      : level.rooms;
  const polygons = regions.length ? regions.map((r) => r.polygon) : [level.outline];
  let tested = 0;
  for (const polygon of polygons) {
    const b = bounds(polygon),
      step = Math.max(0.15, Math.max(b.width, b.depth) / 60);
    const relative = footprint({ ...item, position: [0, 0] });
    const halfX = Math.max(...relative.map((p) => Math.abs(p[0]))),
      halfZ = Math.max(...relative.map((p) => Math.abs(p[1])));
    const xs = new Set<number>([item.position[0], b.center[0], b.minX + halfX, b.maxX - halfX]);
    const zs = new Set<number>([item.position[1], b.center[1], b.minZ + halfZ, b.maxZ - halfZ]);
    for (let x = b.minX + 0.01; x <= b.maxX; x += step) xs.add(x);
    for (let z = b.minZ + 0.01; z <= b.maxZ; z += step) zs.add(z);
    const candidates: Point2[] = [...xs]
      .flatMap((x) => [...zs].map((z) => [x, z] as Point2))
      .filter((p) => pointInPolygon(p, polygon));
    candidates.sort(
      (a, b) =>
        Math.hypot(a[0] - item.position[0], a[1] - item.position[1]) -
          Math.hypot(b[0] - item.position[0], b[1] - item.position[1]) ||
        a[0] - b[0] ||
        a[1] - b[1],
    );
    for (const position of candidates) {
      if (++tested > 20_000) return;
      if (free(position)) return clone({ ...item, position });
    }
  }
  return undefined;
}
