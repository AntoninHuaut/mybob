import type { Level, Room } from '../model/types';
import { pointInPolygon } from '../model/geometry';
import {
  createFurniture,
  footprintParts,
  validateFurnitureList,
  type FurnitureItem,
} from './model';
import {
  applyFurnitureTransform,
  constrainGroupDrag,
  linkFurniture,
  unlinkFurniture,
} from './groups';
import { fitFurnitureResize } from './resize';
import { checkFurniture, snapFurniture } from './checks';
import { findFurniturePlacement, getBuildingPlacementIssues } from './placement';

const geometryChanged = (before: FurnitureItem | undefined, after: FurnitureItem) =>
  !before ||
  before.width !== after.width ||
  before.depth !== after.depth ||
  before.height !== after.height ||
  (before.elevation ?? 0) !== (after.elevation ?? 0) ||
  before.rotation !== after.rotation ||
  before.position[0] !== after.position[0] ||
  before.position[1] !== after.position[1] ||
  JSON.stringify(before.sofa) !== JSON.stringify(after.sofa);

/** Isolated popup transaction. Only the caller's explicit Save commits this snapshot. */
export class FurnitureEditorDraft {
  private current: FurnitureItem[];
  private selection: string | undefined;
  private readonly level: Level;

  constructor(items: FurnitureItem[], level: Level, selectedId: string) {
    this.current = validateFurnitureList(items);
    this.level = structuredClone(level);
    this.selection = selectedId;
    this.requireSelected();
  }

  get items(): FurnitureItem[] {
    return structuredClone(this.current);
  }
  get selectedId(): string | undefined {
    return this.selection;
  }
  get selected(): FurnitureItem | undefined {
    const item = this.current.find((item) => item.id === this.selection);
    return item ? structuredClone(item) : undefined;
  }

  private requireSelected(): FurnitureItem {
    const selected = this.current.find((item) => item.id === this.selection);
    if (!selected) throw new Error('Aucun meuble n’est sélectionné dans ce brouillon.');
    return selected;
  }

  private stage(items: FurnitureItem[], selectedId = this.selection): void {
    const next = validateFurnitureList(items);
    const previous = new Map(this.current.map((item) => [item.id, item]));
    for (const item of next) {
      if (!geometryChanged(previous.get(item.id), item)) continue;
      const issue = getBuildingPlacementIssues(item, this.level)[0];
      if (issue) throw new Error(`Placement impossible : ${issue.message}`);
    }
    // Assign only after the whole candidate snapshot passes; failures leave no partial action.
    this.current = next;
    this.selection = selectedId;
  }

  update(item: FurnitureItem): void {
    const selected = this.requireSelected();
    if (item.id !== selected.id)
      throw new Error('Le meuble modifié ne correspond pas à la sélection du brouillon.');
    const adjusted = fitFurnitureResize(selected, item, this.level, (candidate) => {
      try {
        const moved = constrainGroupDrag(
          this.current,
          selected.id,
          candidate.position,
          this.level,
        ).find((member) => member.id === selected.id)!;
        if (
          Math.hypot(
            moved.position[0] - candidate.position[0],
            moved.position[1] - candidate.position[1],
          ) > 0.00001
        )
          return false;
        return applyFurnitureTransform(this.current, candidate).every(
          (member) =>
            !geometryChanged(
              this.current.find((old) => old.id === member.id),
              member,
            ) || !getBuildingPlacementIssues(member, this.level).length,
        );
      } catch {
        return false;
      }
    });
    this.stage(applyFurnitureTransform(this.current, adjusted));
  }

  link(otherId: string): void {
    this.stage(linkFurniture(this.current, this.requireSelected().id, otherId));
  }

  unlink(): void {
    this.stage(unlinkFurniture(this.current, this.requireSelected().id));
  }

  snap(): void {
    const selected = this.requireSelected();
    if (selected.locked)
      throw new Error('Ce meuble est verrouillé. Déverrouillez-le avant de le déplacer.');
    const next = snapFurniture(selected, this.level, this.current, 0.3);
    if (
      Math.hypot(next.position[0] - selected.position[0], next.position[1] - selected.position[1]) <
      0.00001
    )
      throw new Error('Rapprochez le meuble d’un mur ou d’un autre meuble avant de l’aligner.');
    this.stage(applyFurnitureTransform(this.current, next));
  }

  private preferredRoom(item: FurnitureItem): Room | undefined {
    const containing = this.level.rooms.find((room) => pointInPolygon(item.position, room.polygon));
    if (containing) return containing;
    // An L's bounding centre can be in its empty corner, outside the actual room contour.
    for (const part of footprintParts(item)) {
      const center: [number, number] = [
        part.reduce((sum, p) => sum + p[0], 0) / part.length,
        part.reduce((sum, p) => sum + p[1], 0) / part.length,
      ];
      const room = this.level.rooms.find((room) => pointInPolygon(center, room.polygon));
      if (room) return room;
    }
  }

  duplicate(): void {
    const selected = this.requireSelected();
    const source = structuredClone(selected);
    delete source.groupId;
    const duplicate = createFurniture({
      ...source,
      id: undefined,
      name: `${selected.name.slice(0, 151)} (copie)`,
      locked: false,
      elevation: selected.elevation ?? 0,
    });
    const placed = findFurniturePlacement(
      duplicate,
      this.level,
      this.current,
      this.preferredRoom(selected),
    );
    if (!placed)
      throw new Error(
        'Aucune place disponible pour cette copie dans la pièce. Déplacez un meuble ou ajustez ses dimensions.',
      );
    this.stage([...this.current, placed], placed.id);
  }

  addTelevision(): void {
    const stand = this.requireSelected();
    if (stand.kind !== 'tv-stand')
      throw new Error('Sélectionnez un meuble TV pour poser un téléviseur dessus.');
    const tv = createFurniture({
      kind: 'tv',
      position: [...stand.position],
      rotation: stand.rotation,
      elevation: (stand.elevation ?? 0) + stand.height,
    });
    const issue = checkFurniture([...this.current, tv], this.level).find(
      (issue) => issue.itemId === tv.id && issue.severity === 'error',
    );
    if (issue) throw new Error(`Impossible de poser le téléviseur ici : ${issue.message}`);
    this.stage(linkFurniture([...this.current, tv], tv.id, stand.id), tv.id);
  }

  remove(): void {
    const selected = this.requireSelected();
    if (selected.locked)
      throw new Error('Ce meuble est verrouillé. Déverrouillez-le avant de le supprimer.');
    let next = this.current.filter((item) => item.id !== selected.id);
    if (selected.groupId) {
      const remaining = next.filter((item) => item.groupId === selected.groupId);
      if (remaining.length === 1)
        next = next.map((item) => {
          if (item.id !== remaining[0].id) return item;
          const unlinked = { ...item };
          delete unlinked.groupId;
          return unlinked;
        });
    }
    this.stage(next, undefined);
    this.selection = undefined;
  }
}
