import { userMessage } from '../errorMessage';
import type { HouseProject, Room, WallFacePaint } from '../model/types';
import {
  DEFAULT_PLASTER_COLOR,
  PAINT_COLOR,
  parsePaintOverrides,
  wallFacePaint,
  withPaint,
  type PaintOverrides,
} from '../model/paint';
import { roomPaintHtml, syncRoomPaint } from '../ui/roomPanels';
import { toast } from './dom';
import { app, READ_ONLY_TOAST } from './state';

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
export function paintRoom(
  room: Room,
  color: string | undefined,
  face?: Pick<WallFacePaint, 'wallId' | 'side'>,
): boolean {
  if (app.readOnlyLink) {
    toast(READ_ONLY_TOAST);
    return false;
  }
  if (color !== undefined && !PAINT_COLOR.test(color)) return false;
  const next = color?.toLowerCase();
  const faces = room.wallFaces ?? [];
  const matches = (entry: WallFacePaint) =>
    entry.wallId === face?.wallId && entry.side === face.side;
  if ((face ? faces.find(matches)?.color : room.wallColor) === next) return true;
  const { current, viewer } = app;
  const overrides = readPaint(current.id);
  const choices = overrides[viewer.level.id] ?? {};
  const previous = choices[room.id];
  const detailed = typeof previous === 'object' && previous !== null;
  const remaining = face ? faces.filter((entry) => !matches(entry)) : faces;
  if (face && next) remaining.push({ ...face, color: next });
  const choice = face
    ? { color: detailed ? previous.color : previous, faces: remaining }
    : detailed
      ? { ...previous, color: next ?? null }
      : (next ?? null);
  overrides[viewer.level.id] = { ...choices, [room.id]: choice };
  try {
    localStorage.setItem(paintStorageKey(current.id), JSON.stringify(overrides));
  } catch (error) {
    toast(userMessage(error, 'Peinture non sauvegardée : la mémoire locale est indisponible.'));
    return false;
  }
  if (face) {
    if (remaining.length) room.wallFaces = remaining;
    else delete room.wallFaces;
  } else if (next) room.wallColor = next;
  else delete room.wallColor;
  viewer.repaintWalls();

  return true;
}

let brush: AbortController | undefined;

export function endWallBrush() {
  brush?.abort();
  brush = undefined;
}

/** The room card's paint controls, inserted before `before`. */
export function mountRoomPaint(room: Room, before: Element, onPaint: () => void) {
  const host = document.createElement('div');
  host.innerHTML = roomPaintHtml(room);
  const group = host.firstElementChild!;
  before.before(group);
  const button = group.querySelector<HTMLButtonElement>('[data-paint-brush]')!;
  const hint = group.querySelector<HTMLElement>('[data-brush-hint]')!;
  const sample = group.querySelector<HTMLButtonElement>('[data-paint-sample]')!;
  const paintHint = hint.textContent;
  let sampling = false;
  const setSampling = (active: boolean) => {
    sampling = active;
    sample.setAttribute('aria-pressed', String(active));
    hint.textContent = active
      ? 'Cliquez sur le mur dont vous voulez reprendre la teinte.'
      : paintHint;
  };
  sample.addEventListener('click', () => setSampling(!sampling));
  const clear = group.querySelector<HTMLButtonElement>('[data-paint-clear]')!;
  let brushColor: string | undefined;
  const syncBrush = () => {
    syncRoomPaint(group, brushColor);
    clear.hidden = false;
    clear.textContent = 'Couleur de la pièce';
    clear.setAttribute('aria-pressed', String(brushColor === undefined));
  };
  button.addEventListener('click', () => {
    if (brush) {
      endWallBrush();
      return;
    }
    if (app.readOnlyLink) {
      toast(READ_ONLY_TOAST);
      return;
    }
    const { viewer } = app;
    if (
      (viewer.mode !== 'overview' ||
        viewer.exteriorView ||
        viewer.measureMode ||
        viewer.goToMode) &&
      !viewer.setMode('overview')
    )
      return;
    brush = new AbortController();
    const { signal } = brush;
    brushColor =
      room.wallColor ?? group.querySelector<HTMLInputElement>('[data-paint-custom]')!.value;
    syncBrush();
    hint.hidden = false;
    sample.hidden = false;
    button.setAttribute('aria-pressed', 'true');
    button.textContent = 'Terminer';
    viewer.canvas.classList.add('painting');
    signal.addEventListener('abort', () => {
      setSampling(false);
      sample.hidden = true;
      hint.hidden = true;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = 'Peindre un mur';
      clear.textContent = 'Retirer';
      clear.removeAttribute('aria-pressed');
      viewer.canvas.classList.remove('painting');
      syncRoomPaint(group, room.wallColor);
    });
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          event.stopImmediatePropagation();
          event.preventDefault();
          endWallBrush();
        }
      },
      { capture: true, signal },
    );
    let start: [number, number] | undefined;
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target !== viewer.canvas) {
          if (!group.contains(event.target as Node)) endWallBrush();
          return;
        }
        if (event.button !== 0 && event.button !== 2) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        if (event.button === 2) {
          endWallBrush();
          return;
        }
        start = [event.clientX, event.clientY];
      },
      { capture: true, signal },
    );
    window.addEventListener(
      'pointerup',
      (event) => {
        if (!start || event.button !== 0) return;
        const click =
          event.target === viewer.canvas &&
          Math.hypot(event.clientX - start[0], event.clientY - start[1]) < 6;
        start = undefined;
        event.stopImmediatePropagation();
        if (!click) return;
        const face = viewer.pickWallFace(event.clientX, event.clientY);
        if (sampling) {
          const source =
            face && viewer.level.rooms.find((candidate) => candidate.id === face.roomId);
          if (face && source) {
            brushColor =
              wallFacePaint(source, face.wallId, face.side) ??
              app.current.finishes?.wallColor ??
              DEFAULT_PLASTER_COLOR;
            setSampling(false);
            syncBrush();
          } else toast('Cliquez sur la face d’un mur pour en prélever la teinte.');
          return;
        }
        if (face?.roomId === room.id) {
          if (paintRoom(room, brushColor, { wallId: face.wallId, side: face.side })) onPaint();
        } else toast('Cliquez sur la face d’un mur de la pièce sélectionnée.');
      },
      { capture: true, signal },
    );
  });
  const apply = (color: string | undefined) => {
    if (brush) {
      setSampling(false);
      brushColor = color;
      syncBrush();
      return;
    }
    if (paintRoom(room, color)) onPaint();
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
