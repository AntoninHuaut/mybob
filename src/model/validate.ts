import type { CeilingSlope, HouseProject, Level, Room, Point2, ProjectSite } from './types';
import { ceilingHeightAt, ceilingProfile, slopeDistance, slopeHeightAt } from './ceiling';
import {
  alongWall,
  bounds,
  pointInOrOnPolygon,
  pointInPolygon,
  polygonArea,
  polygonInsidePolygon,
  resolveRoofDormer,
  resolveRoofWindow,
  wallLength,
} from './geometry';
import { validateSolarSettings } from './solarSettings';

export class ProjectValidationError extends Error {}
const fail = (message: string): never => {
  throw new ProjectValidationError(message);
};
const finite = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10000;
const point = (p: unknown): p is Point2 => Array.isArray(p) && p.length === 2 && p.every(finite);
const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 500;
const positive = (x: unknown): x is number => finite(x) && x > 0;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean';
const MIN_CEILING_HEIGHT = 1.8;
// Technical minimums for the fixed-size joinery profiles, not construction standards.
const MIN_OPENING_SIZE = 0.1;

/** Every floor, room, parcel or face must have a simple perimeter. */
function simplePolygon(points: Point2[]): boolean {
  const cross = (a: Point2, b: Point2, c: Point2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const on = (a: Point2, b: Point2, c: Point2) =>
    Math.abs(cross(a, b, c)) < 1e-8 &&
    c[0] >= Math.min(a[0], b[0]) - 1e-8 &&
    c[0] <= Math.max(a[0], b[0]) + 1e-8 &&
    c[1] >= Math.min(a[1], b[1]) - 1e-8 &&
    c[1] <= Math.max(a[1], b[1]) + 1e-8;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.001) return false;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        return false;
    }
  }
  return true;
}
function validPolygon(value: unknown): value is Point2[] {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 500 &&
    value.every(point) &&
    polygonArea(value) >= 0.01 &&
    simplePolygon(value)
  );
}

function validRoofFace(face: unknown, vertices: [number, number, number][]): boolean {
  if (
    !Array.isArray(face) ||
    face.length < 3 ||
    face.length > 100 ||
    !face.every((index) => Number.isInteger(index) && index >= 0 && index < vertices.length) ||
    new Set(face).size !== face.length
  )
    return false;
  const points = face.map((index) => vertices[index]);
  const normal = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(...normal);
  if (length < 0.001) return false;
  const dominant = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const projected = points.map((p) => p.filter((_, i) => i !== dominant) as Point2);
  if (!simplePolygon(projected)) return false;
  return points.every(
    (p) => Math.abs(p.reduce((s, n, i) => s + (n - points[0][i]) * normal[i], 0)) / length < 0.001,
  );
}

/**
 * Sloping ceiling parts of a level: a foot line, a height under the flat ceiling,
 * a rise towards the inside of the level, and ordered gaps along the foot line.
 */
function validateCeilingSlopes(l: Level, id: (value: unknown) => void) {
  if (l.ceilingSlopes === undefined) return;
  if (!Array.isArray(l.ceilingSlopes) || l.ceilingSlopes.length > 20)
    fail(`Rampants invalides : ${l.id}`);
  const box = bounds(l.outline);
  const centre: Point2 = [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2];
  for (const slope of l.ceilingSlopes as unknown[]) {
    if (!record(slope)) fail(`Chaque rampant du niveau ${l.id} doit être un objet.`);
    id((slope as Record<string, unknown>).id);
    const s = slope as unknown as CeilingSlope;
    const length =
      point(s.start) && point(s.end) ? Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1]) : 0;
    if (
      length < 0.1 ||
      !positive(s.height) ||
      s.height > l.ceilingHeight ||
      !positive(s.rise) ||
      s.rise > 20
    )
      fail(`Rampant invalide : ${s.id}`);
    if (s.gaps !== undefined) {
      if (!Array.isArray(s.gaps) || s.gaps.length > 20)
        fail(`Interruptions de rampant invalides : ${s.id}`);
      let previous = 0;
      for (const gap of s.gaps as unknown[]) {
        if (
          !Array.isArray(gap) ||
          gap.length !== 2 ||
          !finite(gap[0]) ||
          !finite(gap[1]) ||
          gap[0] < previous ||
          gap[1] - gap[0] < 0.1 ||
          gap[1] > length + 0.001
        )
          fail(`Interruptions de rampant invalides : ${s.id}`);
        previous = (gap as [number, number])[1];
      }
    }
    // A concave floor's bounding-box centre can lie outside the floor altogether.
    // For a slope restricted to one wing by gaps, check the active floor vertices
    // instead. Keep rejecting reversed slopes on ordinary rectangular levels.
    if (slopeDistance(s, centre) <= 0) {
      const active = l.outline.filter((p) => Number.isFinite(slopeHeightAt(s, p)));
      const risesIntoWing =
        s.gaps?.length &&
        !pointInOrOnPolygon(centre, l.outline) &&
        active.some((p) => slopeDistance(s, p) > 0) &&
        active.every((p) => slopeDistance(s, p) >= -0.001);
      if (!risesIntoWing)
        fail(`Un rampant doit monter vers l’intérieur du niveau, à gauche de son tracé : ${s.id}`);
    }
  }
}

export function validateProject(
  input: unknown,
  { allowRoomOverlap = false }: { allowRoomOverlap?: boolean } = {},
): HouseProject {
  if (!record(input)) fail('Le fichier doit contenir un objet de projet JSON.');
  const p = input as HouseProject;
  if (p.schemaVersion !== 1 || p.units !== 'm')
    fail('Format attendu : schemaVersion 1, unités en mètres (m).');
  if (!text(p.id) || !text(p.name) || typeof p.description !== 'string')
    fail('Identifiant, nom ou description du projet manquant.');
  let solar: HouseProject['solar'];
  if (p.solar !== undefined) {
    try {
      solar = validateSolarSettings(p.solar);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Réglages du soleil invalides.');
    }
  }
  if (p.finishes !== undefined) {
    if (
      !record(p.finishes) ||
      Object.values(p.finishes).some((c) => typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c))
    )
      fail('Les couleurs de finition doivent être un objet de couleurs au format #rrggbb.');
  }
  if (
    !record(p.source) ||
    !text(p.source.title) ||
    !text(p.source.status) ||
    !Array.isArray(p.source.notes) ||
    !p.source.notes.every((n) => typeof n === 'string') ||
    (p.source.date !== undefined && typeof p.source.date !== 'string')
  )
    fail('Les informations de référence sont invalides.');
  if (!Array.isArray(p.levels) || !p.levels.length || p.levels.length > 20)
    fail('Le projet doit contenir entre 1 et 20 niveaux.');
  // A dormer back wall crosses its level's ceiling: it is the
  // volume piercing the covering, not a wall taller than the building.
  const dormerWallIds = new Set(
    // `roofs` is not validated yet: tolerate any shape, the real check reports it later.
    (Array.isArray((p.site as ProjectSite | undefined)?.roofs)
      ? (p.site as ProjectSite).roofs!
      : []
    )
      .flatMap((roof) => (Array.isArray(roof?.dormers) ? roof.dormers : []))
      .map((dormer) => dormer?.wallId)
      .filter((wallId): wallId is string => typeof wallId === 'string'),
  );
  const ids = new Set<string>();
  const id = (value: unknown) => {
    if (!text(value) || ids.has(value)) fail(`Identifiant manquant ou dupliqué : ${String(value)}`);
    ids.add(value as string);
  };
  for (const l of p.levels) {
    if (!record(l)) fail('Chaque niveau doit être un objet.');
    id(l.id);
    if (!text(l.name) || !finite(l.elevation) || !positive(l.ceilingHeight) || l.ceilingHeight > 20)
      fail('Nom ou hauteur de niveau invalide.');
    if (l.ceilingHeight < MIN_CEILING_HEIGHT)
      fail(`La hauteur du niveau doit être d’au moins 1,80 m pour la caméra de visite : ${l.id}`);
    if (
      !Array.isArray(l.outline) ||
      l.outline.length < 3 ||
      l.outline.length > 1000 ||
      !l.outline.every(point) ||
      polygonArea(l.outline) < 1 ||
      !simplePolygon(l.outline)
    )
      fail('Contour de niveau invalide.');
    validateCeilingSlopes(l, id);
    if (
      !Array.isArray(l.walls) ||
      l.walls.length > 2000 ||
      !Array.isArray(l.rooms) ||
      l.rooms.length > 500
    )
      fail('Liste des murs ou des pièces invalide.');
    for (const w of l.walls) {
      if (!record(w)) fail(`Chaque mur du niveau ${l.id} doit être un objet.`);
      id(w.id);
      if (!point(w.start) || !point(w.end) || !positive(w.thickness) || wallLength(w) < 0.01)
        fail(`Mur invalide : ${w.id}`);
      if (!optionalBoolean(w.exterior))
        fail(`Le statut extérieur du mur doit être un booléen : ${w.id}`);
      if (
        w.height !== undefined &&
        (!positive(w.height) || (w.height > l.ceilingHeight && !dormerWallIds.has(w.id)))
      )
        fail(`Hauteur de mur invalide : ${w.id}`);
      if (w.openings !== undefined && (!Array.isArray(w.openings) || w.openings.length > 100))
        fail(`Ouvertures invalides : ${w.id}`);
      const openings = w.openings ?? [];
      for (const o of openings) {
        if (!record(o)) fail(`Chaque ouverture du mur ${w.id} doit être un objet.`);
        id(o.id);
        if (
          !['door', 'window', 'sliding', 'garage'].includes(o.kind) ||
          !finite(o.offset) ||
          o.offset < 0 ||
          !positive(o.width) ||
          o.offset + o.width > wallLength(w) + 0.001 ||
          !positive(o.height) ||
          (o.sill !== undefined && !finite(o.sill)) ||
          (o.sill ?? 0) < 0 ||
          o.height + (o.sill ?? 0) > (w.height ?? l.ceilingHeight) + 0.001
        )
          fail(`Dimensions d’ouverture invalides : ${o.id}`);
        // A dormer back wall rises through the covering: its window is not under the slope.
        if (
          l.ceilingSlopes?.length &&
          !dormerWallIds.has(w.id) &&
          o.height + (o.sill ?? 0) >
            Math.min(
              ...ceilingProfile(
                l,
                alongWall(w, o.offset),
                alongWall(w, o.offset + o.width),
              ).flatMap((run) => [run.from, run.to]),
            ) +
              0.001
        )
          fail(`L’ouverture dépasse le plafond en pente : ${o.id}`);
        if (o.width < MIN_OPENING_SIZE || o.height < MIN_OPENING_SIZE)
          fail(
            `Une ouverture doit mesurer au moins 10 cm de large et de haut pour les profils du modèle : ${o.id}`,
          );
        if (o.kind !== 'window' && o.kind !== 'sliding' && (o.sill ?? 0) !== 0)
          fail(`Les portes et portes de garage doivent partir du sol (allège de 0 m) : ${o.id}`);
        if (o.glazed !== undefined && (typeof o.glazed !== 'boolean' || o.kind !== 'door'))
          fail(`Seule une porte battante peut être vitrée : ${o.id}`);
        if (o.leaves !== undefined && ((o.leaves !== 1 && o.leaves !== 2) || o.kind !== 'door'))
          fail(`Seule une porte battante peut avoir un ou deux vantaux : ${o.id}`);
        if (!optionalBoolean(o.exterior))
          fail(`Le statut extérieur de l’ouverture doit être un booléen : ${o.id}`);
        if (o.hinge !== undefined && !['start', 'end'].includes(o.hinge))
          fail(`Charnière invalide : ${o.id}`);
        if (o.swing !== undefined && o.swing !== 1 && o.swing !== -1)
          fail(`Sens de porte invalide : ${o.id}`);
      }
      let previousEnd = 0;
      for (const o of [...openings].sort((a, b) => a.offset - b.offset)) {
        if (o.offset < previousEnd - 0.001)
          fail(`Les ouvertures ne doivent pas se chevaucher : ${o.id}`);
        previousEnd = o.offset + o.width;
      }
    }
    for (const r of l.rooms) {
      if (!record(r)) fail(`Chaque pièce du niveau ${l.id} doit être un objet.`);
      id(r.id);
      if (
        !text(r.name) ||
        !['living', 'bedroom', 'bathroom', 'circulation', 'garage', 'storage'].includes(r.kind) ||
        !Array.isArray(r.polygon) ||
        r.polygon.length < 3 ||
        r.polygon.length > 1000 ||
        !r.polygon.every(point) ||
        polygonArea(r.polygon) < 0.01 ||
        !simplePolygon(r.polygon) ||
        !point(r.label) ||
        !point(r.viewpoint) ||
        !pointInPolygon(r.label, r.polygon) ||
        !pointInPolygon(r.viewpoint, r.polygon) ||
        (r.planArea !== undefined && !positive(r.planArea))
      )
        fail(`Pièce invalide : ${r.id}`);
      if (
        !polygonInsidePolygon(r.polygon, l.outline) ||
        !pointInPolygon(r.label, l.outline) ||
        !pointInPolygon(r.viewpoint, l.outline)
      )
        fail(
          `La pièce, son repère et son point de visite doivent rester dans le contour du niveau : ${r.id}`,
        );
      if (r.note !== undefined && typeof r.note !== 'string')
        fail(`La note de pièce doit être un texte : ${r.id}`);
      if (ceilingHeightAt(l, r.viewpoint) - (r.floorOffset ?? 0) < MIN_CEILING_HEIGHT)
        fail(
          `Le point de visite doit être sous au moins 1,80 m de plafond, hors du rampant : ${r.id}`,
        );
      const floorOffset = r.floorOffset;
      if (floorOffset !== undefined) {
        if (!finite(floorOffset) || floorOffset < -1 || floorOffset > 0)
          fail(`Le décalage de sol doit être compris entre −1 m et 0 m : ${r.id}`);
        if (l.ceilingHeight - floorOffset < MIN_CEILING_HEIGHT)
          fail(`La hauteur libre de la pièce doit être d’au moins 1,80 m : ${r.id}`);
      }
    }
    if (!allowRoomOverlap) rejectOverlappingRooms(l.rooms);
    if (l.stairs !== undefined) {
      if (!Array.isArray(l.stairs) || l.stairs.length > 20) fail(`Escaliers invalides : ${l.id}`);
      for (const stair of l.stairs) {
        if (!record(stair)) fail(`Chaque escalier du niveau ${l.id} doit être un objet.`);
        id(stair.id);
        if (
          !point(stair.start) ||
          !point(stair.end) ||
          !positive(stair.width) ||
          !Number.isInteger(stair.steps) ||
          stair.steps < 1 ||
          stair.steps > 40 ||
          !positive(stair.rise) ||
          stair.rise > 10
        )
          fail(`Escalier invalide : ${stair.id}`);
        const run = Math.hypot(stair.end[0] - stair.start[0], stair.end[1] - stair.start[1]);
        if (run < 0.5) fail(`La volée doit mesurer au moins 50 cm de long : ${stair.id}`);
        if (run / stair.steps < 0.15)
          fail(`Giron inférieur à 15 cm : l’escalier n’est pas franchissable : ${stair.id}`);
        if (stair.rise / stair.steps > 0.25)
          fail(`Hauteur de marche supérieure à 25 cm : ${stair.id}`);
        if (!pointInPolygon(stair.start, l.outline) || !pointInPolygon(stair.end, l.outline))
          fail(`L’escalier doit rester dans le contour du niveau : ${stair.id}`);
        if (stair.note !== undefined && typeof stair.note !== 'string')
          fail(`La note d’escalier doit être un texte : ${stair.id}`);
      }
    }
    if (l.floorVoids !== undefined) {
      if (!Array.isArray(l.floorVoids) || l.floorVoids.length > 20)
        fail(`Trémies invalides : ${l.id}`);
      for (const voidPolygon of l.floorVoids) {
        if (!validPolygon(voidPolygon) || !polygonInsidePolygon(voidPolygon, l.outline))
          fail(
            `Une trémie doit être un polygone simple inscrit dans le contour du niveau : ${l.id}`,
          );
      }
    }
    if (
      !record(l.spawn) ||
      !point(l.spawn.position) ||
      !finite(l.spawn.yaw) ||
      !pointInPolygon(l.spawn.position, l.outline)
    )
      fail('Position de départ invalide ou en dehors du niveau.');
    if (!Array.isArray(l.lights) || l.lights.length > 500) fail('Éclairages invalides.');
    for (const light of l.lights) {
      if (!record(light)) fail(`Chaque éclairage du niveau ${l.id} doit être un objet.`);
      id(light.id);
      if (!point(light.position) || !optionalBoolean(light.provisional))
        fail('Position ou statut de luminaire invalide.');
    }
  }
  if (p.site !== undefined) {
    const site = p.site;
    if (
      !record(site) ||
      !validPolygon(site.boundary) ||
      !finite(site.elevation) ||
      site.elevation < -10 ||
      site.elevation > 5 ||
      !Array.isArray(site.notes) ||
      site.notes.length > 100 ||
      !site.notes.every(text) ||
      (site.declaredArea !== undefined && !positive(site.declaredArea))
    )
      fail('Le terrain doit contenir un contour simple, une altitude et des notes valides.');
    for (const color of [site.facadeColor, site.roofColor])
      if (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)))
        fail('Les couleurs extérieures doivent respecter le format #rrggbb.');
    if (!polygonInsidePolygon(p.levels[0].outline, site.boundary))
      fail('La maison doit rester à l’intérieur de la parcelle.');
    if (site.surfaces !== undefined) {
      if (!Array.isArray(site.surfaces) || site.surfaces.length > 100)
        fail('Surfaces extérieures invalides.');
      for (const surface of site.surfaces) {
        if (!record(surface)) fail('Une surface extérieure doit être un objet.');
        id(surface.id);
        if (
          !['gravel', 'path', 'terrace', 'lawn'].includes(surface.kind) ||
          !validPolygon(surface.polygon) ||
          !polygonInsidePolygon(surface.polygon, site.boundary)
        )
          fail(`Surface extérieure invalide : ${surface.id}`);
        if (
          surface.height !== undefined &&
          (surface.kind !== 'terrace' ||
            !finite(surface.height) ||
            surface.height < 0 ||
            surface.height > 1.5)
        )
          fail(`Seule une terrasse porte une hauteur, entre 0 et 1,5 m : ${surface.id}`);
      }
    }
    if (site.boundaries !== undefined) {
      if (!Array.isArray(site.boundaries) || site.boundaries.length > 100)
        fail('Murs de clôture, clôtures et haies invalides.');
      for (const line of site.boundaries) {
        if (!record(line)) fail('Un mur de clôture, une clôture ou une haie doit être un objet.');
        id(line.id);
        const points: unknown = line.points;
        if (
          !['wall', 'fence', 'hedge', 'gate'].includes(line.kind) ||
          !Array.isArray(points) ||
          points.length < 2 ||
          points.length > 200 ||
          !points.every(point) ||
          !points.every((p) => pointInOrOnPolygon(p, site.boundary)) ||
          points.some(
            (p, i) => i > 0 && Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) < 0.01,
          )
        )
          fail(
            `Un mur de clôture, une clôture ou une haie suit au moins deux points distincts dans la parcelle : ${line.id}`,
          );
        if (line.kind === 'gate' && line.points.length !== 2)
          fail(`Un portillon a exactement deux points, ses deux poteaux : ${line.id}`);
        if (!finite(line.height) || line.height < 0.1 || line.height > 4)
          fail(`La hauteur doit être comprise entre 0,1 et 4 m : ${line.id}`);
        if (
          line.thickness !== undefined &&
          (!finite(line.thickness) || line.thickness < 0.02 || line.thickness > 2)
        )
          fail(`L’épaisseur doit être comprise entre 2 cm et 2 m : ${line.id}`);
        if (
          line.infill !== undefined &&
          (!['mesh', 'slats'].includes(line.infill) || !['fence', 'gate'].includes(line.kind))
        )
          fail(
            `Seuls une clôture ou un portillon ont un remplissage, grillage ou lames : ${line.id}`,
          );
      }
    }
    if (site.roofs !== undefined) {
      if (!Array.isArray(site.roofs) || site.roofs.length > 30) fail('Toitures invalides.');
      for (const roof of site.roofs) {
        if (!record(roof)) fail('Une toiture doit être un objet.');
        id(roof.id);
        if (
          !Array.isArray(roof.vertices) ||
          roof.vertices.length < 3 ||
          roof.vertices.length > 500 ||
          !roof.vertices.every(
            (v) => Array.isArray(v) && v.length === 3 && v.every(finite) && v[1] >= 0 && v[1] <= 30,
          ) ||
          !Array.isArray(roof.faces) ||
          !roof.faces.length ||
          roof.faces.length > 500 ||
          !roof.faces.every((f) => validRoofFace(f, roof.vertices)) ||
          (roof.gables !== undefined &&
            (!Array.isArray(roof.gables) ||
              roof.gables.length > 500 ||
              !roof.gables.every((f) => validRoofFace(f, roof.vertices))))
        )
          fail(`Géométrie de toiture invalide : ${roof.id}`);
        if (roof.dormers !== undefined) {
          if (!Array.isArray(roof.dormers) || roof.dormers.length > 30)
            fail(`Lucarnes invalides : ${roof.id}`);
          for (const dormer of roof.dormers) {
            if (!record(dormer)) fail('Une lucarne de toiture doit être un objet.');
            id(dormer.id);
            if (
              !point(dormer.start) ||
              !point(dormer.end) ||
              !text(dormer.wallId) ||
              (dormer.slope !== undefined && !finite(dormer.slope))
            )
              fail(`Lucarne invalide : ${dormer.id}`);
            const resolved = resolveRoofDormer(p, roof.vertices, roof.faces, dormer);
            if (resolved.error) fail(resolved.error);
          }
        }
        if (roof.windows !== undefined) {
          if (!Array.isArray(roof.windows) || roof.windows.length > 60)
            fail(`Fenêtres de toit invalides : ${roof.id}`);
          for (const window of roof.windows) {
            if (!record(window)) fail('Une fenêtre de toit doit être un objet.');
            id(window.id);
            if (!point(window.center) || !positive(window.width) || !positive(window.height))
              fail(`Fenêtre de toit invalide : ${window.id}`);
            // The minimum size, the carrying roof face and the overflow are resolved
            // with the same function as the renderer: a single rule.
            const resolved = resolveRoofWindow(roof.vertices, roof.faces, window);
            if (resolved.error) fail(resolved.error);
          }
        }
      }
    }
  }
  const result = structuredClone(p);
  if (solar !== undefined) result.solar = solar;
  return result;
}

/**
 * Two rooms must not share floor: it gives a wrong picture and a wrong surface.
 * The overlap is sampled on a 5 cm grid over the smaller room (rooms can be concave);
 * more than 1 % of the smaller room is refused. Touching edges are fine.
 */
function rejectOverlappingRooms(rooms: Room[]) {
  const step = 0.05;
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const [small, other] =
        polygonArea(rooms[i].polygon) <= polygonArea(rooms[j].polygon)
          ? [rooms[i], rooms[j]]
          : [rooms[j], rooms[i]];
      const a = bounds(small.polygon),
        b = bounds(other.polygon);
      if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ) continue;
      let inSmall = 0,
        inBoth = 0;
      for (let x = a.minX + step / 2; x < a.maxX; x += step)
        for (let z = a.minZ + step / 2; z < a.maxZ; z += step) {
          if (!pointInPolygon([x, z], small.polygon)) continue;
          inSmall++;
          if (pointInPolygon([x, z], other.polygon)) inBoth++;
        }
      if (inSmall && inBoth / inSmall > 0.01)
        fail(`Les pièces ${small.id} et ${other.id} se chevauchent.`);
    }
}
