import type { HouseProject, Point2 } from './types';
import { pointInPolygon, polygonArea, polygonInsidePolygon, wallLength } from './geometry';
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

export function validateProject(input: unknown): HouseProject {
  if (!record(input)) fail('Le fichier doit contenir un objet de projet JSON.');
  const p = input as HouseProject;
  if (p.schemaVersion !== 1 || p.units !== 'm')
    fail('Format attendu : schemaVersion 1, unités en mètres (m).');
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
  const ids = new Set<string>();
  const id = (value: unknown) => {
    if (!text(value) || ids.has(value)) fail(`Identifiant manquant ou dupliqué : ${String(value)}`);
    ids.add(value as string);
  };
  for (const l of p.levels) {
    if (!record(l)) fail('Chaque niveau doit être un objet.');
    id(l.id);
    if (!text(l.name) || !finite(l.elevation) || !positive(l.ceilingHeight) || l.ceilingHeight > 20)
      fail('Nom ou hauteur de niveau invalide.');
    if (l.ceilingHeight < MIN_CEILING_HEIGHT)
      fail(`La hauteur du niveau doit être d’au moins 1,80 m pour la caméra de visite : ${l.id}`);
    if (
      !Array.isArray(l.outline) ||
      l.outline.length < 3 ||
      l.outline.length > 1000 ||
      !l.outline.every(point) ||
      polygonArea(l.outline) < 1 ||
      !simplePolygon(l.outline)
    )
      fail('Contour de niveau invalide.');
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
        fail(`Mur invalide : ${w.id}`);
      if (!optionalBoolean(w.exterior))
        fail(`Le statut extérieur du mur doit être un booléen : ${w.id}`);
      if (w.height !== undefined && (!positive(w.height) || w.height > l.ceilingHeight))
        fail(`Hauteur de mur invalide : ${w.id}`);
      if (w.openings !== undefined && (!Array.isArray(w.openings) || w.openings.length > 100))
        fail(`Ouvertures invalides : ${w.id}`);
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
          fail(`Dimensions d’ouverture invalides : ${o.id}`);
        if (o.width < MIN_OPENING_SIZE || o.height < MIN_OPENING_SIZE)
          fail(
            `Une ouverture doit mesurer au moins 10 cm de large et de haut pour les profils du modèle : ${o.id}`,
          );
        if (o.kind !== 'window' && (o.sill ?? 0) !== 0)
          fail(
            `Les portes, baies coulissantes et portes de garage doivent partir du sol (allège de 0 m) : ${o.id}`,
          );
        if (!optionalBoolean(o.exterior))
          fail(`Le statut extérieur de l’ouverture doit être un booléen : ${o.id}`);
        if (o.hinge !== undefined && !['start', 'end'].includes(o.hinge))
          fail(`Charnière invalide : ${o.id}`);
        if (o.swing !== undefined && o.swing !== 1 && o.swing !== -1)
          fail(`Sens de porte invalide : ${o.id}`);
      }
      let previousEnd = 0;
      for (const o of [...openings].sort((a, b) => a.offset - b.offset)) {
        if (o.offset < previousEnd - 0.001)
          fail(`Les ouvertures ne doivent pas se chevaucher : ${o.id}`);
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
        fail(`Pièce invalide : ${r.id}`);
      if (
        !polygonInsidePolygon(r.polygon, l.outline) ||
        !pointInPolygon(r.label, l.outline) ||
        !pointInPolygon(r.viewpoint, l.outline)
      )
        fail(
          `La pièce, son repère et son point de visite doivent rester dans le contour du niveau : ${r.id}`,
        );
      if (r.note !== undefined && typeof r.note !== 'string')
        fail(`La note de pièce doit être un texte : ${r.id}`);
      const floorOffset = r.floorOffset;
      if (floorOffset !== undefined) {
        if (!finite(floorOffset) || floorOffset < -1 || floorOffset > 0)
          fail(`Le décalage de sol doit être compris entre −1 m et 0 m : ${r.id}`);
        if (l.ceilingHeight - floorOffset < MIN_CEILING_HEIGHT)
          fail(`La hauteur libre de la pièce doit être d’au moins 1,80 m : ${r.id}`);
      }
    }
    if (l.stairs !== undefined) {
      if (!Array.isArray(l.stairs) || l.stairs.length > 20) fail(`Escaliers invalides : ${l.id}`);
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
          fail(`Escalier invalide : ${stair.id}`);
        const run = Math.hypot(stair.end[0] - stair.start[0], stair.end[1] - stair.start[1]);
        if (run < 0.5) fail(`La volée doit mesurer au moins 50 cm de long : ${stair.id}`);
        if (run / stair.steps < 0.15)
          fail(`Giron inférieur à 15 cm : l’escalier n’est pas franchissable : ${stair.id}`);
        if (stair.rise / stair.steps > 0.25)
          fail(`Hauteur de marche supérieure à 25 cm : ${stair.id}`);
        if (!pointInPolygon(stair.start, l.outline) || !pointInPolygon(stair.end, l.outline))
          fail(`L’escalier doit rester dans le contour du niveau : ${stair.id}`);
        if (stair.note !== undefined && typeof stair.note !== 'string')
          fail(`La note d’escalier doit être un texte : ${stair.id}`);
      }
    }
    if (l.floorVoids !== undefined) {
      if (!Array.isArray(l.floorVoids) || l.floorVoids.length > 20)
        fail(`Trémies invalides : ${l.id}`);
      for (const voidPolygon of l.floorVoids) {
        if (!validPolygon(voidPolygon) || !polygonInsidePolygon(voidPolygon, l.outline))
          fail(
            `Une trémie doit être un polygone simple inscrit dans le contour du niveau : ${l.id}`,
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
          !['gravel', 'path'].includes(surface.kind) ||
          !validPolygon(surface.polygon) ||
          !polygonInsidePolygon(surface.polygon, site.boundary)
        )
          fail(`Surface extérieure invalide : ${surface.id}`);
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
          fail(`Géométrie de toiture invalide : ${roof.id}`);
      }
    }
  }
  const result = structuredClone(p);
  if (solar !== undefined) result.solar = solar;
  return result;
}
