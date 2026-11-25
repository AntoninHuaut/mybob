import { pointInPolygon, wallLength } from './geometry';
import { editOpening, type OpeningMeasurements } from './openingEdit';
import { deriveRooms } from './roomDerivation';
import { checkJunctionOpening } from './roomPartition';
import type { Level, Point2, Room, Wall } from './types';

export type PlanSelection =
  | { kind: 'wall'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'opening'; wallId: string; id: string };

/** Position along a wall's axis and distance from it, both in metres. */
function project(wall: Wall, p: Point2) {
  const length = wallLength(wall);
  const u: Point2 = [
    (wall.end[0] - wall.start[0]) / length,
    (wall.end[1] - wall.start[1]) / length,
  ];
  const d: Point2 = [p[0] - wall.start[0], p[1] - wall.start[1]];
  return { along: d[0] * u[0] + d[1] * u[1], off: Math.abs(d[0] * u[1] - d[1] * u[0]), length };
}

/** What a Plan click at `p` designates: an opening over its wall, a wall over a room. */
export function pickPlan(level: Level, p: Point2, tolerance: number): PlanSelection | undefined {
  let best: { wall: Wall; off: number; along: number } | undefined;
  for (const wall of level.walls) {
    const { along, off, length } = project(wall, p);
    if (along < -tolerance || along > length + tolerance) continue;
    if (off > wall.thickness / 2 + tolerance || (best && off >= best.off)) continue;
    best = { wall, off, along };
  }
  if (best) {
    const { wall, along } = best;
    const opening = wall.openings?.find((o) => along >= o.offset && along <= o.offset + o.width);
    return opening
      ? { kind: 'opening', wallId: wall.id, id: opening.id }
      : { kind: 'wall', id: wall.id };
  }
  const room = level.rooms.find((r) => pointInPolygon(p, r.polygon));
  return room && { kind: 'room', id: room.id };
}

function withWalls(level: Level, walls: Wall[]): Level {
  const rooms = deriveRooms(walls, level.rooms);
  // The visit starts in a room: an edit that leaves the start outside moves it into the first.
  const spawn =
    rooms.length && !rooms.some((r) => pointInPolygon(level.spawn.position, r.polygon))
      ? { ...level.spawn, position: rooms[0].viewpoint }
      : level.spawn;
  return { ...level, walls, rooms, spawn };
}

const ENDS = 1e-6;
const same = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < ENDS;
const unit = (wall: Wall): Point2 => {
  const length = wallLength(wall);
  return [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
};
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];

/** Distance along `wall` of a point strictly between its ends on its axis, if any. */
function interiorOffset(wall: Wall, p: Point2) {
  const { along, off, length } = project(wall, p);
  return off < ENDS && along > ENDS && along < length - ENDS ? along : undefined;
}

/** Where the line through `origin` along `u` crosses the axis line of `wall`, if not parallel. */
function crossing(origin: Point2, u: Point2, wall: Wall): Point2 | undefined {
  const v = unit(wall);
  const denominator = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(denominator) < 1e-9) return;
  const d: Point2 = [wall.start[0] - origin[0], wall.start[1] - origin[1]];
  const t = (d[0] * v[1] - d[1] * v[0]) / denominator;
  return [origin[0] + u[0] * t, origin[1] + u[1] * t];
}

type EndMoves = Map<string, { start?: Point2; end?: Point2 }>;

function moveEnd(moves: EndMoves, wall: Wall, p: Point2, to: Point2) {
  const move = moves.get(wall.id) ?? {};
  if (same(wall.start, p)) move.start = to;
  if (same(wall.end, p)) move.end = to;
  moves.set(wall.id, move);
}

/**
 * Applies new wall ends. Openings keep their place along a wall whose start moved, junctions
 * may not land in an opening, and rooms are derived again.
 */
function relocate(level: Level, moves: EndMoves): Level {
  const walls = level.walls.map((wall) => {
    const move = moves.get(wall.id);
    if (!move) return wall;
    const start = move.start ?? wall.start;
    const end = move.end ?? wall.end;
    const moved: Wall = { ...wall, start, end };
    if (wallLength(moved) < 0.01 || dot(unit(moved), unit(wall)) <= 0)
      throw new Error('Le déplacement retourne un mur.');
    const u = unit(wall);
    const v = unit(moved);
    const slide = dot([wall.start[0] - start[0], wall.start[1] - start[1]], v);
    // A start moved only across the wall leaves the stored offsets exact.
    const along = Math.abs(slide) > 1e-9 || Math.abs(u[0] * v[1] - u[1] * v[0]) > 1e-9;
    if (move.start && along && wall.openings?.length) {
      moved.openings = wall.openings.map((o) => {
        const at: Point2 = [wall.start[0] + u[0] * o.offset, wall.start[1] + u[1] * o.offset];
        return { ...o, offset: dot([at[0] - start[0], at[1] - start[1]], v) };
      });
      if (moved.openings.some((o) => o.offset < -0.001))
        throw new Error('L’ouverture dépasse le bout du mur.');
    }
    assertOpeningsFit(moved);
    return moved;
  });
  for (const wall of walls) {
    const move = moves.get(wall.id);
    if (!move) continue;
    for (const p of [move.start, move.end]) {
      if (!p) continue;
      for (const host of walls) {
        const offset = host === wall ? undefined : interiorOffset(host, p);
        if (offset !== undefined) checkJunctionOpening(host, offset, wall);
      }
    }
  }
  return withWalls(level, walls);
}

function findWall(level: Level, id: string) {
  const wall = level.walls.find((w) => w.id === id);
  if (!wall) throw new Error('Ce mur n’existe plus.');
  return wall;
}

function assertOpeningsFit(wall: Wall) {
  const length = wallLength(wall);
  if (wall.openings?.some((o) => o.offset + o.width > length + 0.001))
    throw new Error('L’ouverture dépasse le bout du mur.');
}

export function setWallThickness(level: Level, id: string, thickness: number): Level {
  findWall(level, id);
  if (!(thickness > 0 && thickness <= 1))
    throw new Error('L’épaisseur doit être comprise entre 0 et 1 m.');
  return withWalls(
    level,
    level.walls.map((w) => (w.id === id ? { ...w, thickness } : w)),
  );
}

/** Moves the wall's end corner along its axis; the walls meeting at that corner follow it. */
export function setWallLength(level: Level, id: string, length: number): Level {
  const wall = findWall(level, id);
  if (!(length > 0)) throw new Error('La longueur doit être positive.');
  const current = wallLength(wall);
  const old = wall.end;
  const end: Point2 = [
    wall.start[0] + ((old[0] - wall.start[0]) * length) / current,
    wall.start[1] + ((old[1] - wall.start[1]) * length) / current,
  ];
  const same = (p: Point2) => Math.hypot(p[0] - old[0], p[1] - old[1]) < 1e-6;
  const walls = level.walls.map((w) =>
    same(w.start) || same(w.end)
      ? { ...w, start: same(w.start) ? end : w.start, end: same(w.end) ? end : w.end }
      : w,
  );
  walls.forEach(assertOpeningsFit);
  return withWalls(level, walls);
}

/**
 * Slides a wall along its normal by `delta` metres. Walls meeting its ends keep their direction
 * and stretch to it; partitions ending on it follow; an end on another wall slides along it.
 */
export function moveWall(level: Level, id: string, delta: number): Level {
  const wall = findWall(level, id);
  if (!Number.isFinite(delta)) throw new Error('Le déplacement doit être une distance.');
  const u = unit(wall);
  const n: Point2 = [-u[1], u[0]];
  const shift = (p: Point2): Point2 => [p[0] + n[0] * delta, p[1] + n[1] * delta];
  const origin = shift(wall.start);
  const others = level.walls.filter((w) => w !== wall);
  const moves: EndMoves = new Map();
  const end = (p: Point2): Point2 => {
    const sharing = others.filter((w) => same(w.start, p) || same(w.end, p));
    const hosts = others.filter((w) => interiorOffset(w, p) !== undefined);
    for (const guide of [...sharing, ...hosts]) {
      const q = crossing(origin, u, guide);
      if (!q) continue;
      if (hosts.includes(guide)) {
        const { along, length } = project(guide, q);
        if (along <= ENDS || along >= length - ENDS)
          throw new Error('Le mur dépasse le mur auquel il est raccordé.');
      }
      for (const w of sharing) moveEnd(moves, w, p, q);
      return q;
    }
    return shift(p);
  };
  moves.set(wall.id, { start: end(wall.start), end: end(wall.end) });
  for (const w of others)
    for (const p of [w.start, w.end]) {
      if (interiorOffset(wall, p) === undefined) continue;
      const q = crossing(origin, u, w);
      if (!q) throw new Error('Un mur parallèle empêche ce déplacement.');
      moveEnd(moves, w, p, q);
    }
  return relocate(level, moves);
}

/** Moves the corner at `from` to `to`; every wall ending there follows. */
export function moveCorner(level: Level, from: Point2, to: Point2): Level {
  const moves: EndMoves = new Map();
  for (const wall of level.walls)
    if (same(wall.start, from) || same(wall.end, from)) moveEnd(moves, wall, from, to);
  if (!moves.size) throw new Error('Cet angle n’existe plus.');
  return relocate(level, moves);
}

/** Cuts a wall in two at `offset` metres from its start; the second part gets a new id. */
export function splitWall(level: Level, id: string, offset: number): Level {
  const wall = findWall(level, id);
  const length = wallLength(wall);
  if (!(offset > 0.01 && offset < length - 0.01))
    throw new Error('Coupez le mur entre ses deux extrémités.');
  const openings = wall.openings ?? [];
  if (openings.some((o) => o.offset < offset - 1e-9 && o.offset + o.width > offset + 1e-9))
    throw new Error('Le point de coupe tombe dans une ouverture.');
  const u = unit(wall);
  const p: Point2 = [wall.start[0] + u[0] * offset, wall.start[1] + u[1] * offset];
  const ids = new Set(level.walls.map((w) => w.id));
  let n = ids.size + 1;
  while (ids.has(`wall-${n}`)) n++;
  const first: Wall = { ...wall, end: p, openings: openings.filter((o) => o.offset < offset) };
  const second: Wall = {
    ...wall,
    id: `wall-${n}`,
    start: p,
    openings: openings
      .filter((o) => o.offset >= offset)
      .map((o) => ({ ...o, offset: o.offset - offset })),
  };
  // Paint on the cut wall's faces carries over to both parts.
  const rooms = level.rooms.map((room) =>
    room.wallFaces?.some((f) => f.wallId === id)
      ? {
          ...room,
          wallFaces: room.wallFaces.flatMap((f) =>
            f.wallId === id ? [f, { ...f, wallId: second.id }] : [f],
          ),
        }
      : room,
  );
  const walls = [...level.walls.map((w) => (w === wall ? first : w)), second];
  return withWalls({ ...level, rooms }, walls);
}

export function deleteWall(level: Level, id: string): Level {
  findWall(level, id);
  return withWalls(
    level,
    level.walls.filter((w) => w.id !== id),
  );
}

export function updateRoom(
  level: Level,
  id: string,
  change: Partial<Pick<Room, 'name' | 'kind'>>,
): Level {
  if (change.name !== undefined && !change.name.trim())
    throw new Error('Le nom de la pièce ne peut pas être vide.');
  const name = change.name?.trim();
  return {
    ...level,
    rooms: level.rooms.map((r) =>
      r.id === id ? { ...r, ...change, ...(name !== undefined ? { name } : {}) } : r,
    ),
  };
}

/** Measurements of a newly placed opening, before the inspector adjusts them. */
const NEW_OPENINGS = {
  door: { width: 0.9, height: 2.05, hinge: 'start', swing: 1 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
} as const;

/**
 * Places a door or a window centred `at` metres along a wall, kept inside its ends; with a
 * `step`, its distance from the wall start is rounded to it.
 */
export function addOpening(
  level: Level,
  wallId: string,
  kind: 'door' | 'window',
  at: number,
  id: string,
  step?: number,
): Level {
  const wall = findWall(level, wallId);
  const measurements = NEW_OPENINGS[kind];
  const length = wallLength(wall);
  if (measurements.width > length + 0.001)
    throw new Error('Le mur est trop court pour cette ouverture.');
  const wanted = at - measurements.width / 2;
  // Dividing by the step count keeps k/20 as the nearest double, unlike k × 0.05.
  const rounded = step ? Math.round(wanted / step) / (1 / step) : wanted;
  const distance = Math.min(Math.max(rounded, 0), length - measurements.width);
  const opening = editOpening(wall, id, {
    ...measurements,
    kind,
    reference: 'start',
    distance: Math.max(0, distance),
  });
  return {
    ...level,
    walls: level.walls.map((w) =>
      w.id === wallId ? { ...w, openings: [...(w.openings ?? []), opening] } : w,
    ),
  };
}

/** Slides an opening along its wall to `offset` metres from the wall start. */
export function moveOpening(level: Level, wallId: string, id: string, offset: number): Level {
  return updateOpening(level, wallId, id, { reference: 'start', distance: offset });
}

/** Changes some measurements of an opening; the others keep their exact stored values. */
export function updateOpening(
  level: Level,
  wallId: string,
  id: string,
  change: Partial<OpeningMeasurements>,
): Level {
  const wall = findWall(level, wallId);
  const source = wall.openings?.find((o) => o.id === id);
  if (!source) throw new Error('Cette ouverture n’existe plus.');
  const width = change.width ?? source.width;
  const reference = change.reference ?? 'start';
  const distance =
    change.distance ??
    (reference === 'end' ? wallLength(wall) - width - source.offset : source.offset);
  const { offset: _, id: __, exterior: ___, ...stored } = source;
  const opening = editOpening(wall, id, { ...stored, ...change, width, reference, distance });
  return {
    ...level,
    walls: level.walls.map((w) =>
      w.id === wallId ? { ...w, openings: w.openings!.map((o) => (o.id === id ? opening : o)) } : w,
    ),
  };
}

export function deleteOpening(level: Level, wallId: string, id: string): Level {
  return {
    ...level,
    walls: level.walls.map((w) =>
      w.id === wallId ? { ...w, openings: (w.openings ?? []).filter((o) => o.id !== id) } : w,
    ),
  };
}
