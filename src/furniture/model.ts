import type { Point2 } from '../model/types';
import { televisionDimensions } from './television';
export { televisionDimensions };

export type FurnitureKind =
  | 'sofa'
  | 'table'
  | 'chair'
  | 'bed'
  | 'wardrobe'
  | 'dressing'
  | 'desk'
  | 'cabinet'
  | 'custom'
  | 'tv-stand'
  | 'tv'
  | 'coffee-table'
  | 'bookcase'
  | 'ottoman'
  | 'side-table'
  | 'toilet'
  | 'shower'
  | 'bathtub'
  | 'vanity';
export interface SofaConfiguration {
  shape: 'corner' | 'chaise';
  /** Side viewed from the front: left is local negative X. */
  side: 'left' | 'right';
  seatDepth: number;
  returnWidth: number;
}
/** Present only for a corner dressing; a straight run keeps the plain depth. */
export interface DressingConfiguration {
  /** Side of the return run, viewed from the front: left is local negative X. */
  side: 'left' | 'right';
  /** Depth of the main run, measured from the back. */
  runDepth: number;
  /** Width of the return run. */
  returnWidth: number;
}
export interface FurnitureItem {
  id: string;
  name: string;
  kind: FurnitureKind;
  width: number;
  depth: number;
  height: number;
  /** Height of the object's base above the finished floor, in metres. */
  elevation?: number;
  sofa?: SofaConfiguration;
  dressing?: DressingConfiguration;
  /** Display diagonal only; chassis dimensions remain editable approximations. */
  tvDiagonalInches?: number;
  position: Point2;
  /** Babylon Y rotation, in radians; front is local +Z. */
  rotation: number;
  locked: boolean;
  /** Linked objects share transformations, without changing individual dimensions. */
  groupId?: string;
  color: string;
  source?: { url?: string; image?: string; note?: string };
  clearances?: { front: number; back: number; left: number; right: number };
  opening?: { kind: 'hinged' | 'drawer'; reach: number };
}

const DEFAULT_TELEVISION = televisionDimensions(55);
export const FURNITURE_PRESETS: Record<
  FurnitureKind,
  {
    name: string;
    width: number;
    depth: number;
    height: number;
    elevation?: number;
    tvDiagonalInches?: number;
  }
> = {
  sofa: { name: 'Canapé', width: 2.1, depth: 0.9, height: 0.85 },
  table: { name: 'Table', width: 1.6, depth: 0.9, height: 0.75 },
  chair: { name: 'Chaise', width: 0.45, depth: 0.5, height: 0.85 },
  bed: { name: 'Lit', width: 1.6, depth: 2, height: 0.55 },
  wardrobe: { name: 'Armoire', width: 1.2, depth: 0.6, height: 2 },
  dressing: { name: 'Dressing', width: 1.8, depth: 0.6, height: 2.2 },
  desk: { name: 'Bureau', width: 1.2, depth: 0.6, height: 0.75 },
  cabinet: { name: 'Commode', width: 0.9, depth: 0.45, height: 0.9 },
  custom: { name: 'Meuble sur mesure', width: 1, depth: 0.6, height: 0.8 },
  'tv-stand': { name: 'Meuble TV', width: 1.6, depth: 0.4, height: 0.55 },
  tv: {
    name: 'Téléviseur',
    width: DEFAULT_TELEVISION.width,
    depth: DEFAULT_TELEVISION.depth,
    height: DEFAULT_TELEVISION.height,
    elevation: 0.6,
    tvDiagonalInches: 55,
  },
  'coffee-table': { name: 'Table basse', width: 1.1, depth: 0.6, height: 0.4 },
  bookcase: { name: 'Bibliothèque', width: 0.8, depth: 0.3, height: 1.8 },
  ottoman: { name: 'Pouf', width: 0.65, depth: 0.65, height: 0.42 },
  'side-table': { name: 'Table d’appoint', width: 0.5, depth: 0.5, height: 0.5 },
  toilet: { name: 'WC', width: 0.38, depth: 0.65, height: 0.78 },
  shower: { name: 'Douche', width: 0.9, depth: 0.9, height: 2 },
  bathtub: { name: 'Baignoire', width: 1.7, depth: 0.75, height: 0.58 },
  vanity: { name: 'Meuble vasque', width: 0.8, depth: 0.5, height: 0.85 },
};

/** Menu order. Every kind must appear exactly once; the panel renders these groups. */
export const FURNITURE_CATEGORIES: { title: string; kinds: FurnitureKind[] }[] = [
  {
    title: 'Salon',
    kinds: ['sofa', 'coffee-table', 'side-table', 'ottoman', 'tv-stand', 'tv', 'bookcase'],
  },
  { title: 'Salle à manger', kinds: ['table', 'chair'] },
  { title: 'Chambre', kinds: ['bed', 'wardrobe', 'cabinet'] },
  { title: 'Dressing', kinds: ['dressing'] },
  { title: 'Bureau', kinds: ['desk'] },
  { title: 'Salle de bain', kinds: ['toilet', 'shower', 'bathtub', 'vanity'] },
  { title: 'Autre', kinds: ['custom'] },
];

export class FurnitureValidationError extends Error {}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function fail(message: string): never {
  throw new FurnitureValidationError(message);
}

/** This validates data and scale; architectural fit is checked separately. */
export function validateFurnitureList(input: unknown): FurnitureItem[] {
  if (!Array.isArray(input) || input.length > 200)
    fail('Un aménagement peut contenir au plus 200 meubles.');
  const ids = new Set<string>();
  for (const candidate of input) {
    if (!record(candidate)) fail('Chaque meuble doit être un objet.');
    const item = candidate as unknown as FurnitureItem;
    if (typeof item.id !== 'string' || !item.id || item.id.length > 160 || ids.has(item.id))
      fail('Identifiant de meuble manquant ou dupliqué.');
    ids.add(item.id);
    if (
      item.groupId !== undefined &&
      (typeof item.groupId !== 'string' || !item.groupId.trim() || item.groupId.length > 160)
    )
      fail('L’identifiant du groupe de meubles est invalide.');
    if (
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 160 ||
      !(item.kind in FURNITURE_PRESETS) ||
      !Object.hasOwn(FURNITURE_PRESETS, item.kind)
    )
      fail('Nom ou type de meuble invalide.');
    if (![item.width, item.depth, item.height].every((v) => finite(v) && v >= 0.05 && v <= 20))
      fail('Les dimensions du meuble doivent être comprises entre 5 cm et 20 m.');
    if (item.tvDiagonalInches !== undefined) {
      if (
        item.kind !== 'tv' ||
        !finite(item.tvDiagonalInches) ||
        item.tvDiagonalInches < 5 ||
        item.tvDiagonalInches > 300
      )
        fail(
          'La diagonale est réservée aux téléviseurs et doit être comprise entre 5 et 300 pouces.',
        );
      const screen = televisionDimensions(item.tvDiagonalInches);
      if (
        screen.screenWidth > item.width + 0.000001 ||
        screen.screenHeight > item.height + 0.000001
      )
        fail(
          'L’écran indiqué ne tient pas dans les dimensions du téléviseur. Corrigez les mesures ou retirez la diagonale.',
        );
    }
    if (
      item.elevation !== undefined &&
      (!finite(item.elevation) || item.elevation < 0 || item.elevation > 20)
    )
      fail('La hauteur de pose doit être comprise entre 0 et 20 m.');
    if (item.sofa !== undefined) {
      const sofa = item.sofa;
      if (
        item.kind !== 'sofa' ||
        !record(sofa) ||
        !['corner', 'chaise'].includes(sofa.shape) ||
        !['left', 'right'].includes(sofa.side) ||
        !finite(sofa.seatDepth) ||
        sofa.seatDepth < 0.2 ||
        sofa.seatDepth > item.depth - 0.05 ||
        !finite(sofa.returnWidth) ||
        sofa.returnWidth < 0.2 ||
        sofa.returnWidth > item.width - 0.05
      )
        fail(
          'Vérifiez les mesures : la profondeur totale du côté allongé doit dépasser celle du corps du canapé, et la largeur du retour doit être inférieure à la largeur totale.',
        );
    }
    if (item.dressing !== undefined) {
      const dressing = item.dressing;
      if (
        item.kind !== 'dressing' ||
        !record(dressing) ||
        !['left', 'right'].includes(dressing.side) ||
        !finite(dressing.runDepth) ||
        dressing.runDepth < 0.2 ||
        dressing.runDepth > item.depth - 0.05 ||
        !finite(dressing.returnWidth) ||
        dressing.returnWidth < 0.2 ||
        dressing.returnWidth > item.width - 0.05
      )
        fail(
          'Vérifiez les mesures : la profondeur totale du côté en retour doit dépasser celle du linéaire, et la largeur du retour doit être inférieure à la largeur totale.',
        );
    }
    if (
      !Array.isArray(item.position) ||
      item.position.length !== 2 ||
      !item.position.every((v) => finite(v) && Math.abs(v) < 10000) ||
      !finite(item.rotation)
    )
      fail('Position ou rotation du meuble invalide.');
    if (
      typeof item.locked !== 'boolean' ||
      typeof item.color !== 'string' ||
      !/^#[0-9a-fA-F]{6}$/.test(item.color)
    )
      fail('Couleur ou verrouillage du meuble invalide.');
    if (item.source !== undefined) {
      if (!record(item.source)) fail('La référence du meuble doit être un objet.');
      if (item.source.url !== undefined) {
        try {
          const url = new URL(item.source.url);
          if (!['http:', 'https:'].includes(url.protocol) || item.source.url.length > 4000)
            fail('Le lien du meuble doit être une adresse HTTP ou HTTPS.');
        } catch {
          fail('Le lien du meuble doit être une adresse HTTP ou HTTPS.');
        }
      }
      if (
        item.source.image !== undefined &&
        (typeof item.source.image !== 'string' ||
          !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.source.image) ||
          item.source.image.length > 2_500_000)
      )
        fail('La photo doit être une image PNG, JPEG ou WebP de taille réduite.');
      if (
        item.source.note !== undefined &&
        (typeof item.source.note !== 'string' || item.source.note.length > 2000)
      )
        fail('La note du meuble est trop longue.');
    }
    if (
      item.clearances !== undefined &&
      (!record(item.clearances) ||
        !['front', 'back', 'left', 'right'].every(
          (key) =>
            finite(item.clearances![key as keyof typeof item.clearances]) &&
            item.clearances![key as keyof typeof item.clearances] >= 0 &&
            item.clearances![key as keyof typeof item.clearances] <= 5,
        ))
    )
      fail('Les espaces libres doivent être compris entre 0 et 5 m.');
    if (
      item.opening !== undefined &&
      (!record(item.opening) ||
        !['hinged', 'drawer'].includes(item.opening.kind) ||
        !finite(item.opening.reach) ||
        item.opening.reach < 0 ||
        item.opening.reach > 5)
    )
      fail('Le débattement du meuble est invalide.');
  }
  return structuredClone(input as FurnitureItem[]);
}

export type FurnitureInput = Omit<Partial<FurnitureItem>, 'sofa' | 'dressing'> & {
  sofa?: Partial<SofaConfiguration>;
  dressing?: Partial<DressingConfiguration>;
};

export function createFurniture(input: FurnitureInput = {}): FurnitureItem {
  const supplied = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as FurnitureInput;
  const kind = input.kind ?? (input.sofa ? 'sofa' : 'custom');
  const preset =
    input.sofa && kind === 'sofa'
      ? { ...FURNITURE_PRESETS.sofa, width: 2.8, depth: 1.8 }
      : (FURNITURE_PRESETS[kind] ?? FURNITURE_PRESETS.custom);
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `meuble-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const item = {
    ...preset,
    id,
    kind,
    position: [0, 0],
    rotation: 0,
    locked: false,
    color: '#a5a18a',
    ...supplied,
  } as FurnitureItem;
  if (kind === 'tv') {
    if (input.tvDiagonalInches !== undefined) {
      const dimensions = televisionDimensions(input.tvDiagonalInches);
      if (input.width === undefined) item.width = dimensions.width;
      if (input.depth === undefined) item.depth = dimensions.depth;
      if (input.height === undefined) item.height = dimensions.height;
      if (
        dimensions.screenWidth > item.width + 0.000001 ||
        dimensions.screenHeight > item.height + 0.000001
      )
        delete item.tvDiagonalInches;
    } else if (input.width !== undefined || input.height !== undefined)
      delete item.tvDiagonalInches;
  }
  if (input.sofa)
    item.sofa = {
      shape: 'corner',
      side: 'left',
      seatDepth: Math.min(0.9, item.depth * 0.55),
      returnWidth: Math.min(0.9, item.width / 3),
      ...input.sofa,
    };
  if (input.dressing) {
    // A corner needs room for the return run in front of the main one.
    if (input.depth === undefined) item.depth = 1.2;
    item.dressing = {
      side: 'left',
      runDepth: Math.min(0.6, item.depth * 0.55),
      returnWidth: Math.min(0.6, item.width / 3),
      ...input.dressing,
    };
  }
  return validateFurnitureList([item])[0];
}

export function localToWorld(item: FurnitureItem, x: number, z: number): Point2 {
  const c = Math.cos(item.rotation),
    s = Math.sin(item.rotation);
  return [item.position[0] + c * x + s * z, item.position[1] - s * x + c * z];
}

export function footprint(item: FurnitureItem): Point2[] {
  return [
    localToWorld(item, -item.width / 2, -item.depth / 2),
    localToWorld(item, item.width / 2, -item.depth / 2),
    localToWorld(item, item.width / 2, item.depth / 2),
    localToWorld(item, -item.width / 2, item.depth / 2),
  ];
}

function rectangle(
  item: FurnitureItem,
  left: number,
  back: number,
  right: number,
  front: number,
): Point2[] {
  return [
    localToWorld(item, left, back),
    localToWorld(item, right, back),
    localToWorld(item, right, front),
    localToWorld(item, left, front),
  ];
}

/** Two convex pieces: the full-width back run and the forward return. */
function cornerParts(
  item: FurnitureItem,
  runDepth: number,
  returnWidth: number,
  side: 'left' | 'right',
): Point2[][] {
  const runFront = -item.depth / 2 + runDepth;
  const left = side === 'left' ? -item.width / 2 : item.width / 2 - returnWidth;
  return [
    rectangle(item, -item.width / 2, -item.depth / 2, item.width / 2, runFront),
    rectangle(item, left, runFront, left + returnWidth, item.depth / 2),
  ];
}

/** Convex occupied pieces. The empty inside corner of an L is deliberately excluded. */
export function footprintParts(item: FurnitureItem): Point2[][] {
  if (item.kind === 'sofa' && item.sofa) {
    const { seatDepth, returnWidth, side } = item.sofa;
    return cornerParts(item, seatDepth, returnWidth, side);
  }
  if (item.kind === 'dressing' && item.dressing) {
    const { runDepth, returnWidth, side } = item.dressing;
    return cornerParts(item, runDepth, returnWidth, side);
  }
  return [footprint(item)];
}

export class FurnitureHistory {
  private current: FurnitureItem[];
  private past: FurnitureItem[][] = [];
  private future: FurnitureItem[][] = [];
  constructor(items: FurnitureItem[] = []) {
    this.current = validateFurnitureList(items);
  }
  get items() {
    return structuredClone(this.current);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  commit(items: FurnitureItem[]) {
    const next = validateFurnitureList(items);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.past.push(this.current);
    if (this.past.length > 30) this.past.shift();
    this.current = next;
    this.future = [];
  }
  undo() {
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(this.current);
    this.current = previous;
    return true;
  }
  redo() {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.current);
    this.current = next;
    return true;
  }
  reset(items: FurnitureItem[] = []) {
    this.current = validateFurnitureList(items);
    this.past = [];
    this.future = [];
  }
}

export const layoutStorageKey = (projectId: string, levelId: string) =>
  `maison-atelier:layout:v1:${encodeURIComponent(projectId)}:${encodeURIComponent(levelId)}`;

export function loadLayout(projectId: string, levelId: string): FurnitureItem[] {
  let text: string | null;
  try {
    text = globalThis.localStorage.getItem(layoutStorageKey(projectId, levelId));
  } catch {
    throw new Error('La sauvegarde locale des meubles est indisponible dans ce navigateur.');
  }
  if (!text) return [];
  try {
    const data: unknown = JSON.parse(text);
    if (
      !record(data) ||
      data.version !== 1 ||
      data.projectId !== projectId ||
      data.levelId !== levelId
    )
      fail('Identité de sauvegarde invalide.');
    return validateFurnitureList(data.items);
  } catch {
    throw new Error(
      'L’aménagement sauvegardé est illisible. Importez une sauvegarde valide avant de le remplacer.',
    );
  }
}

export function saveLayout(projectId: string, levelId: string, items: FurnitureItem[]) {
  const data = { version: 1, projectId, levelId, items: validateFurnitureList(items) };
  try {
    globalThis.localStorage.setItem(layoutStorageKey(projectId, levelId), JSON.stringify(data));
  } catch {
    throw new Error(
      'Impossible de sauvegarder les meubles : mémoire locale pleine ou indisponible. Réduisez les photos ou exportez votre aménagement.',
    );
  }
}
