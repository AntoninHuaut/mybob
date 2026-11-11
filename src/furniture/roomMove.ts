import type { Level, Point2, Room, Wall } from '../model/types';
import { bounds, pointInPolygon } from '../model/geometry';
import { footprint, footprintParts, validateFurnitureList, type FurnitureItem } from './model';
import { groupMembers } from './groups';
import { findFurniturePlacement, getBuildingPlacementIssues } from './placement';

export type RoomMoveResult = { ok: true; items: FurnitureItem[] } | { ok: false; reason: string };

const cm = (metres: number) => Math.max(1, Math.ceil(metres * 100));

/**
 * Moves a piece (and its linked set, rigidly) into another room without touching any
 * dimension: the piece lands on the free spot of that room nearest to where it was. The
 * walls still decide; clearances are never required. A refusal says why.
 */
export function moveFurnitureToRoom(
  items: FurnitureItem[],
  level: Level,
  id: string,
  roomId: string,
): RoomMoveResult {
  return relocate(items, level, id, roomId);
}

/**
 * A drag released over another room: the piece lands on the valid spot of that room nearest
 * to `target` (where the pointer would put its centre). Like a drag, only the building is
 * mandatory: overlapping another piece stays an editable diagnostic.
 */
export function dropFurnitureInRoom(
  items: FurnitureItem[],
  level: Level,
  id: string,
  roomId: string,
  target: Point2,
): RoomMoveResult {
  return relocate(items, level, id, roomId, target);
}

function relocate(
  items: FurnitureItem[],
  level: Level,
  id: string,
  roomId: string,
  target?: Point2,
): RoomMoveResult {
  const room = level.rooms.find((candidate) => candidate.id === roomId);
  const item = items.find((candidate) => candidate.id === id);
  if (!room || !item) return { ok: false, reason: 'Cette pièce ou ce meuble n’existe plus.' };
  const members = groupMembers(items, id);
  if (members.some((member) => member.locked))
    return { ok: false, reason: 'Un meuble verrouillé ne peut pas être déplacé.' };
  if (pointInPolygon(item.position, room.polygon))
    return { ok: false, reason: `Ce meuble est déjà dans « ${room.name} ».` };

  const memberIds = new Set(members.map((member) => member.id));
  // A drop ignores the other pieces, like the drag it ends; the menu action avoids them.
  const others = target ? [] : items.filter((other) => !memberIds.has(other.id));
  // A linked set moves rigidly: a spot only counts when every member fits there.
  const shifted = (anchor: FurnitureItem, member: FurnitureItem): FurnitureItem => ({
    ...member,
    position: [
      member.position[0] + anchor.position[0] - item.position[0],
      member.position[1] + anchor.position[1] - item.position[1],
    ],
  });
  const setFits = (anchor: FurnitureItem) =>
    members.every((member) => !getBuildingPlacementIssues(shifted(anchor, member), level).length);
  const start = target ? { ...item, position: [...target] as Point2 } : item;
  const placed = findFurniturePlacement(start, level, others, room, setFits);
  if (!placed)
    return {
      ok: false,
      reason: explainNoPlace(item, level, others, room, members.length > 1, setFits),
    };
  const moved = items.map((other) => (memberIds.has(other.id) ? shifted(placed, other) : other));
  return { ok: true, items: validateFurnitureList(moved) };
}

/** Why the search found nothing: too big for the room, room taken, or walls in the way. */
function explainNoPlace(
  item: FurnitureItem,
  level: Level,
  others: FurnitureItem[],
  room: Room,
  linked: boolean,
  setFits: (anchor: FurnitureItem) => boolean,
): string {
  const box = bounds(room.polygon);
  const relative = footprint({ ...item, position: [0, 0] });
  const width = Math.max(...relative.map((p) => p[0])) - Math.min(...relative.map((p) => p[0]));
  const depth = Math.max(...relative.map((p) => p[1])) - Math.min(...relative.map((p) => p[1]));
  // Turned a quarter, the width and the depth swap: the smaller overshoot is the real one.
  const overshoot = Math.min(
    Math.max(width - box.width, depth - box.depth),
    Math.max(depth - box.width, width - box.depth),
  );
  if (overshoot > 0.001)
    return `Ce meuble est trop grand de ${cm(overshoot)} cm pour « ${room.name} », même tourné.`;
  if (linked && findFurniturePlacement(item, level, others, room)) {
    // The piece alone fits but its linked set does not.
    return `L’ensemble lié à ce meuble ne tient pas dans « ${room.name} » : séparez-les d’abord.`;
  }
  if (others.length && findFurniturePlacement(item, level, [], room, setFits))
    return `Il n’y a plus de place libre dans « ${room.name} » : d’autres meubles l’occupent.`;
  return `Aucun emplacement valide dans « ${room.name} » : les murs, vitrages et linteaux ne laissent pas la place.`;
}

/** How far a back may stand off a partition face and still count as against it. */
const AGAINST = 0.1;

function axis(wall: Wall) {
  const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const u: Point2 = [
    (wall.end[0] - wall.start[0]) / length,
    (wall.end[1] - wall.start[1]) / length,
  ];
  const along = (p: Point2) => (p[0] - wall.start[0]) * u[0] + (p[1] - wall.start[1]) * u[1];
  const across = (p: Point2) => (p[0] - wall.start[0]) * -u[1] + (p[1] - wall.start[1]) * u[0];
  return { length, u, n: [-u[1], u[0]] as Point2, along, across };
}

/** The interior partition the piece's back stands against, if any. */
export function partitionBehind(item: FurnitureItem, level: Level): Wall | undefined {
  // Front is local +Z: the back points the other way.
  const back: Point2 = [-Math.sin(item.rotation), -Math.cos(item.rotation)];
  const corners = footprintParts(item).flat();
  let best: { wall: Wall; gap: number } | undefined;
  for (const wall of level.walls) {
    if (wall.exterior) continue;
    const { length, u, n, along, across } = axis(wall);
    if (!(length > 1e-6)) continue;
    if (Math.abs(back[0] * u[0] + back[1] * u[1]) > 0.035) continue; // not parallel (> 2°)
    const side = Math.sign(across(item.position));
    // The back must face the wall, and the piece must stand along it, not past its end.
    if (!side || side * (back[0] * n[0] + back[1] * n[1]) > 0) continue;
    const t = along(item.position);
    if (t < 0 || t > length) continue;
    const gap = Math.min(...corners.map((p) => side * across(p))) - wall.thickness / 2;
    if (gap < -0.005 || gap > AGAINST) continue;
    if (!best || gap < best.gap) best = { wall, gap };
  }
  return best?.wall;
}

/**
 * « Retourner contre l’autre face »: the piece (and its linked set) turns half a turn around
 * the point of the partition axis behind it, so it stands against the other face with the
 * same gap, every dimension unchanged. The walls still decide on the other side.
 */
export function flipAgainstPartition(
  items: FurnitureItem[],
  level: Level,
  id: string,
): RoomMoveResult {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return { ok: false, reason: 'Ce meuble n’existe plus.' };
  const members = groupMembers(items, id);
  if (members.some((member) => member.locked))
    return { ok: false, reason: 'Un meuble verrouillé ne peut pas être déplacé.' };
  const wall = partitionBehind(item, level);
  if (!wall)
    return {
      ok: false,
      reason:
        'Ce meuble n’est pas adossé à une cloison : placez son dos contre elle (10 cm au plus).',
    };
  const { u, along } = axis(wall);
  const t = along(item.position);
  const pivot: Point2 = [wall.start[0] + u[0] * t, wall.start[1] + u[1] * t];
  const turn = 2 * Math.PI;
  const memberIds = new Set(members.map((member) => member.id));
  const flipped = items.map((other) =>
    memberIds.has(other.id)
      ? {
          ...other,
          position: [2 * pivot[0] - other.position[0], 2 * pivot[1] - other.position[1]] as Point2,
          rotation: (((other.rotation + Math.PI) % turn) + turn) % turn,
        }
      : other,
  );
  const blocked = flipped.some(
    (other) => memberIds.has(other.id) && getBuildingPlacementIssues(other, level).length,
  );
  if (blocked)
    return {
      ok: false,
      reason:
        members.length > 1
          ? 'De l’autre côté de la cloison, l’ensemble lié heurte un mur, une ouverture ou le contour.'
          : 'De l’autre côté de la cloison, la place est prise par un mur, une ouverture ou le contour.',
    };
  return { ok: true, items: validateFurnitureList(flipped) };
}
