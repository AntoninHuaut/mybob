import type { Level, Point2, Wall } from '../model/types';
import {
  alongWall,
  floorElevationAt,
  pointInPolygon,
  polygonInsidePolygon,
  wallSections,
} from '../model/geometry';
import { footprint, footprintParts, localToWorld, type FurnitureItem } from './model';

export interface FurnitureIssue {
  itemId: string;
  severity: 'warning' | 'error';
  code?: 'clearance';
  message: string;
}
export interface FurnitureDistance {
  label: string;
  distance: number;
  from: Point2;
  to: Point2;
}
const EPS = 0.002;
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];
const itemBase = (item: FurnitureItem, level: Level) =>
  floorElevationAt(level, item.position) - level.elevation + (item.elevation ?? 0);
const verticalOverlap = (a: FurnitureItem, b: FurnitureItem, level: Level) =>
  Math.min(itemBase(a, level) + a.height, itemBase(b, level) + b.height) >
  Math.max(itemBase(a, level), itemBase(b, level)) + EPS;

/** SAT on convex footprints. Mere contact is allowed; penetration is not. */
export function polygonsOverlap(a: Point2[], b: Point2[], epsilon = EPS): boolean {
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length < 0.000001) continue;
      const axis: Point2 = [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
      const ap = a.map((v) => dot(v, axis)),
        bp = b.map((v) => dot(v, axis));
      if (
        Math.min(Math.max(...ap), Math.max(...bp)) - Math.max(Math.min(...ap), Math.min(...bp)) <=
        epsilon
      )
        return false;
    }
  return true;
}

function wallRectangle(wall: Wall, start: number, end: number, extra = 0): Point2[] {
  const half = wall.thickness / 2 + extra;
  return [
    alongWall(wall, start, -half),
    alongWall(wall, end, -half),
    alongWall(wall, end, half),
    alongWall(wall, start, half),
  ];
}

function openingBase(wall: Wall, offset: number, level: Level): number {
  const samples = [-1, 1].map((sign) =>
    alongWall(wall, offset, sign * (wall.thickness / 2 + 0.02)),
  );
  const floors = samples.flatMap((point) => {
    const room = level.rooms.find((r) => pointInPolygon(point, r.polygon));
    return room ? [room.floorOffset ?? 0] : [];
  });
  return floors.length ? Math.max(...floors) : 0;
}

export function clearanceFootprint(item: FurnitureItem): Point2[] {
  const c = item.clearances ?? { front: 0, back: 0, left: 0, right: 0 };
  return [
    localToWorld(item, -item.width / 2 - c.left, -item.depth / 2 - c.back),
    localToWorld(item, item.width / 2 + c.right, -item.depth / 2 - c.back),
    localToWorld(item, item.width / 2 + c.right, item.depth / 2 + c.front),
    localToWorld(item, -item.width / 2 - c.left, item.depth / 2 + c.front),
  ];
}

export function openingFootprint(item: FurnitureItem): Point2[] | undefined {
  if (!item.opening?.reach) return;
  return [
    localToWorld(item, -item.width / 2, item.depth / 2),
    localToWorld(item, item.width / 2, item.depth / 2),
    localToWorld(item, item.width / 2, item.depth / 2 + item.opening.reach),
    localToWorld(item, -item.width / 2, item.depth / 2 + item.opening.reach),
  ];
}

export function wallSolids(level: Level) {
  return level.walls.flatMap((wall) => {
    const base = openingBase(
      wall,
      Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) / 2,
      level,
    );
    const effective = {
      ...wall,
      openings: wall.openings?.map((o) => ({
        ...o,
        sill: (o.sill ?? 0) + openingBase(wall, o.offset + o.width / 2, level),
      })),
    };
    const solids = wallSections(effective, wall.height ?? level.ceilingHeight).map((section) => ({
      polygon: wallRectangle(wall, section.start, section.end),
      bottom: section.bottom === 0 ? Math.min(base, 0) : section.bottom,
      top: section.top,
    }));
    for (const o of wall.openings ?? [])
      if (o.kind === 'window' || (o.kind === 'sliding' && o.exterior)) {
        const sill = openingBase(wall, o.offset + o.width / 2, level) + (o.sill ?? 0);
        solids.push({
          polygon: wallRectangle({ ...wall, thickness: 0.012 }, o.offset, o.offset + o.width),
          bottom: sill,
          top: sill + o.height,
        });
      }
    return solids;
  });
}

export function checkFurniture(items: FurnitureItem[], level: Level): FurnitureIssue[] {
  const issues: FurnitureIssue[] = [];
  const add = (
    item: FurnitureItem,
    severity: FurnitureIssue['severity'],
    message: string,
    code?: FurnitureIssue['code'],
  ) => {
    if (!issues.some((issue) => issue.itemId === item.id && issue.message === message))
      issues.push({ itemId: item.id, severity, message, ...(code ? { code } : {}) });
  };
  const solids = wallSolids(level);
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      parts = footprintParts(item);
    const floor = itemBase(item, level);
    if (
      (item.elevation ?? 0) <= EPS &&
      parts.flat().some((point) => {
        const sample: Point2 = [
          item.position[0] + (point[0] - item.position[0]) * 0.999,
          item.position[1] + (point[1] - item.position[1]) * 0.999,
        ];
        return Math.abs(floorElevationAt(level, sample) - level.elevation - floor) > EPS;
      })
    )
      add(item, 'warning', 'Chevauche une différence de niveau du sol.');
    if (!parts.every((part) => polygonInsidePolygon(part, level.outline)))
      add(item, 'error', 'Dépasse le contour de la maison.');
    if (floor + item.height > level.ceilingHeight + EPS)
      add(item, 'error', 'Dépasse la hauteur du plafond.');
    const walls = solids.filter((s) => s.top > floor + EPS && s.bottom < floor + item.height - EPS);
    if (walls.some((wall) => parts.some((part) => polygonsOverlap(part, wall.polygon))))
      add(item, 'error', 'Chevauche un mur, un vitrage ou un linteau.');
    for (let j = i + 1; j < items.length; j++) {
      const other = items[j];
      if (!verticalOverlap(item, other, level)) continue;
      if (
        parts.some((part) =>
          footprintParts(other).some((otherPart) => polygonsOverlap(part, otherPart)),
        )
      ) {
        add(item, 'error', `Chevauche « ${other.name} ».`);
        add(other, 'error', `Chevauche « ${item.name} ».`);
      }
    }
    if (item.clearances && Object.values(item.clearances).some((value) => value > 0)) {
      const envelope = clearanceFootprint(item);
      if (
        !polygonInsidePolygon(envelope, level.outline) ||
        walls.some((w) => polygonsOverlap(envelope, w.polygon)) ||
        items.some(
          (other) =>
            other.id !== item.id &&
            verticalOverlap(item, other, level) &&
            footprintParts(other).some((part) => polygonsOverlap(envelope, part)),
        )
      )
        add(
          item,
          'warning',
          'L’espace libre demandé autour de ce meuble n’est pas entièrement disponible.',
          'clearance',
        );
    }
    const envelope = openingFootprint(item);
    if (
      envelope &&
      (!polygonInsidePolygon(envelope, level.outline) ||
        walls.some((w) => polygonsOverlap(envelope, w.polygon)) ||
        items.some(
          (other) =>
            other.id !== item.id &&
            verticalOverlap(item, other, level) &&
            footprintParts(other).some((part) => polygonsOverlap(envelope, part)),
        ))
    )
      add(item, 'warning', 'L’espace d’ouverture du meuble risque d’être gêné.');
    for (const wall of level.walls)
      for (const opening of wall.openings ?? []) {
        if (
          opening.kind === 'window' &&
          floor + item.height >=
            (opening.sill ?? 0) + openingBase(wall, opening.offset + opening.width / 2, level) &&
          floor <
            (opening.sill ?? 0) +
              openingBase(wall, opening.offset + opening.width / 2, level) +
              opening.height -
              EPS
        ) {
          if (
            parts.some((part) =>
              polygonsOverlap(
                part,
                wallRectangle(wall, opening.offset, opening.offset + opening.width, 0.12),
              ),
            )
          )
            add(item, 'warning', 'Très proche d’un vitrage : vérifiez son ouverture et son accès.');
        }
        if (opening.kind !== 'door') continue;
        const hingeEnd = opening.hinge === 'end';
        const hinge = alongWall(wall, opening.offset + (hingeEnd ? opening.width : 0));
        const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
        const direction = hingeEnd ? -1 : 1;
        const vx = ((wall.end[0] - wall.start[0]) / length) * opening.width * direction;
        const vz = ((wall.end[1] - wall.start[1]) / length) * opening.width * direction;
        const swing = ((opening.swing ?? 1) * (hingeEnd ? -1 : 1) * Math.PI) / 2;
        const sector: Point2[] = [hinge];
        for (let n = 0; n <= 12; n++) {
          const angle = (swing * n) / 12;
          sector.push([
            hinge[0] + Math.cos(angle) * vx + Math.sin(angle) * vz,
            hinge[1] - Math.sin(angle) * vx + Math.cos(angle) * vz,
          ]);
        }
        if (
          parts.some((part) => polygonsOverlap(part, sector)) &&
          floor < opening.height + openingBase(wall, opening.offset + opening.width / 2, level)
        )
          add(item, 'warning', 'Gêne le débattement d’une porte de la maison.');
      }
  }
  return issues;
}

function raySegment(from: Point2, direction: Point2, a: Point2, b: Point2): number | undefined {
  const sx = b[0] - a[0],
    sz = b[1] - a[1];
  const cross = direction[0] * sz - direction[1] * sx;
  if (Math.abs(cross) < 1e-9) return undefined;
  const ax = a[0] - from[0],
    az = a[1] - from[1];
  const t = (ax * sz - az * sx) / cross;
  const u = (ax * direction[1] - az * direction[0]) / cross;
  if (t >= -0.001 && u >= -0.00001 && u <= 1.00001) return Math.max(0, t);
  return undefined;
}

/** Distances from the four face centres, not a claim of minimum walking clearance. */
/** Maximum distance to a neighbour for showing a dimension (excluding walls and the linked set). */
export const NEIGHBOR_GAP_RANGE = 1;
/** Maximum number of neighbours dimensioned at once around the selection. */
export const NEIGHBOR_GAP_LIMIT = 3;
/** Below this gap, dimensions are considered "touching" and hidden. */
export const GAP_DISPLAY_EPS = 0.02;

const pointOnSegment = (point: Point2, from: Point2, to: Point2): Point2 => {
  const dx = to[0] - from[0],
    dz = to[1] - from[1];
  const length = dx * dx + dz * dz;
  if (length === 0) return [...from] as Point2;
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / length),
  );
  return [from[0] + dx * t, from[1] + dz * t];
};

/** Closest pair of points on two segments (crossing ruled out upstream). */
function closestSegmentPoints(a1: Point2, a2: Point2, b1: Point2, b2: Point2) {
  const pairs: [Point2, Point2][] = [
    [[...a1] as Point2, pointOnSegment(a1, b1, b2)],
    [[...a2] as Point2, pointOnSegment(a2, b1, b2)],
    [[...b1] as Point2, pointOnSegment(b1, a1, a2)],
    [[...b2] as Point2, pointOnSegment(b2, a1, a2)],
  ];
  let best: { distance: number; from: Point2; to: Point2 } | undefined;
  for (const [from, to] of pairs) {
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (!best || distance < best.distance) best = { distance, from, to };
  }
  return best!;
}

/** Real gap between two (sets of) footprints: closest points, 0 when overlapping. */
function footprintGap(
  a: FurnitureItem,
  b: FurnitureItem,
): { distance: number; from: Point2; to: Point2 } {
  const partsA = footprintParts(a),
    partsB = footprintParts(b);
  for (const part of partsA)
    for (const other of partsB)
      if (polygonsOverlap(part, other)) return { distance: 0, from: part[0], to: part[0] };
  let best: { distance: number; from: Point2; to: Point2 } | undefined;
  for (const part of partsA)
    for (let i = 0; i < part.length; i++) {
      const pa1 = part[i],
        pa2 = part[(i + 1) % part.length];
      for (const other of partsB)
        for (let j = 0; j < other.length; j++) {
          const candidate = closestSegmentPoints(pa1, pa2, other[j], other[(j + 1) % other.length]);
          if (!best || candidate.distance < best.distance) best = candidate;
        }
    }
  return best!;
}

export function furnitureDistances(
  item: FurnitureItem,
  level: Level,
  items: FurnitureItem[],
): FurnitureDistance[] {
  const definitions: { label: string; local: Point2; direction: Point2 }[] = [
    {
      label: 'Devant',
      local: [0, item.depth / 2],
      direction: [Math.sin(item.rotation), Math.cos(item.rotation)],
    },
    {
      label: 'Derrière',
      local: [0, -item.depth / 2],
      direction: [-Math.sin(item.rotation), -Math.cos(item.rotation)],
    },
    {
      label: 'À gauche',
      local: [-item.width / 2, 0],
      direction: [-Math.cos(item.rotation), Math.sin(item.rotation)],
    },
    {
      label: 'À droite',
      local: [item.width / 2, 0],
      direction: [Math.cos(item.rotation), -Math.sin(item.rotation)],
    },
  ];
  // A linked set (table + chairs) moves as one block: its internal distances
  // serve neither as obstacles nor as dimensions.
  const ensemble = new Set(
    items
      .filter((other) => item.groupId !== undefined && other.groupId === item.groupId)
      .map((other) => other.id),
  );
  const floor = itemBase(item, level);
  const obstacles = [
    ...wallSolids(level)
      .filter((s) => s.top > floor + EPS && s.bottom < floor + item.height - EPS)
      .map((s) => s.polygon),
    ...items
      .filter(
        (other) =>
          other.id !== item.id && !ensemble.has(other.id) && verticalOverlap(item, other, level),
      )
      .flatMap(footprintParts),
  ];
  const faceDistances = definitions.flatMap(({ label, local, direction }) => {
    const from = localToWorld(item, ...local);
    if (obstacles.some((polygon) => pointInPolygon(from, polygon)))
      return [{ label, distance: 0, from, to: [...from] as Point2 }];
    let distance = Infinity;
    for (const polygon of [level.outline, ...obstacles])
      for (let i = 0; i < polygon.length; i++) {
        const hit = raySegment(from, direction, polygon[i], polygon[(i + 1) % polygon.length]);
        if (hit !== undefined && hit < distance) distance = hit;
      }
    if (!Number.isFinite(distance)) return [];
    return [
      {
        label,
        distance,
        from,
        to: [from[0] + direction[0] * distance, from[1] + direction[1] * distance] as Point2,
      },
    ];
  });
  const neighbourGaps: FurnitureDistance[] = [];
  for (const other of items) {
    if (ensemble.has(other.id) || other.id === item.id) continue;
    if (!verticalOverlap(item, other, level)) continue;
    const gap = footprintGap(item, other);
    if (gap.distance > GAP_DISPLAY_EPS && gap.distance <= NEIGHBOR_GAP_RANGE)
      neighbourGaps.push({ label: other.name, distance: gap.distance, from: gap.from, to: gap.to });
  }
  neighbourGaps.sort((a, b) => a.distance - b.distance);
  return [...faceDistances, ...neighbourGaps.slice(0, NEIGHBOR_GAP_LIMIT)];
}

/** Visual guide shown while the magnet attaches the item to a wall or a neighbour. */
export interface SnapGuide {
  kind: 'wall' | 'align';
  from: Point2;
  to: Point2;
}
export interface SnapResult {
  item: FurnitureItem;
  guide?: SnapGuide;
}

/** Axis-aligned bounding box of world footprint points. */
export function polygonBounds(points: Point2[]) {
  const xs = points.map((p) => p[0]),
    zs = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Snap only translations that keep the object clear of solids and other furniture. */
export function snapFurniture(
  item: FurnitureItem,
  level: Level,
  others: FurnitureItem[],
  maxDistance = 0.15,
): FurnitureItem {
  return snapFurnitureDetailed(item, level, others, maxDistance).item;
}

/**
 * Magnet snap: wall contact, position/centre alignment with neighbours and
 * axis edge alignment (edges side by side or in flush contact). The returned
 * guide traces the attachment that won so the UI can display it.
 */
export function snapFurnitureDetailed(
  item: FurnitureItem,
  level: Level,
  others: FurnitureItem[],
  maxDistance = 0.15,
): SnapResult {
  const polygon = footprint(item),
    box = polygonBounds(polygon);
  const candidates: { distance: number; position: Point2; guide: SnapGuide }[] = [];
  for (const wall of level.walls) {
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1];
    const length = Math.hypot(dx, dz),
      tangent: Point2 = [dx / length, dz / length],
      normal: Point2 = [-dz / length, dx / length];
    const relative = polygon.map((p) => [p[0] - wall.start[0], p[1] - wall.start[1]] as Point2);
    const along = relative.map((p) => dot(p, tangent));
    if (Math.max(...along) < 0 || Math.min(...along) > length) continue;
    const span: [number, number] = [
      Math.max(0, Math.min(...along) - 0.1),
      Math.min(length, Math.max(...along) + 0.1),
    ];
    const guide: SnapGuide = {
      kind: 'wall',
      from: [wall.start[0] + tangent[0] * span[0], wall.start[1] + tangent[1] * span[0]],
      to: [wall.start[0] + tangent[0] * span[1], wall.start[1] + tangent[1] * span[1]],
    };
    const normalCoordinates = relative.map((p) => dot(p, normal));
    for (const shift of [
      wall.thickness / 2 - Math.min(...normalCoordinates),
      -wall.thickness / 2 - Math.max(...normalCoordinates),
    ]) {
      if (Math.abs(shift) <= maxDistance)
        candidates.push({
          distance: Math.abs(shift),
          position: [item.position[0] + normal[0] * shift, item.position[1] + normal[1] * shift],
          guide,
        });
    }
  }
  for (const other of others) {
    if (other.id === item.id) continue;
    const otherBox = polygonBounds(footprint(other));
    for (const axis of [0, 1] as const) {
      const push = (delta: number, guide: SnapGuide) => {
        if (Math.abs(delta) <= maxDistance)
          candidates.push({
            distance: Math.abs(delta),
            position: offsetAxis(item.position, axis, delta),
            guide,
          });
      };
      push(other.position[axis] - item.position[axis], {
        kind: 'align',
        from: [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2],
        to: [(otherBox.minX + otherBox.maxX) / 2, (otherBox.minZ + otherBox.maxZ) / 2],
      });
      const itemEdges = axis === 0 ? [box.minX, box.maxX] : [box.minZ, box.maxZ];
      const otherEdges =
        axis === 0 ? [otherBox.minX, otherBox.maxX] : [otherBox.minZ, otherBox.maxZ];
      const itemMid = axis === 0 ? (box.minZ + box.maxZ) / 2 : (box.minX + box.maxX) / 2;
      const otherMid =
        axis === 0 ? (otherBox.minZ + otherBox.maxZ) / 2 : (otherBox.minX + otherBox.maxX) / 2;
      for (const [itemEdge, otherEdge] of [
        [itemEdges[0], otherEdges[0]],
        [itemEdges[1], otherEdges[1]],
        [itemEdges[1], otherEdges[0]],
        [itemEdges[0], otherEdges[1]],
      ])
        push(otherEdge - itemEdge, {
          kind: 'align',
          from: axis === 0 ? [otherEdge, itemMid] : [itemMid, otherEdge],
          to: axis === 0 ? [otherEdge, otherMid] : [otherMid, otherEdge],
        });
    }
  }
  for (const candidate of candidates.sort((a, b) => a.distance - b.distance)) {
    const next = { ...item, position: candidate.position };
    if (
      !checkFurniture([...others.filter((other) => other.id !== item.id), next], level).some(
        (issue) => issue.itemId === next.id && issue.severity === 'error',
      )
    )
      return { item: next, guide: candidate.guide };
  }
  return { item: structuredClone(item) };
}

const offsetAxis = (position: Point2, axis: 0 | 1, delta: number): [number, number] =>
  axis === 0 ? [position[0] + delta, position[1]] : [position[0], position[1] + delta];
