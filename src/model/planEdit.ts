import { pointInPolygon, wallLength } from './geometry';
import { editOpening, type OpeningMeasurements } from './openingEdit';
import { deriveRooms } from './roomDerivation';
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
  return { ...level, walls, rooms: deriveRooms(walls, level.rooms) };
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
