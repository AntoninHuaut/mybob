import { pointInPolygon, wallLength } from './geometry';
import { checkJunctionOpening } from './roomPartition';
import { deriveRooms } from './roomDerivation';
import type { HouseProject, Level, Point2, Wall } from './types';
import { validateProject } from './validate';
import { enclosure, nextCorner } from './wallChain';

/** Snapping grid of the wall tool: 5 cm. */
export const GRID_STEPS_PER_METRE = 20;
const round = (value: number) => Math.round(value * GRID_STEPS_PER_METRE) / GRID_STEPS_PER_METRE;
const EPS = 1e-9;

export interface DraftSnap {
  point: Point2;
  kind: 'corner' | 'wall' | 'grid' | 'free';
}

export interface SnapOptions {
  /** The chain's last corner: the next one follows 45° steps from it. */
  last?: Point2;
  /** Corners of the chain being drawn, its first one closing it. */
  corners?: Point2[];
  angle: boolean;
  grid: boolean;
  /** Snap distance in metres, from the pointer's on-screen tolerance. */
  tolerance: number;
}

/** Where a click at `pointer` puts the next corner: a corner, then a wall, then the 45°/grid steps. */
export function snapDraftPoint(walls: Wall[], pointer: Point2, options: SnapOptions): DraftSnap {
  const corners = [...(options.corners ?? []), ...walls.flatMap((w) => [w.start, w.end])];
  let best: Point2 | undefined;
  let bestDistance = options.tolerance;
  for (const c of corners) {
    const d = Math.hypot(c[0] - pointer[0], c[1] - pointer[1]);
    if (d <= bestDistance) [best, bestDistance] = [c, d];
  }
  if (best) return { point: best, kind: 'corner' };
  const { last } = options;
  if (last && options.angle) {
    const ray = nextCorner(last, pointer);
    if (!ray) return { point: last, kind: 'free' };
    const direction: Point2 = [ray[0] - last[0], ray[1] - last[1]];
    const span = Math.hypot(...direction);
    const crossing = closestCrossing(walls, last, direction, ray, options.tolerance);
    if (crossing) return { point: crossing, kind: 'wall' };
    if (!options.grid) return { point: ray, kind: 'free' };
    return {
      point: nextCorner(last, pointer, Math.max(round(span), 1 / GRID_STEPS_PER_METRE))!,
      kind: 'grid',
    };
  }
  const onWall = closestOnWall(walls, pointer, options.tolerance, options.grid);
  if (onWall) return { point: onWall, kind: 'wall' };
  if (options.grid) return { point: [round(pointer[0]), round(pointer[1])], kind: 'grid' };
  return { point: pointer, kind: 'free' };
}

function closestOnWall(walls: Wall[], p: Point2, tolerance: number, grid: boolean) {
  let best: Point2 | undefined;
  let bestDistance = tolerance;
  for (const w of walls) {
    const len = wallLength(w);
    const u: Point2 = [(w.end[0] - w.start[0]) / len, (w.end[1] - w.start[1]) / len];
    const raw = (p[0] - w.start[0]) * u[0] + (p[1] - w.start[1]) * u[1];
    if (raw < 0 || raw > len) continue;
    const along = grid ? Math.min(len, Math.max(0, round(raw))) : raw;
    const q: Point2 = [w.start[0] + u[0] * along, w.start[1] + u[1] * along];
    const d = Math.abs((p[0] - w.start[0]) * u[1] - (p[1] - w.start[1]) * u[0]);
    if (d <= bestDistance) [best, bestDistance] = [q, d];
  }
  return best;
}

/** Where the 45° ray from `last` meets a wall axis close to the pointer's projection. */
function closestCrossing(
  walls: Wall[],
  last: Point2,
  direction: Point2,
  ray: Point2,
  tolerance: number,
) {
  let best: Point2 | undefined;
  let bestDistance = tolerance;
  for (const w of walls) {
    const e: Point2 = [w.end[0] - w.start[0], w.end[1] - w.start[1]];
    const denominator = direction[0] * e[1] - direction[1] * e[0];
    if (Math.abs(denominator) < EPS) continue;
    const r: Point2 = [w.start[0] - last[0], w.start[1] - last[1]];
    const t = (r[0] * e[1] - r[1] * e[0]) / denominator;
    const u = (r[0] * direction[1] - r[1] * direction[0]) / denominator;
    if (t <= EPS || u < 0 || u > 1) continue;
    const q: Point2 = [last[0] + t * direction[0], last[1] + t * direction[1]];
    const d = Math.hypot(q[0] - ray[0], q[1] - ray[1]);
    if (d <= bestDistance) [best, bestDistance] = [q, d];
  }
  return best;
}

/**
 * Adds a chain of walls to `level` as one edit, then derives its rooms again. A corner landing
 * partway along an existing wall joins it there without splitting it, as long as it clears its
 * openings. The level's first closed chain is its exterior: it sets the outline and the start.
 */
export function addWallChain(
  level: Level,
  points: Point2[],
  closed: boolean,
  thickness: number,
): Level {
  if (points.length < 2 || !(thickness > 0)) throw new Error('Tracez au moins un mur.');
  const first = level.walls.length === 0;
  const ids = new Set(level.walls.map((w) => w.id));
  const fresh = () => {
    let n = ids.size + 1;
    while (ids.has(`wall-${n}`)) n++;
    ids.add(`wall-${n}`);
    return `wall-${n}`;
  };
  const segments = points.map((p, i) => [p, points[i + 1]]).slice(0, -1);
  if (closed) segments.push([points.at(-1)!, points[0]]);
  const added: Wall[] = segments.map(([start, end]) => ({
    id: fresh(),
    start,
    end,
    thickness,
    ...(first ? { exterior: true } : {}),
  }));
  for (const wall of added)
    for (const end of [wall.start, wall.end])
      for (const host of level.walls) {
        const offset = interiorOffset(host, end);
        if (offset !== undefined) checkJunctionOpening(host, offset, wall);
      }
  const walls = [...level.walls, ...added];
  const rooms = deriveRooms(walls, level.rooms);
  const outline = first && closed ? enclosure(points, thickness).outline : level.outline;
  const spawn =
    !rooms.some((r) => pointInPolygon(level.spawn.position, r.polygon)) && rooms.length
      ? { position: rooms[0].viewpoint, yaw: level.spawn.yaw }
      : level.spawn;
  return { ...level, walls, rooms, outline, spawn };
}

/** Distance along `wall` of a point strictly between its ends on its axis, if any. */
function interiorOffset(wall: Wall, p: Point2) {
  const len = wallLength(wall);
  const u: Point2 = [(wall.end[0] - wall.start[0]) / len, (wall.end[1] - wall.start[1]) / len];
  const along = (p[0] - wall.start[0]) * u[0] + (p[1] - wall.start[1]) * u[1];
  const off = Math.abs((p[0] - wall.start[0]) * u[1] - (p[1] - wall.start[1]) * u[0]);
  return off < 1e-6 && along > 1e-6 && along < len - 1e-6 ? along : undefined;
}

/** « Nouvelle maison »: nothing drawn yet, on a 12 × 8 m ground until the first closed chain. */
export function emptyHouse(id: string): HouseProject {
  return validateProject({
    schemaVersion: 1,
    id,
    name: 'Nouvelle maison',
    units: 'm',
    description: '',
    source: { title: 'Dessin en plan', status: 'Projet local', notes: [] },
    levels: [
      {
        id: 'level-1',
        name: 'Rez-de-chaussée',
        elevation: 0,
        ceilingHeight: 2.5,
        outline: [
          [0, 0],
          [12, 0],
          [12, 8],
          [0, 8],
        ],
        walls: [],
        rooms: [],
        lights: [],
        spawn: { position: [6, 4], yaw: 0 },
      },
    ],
  });
}
