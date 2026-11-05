import { loadLayout, saveLayout, layoutStorageKey, validateFurnitureList } from './model';
import type { FurnitureItem } from './model';

/** Retain failed writes across level/project switches, until saved or explicitly replaced. */
export class LayoutSession {
  private pending = new Map<string, FurnitureItem[]>();

  get hasUnsaved() {
    return this.pending.size > 0;
  }

  load(projectId: string, levelId: string): FurnitureItem[] {
    const items = this.pending.get(layoutStorageKey(projectId, levelId));
    return items ? structuredClone(items) : loadLayout(projectId, levelId);
  }

  save(projectId: string, levelId: string, items: FurnitureItem[]) {
    const key = layoutStorageKey(projectId, levelId);
    const next = validateFurnitureList(items);
    // Keep the valid snapshot before attempting storage; callers can still export it.
    this.pending.set(key, next);
    saveLayout(projectId, levelId, next);
    this.pending.delete(key);
  }

  forget(projectId: string, levelId: string) {
    const key = layoutStorageKey(projectId, levelId);
    const previous = this.pending.get(key);
    this.pending.delete(key);
    return previous ? structuredClone(previous) : undefined;
  }

  retain(projectId: string, levelId: string, items: FurnitureItem[]) {
    this.pending.set(layoutStorageKey(projectId, levelId), validateFurnitureList(items));
  }
}
