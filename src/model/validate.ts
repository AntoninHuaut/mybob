import type { HouseProject, Point2 } from './types';
import { pointInPolygon, polygonArea, wallLength } from './geometry';

export class ProjectValidationError extends Error {}
const fail = (message: string): never => { throw new ProjectValidationError(message); };
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10000;
const point = (p: unknown): p is Point2 => Array.isArray(p) && p.length === 2 && p.every(finite);
const text = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 500;
const positive = (x: unknown): x is number => finite(x) && x > 0;

export function validateProject(input: unknown): HouseProject {
  if (!input || typeof input !== 'object') fail('Le fichier doit contenir un projet JSON.');
  const p = input as HouseProject;
  if (p.schemaVersion !== 1 || p.units !== 'm') fail('Format attendu : schemaVersion 1, unités en mètres (m).');
  if (!text(p.id) || !text(p.name) || typeof p.description !== 'string') fail('Identifiant, nom ou description du projet manquant.');
  if (p.finishes !== undefined) {
    if (!p.finishes || typeof p.finishes !== 'object' || Object.values(p.finishes).some(c => typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c))) fail('Les couleurs de finition doivent être au format #rrggbb.');
  }
  if (!p.source || !text(p.source.title) || !text(p.source.status) || !Array.isArray(p.source.notes) || !p.source.notes.every(n => typeof n === 'string')) fail('Les informations de référence sont invalides.');
  if (!Array.isArray(p.levels) || !p.levels.length || p.levels.length > 20) fail('Le projet doit contenir entre 1 et 20 niveaux.');
  const ids = new Set<string>();
  const id = (value: unknown) => {
    if (!text(value) || ids.has(value)) fail(`Identifiant manquant ou dupliqué : ${String(value)}`);
    ids.add(value as string);
  };
  for (const l of p.levels) {
    id(l.id);
    if (!text(l.name) || !finite(l.elevation) || !positive(l.ceilingHeight) || l.ceilingHeight > 20) fail('Nom ou hauteur de niveau invalide.');
    if (!Array.isArray(l.outline) || l.outline.length < 3 || l.outline.length > 1000 || !l.outline.every(point) || polygonArea(l.outline) < 1) fail('Contour de niveau invalide.');
    if (!Array.isArray(l.walls) || l.walls.length > 2000 || !Array.isArray(l.rooms) || l.rooms.length > 500) fail('Liste des murs ou des pièces invalide.');
    for (const w of l.walls) {
      id(w.id);
      if (!point(w.start) || !point(w.end) || !positive(w.thickness) || wallLength(w) < .01) fail(`Mur invalide : ${w.id}`);
      if (w.height !== undefined && (!positive(w.height) || w.height > l.ceilingHeight)) fail(`Hauteur de mur invalide : ${w.id}`);
      if (w.openings !== undefined && (!Array.isArray(w.openings) || w.openings.length > 100)) fail(`Ouvertures invalides : ${w.id}`);
      let previousEnd = 0;
      for (const o of [...(w.openings ?? [])].sort((a, b) => a.offset - b.offset)) {
        id(o.id);
        if (!['door', 'window', 'sliding', 'garage'].includes(o.kind) || !finite(o.offset) || o.offset < previousEnd - .001 || !positive(o.width) || o.offset + o.width > wallLength(w) + .001 || !positive(o.height) || !finite(o.sill ?? 0) || (o.sill ?? 0) < 0 || o.height + (o.sill ?? 0) > (w.height ?? l.ceilingHeight) + .001) fail(`Dimensions ou chevauchement d’ouverture : ${o.id}`);
        if (o.hinge !== undefined && !['start', 'end'].includes(o.hinge)) fail(`Charnière invalide : ${o.id}`);
        if (o.swing !== undefined && o.swing !== 1 && o.swing !== -1) fail(`Sens de porte invalide : ${o.id}`);
        previousEnd = o.offset + o.width;
      }
    }
    for (const r of l.rooms) {
      id(r.id);
      if (!text(r.name) || !['living', 'bedroom', 'bathroom', 'circulation', 'garage', 'storage'].includes(r.kind) || !Array.isArray(r.polygon) || r.polygon.length < 3 || r.polygon.length > 1000 || !r.polygon.every(point) || polygonArea(r.polygon) < .01 || !point(r.label) || !point(r.viewpoint) || !pointInPolygon(r.label, r.polygon) || !pointInPolygon(r.viewpoint, r.polygon) || (r.planArea !== undefined && !positive(r.planArea))) fail(`Pièce invalide : ${r.id}`);
    }
    if (!l.spawn || !point(l.spawn.position) || !finite(l.spawn.yaw) || !pointInPolygon(l.spawn.position, l.outline)) fail('Position de départ invalide ou en dehors du niveau.');
    if (!Array.isArray(l.lights) || l.lights.length > 500) fail('Éclairages invalides.');
    for (const light of l.lights) { id(light.id); if (!point(light.position)) fail('Position de luminaire invalide.'); }
  }
  return structuredClone(p);
}
