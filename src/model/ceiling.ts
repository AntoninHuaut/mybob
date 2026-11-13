import earcut from 'earcut';
import type { CeilingSlope, Level, Point2 } from './types';

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
      const h0 = slope.height + slope.rise * slopeDistance(slope, a);
      const f = slopeFrame(slope);
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
    slopes.forEach((slope, s) => {
      const height = slopeHeightAt(slope, middle);
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
        for (const [t0, t1] of insideIntervals(level.outline, base, across, reach)) {
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
