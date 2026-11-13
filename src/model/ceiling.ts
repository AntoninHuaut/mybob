import earcut from 'earcut';
import type { CeilingSlope, HouseProject, Level, Point2 } from './types';
import { resolveRoofWindow, roofFaceHeightAt } from './geometry';

/**
 * Ceiling of a level under its roof slopes. The ceiling is the lowest of the flat
 * `ceilingHeight` and of each declared slope, a plane rising from its foot line.
 * Everything is relative to the level floor. Pure geometry: the scene builds the
 * meshes from it, the validation and the furniture checks read heights from it.
 */

/** A height that varies linearly in plan: `c + cx·x + cz·z`. */
interface Linear {
  c: number;
  cx: number;
  cz: number;
}

const EPS = 1e-9;

/** Unit direction of the foot line, its length, and the normal of the rising side. */
function slopeFrame(slope: CeilingSlope) {
  const dx = slope.end[0] - slope.start[0];
  const dz = slope.end[1] - slope.start[1];
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length;
  const uz = dz / length;
  // Left of the direction on a plan drawn with z downwards.
  return { ux, uz, nx: uz, nz: -ux, length };
}

/** Distance from the foot line, positive on the rising side. */
export function slopeDistance(slope: CeilingSlope, point: Point2): number {
  const f = slopeFrame(slope);
  return (point[0] - slope.start[0]) * f.nx + (point[1] - slope.start[1]) * f.nz;
}

/** Position of a point along the foot line, in metres from `start`. */
function slopeAlong(slope: CeilingSlope, point: Point2): number {
  const f = slopeFrame(slope);
  return (point[0] - slope.start[0]) * f.ux + (point[1] - slope.start[1]) * f.uz;
}

function inGap(slope: CeilingSlope, along: number): boolean {
  return (slope.gaps ?? []).some(([from, to]) => along > from + EPS && along < to - EPS);
}

function slopeLinear(slope: CeilingSlope): Linear {
  const f = slopeFrame(slope);
  const cx = slope.rise * f.nx;
  const cz = slope.rise * f.nz;
  return { c: slope.height - cx * slope.start[0] - cz * slope.start[1], cx, cz };
}

const evaluate = (fn: Linear, x: number, z: number) => fn.c + fn.cx * x + fn.cz * z;

/** Height of one slope at a point; infinite where a gap interrupts it. */
export function slopeHeightAt(slope: CeilingSlope, point: Point2): number {
  if (inGap(slope, slopeAlong(slope, point))) return Infinity;
  return slope.height + slope.rise * slopeDistance(slope, point);
}

/** Ceiling height above the level floor at a point in plan. */
export function ceilingHeightAt(level: Level, point: Point2, cap = level.ceilingHeight): number {
  let height = cap;
  for (const slope of level.ceilingSlopes ?? [])
    height = Math.min(height, slopeHeightAt(slope, point));
  return height;
}

/** Lowest ceiling over a set of points (the corners of a convex footprint). */
export function lowestCeiling(level: Level, points: Point2[]): number {
  return Math.min(...points.map((point) => ceilingHeightAt(level, point)));
}

/** One straight run of a ceiling profile, from `start` to `end` metres along a segment. */
export interface CeilingRun {
  start: number;
  end: number;
  /** Ceiling height at `start` and at `end`. */
  from: number;
  to: number;
}

/**
 * Profile of the ceiling above the segment `a → b`, as straight runs. `cap` replaces
 * the flat ceiling (a wall lower than the ceiling caps its own top). Consecutive runs
 * share their ends, except at a gap edge, where the height steps.
 */
export function ceilingProfile(
  level: Level,
  a: Point2,
  b: Point2,
  cap = level.ceilingHeight,
  /**
   * Thickness of a wall standing on `a → b`: each slope is then read on the wall's
   * higher face, so the face on the rising side meets the ceiling instead of stopping
   * under it; the rest of the wall top hides above the ceiling.
   */
  thickness = 0,
): CeilingRun[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < EPS) return [];
  const ux = (b[0] - a[0]) / length;
  const uz = (b[1] - a[1]) / length;
  const at = (t: number): Point2 => [a[0] + ux * t, a[1] + uz * t];
  const slopes = level.ceilingSlopes ?? [];
  // Along the segment, every function is linear in t: h(t) = h0 + k·t.
  const lines = [
    { h0: cap, k: 0 },
    ...slopes.map((slope) => {
      const f = slopeFrame(slope);
      const across = Math.abs(-uz * f.nx + ux * f.nz);
      const h0 = slope.height + slope.rise * (slopeDistance(slope, a) + (thickness / 2) * across);
      return { h0, k: slope.rise * (ux * f.nx + uz * f.nz) };
    }),
  ];
  const cuts = new Set<number>([0, length]);
  slopes.forEach((slope) => {
    const f = slopeFrame(slope);
    const along0 = slopeAlong(slope, a);
    const rate = ux * f.ux + uz * f.uz;
    if (Math.abs(rate) > EPS)
      for (const edge of (slope.gaps ?? []).flat()) cuts.add((edge - along0) / rate);
  });
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const dk = lines[i].k - lines[j].k;
      if (Math.abs(dk) > EPS) cuts.add((lines[j].h0 - lines[i].h0) / dk);
    }
  const ts = [...cuts].filter((t) => t >= 0 && t <= length).sort((p, q) => p - q);
  const runs: CeilingRun[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    if (t1 - t0 < 1e-6) continue;
    const middle = at((t0 + t1) / 2);
    // The lowest function in the middle of the run stays the lowest on the whole run.
    let best = lines[0];
    let bestHeight = cap;
    const tm = (t0 + t1) / 2;
    slopes.forEach((slope, s) => {
      if (inGap(slope, slopeAlong(slope, middle))) return;
      const height = lines[s + 1].h0 + lines[s + 1].k * tm;
      if (height < bestHeight) {
        bestHeight = height;
        best = lines[s + 1];
      }
    });
    const run = { start: t0, end: t1, from: best.h0 + best.k * t0, to: best.h0 + best.k * t1 };
    const previous = runs[runs.length - 1];
    // Merge collinear neighbours: a flat wall stays one run.
    if (
      previous &&
      Math.abs(previous.to - run.from) < 1e-9 &&
      Math.abs(
        (previous.to - previous.from) / (previous.end - previous.start) -
          (run.to - run.from) / (run.end - run.start),
      ) < 1e-9
    ) {
      previous.end = run.end;
      previous.to = run.to;
    } else runs.push(run);
  }
  return runs;
}

type Polygon = Point2[];

/** Keeps the part of a convex polygon where `fn ≤ 0`. */
function clip(polygon: Polygon, fn: Linear): Polygon {
  const result: Polygon = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const vp = evaluate(fn, p[0], p[1]);
    const vq = evaluate(fn, q[0], q[1]);
    if (vp <= 0) result.push(p);
    if ((vp < 0 && vq > 0) || (vp > 0 && vq < 0)) {
      const t = vp / (vp - vq);
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return result;
}

const negate = (fn: Linear): Linear => ({ c: -fn.c, cx: -fn.cx, cz: -fn.cz });
const minus = (p: Linear, q: Linear): Linear => ({
  c: p.c - q.c,
  cx: p.cx - q.cx,
  cz: p.cz - q.cz,
});

function area(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    sum += p[0] * q[1] - q[0] * p[1];
  }
  return sum / 2;
}

/** A convex piece of the ceiling and the plane it lies in. */
interface CeilingPiece {
  polygon: Polygon;
  plane: Linear;
}

/**
 * Splits a convex piece where `slope` passes under its plane. Outside the gaps the
 * slope takes over wherever it is lower; inside a gap the piece keeps its plane.
 */
function lowerBy(piece: CeilingPiece, slope: CeilingSlope): CeilingPiece[] {
  const f = slopeFrame(slope);
  // along(x, z) - edge as a linear function, for the strips of the gaps.
  const along = (edge: number): Linear => ({
    c: -slope.start[0] * f.ux - slope.start[1] * f.uz - edge,
    cx: f.ux,
    cz: f.uz,
  });
  const strips: { polygon: Polygon; applies: boolean }[] = [];
  let rest = piece.polygon;
  for (const [from, to] of [...(slope.gaps ?? [])].sort((p, q) => p[0] - q[0])) {
    if (rest.length < 3) break;
    strips.push({ polygon: clip(rest, along(from)), applies: true });
    const after = clip(rest, negate(along(from)));
    strips.push({ polygon: clip(after, along(to)), applies: false });
    rest = clip(after, negate(along(to)));
  }
  strips.push({ polygon: rest, applies: true });
  const plane = slopeLinear(slope);
  const result: CeilingPiece[] = [];
  for (const strip of strips) {
    if (strip.polygon.length < 3 || Math.abs(area(strip.polygon)) < 1e-10) continue;
    if (!strip.applies) {
      result.push({ polygon: strip.polygon, plane: piece.plane });
      continue;
    }
    const difference = minus(plane, piece.plane);
    const lower = clip(strip.polygon, difference);
    const upper = clip(strip.polygon, negate(difference));
    if (lower.length >= 3 && Math.abs(area(lower)) > 1e-10) result.push({ polygon: lower, plane });
    if (upper.length >= 3 && Math.abs(area(upper)) > 1e-10)
      result.push({ polygon: upper, plane: piece.plane });
  }
  return result;
}

/** The inside half-planes of a convex polygon, each as `fn ≤ 0`. */
function halfPlanes(polygon: Polygon): Linear[] {
  const cx = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
  const cz = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
  return polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    // Zero on the edge, signed so that the centre is inside.
    const cxEdge = q[1] - p[1];
    const czEdge = -(q[0] - p[0]);
    const fn: Linear = { c: -(cxEdge * p[0] + czEdge * p[1]), cx: cxEdge, cz: czEdge };
    return evaluate(fn, cx, cz) > 0 ? negate(fn) : fn;
  });
}

/** A convex piece minus a convex cutout: at most one piece per side of the cutout. */
function cutAway(piece: CeilingPiece, cutout: Polygon): CeilingPiece[] {
  const result: CeilingPiece[] = [];
  let rest = piece.polygon;
  for (const plane of halfPlanes(cutout)) {
    if (rest.length < 3) break;
    const outside = clip(rest, negate(plane));
    if (outside.length >= 3 && Math.abs(area(outside)) > 1e-10)
      result.push({ polygon: outside, plane: piece.plane });
    rest = clip(rest, plane);
  }
  return result;
}

/** A triangle of the ceiling surface, its vertices as [x, height, z]. */
export type CeilingTriangle = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/**
 * The ceiling surface over `outline` minus `holes`, as triangles: the flat ceiling
 * where it is the lowest, the slopes elsewhere. Without a slope it is the flat
 * outline, as before.
 */
export function ceilingTriangles(
  level: Level,
  outline: Point2[] = level.outline,
  holes: Point2[][] = [],
  /** Convex polygons cut out of the ceiling, such as the well of a roof window. */
  cutouts: Point2[][] = [],
): CeilingTriangle[] {
  const points = [...outline];
  const holeIndices: number[] = [];
  for (const hole of holes) {
    holeIndices.push(points.length);
    points.push(...hole);
  }
  const indices = earcut(points.flat(), holeIndices);
  const flat: Linear = { c: level.ceilingHeight, cx: 0, cz: 0 };
  const triangles: CeilingTriangle[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    let pieces: CeilingPiece[] = [
      {
        polygon: [points[indices[i]], points[indices[i + 1]], points[indices[i + 2]]],
        plane: flat,
      },
    ];
    for (const slope of level.ceilingSlopes ?? [])
      pieces = pieces.flatMap((piece) => lowerBy(piece, slope));
    for (const cutout of cutouts) pieces = pieces.flatMap((piece) => cutAway(piece, cutout));
    for (const { polygon, plane } of pieces)
      for (let k = 1; k + 1 < polygon.length; k++) {
        const vertex = (p: Point2): [number, number, number] => [
          p[0],
          evaluate(plane, p[0], p[1]),
          p[1],
        ];
        triangles.push([vertex(polygon[0]), vertex(polygon[k]), vertex(polygon[k + 1])]);
      }
  }
  return triangles;
}

/** Height of a profile at `t`, the runs covering it in order. */
function profileAt(runs: CeilingRun[], t: number): number {
  const run = runs.find((r) => t >= r.start - 1e-9 && t <= r.end + 1e-9) ?? runs[runs.length - 1];
  if (!run) return NaN;
  const span = run.end - run.start;
  return span < 1e-12 ? run.from : run.from + ((run.to - run.from) * (t - run.start)) / span;
}

/** Parameters, along `a + t·u`, of the intervals of a line inside a polygon. */
function insideIntervals(polygon: Point2[], a: Point2, u: Point2, reach: number) {
  const ts = [-reach, reach];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const ex = q[0] - p[0];
    const ez = q[1] - p[1];
    const denominator = u[0] * ez - u[1] * ex;
    if (Math.abs(denominator) < EPS) continue;
    const wx = p[0] - a[0];
    const wz = p[1] - a[1];
    const t = (wx * ez - wz * ex) / denominator;
    const s = (wx * u[1] - wz * u[0]) / denominator;
    if (s >= -EPS && s <= 1 + EPS) ts.push(t);
  }
  ts.sort((p, q) => p - q);
  const intervals: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const middle = (ts[i] + ts[i + 1]) / 2;
    if (
      ts[i + 1] - ts[i] > 1e-6 &&
      pointInside([a[0] + u[0] * middle, a[1] + u[1] * middle], polygon)
    )
      intervals.push([ts[i], ts[i + 1]]);
  }
  return intervals;
}

function pointInside(point: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (
      zi > point[1] !== zj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi
    )
      inside = !inside;
  }
  return inside;
}

/**
 * The vertical faces of the ceiling at the edges of a gap: beside a dormer, the
 * flat ceiling over the gap stands above the slope next to it, and the step between
 * them is a wall of plaster hanging from the flat ceiling down to the slope. Each
 * face comes as quads [bottom start, bottom end, top end, top start], with the
 * side of the gap as its normal.
 */
export function ceilingSteps(
  level: Level,
): { points: [number, number, number][]; normal: [number, number, number] }[] {
  const faces: { points: [number, number, number][]; normal: [number, number, number] }[] = [];
  const box = level.outline.reduce((r, [x, z]) => Math.max(r, Math.abs(x), Math.abs(z)), 0);
  const reach = 4 * box + 10;
  for (const slope of level.ceilingSlopes ?? []) {
    const f = slopeFrame(slope);
    for (const [from, to] of slope.gaps ?? [])
      for (const [edge, inward] of [
        [from, 1],
        [to, -1],
      ] as const) {
        // The edge line, across the foot line, and the two sides of it.
        const base: Point2 = [slope.start[0] + f.ux * edge, slope.start[1] + f.uz * edge];
        const across: Point2 = [f.nx, f.nz];
        const shift = (side: number): Point2 => [
          base[0] + f.ux * side * 1e-5,
          base[1] + f.uz * side * 1e-5,
        ];
        for (const [t0, t1] of insideIntervals(level.outline, shift(inward), across, reach)) {
          const end = (origin: Point2, t: number): Point2 => [
            origin[0] + across[0] * t,
            origin[1] + across[1] * t,
          ];
          const gapSide = shift(inward);
          const slopeSide = shift(-inward);
          const high = ceilingProfile(level, end(gapSide, t0), end(gapSide, t1));
          const low = ceilingProfile(level, end(slopeSide, t0), end(slopeSide, t1));
          const cuts = [...new Set([...high, ...low].flatMap((run) => [run.start, run.end]))].sort(
            (p, q) => p - q,
          );
          for (let i = 0; i + 1 < cuts.length; i++) {
            const [s0, s1] = [cuts[i], cuts[i + 1]];
            if (s1 - s0 < 1e-6) continue;
            const top0 = profileAt(high, s0);
            const top1 = profileAt(high, s1);
            const bottom0 = profileAt(low, s0);
            const bottom1 = profileAt(low, s1);
            if (top0 - bottom0 < 1e-6 && top1 - bottom1 < 1e-6) continue;
            const p0 = end(base, t0 + s0);
            const p1 = end(base, t0 + s1);
            faces.push({
              points: [
                [p0[0], bottom0, p0[1]],
                [p1[0], bottom1, p1[1]],
                [p1[0], top1, p1[1]],
                [p0[0], top0, p0[1]],
              ],
              normal: [f.ux * inward, 0, f.uz * inward],
            });
          }
        }
      }
  }
  return faces;
}

/** What a roof window does to the ceiling under it: a hole, and the well's sides. */
export interface CeilingWells {
  /** Plan footprints of the wells, convex, cut out of the ceiling. */
  cutouts: Point2[][];
  /** Sides and top of the wells, between the ceiling and the window. */
  reveals: { points: [number, number, number][]; normal: [number, number, number] }[];
}

/**
 * The wells of the roof windows above a level with sloping ceilings, as an attic plan
 * draws them: the ceiling opens under the window and on, towards the ridge, until it
 * reaches the height of the window's top edge. The sides rise vertically from the
 * ceiling to the roof face, or to that height where the well runs on under the slope,
 * and a flat top closes it there. From inside, the window shows at the end of its
 * well instead of being hidden behind the slope. Only the part over the floor opens.
 */
export function roofWindowWells(project: HouseProject, level: Level): CeilingWells {
  const wells: CeilingWells = { cutouts: [], reveals: [] };
  if (!level.ceilingSlopes?.length) return wells;
  const reach =
    4 * level.outline.reduce((r, [x, z]) => Math.max(r, Math.abs(x), Math.abs(z)), 0) + 10;
  for (const roof of project.site?.roofs ?? [])
    for (const window of roof.windows ?? []) {
      const resolved = resolveRoofWindow(roof.vertices, roof.faces, window);
      if (!resolved.frame) continue;
      const frame = resolved.frame;
      const face = roof.faces[frame.faceIndex];
      const roofHeight = (x: number, z: number) =>
        roofFaceHeightAt(roof.vertices, face, x, z) - level.elevation;
      const corners = frame.corners;
      const windowTop = Math.max(...corners.map((c) => c[1])) - level.elevation;
      // The well's flat top never rises above the flat ceiling.
      const top = Math.min(windowTop, level.ceilingHeight);
      // Up the slope, in plan: the well runs on that way under the ceiling.
      const flat = Math.hypot(frame.up[0], frame.up[2]) || 1;
      const inward: Point2 = [frame.up[0] / flat, frame.up[2] / flat];
      const upper = corners.filter((c) => c[1] - level.elevation > windowTop - 1e-6);
      const lower = corners.filter((c) => c[1] - level.elevation <= windowTop - 1e-6);
      if (upper.length !== 2 || lower.length !== 2) continue;
      // How far the ceiling stays under the top edge, from the middle of that edge.
      const middle: Point2 = [(upper[0][0] + upper[1][0]) / 2, (upper[0][2] + upper[1][2]) / 2];
      let reachIn = 0;
      if (ceilingHeightAt(level, middle) < top) {
        let low = 0;
        let high = 6;
        for (let k = 0; k < 40; k++) {
          const mid = (low + high) / 2;
          const at: Point2 = [middle[0] + inward[0] * mid, middle[1] + inward[1] * mid];
          if (ceilingHeightAt(level, at) < top) low = mid;
          else high = mid;
        }
        reachIn = high;
      }
      const [l0, l1] = lower.map((c): Point2 => [c[0], c[2]]);
      const [u0, u1] = upper.map((c): Point2 => [c[0], c[2]]);
      // Pair each upper corner with the lower corner on its side.
      const sameSide =
        Math.hypot(u0[0] - l0[0], u0[1] - l0[1]) <= Math.hypot(u0[0] - l1[0], u0[1] - l1[1]);
      const [a0, a1] = sameSide ? [l0, l1] : [l1, l0];
      const shift = (p: Point2): Point2 => [p[0] + inward[0] * reachIn, p[1] + inward[1] * reachIn];
      const footprint: Polygon = [a0, a1, shift(u1), shift(u0)];
      if (reachIn < 1e-6) footprint.splice(2, 2, u1, u0);
      // Only where the footprint is over the floor.
      let over: Polygon = level.outline;
      for (const plane of halfPlanes(footprint)) over = clip(over, plane);
      if (over.length < 3 || Math.abs(area(over)) < 1e-4) continue;
      wells.cutouts.push(footprint);
      // The well's upper surface: the roof face under the window, the top height beyond.
      const ceilingOfWell = (x: number, z: number) => Math.min(roofHeight(x, z), top);
      const cx = footprint.reduce((sum, p) => sum + p[0], 0) / footprint.length;
      const cz = footprint.reduce((sum, p) => sum + p[1], 0) / footprint.length;
      footprint.forEach((p, i) => {
        const q = footprint[(i + 1) % footprint.length];
        const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (length < 1e-6) return;
        const u: Point2 = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
        let normal: [number, number, number] = [-u[1], 0, u[0]];
        if (normal[0] * (cx - p[0]) + normal[2] * (cz - p[1]) < 0) normal = [u[1], 0, -u[0]];
        const at = (t: number): Point2 => [p[0] + u[0] * t, p[1] + u[1] * t];
        // Where the roof face crosses the top height along this edge.
        const r0 = roofHeight(p[0], p[1]);
        const r1 = roofHeight(q[0], q[1]);
        const kink = Math.abs(r1 - r0) > 1e-9 ? ((top - r0) / (r1 - r0)) * length : -1;
        for (const [t0, t1] of insideIntervals(level.outline, p, u, reach)) {
          const s0 = Math.max(0, t0);
          const s1 = Math.min(length, t1);
          if (s1 - s0 < 1e-6) continue;
          for (const run of ceilingProfile(level, at(s0), at(s1))) {
            const cuts = [s0 + run.start, s0 + run.end];
            if (kink > cuts[0] + 1e-6 && kink < cuts[1] - 1e-6) cuts.splice(1, 0, kink);
            for (let k = 0; k + 1 < cuts.length; k++) {
              const a = at(cuts[k]);
              const b = at(cuts[k + 1]);
              const span = run.end - run.start;
              const bottomA = run.from + ((run.to - run.from) * (cuts[k] - s0 - run.start)) / span;
              const bottomB =
                run.from + ((run.to - run.from) * (cuts[k + 1] - s0 - run.start)) / span;
              const topA = ceilingOfWell(a[0], a[1]);
              const topB = ceilingOfWell(b[0], b[1]);
              if (topA - bottomA < 1e-6 && topB - bottomB < 1e-6) continue;
              wells.reveals.push({
                points: [
                  [a[0], bottomA, a[1]],
                  [b[0], bottomB, b[1]],
                  [b[0], Math.max(topB, bottomB), b[1]],
                  [a[0], Math.max(topA, bottomA), a[1]],
                ],
                normal,
              });
            }
          }
        }
      });
      // Over a knee wall, the window's lower edge stands beyond the floor: close the
      // well there, from the edge of the floor at the ceiling up to that lower edge,
      // with a triangle on each side.
      const entry = (corner: Point2, towards: Point2): Point2 | undefined => {
        if (pointInside(corner, level.outline)) return undefined;
        const length = Math.hypot(towards[0] - corner[0], towards[1] - corner[1]);
        if (length < 1e-6) return undefined;
        const u: Point2 = [(towards[0] - corner[0]) / length, (towards[1] - corner[1]) / length];
        const first = insideIntervals(level.outline, corner, u, reach).find(
          ([t0, t1]) => t1 > 0 && t0 < length,
        );
        if (!first) return undefined;
        // Past the knee wall standing on the floor's edge: the sill starts at its
        // inner face, level with its top, instead of behind it.
        const inWall = (p: Point2) =>
          level.walls.some((wall) => {
            const dx = wall.end[0] - wall.start[0];
            const dz = wall.end[1] - wall.start[1];
            const run = Math.hypot(dx, dz) || 1;
            const along = ((p[0] - wall.start[0]) * dx + (p[1] - wall.start[1]) * dz) / run;
            const off = Math.abs((p[0] - wall.start[0]) * dz - (p[1] - wall.start[1]) * dx) / run;
            return along >= 0 && along <= run && off <= wall.thickness / 2 + 1e-6;
          });
        let t = Math.max(0, first[0]);
        const stop = Math.min(length, t + 0.6);
        while (t < stop && inWall([corner[0] + u[0] * t, corner[1] + u[1] * t])) t += 0.001;
        return [corner[0] + u[0] * t, corner[1] + u[1] * t];
      };
      const c0 = entry(a0, shift(u0));
      const c1 = entry(a1, shift(u1));
      if (c0 && c1) {
        const at = (p: Point2, y: number): [number, number, number] => [p[0], y, p[1]];
        const sill = [at(c0, ceilingHeightAt(level, c0)), at(c1, ceilingHeightAt(level, c1))];
        const lowEdge = [at(a1, roofHeight(a1[0], a1[1])), at(a0, roofHeight(a0[0], a0[1]))];
        const e1 = [sill[1][0] - sill[0][0], sill[1][1] - sill[0][1], sill[1][2] - sill[0][2]];
        const e2 = [
          lowEdge[1][0] - sill[0][0],
          lowEdge[1][1] - sill[0][1],
          lowEdge[1][2] - sill[0][2],
        ];
        let n: [number, number, number] = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const length = Math.hypot(...n) || 1;
        n = n.map((v) => v / length) as [number, number, number];
        if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
        wells.reveals.push({ points: [sill[0], sill[1], lowEdge[0], lowEdge[1]], normal: n });
        for (const [c, a] of [
          [c0, a0],
          [c1, a1],
        ] as const) {
          const top = roofHeight(c[0], c[1]);
          const bottom = ceilingHeightAt(level, c);
          if (top - bottom < 1e-6) continue;
          const u: Point2 = [a[0] - c[0], a[1] - c[1]];
          const length = Math.hypot(u[0], u[1]) || 1;
          let side: [number, number, number] = [-u[1] / length, 0, u[0] / length];
          if (side[0] * (cx - c[0]) + side[2] * (cz - c[1]) < 0) side = [-side[0], 0, -side[2]];
          wells.reveals.push({
            points: [at(c, bottom), at(a, roofHeight(a[0], a[1])), at(c, top)],
            normal: side,
          });
        }
      }
      // The flat top of the well, from the window's top edge to where the ceiling
      // reaches it.
      if (reachIn > 1e-6)
        wells.reveals.push({
          points: [u0, u1, shift(u1), shift(u0)].map(([x, z]) => [x, top, z]),
          normal: [0, -1, 0],
        });
    }
  return wells;
}
