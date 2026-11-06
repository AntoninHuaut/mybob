import { createFurniture, validateFurnitureList, type FurnitureItem } from './model';

/** Session-local furniture clipboard; never replaces the OS clipboard or form editing. */
export class FurnitureClipboard {
  private copied?: FurnitureItem;

  copy(item: FurnitureItem) {
    this.copied = validateFurnitureList([item])[0];
  }

  paste(): FurnitureItem | undefined {
    if (!this.copied) return;
    return createFurniture({
      ...this.copied,
      id: undefined,
      groupId: undefined,
      locked: false,
      name: `${this.copied.name.slice(0, 151)} (copie)`,
      position: [...this.copied.position],
    });
  }
}
