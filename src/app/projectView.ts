import type { HouseProject } from '../model/types';
import type { ViewMode } from '../scene/viewer';
import type { WallDisplay } from '../scene/wallCutaway';
import { escapeHtml as esc, number } from '../ui/format';
import { icon } from '../ui/icons';
import { minimap } from '../ui/minimap';
import {
  roomDetailHtml,
  roomHeightHtml,
  roomListNote,
  roomRowsHtml,
  roomSummaryHtml,
  sceneLabelsHtml,
} from '../ui/roomPanels';
import { el, toast } from './dom';
import { app } from './state';
import { mountFurniture, unmountFurniture } from './furnitureController';
import { findProject, firstProject, isImported, renderProjectOptions } from './projectLibrary';
import { applyNavigationPreferences, applyRenderScale } from './preferences';
import { scheduleLinkHashUpdate } from './shareLinkSync';
import { mountRoomPaint, paintedProject } from './roomPaint';
import { setMode, setSidebar, setSidebarTab } from './viewChrome';

/*
 * The displayed project and level: loading them into the viewer, and the room panels (list,
 * card, scene labels, mini-map) that follow the selected room.
 */

export function loadProject(
  id: string,
  levelId?: string,
  override?: HouseProject,
  /** The view to keep across a level change; a project change starts in Vue 3D. */
  keep?: { mode: ViewMode; exterior: boolean },
) {
  const { viewer } = app;
  // A project received by link is not in the project list: reloading it by its identifier
  // (level change) must keep its document and its read-only state, instead of falling back
  // to the demonstration.
  const received =
    override ?? (app.readOnlyLink && app.current?.id === id ? app.current : undefined);
  const stored = received ? undefined : (findProject(id) ?? firstProject());
  // A received project is shown as it was shared; an owned one as painted here.
  const p = received ?? (stored && paintedProject(stored));
  if (!p) return;
  app.readOnlyLink = Boolean(received);
  if (!received) app.receivedShare = undefined;
  unmountFurniture();
  app.current = p;
  app.layoutSession.register(
    p.id,
    p.levels.map((level) => level.id),
  );
  viewer.load(p, levelId);
  app.solarPanel.load(p);
  app.selectedRoom = undefined;
  el<HTMLButtonElement>('#view-exterior').hidden = !p.site;
  viewer.setLights(app.display.lights);
  viewer.setDimensions(app.display.dimensions);
  mountFurniture();
  viewer.setEyeHeight(Number(el<HTMLSelectElement>('#eye-height').value));
  viewer.setWallDisplay(el<HTMLSelectElement>('#wall-display').value as WallDisplay);
  el<HTMLInputElement>('#section-height').max = String(viewer.level.ceilingHeight);
  el('#section-value').textContent =
    `${number(Number(el<HTMLInputElement>('#section-height').value))} m`;
  viewer.setSectionHeight(
    el<HTMLInputElement>('#section-enable').checked
      ? Number(el<HTMLInputElement>('#section-height').value)
      : undefined,
  );
  const projectSelect = el<HTMLSelectElement>('#project-select');
  if (received) {
    // The received project is not in the list: a dedicated entry, removed on the next
    // normal load by renderProjectOptions.
    if (!projectSelect.querySelector(`option[value="${CSS.escape(p.id)}"]`)) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = `${p.name} — reçu`;
      projectSelect.append(option);
    }
  } else {
    renderProjectOptions();
  }
  projectSelect.value = p.id;
  el('#header-project').textContent = p.name;
  el('#project-description').textContent = p.description;
  el('#demo-notice').hidden = p.id !== 'studio-demo';
  el('#received-banner').hidden = !received;
  applyNavigationPreferences();
  applyRenderScale();
  el<HTMLSelectElement>('#level-select').innerHTML = p.levels
    .map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`)
    .join('');
  const removable = isImported(p.id);
  el<HTMLButtonElement>('#remove-project').disabled = !removable;
  el('#remove-project').title = removable
    ? 'Supprimer ce projet de cet ordinateur'
    : 'Les projets fournis ne peuvent pas être supprimés';
  renderLevelChrome();
  setMode('overview');
  // Changing level keeps the view: Extérieur, Plan, or a visit from the new level's
  // start (Vue 3D if no free point is found there).
  if (keep?.exterior && p.site) viewer.setExteriorView(true);
  else if (keep && keep.mode !== 'overview') setMode(keep.mode);
  syncSelection();
  if (!received) {
    try {
      localStorage.setItem('maison-atelier:last-project', p.id);
    } catch {
      /* browser storage may be unavailable */
    }
    scheduleLinkHashUpdate();
  }
}

/** Changes the displayed level of the current project, keeping the view. */
export function loadLevel(levelId: string) {
  loadProject(app.current.id, levelId, undefined, {
    mode: app.viewer.mode,
    exterior: app.viewer.exteriorView,
  });
}

/** A stair taken in the visit changed the displayed level inside the same scene. */
export function handleStairLevelChange() {
  unmountFurniture();
  app.selectedRoom = undefined;
  mountFurniture();
  renderLevelChrome();
  syncSelection();
  if (!app.readOnlyLink) scheduleLinkHashUpdate();
  toast(`Niveau : ${app.viewer.level.name}`);
}

/** Everything in the chrome that describes the displayed level. */
function renderLevelChrome() {
  const level = app.viewer.level;
  el<HTMLInputElement>('#section-height').max = String(level.ceilingHeight);
  el<HTMLSelectElement>('#level-select').value = level.id;
  el('#header-level').textContent = level.name;
  el('#room-count').textContent = String(level.rooms.length).padStart(2, '0');
  renderRooms();
  renderLabels();
  renderMinimap();
  renderRoomDetail();
}

export function syncSelection() {
  const selectedId = app.selectedRoom?.id;
  document.querySelectorAll<HTMLButtonElement>('[data-room], [data-label]').forEach((button) => {
    const selected = (button.dataset.room ?? button.dataset.label) === selectedId;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll<SVGElement>('[data-map-room]').forEach((item) => {
    const room = app.viewer.level.rooms.find((room) => room.id === item.dataset.mapRoom);
    item.setAttribute(
      'fill',
      room?.id === selectedId ? '#cfdfd3' : room?.kind === 'garage' ? '#e5e6df' : '#f1ebdf',
    );
    item.setAttribute('aria-pressed', String(room?.id === selectedId));
  });
}

function renderRooms() {
  const rooms = app.viewer.level.rooms;
  el('#room-list').innerHTML = roomRowsHtml(rooms, app.selectedRoom?.id, icon);
  const note = document.createElement('p');
  note.className = 'room-list-note';
  note.textContent = roomListNote(rooms.some((r) => r.planArea !== undefined));
  el('#room-list').append(note);
  document
    .querySelectorAll<HTMLButtonElement>('[data-room]')
    .forEach((button) => button.addEventListener('click', () => selectRoom(button.dataset.room!)));
}

export function selectRoom(id: string, move = true) {
  app.selectedRoom = app.viewer.level.rooms.find((r) => r.id === id);
  if (!app.selectedRoom) return;
  if (move) setSidebarTab('house');
  if (move && app.viewer.exteriorView) setMode('overview');
  if (move) app.viewer.focusRoom(id);
  syncSelection();
  renderRoomDetail();
}

function renderRoomDetail() {
  const { viewer } = app;
  const room = app.selectedRoom;
  if (!room) {
    el('#room-detail').innerHTML = roomSummaryHtml(viewer.level, {
      areasFromPlan: viewer.level.rooms.some((r) => r.planArea !== undefined),
      icon,
    });
    return;
  }
  el('#room-detail').innerHTML = roomDetailHtml(room, viewer.level, icon);
  el('#visit-room').addEventListener('click', () => {
    if (setMode('walk')) {
      viewer.focusRoom(room.id);
      setSidebar(false);
    }
  });
  const height = document.createElement('div');
  height.className = 'detail-data';
  height.innerHTML = roomHeightHtml(room, viewer.level);
  el('#visit-room').before(height);
  mountRoomPaint(room, el('#visit-room'));
  el('#clear-room').addEventListener('click', () => {
    const previous = app.selectedRoom?.id;
    app.selectedRoom = undefined;
    viewer.house.highlights.forEach((m) => m.setEnabled(false));
    syncSelection();
    renderRoomDetail();
    if (previous)
      document.querySelector<HTMLButtonElement>(`[data-room="${CSS.escape(previous)}"]`)?.focus();
  });
}

function renderLabels() {
  el('#scene-labels').innerHTML = sceneLabelsHtml(app.viewer.level.rooms, app.selectedRoom?.id);
  document
    .querySelectorAll<HTMLButtonElement>('[data-label]')
    .forEach((b) => b.addEventListener('click', () => selectRoom(b.dataset.label!)));
}

function renderMinimap() {
  el('#minimap').innerHTML = minimap(app.viewer.level, app.selectedRoom?.id);
  document.querySelectorAll<SVGElement>('[data-map-room]').forEach((item) => {
    const select = () => selectRoom(item.dataset.mapRoom!);
    item.addEventListener('click', select);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
  });
  el('#mini-caption').textContent = app.viewer.level.name;
}
