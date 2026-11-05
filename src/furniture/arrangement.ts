import type { Level } from '../model/types';
import { bounds } from '../model/geometry';
import { footprintParts, validateFurnitureList, type FurnitureItem } from './model';
import { applyFurnitureTransform, constrainGroupDrag, groupMembers } from './groups';
import { getBuildingPlacementIssues } from './placement';
import { snapFurniture } from './checks';

export type ArrangementAxis = 'x' | 'z';
export type AlignmentEdge = 'min' | 'center' | 'max';
export interface SnapSettings {
  grid: boolean;
  walls: boolean;
  gridSize: number;
}
export const defaultSnapSettings: SnapSettings = { grid: false, walls: false, gridSize: 0.1 };

function units(items: FurnitureItem[], ids: string[]) {
  const selected = new Set(ids);
  if (ids.some((id) => !items.some((item) => item.id === id)))
    throw new Error('La sélection contient un meuble qui n’existe plus.');
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    if (seen.has(id)) return [];
    const members = groupMembers(items, id);
    if (members.some((item) => !selected.has(item.id)))
      throw new Error('Cochez tous les meubles de chaque ensemble lié avant de les aligner.');
    if (members.some((item) => item.locked))
      throw new Error('Déverrouillez les meubles sélectionnés avant de les placer.');
    members.forEach((item) => seen.add(item.id));
    return [{ leader: id, box: bounds(members.flatMap((item) => footprintParts(item).flat())) }];
  });
}

function extent(unit: ReturnType<typeof units>[number], axis: ArrangementAxis) {
  return axis === 'x'
    ? { min: unit.box.minX, max: unit.box.maxX }
    : { min: unit.box.minZ, max: unit.box.maxZ };
}

function move(items: FurnitureItem[], id: string, axis: ArrangementAxis, delta: number) {
  const item = items.find((item) => item.id === id)!;
  const position: [number, number] = [...item.position];
  position[axis === 'x' ? 0 : 1] += delta;
  return applyFurnitureTransform(items, { ...item, position });
}

function validatePlacement(before: FurnitureItem[], after: FurnitureItem[], level: Level) {
  for (const item of after) {
    const old = before.find((old) => old.id === item.id)!;
    if (old.position.every((value, axis) => Math.abs(value - item.position[axis]) < 1e-9)) continue;
    const issue = getBuildingPlacementIssues(item, level)[0];
    if (issue) throw new Error(`Placement impossible pour « ${item.name} » : ${issue.message}`);
  }
  return after;
}

/** Linked furniture forms one indivisible unit; the first selected unit is the reference. */
export function alignFurniture(
  input: FurnitureItem[],
  ids: string[],
  level: Level,
  axis: ArrangementAxis,
  edge: AlignmentEdge,
): FurnitureItem[] {
  const items = validateFurnitureList(input);
  const selected = units(items, ids);
  if (selected.length < 2) throw new Error('Sélectionnez au moins deux meubles ou ensembles.');
  const coordinate = (unit: (typeof selected)[number]) => {
    const box = extent(unit, axis);
    return edge === 'center' ? (box.min + box.max) / 2 : box[edge];
  };
  const target = coordinate(selected[0]);
  let next = items;
  for (const unit of selected.slice(1))
    next = move(next, unit.leader, axis, target - coordinate(unit));
  return validatePlacement(items, next, level);
}

/** Equal clear gaps between oriented footprint bounds; outermost units stay fixed. */
export function distributeFurniture(
  input: FurnitureItem[],
  ids: string[],
  level: Level,
  axis: ArrangementAxis,
): FurnitureItem[] {
  const items = validateFurnitureList(input);
  const selected = units(items, ids).sort((a, b) => extent(a, axis).min - extent(b, axis).min);
  if (selected.length < 3) throw new Error('Sélectionnez au moins trois meubles ou ensembles.');
  const first = extent(selected[0], axis);
  const last = extent(selected.at(-1)!, axis);
  const total = selected.reduce((sum, unit) => {
    const box = extent(unit, axis);
    return sum + box.max - box.min;
  }, 0);
  const gap = (last.max - first.min - total) / (selected.length - 1);
  if (gap < -1e-9) throw new Error('Écartez les meubles extrêmes pour laisser assez de place.');
  let cursor = first.max + Math.max(0, gap);
  let next = items;
  for (const unit of selected.slice(1, -1)) {
    const box = extent(unit, axis);
    next = move(next, unit.leader, axis, cursor - box.min);
    cursor += box.max - box.min + Math.max(0, gap);
  }
  return validatePlacement(items, next, level);
}

/** items already contains the candidate drag transform, including its linked members. */
export function snapDraggedFurniture(
  item: FurnitureItem,
  level: Level,
  items: FurnitureItem[],
  settings: SnapSettings,
): FurnitureItem {
  if (item.locked || (!settings.grid && !settings.walls)) return structuredClone(item);
  let next = structuredClone(item);
  if (
    settings.grid &&
    Number.isFinite(settings.gridSize) &&
    settings.gridSize >= 0.01 &&
    settings.gridSize <= 1
  )
    next.position = next.position.map(
      (value) => Math.round(value / settings.gridSize) * settings.gridSize,
    ) as [number, number];
  if (settings.walls) next = snapFurniture(next, level, [], 0.12);
  try {
    const base = items.map((other) => (other.id === item.id ? structuredClone(item) : other));
    const moved = constrainGroupDrag(base, item.id, next.position, level);
    const snapped = moved.find((other) => other.id === item.id)!;
    if (snapped.position.some((value, axis) => Math.abs(value - next.position[axis]) > 1e-7))
      return structuredClone(item);
    if (
      groupMembers(moved, item.id).some(
        (member) => getBuildingPlacementIssues(member, level).length,
      )
    )
      return structuredClone(item);
    return snapped;
  } catch {
    return structuredClone(item);
  }
}
