import type { Level, Point2 } from '../model/types';
import { validateFurnitureList, type FurnitureItem } from './model';
import { constrainFurnitureDrag, getBuildingPlacementIssues } from './placement';

const EPS = 1e-8;
const copy = (items: FurnitureItem[]) => structuredClone(items);
const sameNumber = (a: number, b: number) => Math.abs(a - b) < EPS;
const angleDelta = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

function selectedItem(items: FurnitureItem[], id: string): FurnitureItem {
  const item = items.find((item) => item.id === id);
  if (!item) throw new Error('Le meuble sélectionné n’existe plus.');
  return item;
}

/** The id is a furniture id; an unlinked furniture item is its own selection. */
export function groupMembers(items: FurnitureItem[], id: string): FurnitureItem[] {
  const selected = items.find((item) => item.id === id);
  if (!selected) return [];
  return copy(
    selected.groupId ? items.filter((item) => item.groupId === selected.groupId) : [selected],
  );
}

/** Merge both existing groups, or create one group for two individual objects. */
export function linkFurniture(items: FurnitureItem[], a: string, b: string): FurnitureItem[] {
  const next = validateFurnitureList(items);
  if (a === b) throw new Error('Choisissez deux meubles différents à lier.');
  const first = selectedItem(next, a),
    second = selectedItem(next, b);
  if (first.groupId && first.groupId === second.groupId) return next;
  const groups = new Set([first.groupId, second.groupId].filter((id): id is string => !!id));
  const used = new Set(next.flatMap((item) => (item.groupId ? [item.groupId] : [])));
  const token =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const base = `groupe-${token}`;
  let groupId = base,
    suffix = 1;
  while (used.has(groupId)) groupId = `${base}-${suffix++}`;
  return next.map((item) =>
    item.id === a || item.id === b || (item.groupId && groups.has(item.groupId))
      ? { ...item, groupId }
      : item,
  );
}

/** Unlink the whole selected group. Locking affects geometry, not this metadata action. */
export function unlinkFurniture(items: FurnitureItem[], id: string): FurnitureItem[] {
  const next = validateFurnitureList(items),
    selected = selectedItem(next, id);
  if (!selected.groupId) return next;
  return next.map((item) => {
    if (item.groupId !== selected.groupId) return item;
    const result = { ...item };
    delete result.groupId;
    return result;
  });
}

function geometryChanged(a: FurnitureItem, b: FurnitureItem): boolean {
  return (
    !sameNumber(a.position[0], b.position[0]) ||
    !sameNumber(a.position[1], b.position[1]) ||
    !sameNumber(angleDelta(a.rotation - b.rotation), 0) ||
    !sameNumber(a.elevation ?? 0, b.elevation ?? 0) ||
    !sameNumber(a.width, b.width) ||
    !sameNumber(a.depth, b.depth) ||
    !sameNumber(a.height, b.height) ||
    JSON.stringify(a.sofa) !== JSON.stringify(b.sofa)
  );
}

/**
 * Translate/rotate around the selected object's previous centre, then apply its
 * change in base height to all linked objects. Resizing only affects that object.
 * The returned snapshot is atomic; callers validate building fit before committing.
 */
export function applyFurnitureTransform(
  items: FurnitureItem[],
  updated: FurnitureItem,
): FurnitureItem[] {
  const current = validateFurnitureList(items);
  const previous = selectedItem(current, updated.id);
  const replacement = validateFurnitureList([updated])[0];
  // Link/unlink are explicit actions, not side effects of a property edit.
  if (previous.groupId) replacement.groupId = previous.groupId;
  else delete replacement.groupId;
  const angle = angleDelta(replacement.rotation - previous.rotation),
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const elevationDelta = (replacement.elevation ?? 0) - (previous.elevation ?? 0);
  const moves =
    !sameNumber(replacement.position[0], previous.position[0]) ||
    !sameNumber(replacement.position[1], previous.position[1]);
  const rotates = !sameNumber(angle, 0);
  const raises = !sameNumber(elevationDelta, 0);
  const memberIds = new Set(groupMembers(current, previous.id).map((item) => item.id));
  const result = current.map((item) => {
    if (!memberIds.has(item.id)) return item;
    if (item.id === replacement.id) return replacement;
    if (!moves && !rotates && !raises) return item;
    const dx = item.position[0] - previous.position[0],
      dz = item.position[1] - previous.position[1];
    const next = { ...item };
    if (rotates) {
      next.position = [
        replacement.position[0] + cos * dx + sin * dz,
        replacement.position[1] - sin * dx + cos * dz,
      ];
      next.rotation = item.rotation + angle;
    } else if (moves)
      next.position = [
        item.position[0] + replacement.position[0] - previous.position[0],
        item.position[1] + replacement.position[1] - previous.position[1],
      ];
    if (raises) next.elevation = (item.elevation ?? 0) + elevationDelta;
    return next;
  });
  for (const next of result) {
    const old = current.find((item) => item.id === next.id)!;
    if (old.locked && geometryChanged(old, next))
      throw new Error(
        `« ${old.name} » est verrouillé. Déverrouillez ce meuble pour déplacer le groupe.`,
      );
    if ((next.elevation ?? 0) < 0)
      throw new Error(
        'Ce déplacement ferait passer un meuble lié sous le sol. Déliez-le pour régler sa hauteur séparément.',
      );
  }
  return validateFurnitureList(result);
}

/** Stop every linked object at the earliest building collision encountered by any member. */
export function constrainGroupDrag(
  items: FurnitureItem[],
  selectedId: string,
  toPosition: Point2,
  level: Level,
): FurnitureItem[] {
  const current = validateFurnitureList(items),
    selected = selectedItem(current, selectedId);
  if (!Array.isArray(toPosition) || toPosition.length !== 2 || !toPosition.every(Number.isFinite))
    throw new Error('La position demandée n’est pas valide.');
  const dx = toPosition[0] - selected.position[0],
    dz = toPosition[1] - selected.position[1];
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared < EPS * EPS) return current;
  const members = groupMembers(current, selectedId);
  const locked = members.find((item) => item.locked);
  if (locked)
    throw new Error(
      `« ${locked.name} » est verrouillé. Déverrouillez ce meuble pour déplacer le groupe.`,
    );
  let fraction = 1;
  for (const member of members) {
    const proposed = {
      ...member,
      position: [member.position[0] + dx, member.position[1] + dz] as Point2,
    };
    const constrained = constrainFurnitureDrag(member, proposed, level);
    const travelled =
      ((constrained.position[0] - member.position[0]) * dx +
        (constrained.position[1] - member.position[1]) * dz) /
      distanceSquared;
    fraction = Math.min(fraction, Math.max(0, Math.min(1, travelled)));
  }
  const result = applyFurnitureTransform(current, {
    ...selected,
    position: [selected.position[0] + dx * fraction, selected.position[1] + dz * fraction],
  });
  // A legacy invalid member must escape completely; never move another member
  // while leaving a newly moved group member intersecting the building.
  const ids = new Set(members.map((item) => item.id));
  if (
    result.some(
      (item) =>
        ids.has(item.id) &&
        geometryChanged(selectedItem(current, item.id), item) &&
        getBuildingPlacementIssues(item, level).length,
    )
  )
    return current;
  return result;
}
