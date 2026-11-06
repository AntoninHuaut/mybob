import { loadLayout, validateFurnitureList, type FurnitureItem } from './model';

export interface LayoutVariant {
  id: string;
  name: string;
  levels: Record<string, FurnitureItem[]>;
}
export interface VariantBook {
  version: 1;
  activeId: string;
  variants: LayoutVariant[];
}
interface Entry {
  book: VariantBook;
  dirty: boolean;
}
export const variantsStorageKey = (projectId: string) =>
  `maison-atelier:variants:v1:${encodeURIComponent(projectId)}`;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100;
function variantName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60)
    throw new Error('Donnez à la variante un nom de 1 à 60 caractères.');
  return value.trim();
}

export function validateVariantBook(input: unknown, levelIds: string[]): VariantBook {
  if (
    !record(input) ||
    input.version !== 1 ||
    !identifier(input.activeId) ||
    !Array.isArray(input.variants) ||
    !input.variants.length ||
    input.variants.length > 10
  )
    throw new Error('Les variantes d’aménagement sont invalides (1 à 10 variantes).');
  const ids = new Set<string>();
  const variants = input.variants.map((value): LayoutVariant => {
    if (!record(value) || !identifier(value.id) || ids.has(value.id) || !record(value.levels))
      throw new Error('Identifiant ou niveaux de variante invalides.');
    ids.add(value.id);
    if (Object.keys(value.levels).some((id) => !levelIds.includes(id)))
      throw new Error('Une variante contient un niveau absent du projet.');
    return {
      id: value.id,
      name: variantName(value.name),
      levels: Object.fromEntries(
        levelIds.map((id) => [
          id,
          Object.hasOwn(value.levels as object, id)
            ? validateFurnitureList((value.levels as Record<string, unknown>)[id])
            : [],
        ]),
      ),
    };
  });
  if (!ids.has(input.activeId)) throw new Error('La variante active est introuvable.');
  return { version: 1, activeId: input.activeId, variants };
}

/** One atomic document per project; old single-layout keys remain untouched as a backup. */
export class VariantSession {
  private entries = new Map<string, Entry>();
  private levels = new Map<string, string[]>();
  get hasUnsaved() {
    return [...this.entries.values()].some((entry) => entry.dirty);
  }
  register(projectId: string, levelIds: string[]) {
    this.levels.set(projectId, [...levelIds]);
  }
  private ensure(projectId: string): Entry {
    const cached = this.entries.get(projectId);
    if (cached) return cached;
    const levelIds = this.levels.get(projectId);
    if (!levelIds) throw new Error('Projet de variantes non chargé.');
    const text = localStorage.getItem(variantsStorageKey(projectId));
    const book: VariantBook = text
      ? validateVariantBook(JSON.parse(text), levelIds)
      : {
          version: 1,
          activeId: 'initial',
          variants: [
            {
              id: 'initial',
              name: 'Aménagement initial',
              levels: Object.fromEntries(levelIds.map((id) => [id, loadLayout(projectId, id)])),
            },
          ],
        };
    const entry = { book, dirty: false };
    this.entries.set(projectId, entry);
    return entry;
  }
  book(projectId: string): VariantBook {
    return structuredClone(this.ensure(projectId).book);
  }
  active(projectId: string): LayoutVariant {
    const book = this.ensure(projectId).book;
    return structuredClone(book.variants.find((variant) => variant.id === book.activeId)!);
  }
  load(projectId: string, levelId: string): FurnitureItem[] {
    const active = this.active(projectId);
    return Object.hasOwn(active.levels, levelId) ? active.levels[levelId] : [];
  }
  private persist(projectId: string) {
    const entry = this.ensure(projectId);
    entry.dirty = true;
    try {
      localStorage.setItem(variantsStorageKey(projectId), JSON.stringify(entry.book));
    } catch {
      throw new Error(
        'Variante conservée dans cette session mais non sauvegardée : exportez le projet avant de fermer.',
      );
    }
    entry.dirty = false;
  }
  save(projectId: string, levelId: string, items: FurnitureItem[]) {
    const next = validateFurnitureList(items);
    if (!this.levels.get(projectId)?.includes(levelId))
      throw new Error('Niveau de variante inconnu.');
    const book = this.ensure(projectId).book;
    book.variants.find((variant) => variant.id === book.activeId)!.levels[levelId] = next;
    this.persist(projectId);
  }
  select(projectId: string, id: string) {
    const book = this.ensure(projectId).book;
    if (!book.variants.some((variant) => variant.id === id))
      throw new Error('Variante introuvable.');
    book.activeId = id;
    this.persist(projectId);
  }
  duplicate(projectId: string, name: string) {
    const book = this.ensure(projectId).book;
    const title = variantName(name);
    if (book.variants.length >= 10)
      throw new Error('Vous pouvez conserver jusqu’à 10 variantes par projet.');
    if (book.variants.some((v) => v.name.toLocaleLowerCase() === title.toLocaleLowerCase()))
      throw new Error('Ce nom de variante est déjà utilisé.');
    const clone = this.active(projectId);
    clone.id = crypto.randomUUID();
    clone.name = title;
    book.variants.push(clone);
    book.activeId = clone.id;
    this.persist(projectId);
  }
  rename(projectId: string, name: string) {
    const book = this.ensure(projectId).book;
    const title = variantName(name);
    if (
      book.variants.some(
        (v) => v.id !== book.activeId && v.name.toLocaleLowerCase() === title.toLocaleLowerCase(),
      )
    )
      throw new Error('Ce nom de variante est déjà utilisé.');
    book.variants.find((variant) => variant.id === book.activeId)!.name = title;
    this.persist(projectId);
  }
  deleteActive(projectId: string) {
    const book = this.ensure(projectId).book;
    if (book.variants.length <= 1) throw new Error('Conservez au moins une variante.');
    const index = book.variants.findIndex((variant) => variant.id === book.activeId);
    book.variants.splice(index, 1);
    book.activeId = book.variants[Math.min(index, book.variants.length - 1)].id;
    this.persist(projectId);
  }
  capture(projectId: string): Entry | undefined {
    const entry = this.entries.get(projectId);
    return entry ? structuredClone(entry) : undefined;
  }
  restore(projectId: string, entry: Entry | undefined) {
    if (entry) this.entries.set(projectId, structuredClone(entry));
    else this.entries.delete(projectId);
  }
  install(projectId: string, book: VariantBook) {
    this.entries.set(projectId, { book: structuredClone(book), dirty: false });
  }
  forgetProject(projectId: string) {
    this.entries.delete(projectId);
    this.levels.delete(projectId);
  }
  prepareImport(
    projectId: string,
    levelIds: string[],
    staged: [string, FurnitureItem[]][],
    incoming?: unknown,
  ): VariantBook {
    if (incoming !== undefined) return validateVariantBook(incoming, levelIds);
    // A legacy import updates the active layout, preserving other named variants.
    if (!this.levels.has(projectId)) this.register(projectId, levelIds);
    let book: VariantBook;
    try {
      book = this.book(projectId);
    } catch {
      if (!levelIds.every((id) => staged.some(([stagedId]) => stagedId === id)))
        throw new Error(
          'Les variantes locales sont illisibles. Importez un export complet des meubles pour les restaurer.',
        );
      book = {
        version: 1,
        activeId: 'initial',
        variants: [
          {
            id: 'initial',
            name: 'Aménagement restauré',
            levels: Object.fromEntries(staged),
          },
        ],
      };
    }
    for (const variant of book.variants)
      variant.levels = Object.fromEntries(
        levelIds.map((id) => [id, Object.hasOwn(variant.levels, id) ? variant.levels[id] : []]),
      );
    const active = book.variants.find((variant) => variant.id === book.activeId)!;
    for (const [id, items] of staged) active.levels[id] = validateFurnitureList(items);
    return validateVariantBook(book, levelIds);
  }
}
