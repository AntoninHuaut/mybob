import type { HouseProject, Room } from '../model/types';
import { polygonArea } from '../model/geometry';
import { area, escapeHtml as esc } from './format';

/** Un écart sous ce seuil n’est pas significatif à l’échelle d’un plan. */
export const AREA_GAP_TOLERANCE = 0.1;

/** Écart entre la surface reconstruite et celle annoncée au plan, en mètres carrés. */
export function areaGap(room: Room): number | undefined {
  if (room.planArea === undefined) return undefined;
  return polygonArea(room.polygon) - room.planArea;
}

/** « équivalent » plutôt qu’un chiffre bruité quand l’écart tient dans la tolérance. */
export function gapLabel(gap: number | undefined): string {
  if (gap === undefined) return '—';
  if (Math.abs(gap) <= AREA_GAP_TOLERANCE) return 'équivalent';
  return `${gap > 0 ? '+' : '−'}${area(Math.abs(gap))}`;
}

function areaTableHtml(rooms: Room[]): string {
  const compared = rooms.some((room) => room.planArea !== undefined);
  const head = compared
    ? '<tr><th>Pièce</th><th>Au plan</th><th>Reconstruite</th><th>Écart</th></tr>'
    : '<tr><th>Pièce</th><th>Reconstruite</th></tr>';
  const rows = rooms
    .map((room) => {
      const reconstructed = area(polygonArea(room.polygon));
      if (!compared) return `<tr><td>${esc(room.name)}</td><td>${reconstructed}</td></tr>`;
      const gap = areaGap(room);
      const differs = gap !== undefined && Math.abs(gap) > AREA_GAP_TOLERANCE;
      const declared = room.planArea === undefined ? '—' : area(room.planArea);
      return `<tr><td>${esc(room.name)}</td><td>${declared}</td><td>${reconstructed}</td><td class="area-gap${differs ? ' differs' : ''}">${gapLabel(gap)}</td></tr>`;
    })
    .join('');
  return `<table class="area-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

/**
 * Contenu de « Plans et précision ». Les surfaces passent en premier : c’est ce qu’on vient
 * vérifier, et les notes du document restent disponibles en dessous.
 */
export function sourceDialogHtml(project: HouseProject, rooms: Room[]): string {
  const compared = rooms.some((room) => room.planArea !== undefined);
  const caveat = compared
    ? 'Écart = reconstruite moins annoncée au plan. Contours enregistrés, pas un relevé sur chantier.'
    : 'Ce projet n’annonce pas de surface au plan : seule la surface reconstruite est affichée.';
  const site = project.site
    ? `<h3>Terrain et extérieur</h3><ul class="source-notes">${project.site.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>`
    : '';
  return `<h2>Les dimensions d’abord.</h2><p class="source-title">${esc(project.source.title)}${project.source.date ? ` · ${esc(project.source.date)}` : ''}</p><span class="status-pill">${esc(project.source.status)}</span><h3>Surfaces : plan et reconstruction</h3>${areaTableHtml(rooms)}<p class="area-note">${caveat}</p><h3>Ce que dit le document</h3><ul class="source-notes">${project.source.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>${site}`;
}
