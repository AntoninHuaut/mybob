import type { HouseProject, Point2 } from './types';
import { pointInPolygon, polygonArea, polygonInsidePolygon, wallLength } from './geometry';

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

export function validateProject(input: unknown): HouseProject {
  if (!record(input)) fail('Le fichier doit contenir un objet de projet JSON.');
  const p = input as HouseProject;
  if (p.schemaVersion !== 1 || p.units !== 'm')
    fail('Format attendu : schemaVersion 1, unités en mètres (m).');
  if (!text(p.id) || !text(p.name) || typeof p.description !== 'string')
    fail('Identifiant, nom ou description du projet manquant.');
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
      polygonArea(l.outline) < 1
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
  return structuredClone(p);
}
