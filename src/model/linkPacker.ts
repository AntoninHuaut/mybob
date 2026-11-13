import type { HouseProject, Opening, ProjectSite, Point2, RoofDormer } from './types';
import type {
  DressingConfiguration,
  DressingRun,
  FurnitureItem,
  FurnitureKind,
  ShowerPanelSide,
  ShowerPanelSpan,
  SofaConfiguration,
} from '../furniture/model';
import { SHOWER_PANEL_SIDES } from '../furniture/model';
import type { LayoutVariant, VariantBook } from '../furniture/variants';

/**
 * Home-made pack of the share link. The pack only exists in the URL hash: in memory,
 * in `localStorage` and in import/export, the format stays the current `HouseProject`
 * JSON. Millimetre quantisation, omission of absent fields and interning of repeated
 * strings: that is the information deflate cannot invent by itself.
 */
export class LinkPackError extends Error {}

/** A complete export project: the project, the arrangement of its active variant and all its variants. */
export type ShareDocument = HouseProject & {
  furnishing?: { version: number; levels: Record<string, FurnitureItem[]>; variants?: unknown };
};
export interface UnpackedShare {
  project: HouseProject;
  /** Mirror of the active variant, as in a complete export. */
  levels: Record<string, FurnitureItem[]>;
  variants: VariantBook;
}

/**
 * Revision 2: glazing and leaves of openings, dormers and roof windows. Revision 3: the
 * length of each shower panel. Revision 4: a CRC-32 closes the pack, so a link altered by
 * one character is refused instead of decoding into another valid project. Revision 5: the
 * sloping parts of each level's ceiling. Reading still accepts revisions 1 to 5 (links
 * already shared); Revision 6 adds kitchen configurations; writing always produces 6.
 */
export const LINK_PACK_VERSION = 6;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** CRC-32 (IEEE) of `data`, as an unsigned 32-bit integer. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type OpeningKind = 'door' | 'window' | 'sliding' | 'garage';
type RoomKind = 'living' | 'bedroom' | 'bathroom' | 'circulation' | 'garage' | 'storage';
const OPENING_KINDS: OpeningKind[] = ['door', 'window', 'sliding', 'garage'];
const ROOM_KINDS: RoomKind[] = [
  'living',
  'bedroom',
  'bathroom',
  'circulation',
  'garage',
  'storage',
];
const SURFACE_KINDS = ['gravel', 'path'] as const;
const FURNITURE_KIND_ORDER: FurnitureKind[] = [
  'sofa',
  'table',
  'chair',
  'bed',
  'wardrobe',
  'dressing',
  'desk',
  'cabinet',
  'custom',
  'tv-stand',
  'tv',
  'coffee-table',
  'bookcase',
  'ottoman',
  'side-table',
  'toilet',
  'shower',
  'bathtub',
  'vanity',
  'kitchen',
];

const enumInt = <T extends string>(list: readonly T[], value: T): number => {
  const index = list.indexOf(value);
  if (index < 0) throw new LinkPackError(`Type inconnu du pack : ${String(value)}`);
  return index;
};
const enumValue = <T extends string>(list: readonly T[], index: number): T => {
  const value = list[index];
  if (value === undefined) throw new LinkPackError('Type inconnu du pack.');
  return value;
};

const parseIntColor = (value: string): number => {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw new LinkPackError('Couleur invalide pour le pack.');
  return parseInt(value.slice(1), 16);
};

/* ---------------------------------------------------------------------------------------------- */
/* Writing                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

class Packer {
  private data: number[] = [];
  private strings: string[] = [];
  private seen = new Map<string, number>();

  bytes(): Uint8Array {
    return Uint8Array.from(this.data);
  }
  /** Unsigned varint, least significant byte first. */
  u(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
      throw new LinkPackError('Quantité invalide pour le pack.');
    let rest = value;
    do {
      let byte = rest % 128;
      rest = Math.floor(rest / 128);
      if (rest > 0) byte += 128;
      this.data.push(byte);
    } while (rest > 0);
  }
  /** Zigzag-encoded signed varint. */
  i(value: number): void {
    const n = Math.round(value);
    this.u(n >= 0 ? n * 2 : -n * 2 - 1);
  }
  /** Millimetres: integer quantisation, most of the gain after deflate. */
  mm(value: number): void {
    this.i(Math.round(value * 1000));
  }
  /** Angle in radians, to a ten-thousandth. */
  angle(value: number): void {
    this.i(Math.round(value * 10000));
  }
  b(value: boolean): void {
    this.u(value ? 1 : 0);
  }
  /** Three states: absent, false, true. */
  tri(value: boolean | undefined): void {
    this.u(value === undefined ? 0 : value ? 2 : 1);
  }
  optMM(value: number | undefined): void {
    this.u(value === undefined ? 0 : 1);
    if (value !== undefined) this.mm(value);
  }
  /** Area in square centimetres, always positive. */
  optArea(value: number | undefined): void {
    this.u(value === undefined ? 0 : 1);
    if (value !== undefined) this.u(Math.round(value * 10000));
  }
  optColor(value: string | undefined): void {
    this.u(value === undefined ? 0 : 1);
    if (value !== undefined) this.u(parseIntColor(value));
  }
  /** Interned string: reference by index when it comes back, otherwise added to the table. */
  str(value: string): void {
    const known = this.seen.get(value);
    if (known !== undefined) {
      this.u(known * 2 + 1);
      return;
    }
    const index = this.strings.length;
    this.strings.push(value);
    this.seen.set(value, index);
    this.u(index * 2 + 2);
    const bytes = textEncoder.encode(value);
    this.u(bytes.length);
    for (const byte of bytes) this.data.push(byte);
  }
  optStr(value: string | undefined): void {
    if (value === undefined) this.u(0);
    else this.str(value);
  }
  point(value: Point2): void {
    this.mm(value[0]);
    this.mm(value[1]);
  }
  polygon(points: Point2[]): void {
    this.u(points.length);
    for (const point of points) this.point(point);
  }
}

function packSofa(packer: Packer, sofa: SofaConfiguration): void {
  packer.u(enumInt(['corner', 'chaise'], sofa.shape));
  packer.u(enumInt(['left', 'right'], sofa.side));
  packer.mm(sofa.seatDepth);
  packer.mm(sofa.returnWidth);
}

function packDressing(packer: Packer, dressing: DressingConfiguration): void {
  packer.mm(dressing.runDepth);
  packer.u(dressing.runs.length);
  for (const run of dressing.runs)
    packer.u(run.turn === undefined ? 0 : run.turn === 'left' ? 1 : 2);
  for (const run of dressing.runs) packer.mm(run.length);
}

function packShowerPanels(packer: Packer, sides: ShowerPanelSide[]): void {
  packer.u(sides.length);
  for (const side of sides) {
    const index = SHOWER_PANEL_SIDES.indexOf(side);
    if (index < 0) throw new LinkPackError('Paroi de douche inconnue du pack.');
    packer.u(index);
  }
}

function packShowerSpans(
  packer: Packer,
  spans: Partial<Record<ShowerPanelSide, ShowerPanelSpan>> | undefined,
): void {
  const entries = SHOWER_PANEL_SIDES.flatMap((side) => {
    const span = spans?.[side];
    return span ? [[side, span] as const] : [];
  });
  packer.u(entries.length);
  for (const [side, span] of entries) {
    packer.u(SHOWER_PANEL_SIDES.indexOf(side));
    packer.mm(span.length);
    packer.u(span.from === 'right' ? 1 : 0);
  }
}

/**
 * Packs a piece of furniture. Its identifier is not carried: it is its position in the list,
 * and the group takes the index of its first member. Generated identifiers (UUID)
 * are entropy no algorithm compresses; the position rebuilds the same linked
 * structure on unpacking. `meuble-<n>` and `groupe-<n>` take over on reading.
 */
function packFurnitureItem(packer: Packer, item: FurnitureItem, groupFirstIndex: number): void {
  packer.str(item.name);
  packer.u(enumInt(FURNITURE_KIND_ORDER, item.kind));
  packer.mm(item.width);
  packer.mm(item.depth);
  packer.mm(item.height);
  packer.optMM(item.elevation);
  if (item.sofa === undefined) packer.u(0);
  else {
    packer.u(1);
    packSofa(packer, item.sofa);
  }
  if (item.dressing === undefined) packer.u(0);
  else {
    packer.u(1);
    packDressing(packer, item.dressing);
  }
  packer.u(item.kitchen ? 1 : 0);
  if (item.kitchen) {
    const k = item.kitchen;
    packDressing(packer, k);
    packer.mm(k.worktopHeight);
    packer.u(parseIntColor(k.worktopColor));
    packer.u(k.wallUnits ? 1 : 0);
    if (k.wallUnits) {
      packer.mm(k.wallUnits.bottom);
      packer.mm(k.wallUnits.height);
      packer.mm(k.wallUnits.depth);
    }
    packer.u(k.slots.length);
    for (const slot of k.slots) {
      packer.u(slot.run);
      packer.mm(slot.offset);
      packer.mm(slot.width);
      packer.u(enumInt(['sink', 'hob', 'oven', 'fridge'], slot.kind));
    }
  }
  packer.optMM(item.showerTray);
  if (item.showerPanels === undefined) packer.u(0);
  else {
    packer.u(1);
    packShowerPanels(packer, item.showerPanels);
  }
  packShowerSpans(packer, item.showerPanelSpans);
  if (item.tvDiagonalInches === undefined) packer.u(0);
  else {
    packer.u(1);
    packer.u(Math.round(item.tvDiagonalInches * 100));
  }
  packer.point(item.position);
  packer.angle(item.rotation);
  packer.b(item.locked);
  packer.u(parseIntColor(item.color));
  packer.u(groupFirstIndex);
  if (item.clearances === undefined) packer.u(0);
  else {
    packer.u(1);
    packer.mm(item.clearances.front);
    packer.mm(item.clearances.back);
    packer.mm(item.clearances.left);
    packer.mm(item.clearances.right);
  }
  if (item.opening === undefined) packer.u(0);
  else {
    packer.u(1);
    packer.u(enumInt(['hinged', 'drawer'], item.opening.kind));
    packer.mm(item.opening.reach);
  }
}

function packVariant(packer: Packer, variant: LayoutVariant, levelIds: string[]): void {
  packer.str(variant.id);
  packer.str(variant.name);
  for (const levelId of levelIds) {
    const items = variant.levels[levelId] ?? [];
    packer.u(items.length);
    const groups = new Map<string, number>();
    items.forEach((item, index) => {
      if (item.groupId !== undefined && !groups.has(item.groupId)) groups.set(item.groupId, index);
    });
    items.forEach((item) =>
      packFurnitureItem(
        packer,
        item,
        item.groupId === undefined ? 0 : (groups.get(item.groupId) ?? 0) + 1,
      ),
    );
  }
}

/**
 * Packs a complete export document. The binary description is deterministic: two identical
 * states always produce the same bytes, whatever the platform.
 */
export function packShareDocument(document: ShareDocument): Uint8Array {
  const project = document;
  const furnishing = document.furnishing;
  const book = furnishing?.variants as VariantBook | undefined;
  const activeVariant = book?.variants.find((variant) => variant.id === book.activeId);
  const activeLevels: Record<string, FurnitureItem[]> =
    furnishing?.levels ?? activeVariant?.levels ?? {};
  const packer = new Packer();
  packer.u(LINK_PACK_VERSION);
  // Position (level, wall) of every wall: identifiers are renumbered on unpacking.
  const wallPositions = new Map<string, [number, number]>();
  project.levels.forEach((level, l) =>
    level.walls.forEach((wall, w) => wallPositions.set(wall.id, [l, w])),
  );
  packer.u(
    (project.site ? 1 : 0) |
      (project.solar ? 2 : 0) |
      (project.finishes ? 4 : 0) |
      (furnishing ? 8 : 0),
  );
  packer.str(project.id);
  packer.str(project.name);
  packer.str(project.description);
  packer.str(project.source.title);
  packer.optStr(project.source.date);
  packer.str(project.source.status);
  packer.u(project.source.notes.length);
  for (const note of project.source.notes) packer.str(note);
  if (project.solar) {
    packer.i(Math.round(project.solar.latitude * 1e6));
    packer.i(Math.round(project.solar.longitude * 1e6));
    packer.u(Math.round(project.solar.northAngleDeg * 100));
    packer.optStr(project.solar.timeZone);
    packer.optStr(project.solar.label);
    packer.optStr(project.solar.instant);
  }
  if (project.finishes) {
    packer.optColor(project.finishes.wallColor);
    packer.optColor(project.finishes.floorTint);
    packer.optColor(project.finishes.garageColor);
    packer.optColor(project.finishes.joineryColor);
  }
  packer.u(project.levels.length);
  const levelIds: string[] = [];
  for (const level of project.levels) {
    // The identifier of a level, a wall, a room… is its position in the list:
    // `niveau-0`, `mur-0-1`… take over on unpacking. Only the displayed texts
    // (names, notes) and the project's own identifier remain.
    levelIds.push(level.id);
    packer.str(level.name);
    packer.mm(level.elevation);
    packer.mm(level.ceilingHeight);
    packer.polygon(level.outline);
    packer.u(level.walls.length);
    for (const wall of level.walls) {
      packer.point(wall.start);
      packer.point(wall.end);
      packer.mm(wall.thickness);
      packer.optMM(wall.height);
      packer.tri(wall.exterior);
      const openings = wall.openings ?? [];
      packer.u(openings.length);
      for (const opening of openings) {
        packer.u(enumInt(OPENING_KINDS, opening.kind));
        packer.mm(opening.offset);
        packer.mm(opening.width);
        packer.mm(opening.height);
        packer.optMM(opening.sill);
        packer.u(opening.hinge === undefined ? 0 : opening.hinge === 'start' ? 1 : 2);
        packer.u(opening.swing === undefined ? 0 : opening.swing === 1 ? 1 : 2);
        packer.tri(opening.exterior);
        packer.tri(opening.glazed);
        packer.u(opening.leaves === undefined ? 0 : opening.leaves);
      }
    }
    packer.u(level.rooms.length);
    for (const room of level.rooms) {
      packer.str(room.name);
      packer.u(enumInt(ROOM_KINDS, room.kind));
      packer.polygon(room.polygon);
      packer.point(room.label);
      packer.point(room.viewpoint);
      packer.optMM(room.floorOffset);
      packer.optArea(room.planArea);
      packer.optStr(room.note);
    }
    const stairs = level.stairs ?? [];
    packer.u(stairs.length);
    for (const stair of stairs) {
      packer.point(stair.start);
      packer.point(stair.end);
      packer.mm(stair.width);
      packer.u(stair.steps);
      packer.mm(stair.rise);
      packer.optStr(stair.note);
    }
    const voids = level.floorVoids ?? [];
    packer.u(voids.length);
    for (const floorVoid of voids) packer.polygon(floorVoid);
    packer.u(level.lights.length);
    for (const light of level.lights) {
      packer.point(light.position);
      packer.u(light.provisional ? 1 : 0);
    }
    packer.point(level.spawn.position);
    packer.angle(level.spawn.yaw);
    const slopes = level.ceilingSlopes ?? [];
    packer.u(slopes.length);
    for (const slope of slopes) {
      packer.point(slope.start);
      packer.point(slope.end);
      packer.mm(slope.height);
      packer.mm(slope.rise);
      const gaps = slope.gaps ?? [];
      packer.u(gaps.length);
      for (const [from, to] of gaps) {
        packer.mm(from);
        packer.mm(to);
      }
    }
  }
  if (project.site) {
    const site = project.site;
    packer.polygon(site.boundary);
    packer.mm(site.elevation);
    packer.optArea(site.declaredArea);
    packer.optColor(site.facadeColor);
    packer.optColor(site.roofColor);
    const surfaces = site.surfaces ?? [];
    packer.u(surfaces.length);
    for (const surface of surfaces) {
      packer.u(enumInt(SURFACE_KINDS, surface.kind));
      packer.polygon(surface.polygon);
    }
    const roofs = site.roofs ?? [];
    packer.u(roofs.length);
    for (const roof of roofs) {
      packer.u(roof.vertices.length);
      for (const vertex of roof.vertices) {
        packer.mm(vertex[0]);
        packer.mm(vertex[1]);
        packer.mm(vertex[2]);
      }
      packer.u(roof.faces.length);
      for (const face of roof.faces) {
        packer.u(face.length);
        for (const index of face) packer.u(index);
      }
      const gables = roof.gables ?? [];
      packer.u(gables.length);
      for (const face of gables) {
        packer.u(face.length);
        for (const index of face) packer.u(index);
      }
      const dormers = roof.dormers ?? [];
      packer.u(dormers.length);
      for (const dormer of dormers) {
        const position = wallPositions.get(dormer.wallId);
        if (!position) throw new LinkPackError('Mur de fond de lucarne introuvable.');
        packer.point(dormer.start);
        packer.point(dormer.end);
        packer.u(position[0]);
        packer.u(position[1]);
        packer.u(dormer.slope === undefined ? 0 : 1);
        if (dormer.slope !== undefined) packer.u(Math.round(dormer.slope * 10000));
      }
      const windows = roof.windows ?? [];
      packer.u(windows.length);
      for (const window of windows) {
        packer.point(window.center);
        packer.mm(window.width);
        packer.mm(window.height);
      }
    }
    packer.u(site.notes.length);
    for (const note of site.notes) packer.str(note);
  }
  if (furnishing) {
    const effectiveBook: { activeId: string; variants: LayoutVariant[] } = book ?? {
      activeId: 'initial',
      variants: [{ id: 'initial', name: 'Aménagement initial', levels: activeLevels }],
    };
    packer.u(effectiveBook.variants.length);
    for (const variant of effectiveBook.variants) packVariant(packer, variant, levelIds);
    const activeIndex = effectiveBook.variants.findIndex(
      (variant) => variant.id === effectiveBook.activeId,
    );
    if (activeIndex < 0) throw new LinkPackError('Variante active introuvable.');
    packer.u(activeIndex);
  }
  const body = packer.bytes();
  const sealed = new Uint8Array(body.length + 4);
  sealed.set(body);
  new DataView(sealed.buffer).setUint32(body.length, crc32(body));
  return sealed;
}

/* ---------------------------------------------------------------------------------------------- */
/* Lecture                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

class Unpacker {
  private offset = 0;
  private strings: string[] = [];
  constructor(private data: Uint8Array) {}

  private take(count: number): Uint8Array {
    if (this.offset + count > this.data.length) throw new LinkPackError('Lien tronqué.');
    const slice = this.data.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }
  u(): number {
    let value = 0;
    let shift = 1;
    for (let guard = 0; ; guard++) {
      if (guard > 8) throw new LinkPackError('Lien illisible.');
      const byte = this.take(1)[0];
      value += (byte & 127) * shift;
      if ((byte & 128) === 0) return value;
      shift *= 128;
    }
  }
  i(): number {
    const n = this.u();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }
  mm(): number {
    return this.i() / 1000;
  }
  angle(): number {
    return this.i() / 10000;
  }
  b(): boolean {
    return this.u() === 1;
  }
  tri(): boolean | undefined {
    return [undefined, false, true][this.u()];
  }
  optMM(): number | undefined {
    return this.u() === 0 ? undefined : this.mm();
  }
  optArea(): number | undefined {
    return this.u() === 0 ? undefined : this.u() / 10000;
  }
  optColor(): string | undefined {
    return this.u() === 0 ? undefined : `#${this.u().toString(16).padStart(6, '0')}`;
  }
  str(): string {
    const code = this.u();
    if (code === 0) throw new LinkPackError('Chaîne manquante dans le pack.');
    if (code % 2 === 1) {
      const value = this.strings[(code - 1) / 2];
      if (value === undefined) throw new LinkPackError('Chaîne internée inconnue.');
      return value;
    }
    const index = (code - 2) / 2;
    const value = textDecoder.decode(this.take(this.u()));
    if (index !== this.strings.length) throw new LinkPackError('Table de chaînes incohérente.');
    this.strings.push(value);
    return value;
  }
  optStr(): string | undefined {
    if (this.offset >= this.data.length) throw new LinkPackError('Lien tronqué.');
    return this.data[this.offset] === 0 ? (this.take(1), undefined) : this.str();
  }
  point(): Point2 {
    return [this.mm(), this.mm()];
  }
  polygon(): Point2[] {
    const count = this.u();
    if (count > 2000) throw new LinkPackError('Polygone illisible.');
    return Array.from({ length: count }, () => this.point());
  }
  count(max: number): number {
    const count = this.u();
    if (count > max) throw new LinkPackError('Lien illisible.');
    return count;
  }
  end(): void {
    if (this.offset !== this.data.length) throw new LinkPackError('Lien illisible.');
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Unpacks packed bytes into a complete export document, ready for the import validation pipeline. */
export function unpackShareDocument(data: Uint8Array): ShareDocument {
  // From revision 4 the last four bytes are the CRC-32 of everything before them.
  if (data[0] >= 4 && data[0] <= LINK_PACK_VERSION) {
    if (data.length < 5) throw new LinkPackError('Lien tronqué.');
    const body = data.subarray(0, data.length - 4);
    if (new DataView(data.buffer, data.byteOffset).getUint32(body.length) !== crc32(body))
      throw new LinkPackError('Somme de contrôle invalide.');
    data = body;
  }
  const reader = new Unpacker(data);
  const version = reader.u();
  if (version < 1 || version > LINK_PACK_VERSION)
    throw new LinkPackError('Version du pack inconnue.');
  const flags = reader.u();
  const project: ShareDocument = {
    schemaVersion: 1,
    id: reader.str(),
    name: reader.str(),
    description: reader.str(),
    units: 'm',
    source: {
      title: reader.str(),
      date: reader.optStr(),
      status: reader.str(),
      notes: Array.from({ length: reader.count(2000) }, () => reader.str()),
    },
    levels: [],
  };
  if (flags & 2) {
    const solar = {
      latitude: reader.i() / 1e6,
      longitude: reader.i() / 1e6,
      northAngleDeg: reader.u() / 100,
      timeZone: reader.optStr(),
      label: reader.optStr(),
      instant: reader.optStr(),
    };
    const clean: NonNullable<HouseProject['solar']> = {
      latitude: solar.latitude,
      longitude: solar.longitude,
      northAngleDeg: solar.northAngleDeg,
    };
    if (solar.timeZone !== undefined) clean.timeZone = solar.timeZone;
    if (solar.label !== undefined) clean.label = solar.label;
    if (solar.instant !== undefined) clean.instant = solar.instant;
    project.solar = clean;
  }
  if (flags & 4) {
    const finishes = Object.fromEntries(
      (
        [
          ['wallColor', reader.optColor()],
          ['floorTint', reader.optColor()],
          ['garageColor', reader.optColor()],
          ['joineryColor', reader.optColor()],
        ] as const
      ).filter(([, color]) => color !== undefined),
    );
    if (Object.keys(finishes).length) project.finishes = finishes;
  }
  const levelIds: string[] = [];
  const levelCount = reader.count(20);
  for (let l = 0; l < levelCount; l++) {
    const level: HouseProject['levels'][number] = {
      id: `niveau-${l}`,
      name: reader.str(),
      elevation: reader.mm(),
      ceilingHeight: reader.mm(),
      outline: reader.polygon(),
      walls: [],
      rooms: [],
      lights: [],
      spawn: { position: [0, 0], yaw: 0 },
    };
    levelIds.push(level.id);
    const wallCount = reader.count(2000);
    for (let w = 0; w < wallCount; w++) {
      const wall: HouseProject['levels'][number]['walls'][number] = {
        id: `mur-${l}-${w}`,
        start: reader.point(),
        end: reader.point(),
        thickness: reader.mm(),
        height: reader.optMM(),
        exterior: reader.tri(),
      };
      const openingCount = reader.count(100);
      const openings: NonNullable<HouseProject['levels'][number]['walls'][number]['openings']> = [];
      for (let o = 0; o < openingCount; o++) {
        const opening = {
          id: `ouverture-${l}-${w}-${o}`,
          kind: enumValue(OPENING_KINDS, reader.u()),
          offset: reader.mm(),
          width: reader.mm(),
          height: reader.mm(),
          sill: reader.optMM(),
        };
        const hinge = reader.u();
        const swing = reader.u();
        const exterior = reader.tri();
        const read: Opening = {
          ...opening,
          hinge: hinge === 0 ? undefined : hinge === 1 ? 'start' : 'end',
          swing: swing === 0 ? undefined : swing === 1 ? 1 : -1,
          exterior,
        };
        if (version >= 2) {
          const glazed = reader.tri();
          const leaves = reader.u();
          if (leaves > 2) throw new LinkPackError('Lien illisible.');
          if (glazed !== undefined) read.glazed = glazed;
          if (leaves !== 0) read.leaves = leaves as 1 | 2;
        }
        openings.push(read);
      }
      if (openings.length) wall.openings = openings;
      level.walls.push(wall);
    }
    const roomCount = reader.count(500);
    for (let r = 0; r < roomCount; r++) {
      level.rooms.push({
        id: `piece-${l}-${r}`,
        name: reader.str(),
        kind: enumValue(ROOM_KINDS, reader.u()),
        polygon: reader.polygon(),
        label: reader.point(),
        viewpoint: reader.point(),
        floorOffset: reader.optMM(),
        planArea: reader.optArea(),
        note: reader.optStr(),
      });
    }
    const stairCount = reader.count(20);
    if (stairCount) {
      level.stairs = [];
      for (let s = 0; s < stairCount; s++) {
        level.stairs.push({
          id: `escalier-${l}-${s}`,
          start: reader.point(),
          end: reader.point(),
          width: reader.mm(),
          steps: reader.u(),
          rise: reader.mm(),
          note: reader.optStr(),
        });
      }
    }
    const voidCount = reader.count(20);
    if (voidCount) {
      level.floorVoids = [];
      for (let v = 0; v < voidCount; v++) level.floorVoids.push(reader.polygon());
    }
    const lightCount = reader.count(500);
    for (let li = 0; li < lightCount; li++) {
      level.lights.push({
        id: `luminaire-${l}-${li}`,
        position: reader.point(),
        provisional: reader.u() === 1 ? true : undefined,
      });
    }
    level.spawn = { position: reader.point(), yaw: reader.angle() };
    if (version >= 5) {
      const slopeCount = reader.count(20);
      if (slopeCount) {
        level.ceilingSlopes = [];
        for (let s = 0; s < slopeCount; s++) {
          const slope: NonNullable<HouseProject['levels'][number]['ceilingSlopes']>[number] = {
            id: `rampant-${l}-${s}`,
            start: reader.point(),
            end: reader.point(),
            height: reader.mm(),
            rise: reader.mm(),
          };
          const gapCount = reader.count(20);
          if (gapCount) {
            slope.gaps = [];
            for (let g = 0; g < gapCount; g++) slope.gaps.push([reader.mm(), reader.mm()]);
          }
          level.ceilingSlopes.push(slope);
        }
      }
    }
    project.levels.push(level);
  }
  if (flags & 1) {
    const site: ProjectSite = {
      boundary: reader.polygon(),
      elevation: reader.mm(),
      declaredArea: reader.optArea(),
      facadeColor: reader.optColor(),
      roofColor: reader.optColor(),
      notes: [],
    };
    const surfaceCount = reader.count(100);
    if (surfaceCount) {
      site.surfaces = [];
      for (let s = 0; s < surfaceCount; s++)
        site.surfaces.push({
          id: `surface-${s}`,
          kind: enumValue(SURFACE_KINDS, reader.u()),
          polygon: reader.polygon(),
        });
    }
    const roofCount = reader.count(30);
    if (roofCount) {
      site.roofs = [];
      for (let r = 0; r < roofCount; r++) {
        const roof: NonNullable<ProjectSite['roofs']>[number] = {
          id: `toit-${r}`,
          vertices: [],
          faces: [],
          gables: undefined,
        };
        const vertexCount = reader.count(500);
        for (let v = 0; v < vertexCount; v++)
          roof.vertices.push([reader.mm(), reader.mm(), reader.mm()]);
        const faceCount = reader.count(500);
        for (let f = 0; f < faceCount; f++)
          roof.faces.push(Array.from({ length: reader.count(100) }, () => reader.u()));
        const gableCount = reader.count(500);
        if (gableCount) {
          roof.gables = [];
          for (let g = 0; g < gableCount; g++)
            roof.gables.push(Array.from({ length: reader.count(100) }, () => reader.u()));
        }
        if (version >= 2) {
          const dormerCount = reader.count(100);
          for (let d = 0; d < dormerCount; d++) {
            const start = reader.point();
            const end = reader.point();
            const level = reader.u();
            const wall = reader.u();
            const hasSlope = reader.u() === 1;
            const dormer: RoofDormer = {
              id: `lucarne-${r}-${d}`,
              start,
              end,
              wallId: `mur-${level}-${wall}`,
            };
            if (hasSlope) dormer.slope = reader.u() / 10000;
            (roof.dormers ??= []).push(dormer);
          }
          const windowCount = reader.count(100);
          for (let w = 0; w < windowCount; w++)
            (roof.windows ??= []).push({
              id: `fenetre-toit-${r}-${w}`,
              center: reader.point(),
              width: reader.mm(),
              height: reader.mm(),
            });
        }
        site.roofs.push(roof);
      }
    }
    const noteCount = reader.count(100);
    for (let n = 0; n < noteCount; n++) site.notes.push(reader.str());
    project.site = site;
  }
  if (flags & 8) {
    const variants: LayoutVariant[] = [];
    const variantCount = reader.count(10);
    for (let v = 0; v < variantCount; v++) {
      const variant: LayoutVariant = {
        id: reader.str(),
        name: reader.str(),
        levels: {},
      };
      for (const levelId of levelIds) {
        variant.levels[levelId] = [];
        const itemCount = reader.count(200);
        for (let it = 0; it < itemCount; it++) {
          const item: FurnitureItem = {
            // The link's identifier is its position in the list: renumbered on unpacking.
            id: `meuble-${it}`,
            name: reader.str(),
            kind: enumValue(FURNITURE_KIND_ORDER, reader.u()),
            width: reader.mm(),
            depth: reader.mm(),
            height: reader.mm(),
            elevation: reader.optMM(),
            position: [0, 0],
            rotation: 0,
            locked: false,
            color: '#000000',
          };
          if (reader.u() === 1) {
            item.sofa = {
              shape: enumValue(['corner', 'chaise'], reader.u()),
              side: enumValue(['left', 'right'], reader.u()),
              seatDepth: reader.mm(),
              returnWidth: reader.mm(),
            };
          }
          if (reader.u() === 1) {
            item.dressing = {
              runDepth: reader.mm(),
              runs: Array.from({ length: reader.count(12) }, () => ({ length: 0 })),
            };
            const turns = item.dressing.runs.map(() => reader.u());
            item.dressing.runs.forEach((run, index) => {
              run.length = reader.mm();
              const turn = turns[index];
              if (turn === 1 || turn === 2)
                if (index < item.dressing!.runs.length - 1)
                  run.turn = turn === 1 ? 'left' : 'right';
            });
          }
          if (version >= 6 && reader.u() === 1) {
            const runDepth = reader.mm();
            const runs = Array.from(
              { length: reader.count(12) },
              () => ({ length: 0 }) as DressingRun,
            );
            const turns = runs.map(() => reader.u());
            runs.forEach((run, i) => {
              run.length = reader.mm();
              if (turns[i] !== 0) run.turn = enumValue(['left', 'right'] as const, turns[i] - 1);
            });
            item.kitchen = {
              runDepth,
              runs,
              worktopHeight: reader.mm(),
              worktopColor: `#${reader.u().toString(16).padStart(6, '0')}`,
              slots: [],
            };
            if (reader.u() === 1)
              item.kitchen.wallUnits = {
                bottom: reader.mm(),
                height: reader.mm(),
                depth: reader.mm(),
              };
            item.kitchen.slots = Array.from({ length: reader.count(48) }, () => ({
              run: reader.u(),
              offset: reader.mm(),
              width: reader.mm(),
              kind: enumValue(['sink', 'hob', 'oven', 'fridge'] as const, reader.u()),
            }));
          }
          item.showerTray = reader.optMM();
          if (reader.u() === 1) {
            item.showerPanels = Array.from({ length: reader.count(4) }, () =>
              enumValue(SHOWER_PANEL_SIDES, reader.u()),
            );
          }
          if (version >= 3) {
            const count = reader.count(4);
            if (count > 0) item.showerPanelSpans = {};
            for (let index = 0; index < count; index++) {
              const side = enumValue(SHOWER_PANEL_SIDES, reader.u());
              const span: ShowerPanelSpan = { length: reader.mm() };
              if (reader.u() === 1) span.from = 'right';
              item.showerPanelSpans![side] = span;
            }
          }
          if (reader.u() === 1) item.tvDiagonalInches = reader.u() / 100;
          item.position = reader.point();
          item.rotation = reader.angle();
          item.locked = reader.b();
          item.color = `#${reader.u().toString(16).padStart(6, '0')}`;
          const groupFirstIndex = reader.u();
          if (groupFirstIndex > 0) item.groupId = `groupe-${groupFirstIndex - 1}`;
          if (reader.u() === 1) {
            item.clearances = {
              front: reader.mm(),
              back: reader.mm(),
              left: reader.mm(),
              right: reader.mm(),
            };
          }
          if (reader.u() === 1) {
            item.opening = {
              kind: enumValue(['hinged', 'drawer'], reader.u()),
              reach: reader.mm(),
            };
          }
          variant.levels[levelId].push(item);
        }
      }
      variants.push(variant);
    }
    const activeIndex = reader.u();
    if (!variants[activeIndex]) throw new LinkPackError('Variante active introuvable.');
    project.furnishing = {
      version: 1,
      levels: structuredClone(variants[activeIndex].levels),
      variants: { version: 1, activeId: variants[activeIndex].id, variants },
    };
  }
  reader.end();
  return project;
}
