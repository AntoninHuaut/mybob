import { userMessage } from '../errorMessage';
import type { HouseProject, Room } from '../model/types';
import { PAINT_COLOR, parsePaintOverrides, withPaint, type PaintOverrides } from '../model/paint';
import { roomPaintHtml, syncRoomPaint } from '../ui/roomPanels';
import { toast } from './dom';
import { app, READ_ONLY_TOAST } from './state';
import { scheduleLinkHashUpdate } from './shareLinkSync';

/*
 * « Peinture des murs »: each room's wall colour. A choice made here is stored per project,
 * apart from the project itself (bundled projects are never rewritten), like the sun
 * settings; exports and links carry the painted project.
 */

export const paintStorageKey = (projectId: string) => `maison-atelier:paint:${projectId}`;

function readPaint(projectId: string): PaintOverrides {
  try {
    return parsePaintOverrides(
      JSON.parse(localStorage.getItem(paintStorageKey(projectId)) ?? '{}'),
    );
  } catch {
    return {}; // A malformed choice must not stop loading a house.
  }
}

/** A project as painted in this browser. */
export function paintedProject(project: HouseProject): HouseProject {
  return withPaint(project, readPaint(project.id));
}

/**
 * Paints a room of the displayed level, or brings it back to plaster (`undefined`). The
 * room object is the one the viewer shows, so the scene only rebuilds its paint.
 */
export function paintRoom(room: Room, color: string | undefined): boolean {
  if (app.readOnlyLink) {
    toast(READ_ONLY_TOAST);
    return false;
  }
  if (color !== undefined && !PAINT_COLOR.test(color)) return false;
  const next = color?.toLowerCase();
  if (room.wallColor === next) return true;
  const { current, viewer } = app;
  const overrides = readPaint(current.id);
  overrides[viewer.level.id] = { ...overrides[viewer.level.id], [room.id]: next ?? null };
  try {
    localStorage.setItem(paintStorageKey(current.id), JSON.stringify(overrides));
  } catch (error) {
    toast(userMessage(error, 'Peinture non sauvegardée : la mémoire locale est indisponible.'));
    return false;
  }
  if (next) room.wallColor = next;
  else delete room.wallColor;
  viewer.repaintWalls();
  scheduleLinkHashUpdate();
  return true;
}

/** The room card's paint controls, inserted before `before`. */
export function mountRoomPaint(room: Room, before: Element) {
  const host = document.createElement('div');
  host.innerHTML = roomPaintHtml(room);
  const group = host.firstElementChild!;
  before.before(group);
  const apply = (color: string | undefined) => {
    paintRoom(room, color);
    syncRoomPaint(group, room.wallColor);
  };
  group.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const swatch = target.closest<HTMLElement>('[data-paint]');
    if (swatch) apply(swatch.dataset.paint);
    else if (target.closest('[data-paint-clear]')) apply(undefined);
  });
  // `change`, not `input`: the picker commits once, when it closes.
  group
    .querySelector<HTMLInputElement>('[data-paint-custom]')!
    .addEventListener('change', (event) => apply((event.target as HTMLInputElement).value));
}
