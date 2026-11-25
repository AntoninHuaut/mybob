import type { Level, Room } from '../model/types';
import { polygonArea } from '../model/geometry';
import { PAINT_PALETTE } from '../model/paint';
import { area, escapeHtml as esc, number } from './format';

/** Renders an SVG icon from the `ui/icons` module (optional size). */
export type PanelIcon = (name: string, size?: number) => string;

export const roomIcon = (room: Room) =>
  room.kind === 'garage'
    ? 'door'
    : room.kind === 'circulation'
      ? 'walk'
      : room.kind === 'storage'
        ? 'layers'
        : 'plan';

/** The reconstructed outline differs from the area stated on the builder's plan. */
export const hasSurfaceDifference = (room: Room) =>
  room.planArea !== undefined && Math.abs(polygonArea(room.polygon) - room.planArea) > 0.1;

export function roomRowsHtml(
  rooms: Room[],
  selectedId: string | undefined,
  icon: PanelIcon,
): string {
  return rooms
    .map(
      (r) =>
        `<button class="room-row${r.id === selectedId ? ' selected' : ''}" data-room="${esc(r.id)}"><span class="room-icon">${icon(roomIcon(r), 17)}</span><span class="room-name">${esc(r.name)}</span><span class="room-area">${number(r.planArea ?? polygonArea(r.polygon))}<small>m²</small>${hasSurfaceDifference(r) ? '<sup title="Le contour reconstruit reste à vérifier">*<span class="sr-only">Contour reconstruit à vérifier</span></sup>' : ''}</span>${icon('chevron', 13)}</button>`,
    )
    .join('');
}

export function roomListNote(hasPlanAreas: boolean): string {
  return hasPlanAreas
    ? 'Surfaces du plan · * contour à vérifier'
    : 'Surfaces calculées depuis le modèle';
}

/** "The project at a glance" card when no room is selected. */
export function roomSummaryHtml(
  level: Level,
  options: { areasFromPlan: boolean; icon: PanelIcon },
): string {
  const living = level.rooms
    .filter((r) => r.kind !== 'garage')
    .reduce((sum, r) => sum + (r.planArea ?? polygonArea(r.polygon)), 0);
  const garage = level.rooms
    .filter((r) => r.kind === 'garage')
    .reduce((sum, r) => sum + (r.planArea ?? polygonArea(r.polygon)), 0);
  return `<div class="eyebrow">LE PROJET EN UN REGARD</div><div class="project-stats"><div><strong>${number(living)}</strong><span>m² habitables${options.areasFromPlan ? ' au plan' : ''}</span></div><div><strong>${number(level.ceilingHeight)}</strong><span>m sous plafond</span></div></div>${garage ? `<div class="garage-stat">${options.icon('door', 15)} Garage <span>${area(garage)}</span></div>` : ''}<p class="detail-hint">Sélectionnez une pièce pour la découvrir.</p>`;
}

export function roomDetailHtml(room: Room, _level: Level, icon: PanelIcon): string {
  const computed = polygonArea(room.polygon);
  const difference = hasSurfaceDifference(room);
  return `<div class="eyebrow">Pièce sélectionnée <button id="clear-room" aria-label="Désélectionner la pièce">${icon('close', 14)}</button></div><h2>${esc(room.name)}</h2><div class="room-detail-area">${area(room.planArea ?? computed)} <span>${room.planArea !== undefined ? 'au plan' : 'calculés'}</span></div><div class="detail-data"><span>Surface reconstruite</span><strong>${area(computed)}</strong></div>${difference ? '<p class="precision-note">Raccords à vérifier : les deux surfaces diffèrent.</p>' : ''}<p class="room-note">${esc(room.note ?? 'Dimensions en mètres, entre les faces intérieures des murs finis.')}</p><button id="visit-room" class="visit-room">Visiter cette pièce ${icon('arrow', 16)}</button>`;
}

export function roomHeightHtml(room: Room, level: Level): string {
  return `<span>Hauteur libre</span><strong>${number(level.ceilingHeight - (room.floorOffset ?? 0))} m</strong>`;
}

export function sceneLabelsHtml(rooms: Room[], selectedId: string | undefined): string {
  return rooms
    .map(
      (r) =>
        `<button class="scene-label${r.id === selectedId ? ' selected' : ''}" data-label="${esc(r.id)}"><span>${esc(r.name)}</span><small>${area(r.planArea ?? polygonArea(r.polygon))}</small></button>`,
    )
    .join('');
}

/**
 * « Peinture des murs » of the room card: suggested paints, any other colour through the
 * native picker, and « Retirer » back to plain plaster. The current colour is pressed.
 */
export function roomPaintHtml(room: Room): string {
  const current = room.wallColor?.toLowerCase();
  const swatches = PAINT_PALETTE.map(
    ({ color, name }) =>
      `<button type="button" class="paint-swatch" data-paint="${color}" style="--swatch: ${color}" title="${esc(name)}" aria-label="${esc(name)}" aria-pressed="${current === color}"></button>`,
  ).join('');
  const custom = current !== undefined && !PAINT_PALETTE.some(({ color }) => color === current);
  return `<div class="room-paint" role="group" aria-labelledby="room-paint-title"><div class="room-paint-head"><span id="room-paint-title">Peinture des murs</span><button type="button" class="text-button" data-paint-clear${current ? '' : ' hidden'}>Retirer</button></div><div class="room-paint-swatches">${swatches}<label class="paint-swatch paint-custom" title="Autre couleur" aria-pressed="${custom}"><input type="color" data-paint-custom value="${current ?? '#eeede8'}" aria-label="Autre couleur"></label></div><button type="button" class="text-button" data-paint-brush aria-pressed="false">Peindre un mur</button><p data-brush-hint hidden>Choisissez une teinte puis cliquez sur un mur de cette pièce. Échap ou clic droit pour terminer.</p></div>`;
}

/** Updates the paint controls in place: the native colour input is never replaced. */
export function syncRoomPaint(host: ParentNode, color: string | undefined) {
  const current = color?.toLowerCase();
  host.querySelectorAll<HTMLElement>('[data-paint]').forEach((swatch) => {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.paint === current));
  });
  const custom = host.querySelector<HTMLElement>('.paint-custom');
  custom?.setAttribute(
    'aria-pressed',
    String(current !== undefined && !PAINT_PALETTE.some((paint) => paint.color === current)),
  );
  const input = host.querySelector<HTMLInputElement>('[data-paint-custom]');
  if (input && current && input.value !== current) input.value = current;
  const clear = host.querySelector<HTMLElement>('[data-paint-clear]');
  if (clear) clear.hidden = !current;
}
