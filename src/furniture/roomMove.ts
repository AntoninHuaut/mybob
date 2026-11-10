import type { Level, Room } from '../model/types';
import { bounds, pointInPolygon } from '../model/geometry';
import { footprint, validateFurnitureList, type FurnitureItem } from './model';
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
  const room = level.rooms.find((candidate) => candidate.id === roomId);
  const item = items.find((candidate) => candidate.id === id);
  if (!room || !item) return { ok: false, reason: 'Cette pièce ou ce meuble n’existe plus.' };
  const members = groupMembers(items, id);
  if (members.some((member) => member.locked))
    return { ok: false, reason: 'Un meuble verrouillé ne peut pas être déplacé.' };
  if (pointInPolygon(item.position, room.polygon))
    return { ok: false, reason: `Ce meuble est déjà dans « ${room.name} ».` };

  const memberIds = new Set(members.map((member) => member.id));
  const others = items.filter((other) => !memberIds.has(other.id));
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
  const placed = findFurniturePlacement(item, level, others, room, setFits);
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
