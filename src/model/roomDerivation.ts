import { polygonArea } from './geometry';
import { withRoomPolygon } from './roomPartition';
import type { Point2, Room, Wall } from './types';
import { interiorViewpoint } from './wallChain';

/** Wall axes closer than this meet: drawn plans are entered to the millimetre at best. */
const SNAP = 1e-4;
const EPS = 1e-9;

interface Edge {
  a: number;
  b: number;
  thickness: number;
}

const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
const signedArea = (polygon: Point2[]) =>
  polygon.reduce((sum, p, i) => sum + cross(p, polygon[(i + 1) % polygon.length]), 0) / 2;

/**
 * The rooms enclosed by `walls`: one per bounded face of the graph of wall axes, on the
 * finished faces (each side offset by half its wall's thickness). Previous rooms keep their
 * identity, names and finishes on the face they overlap most; other faces become « Pièce N ».
 * Walls closing no loop, such as a stub partition, do not shape a room.
 */
export function deriveRooms(walls: Wall[], previous: Room[]): Room[] {
  const polygons = faces(walls).map(finishedPolygon);
  const wallIds = new Set(walls.map((w) => w.id));
  const pairs = polygons.flatMap((polygon, face) =>
    previous.map((room, index) => ({ face, index, overlap: overlapArea(polygon, room.polygon) })),
  );
  pairs.sort((x, y) => y.overlap - x.overlap);
  const owner = new Map<number, number>();
  const taken = new Set<number>();
  for (const { face, index, overlap } of pairs) {
    if (overlap <= EPS || owner.has(face) || taken.has(index)) continue;
    owner.set(face, index);
    taken.add(index);
  }
  const kept: { index: number; room: Room }[] = [];
  const added: Point2[][] = [];
  polygons.forEach((polygon, face) => {
    const index = owner.get(face);
    if (index === undefined) {
      added.push(polygon);
      return;
    }
    const room = withRoomPolygon(previous[index], polygon);
    if (room.wallFaces) room.wallFaces = room.wallFaces.filter((f) => wallIds.has(f.wallId));
    kept.push({ index, room });
  });
  const rooms = kept.sort((x, y) => x.index - y.index).map((k) => k.room);
  const ids = new Set(rooms.map((r) => r.id));
  const names = new Set(rooms.map((r) => r.name));
  let n = rooms.length;
  for (const polygon of added) {
    do n++;
    while (names.has(`Pièce ${n}`) || ids.has(`room-${n}`));
    const viewpoint = interiorViewpoint(polygon);
    const room: Room = {
      id: `room-${n}`,
      name: `Pièce ${n}`,
      kind: 'living',
      polygon,
      label: viewpoint,
      viewpoint,
    };
    ids.add(room.id);
    names.add(room.name);
    rooms.push(room);
  }
  return rooms;
}

function onAxis(p: Point2, wall: Wall) {
  const d = sub(wall.end, wall.start);
  const r = sub(p, wall.start);
  const len2 = d[0] * d[0] + d[1] * d[1];
  const t = Math.min(1, Math.max(0, (r[0] * d[0] + r[1] * d[1]) / len2));
  return Math.hypot(r[0] - t * d[0], r[1] - t * d[1]) < SNAP;
}

/**
 * Plans join a partition to the face of the wall it meets, not to its axis: an end that stops
 * inside another wall's thickness is extended to that axis.
 */
function joinedAxes(walls: Wall[]): Wall[] {
  return walls.map((w) => {
    const ends: [Point2, Point2] = [w.start, w.end];
    const reach = (end: 0 | 1): Point2 => {
      const p = ends[end];
      if (walls.some((v) => v !== w && onAxis(p, v))) return p;
      const d = sub(p, ends[1 - end]);
      const len = Math.hypot(...d);
      const unit: Point2 = [d[0] / len, d[1] / len];
      let best: Point2 = p;
      let bestGap = Infinity;
      for (const v of walls) {
        if (v === w) continue;
        const e = sub(v.end, v.start);
        const lenV = Math.hypot(...e);
        const denominator = cross(unit, e);
        const sine = Math.abs(denominator) / lenV;
        if (sine < 1e-6) continue;
        const r = sub(v.start, p);
        const gap = cross(r, e) / denominator;
        const u = cross(r, unit) / denominator;
        if (gap < SNAP || gap > v.thickness / 2 / sine + SNAP) continue;
        if (u < -SNAP / lenV || u > 1 + SNAP / lenV || gap >= bestGap) continue;
        bestGap = gap;
        best = [p[0] + unit[0] * gap, p[1] + unit[1] * gap];
      }
      return best;
    };
    return { ...w, start: reach(0), end: reach(1) };
  });
}

/** Bounded faces of the planar graph of wall axes, counter-clockwise, as edge cycles. */
function faces(source: Wall[]) {
  const walls = joinedAxes(source);
  const nodes: Point2[] = [];
  const node = (p: Point2) => {
    const found = nodes.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < SNAP);
    if (found >= 0) return found;
    nodes.push(p);
    return nodes.length - 1;
  };
  // Split every wall where another wall's end lies on it or crosses it.
  const cuts = walls.map(() => [0, 1]);
  walls.forEach((w, i) => {
    const d = sub(w.end, w.start);
    const len = Math.hypot(...d);
    walls.forEach((v, j) => {
      if (i === j) return;
      const e = sub(v.end, v.start);
      const denominator = cross(d, e);
      if (Math.abs(denominator) > EPS) {
        const r = sub(v.start, w.start);
        const t = cross(r, e) / denominator,
          u = cross(r, d) / denominator;
        const lenV = Math.hypot(...e);
        if (t > -SNAP / len && t < 1 + SNAP / len && u > -SNAP / lenV && u < 1 + SNAP / lenV)
          cuts[i].push(Math.min(1, Math.max(0, t)));
      } else {
        for (const p of [v.start, v.end]) {
          const r = sub(p, w.start);
          if (Math.abs(cross(d, r)) / len >= SNAP) continue;
          const t = (r[0] * d[0] + r[1] * d[1]) / (len * len);
          if (t > 0 && t < 1) cuts[i].push(t);
        }
      }
    });
  });
  const edges: Edge[] = [];
  const seen = new Set<string>();
  walls.forEach((w, i) => {
    const ts = [...new Set(cuts[i])].sort((x, y) => x - y);
    const at = (t: number): Point2 => [
      w.start[0] + t * (w.end[0] - w.start[0]),
      w.start[1] + t * (w.end[1] - w.start[1]),
    ];
    for (let k = 1; k < ts.length; k++) {
      const a = node(at(ts[k - 1])),
        b = node(at(ts[k]));
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (a === b || seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, thickness: w.thickness });
    }
  });
  // Dangling walls bound no room: prune them until every node joins two edges or more.
  let alive = edges;
  for (;;) {
    const degree = new Map<number, number>();
    for (const e of alive) for (const n of [e.a, e.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
    const next = alive.filter((e) => degree.get(e.a)! > 1 && degree.get(e.b)! > 1);
    if (next.length === alive.length) break;
    alive = next;
  }
  // Half-edges sorted by angle around each node; the next half-edge of a face turns most
  // to the right, which walks bounded faces counter-clockwise.
  const outgoing = new Map<number, { to: number; edge: Edge; angle: number }[]>();
  for (const edge of alive)
    for (const [from, to] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ]) {
      const d = sub(nodes[to], nodes[from]);
      const list = outgoing.get(from) ?? [];
      list.push({ to, edge, angle: Math.atan2(d[1], d[0]) });
      outgoing.set(from, list);
    }
  for (const list of outgoing.values()) list.sort((x, y) => x.angle - y.angle);
  const visited = new Set<string>();
  const result: { points: Point2[]; thickness: number[] }[] = [];
  for (const [start, list] of outgoing)
    for (const first of list) {
      if (visited.has(`${start}>${first.to}`)) continue;
      const points: Point2[] = [];
      const thickness: number[] = [];
      let from = start,
        step = first;
      while (!visited.has(`${from}>${step.to}`)) {
        visited.add(`${from}>${step.to}`);
        points.push(nodes[from]);
        thickness.push(step.edge.thickness);
        const around = outgoing.get(step.to)!;
        const back = around.findIndex((h) => h.to === from);
        from = step.to;
        step = around[(back - 1 + around.length) % around.length];
      }
      if (signedArea(points) > EPS) result.push({ points, thickness });
    }
  return result;
}

/**
 * The outer faces of the exterior walls when they close a single loop, each side offset
 * outward by half its wall's thickness; undefined otherwise.
 */
export function exteriorOutline(walls: Wall[]): Point2[] | undefined {
  const remaining = walls.filter((w) => w.exterior);
  if (remaining.length < 3) return;
  const near = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < SNAP;
  let points: Point2[] = [];
  let thickness: number[] = [];
  let at = remaining[0].start;
  while (remaining.length) {
    const i = remaining.findIndex((w) => near(w.start, at) || near(w.end, at));
    if (i < 0) return;
    const [wall] = remaining.splice(i, 1);
    points.push(at);
    thickness.push(wall.thickness);
    at = near(wall.start, at) ? wall.end : wall.start;
  }
  if (!near(at, points[0])) return;
  if (signedArea(points) < 0) {
    points = [points[0], ...points.slice(1).reverse()];
    thickness = thickness.reverse();
  }
  // A negative thickness offsets the counter-clockwise sides outward.
  return finishedPolygon({ points, thickness: thickness.map((t) => -t) });
}

/** Offsets each side of a counter-clockwise face inward by half its wall's thickness. */
function finishedPolygon({ points, thickness }: { points: Point2[]; thickness: number[] }) {
  // Merge collinear sides of equal thickness (a wall split by a junction on its other face).
  const corners: Point2[] = [];
  const sides: number[] = [];
  points.forEach((p, i) => {
    const before = points[(i - 1 + points.length) % points.length],
      after = points[(i + 1) % points.length];
    const previousThickness = thickness[(i - 1 + points.length) % points.length];
    const turn = cross(sub(p, before), sub(after, p));
    const straight =
      Math.abs(turn) <= EPS * Math.hypot(...sub(p, before)) * Math.hypot(...sub(after, p)) * 1e3 &&
      (p[0] - before[0]) * (after[0] - p[0]) + (p[1] - before[1]) * (after[1] - p[1]) > 0;
    if (straight && Math.abs(previousThickness - thickness[i]) < EPS) return;
    corners.push(p);
    sides.push(thickness[i]);
  });
  const lines = corners.map((p, i) => {
    const q = corners[(i + 1) % corners.length];
    const d = sub(q, p);
    const len = Math.hypot(...d);
    const inward: Point2 = [-d[1] / len, d[0] / len];
    const shift = sides[i] / 2;
    return { p: [p[0] + inward[0] * shift, p[1] + inward[1] * shift] as Point2, d };
  });
  const polygon: Point2[] = [];
  lines.forEach((line, i) => {
    const previous = lines[(i - 1 + lines.length) % lines.length];
    const denominator = cross(previous.d, line.d);
    if (Math.abs(denominator) <= EPS) {
      // Collinear sides of different thickness: a step at the shared corner.
      polygon.push(project(previous, corners[i]), line.p);
      return;
    }
    const t = cross(sub(line.p, previous.p), line.d) / denominator;
    polygon.push([previous.p[0] + t * previous.d[0], previous.p[1] + t * previous.d[1]]);
  });
  return untangle(polygon);
}

/**
 * A side shorter than a neighbouring wall's half-thickness folds the offset outline over
 * itself: where two sides cross, keep the larger of the two loops.
 */
function untangle(polygon: Point2[]): Point2[] {
  for (let i = 0; i < polygon.length; i++)
    for (let j = i + 2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length - 1) continue;
      const a = polygon[i],
        b = polygon[i + 1],
        c = polygon[j],
        d = polygon[(j + 1) % polygon.length];
      const ab = sub(b, a),
        cd = sub(d, c);
      const denominator = cross(ab, cd);
      if (Math.abs(denominator) <= EPS) continue;
      const t = cross(sub(c, a), cd) / denominator,
        u = cross(sub(c, a), ab) / denominator;
      if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) continue;
      const x: Point2 = [a[0] + t * ab[0], a[1] + t * ab[1]];
      const inner = [x, ...polygon.slice(i + 1, j + 1)];
      const outer = [x, ...polygon.slice(j + 1), ...polygon.slice(0, i + 1)];
      return untangle(signedArea(inner) > signedArea(outer) ? inner : outer);
    }
  return polygon;
}

function project(line: { p: Point2; d: Point2 }, point: Point2): Point2 {
  const r = sub(point, line.p);
  const t = (r[0] * line.d[0] + r[1] * line.d[1]) / (line.d[0] ** 2 + line.d[1] ** 2);
  return [line.p[0] + t * line.d[0], line.p[1] + t * line.d[1]];
}

/** Area shared by two simple polygons: `subject` clipped by each ear of `clip`. */
function overlapArea(subject: Point2[], clip: Point2[]) {
  return triangles(clip).reduce(
    (sum, triangle) => sum + polygonArea(clipConvex(subject, triangle)),
    0,
  );
}

function triangles(polygon: Point2[]): Point2[][] {
  const ring = signedArea(polygon) >= 0 ? [...polygon] : [...polygon].reverse();
  const result: Point2[][] = [];
  let guard = ring.length * ring.length;
  while (ring.length > 3 && guard-- > 0) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i - 1 + ring.length) % ring.length],
        b = ring[i],
        c = ring[(i + 1) % ring.length];
      if (cross(sub(b, a), sub(c, b)) <= EPS) continue;
      const inside = ring.some(
        (p) =>
          p !== a &&
          p !== b &&
          p !== c &&
          cross(sub(b, a), sub(p, a)) > 0 &&
          cross(sub(c, b), sub(p, b)) > 0 &&
          cross(sub(a, c), sub(p, c)) > 0,
      );
      if (inside) continue;
      result.push([a, b, c]);
      ring.splice(i, 1);
      break;
    }
  }
  if (ring.length === 3) result.push(ring);
  return result;
}

/** Sutherland–Hodgman against a counter-clockwise convex polygon; area-exact for any subject. */
function clipConvex(subject: Point2[], convex: Point2[]) {
  let output = subject;
  convex.forEach((a, i) => {
    const b = convex[(i + 1) % convex.length];
    const side = (p: Point2) => cross(sub(b, a), sub(p, a));
    const input = output;
    output = [];
    input.forEach((p, j) => {
      const q = input[(j + 1) % input.length];
      const sp = side(p),
        sq = side(q);
      if (sp >= 0) output.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        output.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    });
  });
  return output.length >= 3 ? output : [];
}
