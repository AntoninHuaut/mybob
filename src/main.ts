import './style.css';
import { HouseViewer, type ViewMode } from './scene/viewer';
import type { HouseProject, Room } from './model/types';
import { validateProject } from './model/validate';
import { bounds, floorElevationAt, polygonArea } from './model/geometry';
import { icon } from './ui/icons';
import { area, escapeHtml as esc, number } from './ui/format';
import { minimap } from './ui/minimap';
import { FurnitureLayer, type FurnitureOverlays } from './furniture/layer';
import { FurniturePanel } from './furniture/panel';
import {
  FurnitureHistory,
  createFurniture,
  loadLayout,
  saveLayout,
  layoutStorageKey,
  validateFurnitureList,
  type FurnitureItem,
} from './furniture/model';
import { checkFurniture, snapFurniture } from './furniture/checks';
import { deliveryChecks } from './furniture/delivery';

const STORAGE = 'maison-atelier:projects:v1';
const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let viewer: HouseViewer;
let projects: HouseProject[] = [];
let imported: HouseProject[] = [];
let builtins: HouseProject[] = [];
let current: HouseProject;
let selectedRoom: Room | undefined;
let showLabels = true;
let showDimensions = false;
let ceiling = false;
let exteriorView = false;
let lights = true;
let mode: ViewMode = 'overview';
let toastTimer: ReturnType<typeof setTimeout>;
const furnitureHistory = new FurnitureHistory();
let furnitureLayer: FurnitureLayer | undefined;
let furniturePanel: FurniturePanel | undefined;
let selectedFurnitureId: string | undefined;
let previewFurniture: FurnitureItem[] | undefined;
let draggingFurniture = false;
let overlays: FurnitureOverlays = { distances: true, clearances: false, openings: false };
let syncingViewerMode = false;

el('#app').innerHTML = `
  <header class="app-header">
    <button id="toggle-sidebar" class="mobile-menu-button" aria-controls="project-sidebar" aria-expanded="false" aria-label="Afficher les pièces et projets">${icon('layers', 20)}</button>
    <a class="brand" href="#" aria-label="Maison, revenir à la vue d’ensemble"><span class="brand-mark">${icon('house', 23)}</span><span>maison<span class="brand-dot">.</span><small>ATELIER 3D</small></span></a>
    <div class="header-separator"></div><div class="project-breadcrumb"><span id="header-project">Votre espace</span>${icon('chevron', 13)}<span id="header-level">Rez-de-chaussée</span></div>
    <div class="header-actions"><span class="version-badge"><i></i> Version 2</span><button class="text-button" id="export-project" title="Exporter les données du projet">${icon('export', 17)}<span>Exporter le projet</span></button><button class="icon-button" id="help" title="Aide et commandes" aria-label="Aide et commandes">${icon('help')}</button></div>
  </header>
  <div class="workspace">
    <button class="sidebar-backdrop" aria-label="Fermer le panneau des pièces" hidden></button>
    <aside class="sidebar" id="project-sidebar" aria-label="Projets et pièces">
      <section class="project-section"><div class="eyebrow">VOTRE PROJET <span>01</span></div><label for="project-select" class="sr-only">Choisir une maison</label><div class="select-wrap"><span class="select-icon">${icon('house', 20)}</span><select id="project-select"></select>${icon('down', 15)}</div><p id="project-description" class="muted"></p><p id="demo-notice" class="demo-notice" hidden>Vous consultez une démonstration. Importez le fichier JSON de votre maison pour afficher votre projet. Il reste dans ce navigateur.</p><button id="import-project" class="import-button">${icon('plus', 16)} Importer ma maison</button><input type="file" id="import-file" accept="application/json,.json" hidden/><button id="remove-project" class="remove-project" hidden>${icon('trash', 14)} Retirer ce projet importé</button></section>
      <section id="furniture-panel" aria-label="Aménager la maison"></section>
      <details class="navigation-settings"><summary>Déplacement et vue</summary><div class="navigation-settings-body"><button id="go-to" class="visit-room" aria-pressed="false">Cliquer pour entrer ici</button><p>Choisissez un point libre du sol, puis explorez au clavier.</p><label>Vitesse de marche <output id="walk-speed-value">2,8 m/s</output><input id="walk-speed" type="range" min="1" max="5" step="0.2" value="2.8"></label><label>Sensibilité de la souris <output id="look-sensitivity-value">100 %</output><input id="look-sensitivity" type="range" min="50" max="200" step="10" value="100"></label><small>Maj pour marcher plus vite. Ces réglages sont conservés sur cet ordinateur.</small><label>Hauteur du regard<select id="eye-height"><option value="1.65">Debout · 1,65 m</option><option value="1.15">Assis · 1,15 m</option><option value="0.95">À 0,95 m</option><option value="1.80">À 1,80 m</option></select></label><label class="navigation-check"><input type="checkbox" id="cutaway"> Masquer les façades gênantes</label><label class="navigation-check"><input type="checkbox" id="section-enable"> Vue en coupe</label><label>Hauteur de coupe <output id="section-value">1,20 m</output><input id="section-height" type="range" min="0.4" max="2.5" step="0.05" value="1.2" disabled></label><small>La coupe et les façades masquées servent aux vues de dessus. La visite conserve les volumes complets.</small></div></details>
      <section class="level-section"><div class="eyebrow">EXPLORER LES ESPACES <span id="room-count"></span></div><label for="level-select" class="sr-only">Choisir le niveau</label><div class="level-selector">${icon('layers', 17)}<select id="level-select"></select><span class="level-dot"></span></div><div id="room-list" class="room-list"></div></section>
      <section class="room-detail" id="room-detail"></section>
      <div class="sidebar-bottom"><button class="source-button" id="source-info">${icon('info', 17)}<span>Plans & précision du modèle<small>Cotes, hypothèses et points à vérifier</small></span>${icon('chevron', 15)}</button><div class="sidebar-footnote">Un espace pour se projeter.</div></div>
    </aside>
    <main class="viewport" id="viewport" aria-label="Atelier de visite 3D">
      <canvas id="scene" tabindex="0" aria-label="Vue 3D de la maison. Utilisez le bouton Visite pour vous déplacer au clavier."></canvas>
      <div class="viewport-top"><div class="view-heading"><span class="eyebrow" id="view-eyebrow">VOTRE MAISON, EN PERSPECTIVE</span><h1 id="view-title">Prenez de la hauteur.</h1><p id="view-subtitle">Explorez les volumes, à votre rythme.</p></div><div class="view-switch" role="group" aria-label="Mode de visualisation"><button data-view="overview" class="active" aria-pressed="true">${icon('cube', 17)}Vue 3D</button><button id="view-exterior" aria-pressed="false" hidden>${icon('house', 17)}Extérieur</button><button data-view="plan" aria-pressed="false">${icon('plan', 17)}Plan</button><button data-view="walk" aria-pressed="false">${icon('walk', 17)}Visite</button></div></div>
      <div class="floating-tools" role="group" aria-label="Options d’affichage"><button class="tool-button" id="tool-measure" aria-pressed="false" title="Mesurer une distance au sol">${icon('ruler')}<span>Mesurer</span></button><div class="tool-divider"></div><button class="tool-button active" id="tool-labels" aria-pressed="true" title="Afficher les noms des pièces">${icon('label')}<span>Pièces</span></button><button class="tool-button" id="tool-dimensions" aria-pressed="false" title="Afficher les dimensions extérieures">${icon('plan')}<span>Cotes</span></button><button class="tool-button active" id="tool-lights" aria-pressed="true" title="Allumer les éclairages intérieurs">${icon('sun')}<span>Lumière</span></button><button class="tool-button" id="tool-ceiling" aria-pressed="false" title="Afficher le plafond en vue 3D">${icon('roof')}<span>Plafond</span></button><div class="tool-divider"></div><button class="tool-button" id="tool-reset" title="Recentrer la vue">${icon('reset')}<span>Recentrer</span></button></div>
      <div id="scene-labels" class="scene-labels"></div>
      <div class="dimension-label" id="width-label" hidden></div><div class="dimension-label" id="depth-label" hidden></div>
      <div id="measure-label" class="measurement-label" hidden></div>
      <div id="measure-instructions" class="measure-instructions" hidden>${icon('ruler', 17)}<span>Cliquez sur deux points du sol.</span><button id="end-measure" aria-label="Quitter la mesure">${icon('close', 15)}</button></div>
      <div id="crosshair" class="crosshair" hidden></div>
      <div id="door-prompt" class="door-prompt" hidden><kbd>E</kbd> Ouvrir / fermer la porte</div>
      <div id="walk-start" class="walk-start" hidden><div class="walk-start-icon">${icon('walk', 25)}</div><h2>Bienvenue chez vous.</h2><p>Avancez avec <strong>ZQSD</strong> ou les <strong>flèches</strong>.<br>Regardez autour de vous avec la souris.</p><button class="primary-button" id="capture-mouse">Entrer dans la visite ${icon('arrow', 17)}</button><small>Échap pour libérer la souris · E pour une porte</small></div>
      <button id="resume-walk" class="resume-walk" hidden>${icon('mouse', 17)} Reprendre la visite</button>
      <div class="orientation" title="Direction du haut du document de référence"><span>HAUT DU PLAN</span><svg id="orientation-arrow" width="23" height="23" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 6 18-6-4-6 4Z" fill="currentColor"/></svg></div>
      <div class="mini-card"><div class="mini-heading"><span>VOUS REPÉRER</span><button id="mini-plan" aria-label="Ouvrir la vue en plan" title="Vue en plan">${icon('plan', 15)}</button></div><div id="minimap"></div><div class="mini-caption" id="mini-caption">Rez-de-chaussée</div></div>
      <div class="bottom-controls"><div class="control-hint" id="control-hint">${icon('mouse', 17)}<span>Glisser pour tourner</span><i></i><span>Molette pour zoomer</span><i></i><span>Clic droit pour déplacer</span></div><div class="scale-note"><span class="scale-line"></span> Dimensions en mètres</div></div>
      <div id="layout-status" class="layout-status" role="status">Aménagement sauvegardé sur cet ordinateur</div>
      <div class="loading" id="loading"><div class="loading-mark">${icon('house', 35)}</div><span>Votre maison prend forme…</span></div>
      <div id="fatal-error" class="fatal-error" hidden></div>
    </main>
  </div>
  <div class="toast" id="toast" role="status" hidden></div>
  <dialog id="info-dialog" aria-labelledby="dialog-eyebrow"><div class="dialog-heading"><span class="eyebrow" id="dialog-eyebrow"></span><button id="close-dialog" class="icon-button" aria-label="Fermer">${icon('close')}</button></div><div id="dialog-content"></div></dialog>
`;

function toast(message: string) {
  clearTimeout(toastTimer);
  el('#toast').textContent = message;
  el('#toast').hidden = false;
  toastTimer = setTimeout(() => {
    el('#toast').hidden = true;
  }, 5000);
}

function activeButton(selector: string, active: boolean) {
  el(selector).classList.toggle('active', active);
  el(selector).setAttribute('aria-pressed', String(active));
}

function currentFurniture() {
  return previewFurniture ?? furnitureHistory.items;
}

function persistFurniture() {
  try {
    saveLayout(current.id, viewer.level.id, furnitureHistory.items);
    el('#layout-status').textContent = 'Aménagement sauvegardé sur cet ordinateur';
    el('#layout-status').classList.remove('unsaved');
  } catch (error) {
    el('#layout-status').textContent = 'Non sauvegardé · exportez le projet';
    el('#layout-status').classList.add('unsaved');
    toast(error instanceof Error ? error.message : 'Sauvegarde indisponible.');
  }
}

function syncFurniture(save = true) {
  previewFurniture = undefined;
  if (!furnitureHistory.items.some((item) => item.id === selectedFurnitureId))
    selectedFurnitureId = undefined;
  furnitureLayer?.setItems(furnitureHistory.items);
  furnitureLayer?.select(selectedFurnitureId);
  furniturePanel?.render();
  if (save) persistFurniture();
}

function commitFurniture(items: FurnitureItem[]) {
  try {
    furnitureHistory.commit(items);
  } catch (error) {
    previewFurniture = undefined;
    furnitureLayer?.setItems(furnitureHistory.items);
    toast(error instanceof Error ? error.message : 'Modification invalide.');
    return;
  }
  syncFurniture();
}

function selectFurniture(id: string | undefined) {
  if (id && exteriorView) setMode('overview');
  selectedFurnitureId = id;
  furnitureLayer?.select(id);
  furniturePanel?.render();
}

function mountFurniture() {
  let items: FurnitureItem[] = [];
  let restoreError = false;
  try {
    items = loadLayout(current.id, viewer.level.id);
  } catch (error) {
    restoreError = true;
    toast(error instanceof Error ? error.message : 'Aménagement illisible.');
  }
  furnitureHistory.reset(items);
  selectedFurnitureId = undefined;
  previewFurniture = undefined;
  furnitureLayer = new FurnitureLayer(viewer.scene, viewer.level);
  furnitureLayer.setItems(items);
  furnitureLayer.setOverlays(overlays);
  furnitureLayer.onSelect = selectFurniture;
  furnitureLayer.onDragState = (dragging) => {
    draggingFurniture = dragging;
    if (dragging) viewer.orbit.detachControl();
    else if (mode !== 'walk') viewer.orbit.attachControl(viewer.canvas, true);
  };
  furnitureLayer.onChange = (next, final) => {
    if (final) commitFurniture(next);
    else previewFurniture = next;
  };
  if (!furniturePanel)
    furniturePanel = new FurniturePanel(el('#furniture-panel'), {
      getItems: currentFurniture,
      getSelectedId: () => selectedFurnitureId,
      getLevel: () => viewer.level,
      getAddPosition: () => selectedRoom?.viewpoint ?? viewer.level.spawn.position,
      canUndo: () => furnitureHistory.canUndo,
      canRedo: () => furnitureHistory.canRedo,
      onAdd: (item) => {
        if (exteriorView) setMode('overview');
        selectedFurnitureId = item.id;
        commitFurniture([...currentFurniture(), item]);
        setSidebar(false);
      },
      onUpdate: (item) =>
        commitFurniture(
          currentFurniture().map((previous) => (previous.id === item.id ? item : previous)),
        ),
      onDelete: (id) => commitFurniture(currentFurniture().filter((item) => item.id !== id)),
      onDuplicate: (id) => {
        const item = currentFurniture().find((candidate) => candidate.id === id);
        if (!item) return;
        const copy = createFurniture({
          ...item,
          id: undefined,
          name: `${item.name} (copie)`,
          locked: false,
          position: [item.position[0] + 0.2, item.position[1] + 0.2],
        });
        selectedFurnitureId = copy.id;
        commitFurniture([...currentFurniture(), copy]);
      },
      onSelect: selectFurniture,
      onUndo: () => {
        if (furnitureHistory.undo()) syncFurniture();
      },
      onRedo: () => {
        if (furnitureHistory.redo()) syncFurniture();
      },
      onSnap: (id) => {
        const items = currentFurniture(),
          item = items.find((candidate) => candidate.id === id);
        if (!item || item.locked) return;
        const snapped = snapFurniture(item, viewer.level, items, 0.3);
        if (
          Math.hypot(
            snapped.position[0] - item.position[0],
            snapped.position[1] - item.position[1],
          ) < 0.001
        )
          toast('Rapprochez le meuble du mur (moins de 30 cm), puis réessayez.');
        commitFurniture(items.map((candidate) => (candidate.id === id ? snapped : candidate)));
      },
      onOverlays: (options) => {
        overlays = options;
        furnitureLayer?.setOverlays(options);
      },
      getChecks: () => [
        ...checkFurniture(currentFurniture(), viewer.level),
        ...deliveryChecks(currentFurniture(), viewer.level),
      ],
      onToast: toast,
      onDialogState: (open) => {
        if (open && document.pointerLockElement) document.exitPointerLock();
        viewer.setPaused(open);
      },
    });
  furniturePanel.render();
  el('#layout-status').textContent = restoreError
    ? 'Aménagement non restauré · importez une sauvegarde'
    : 'Aménagement sauvegardé sur cet ordinateur';
  el('#layout-status').classList.toggle('unsaved', restoreError);
}

function setSidebar(open: boolean) {
  el('.workspace').classList.toggle('sidebar-open', open);
  el('#toggle-sidebar').setAttribute('aria-expanded', String(open));
  el('#toggle-sidebar').setAttribute(
    'aria-label',
    open ? 'Masquer les pièces et projets' : 'Afficher les pièces et projets',
  );
  el('.sidebar-backdrop').hidden = !open;
}

function syncDisplayControls() {
  const measuring = viewer.measureMode;
  activeButton('#go-to', viewer.goToMode);
  activeButton('#view-exterior', exteriorView);
  const overviewButton = document.querySelector<HTMLButtonElement>('[data-view=overview]')!;
  overviewButton.classList.toggle('active', mode === 'overview' && !exteriorView);
  overviewButton.setAttribute('aria-pressed', String(mode === 'overview' && !exteriorView));
  el('#scene-labels').hidden =
    mode === 'walk' ||
    exteriorView ||
    !showLabels ||
    measuring ||
    viewer.goToMode ||
    (ceiling && mode === 'overview');
  el<HTMLButtonElement>('#go-to').disabled = mode === 'walk';
  furnitureLayer?.setMode(
    mode === 'walk' || exteriorView || measuring || viewer.goToMode ? 'walk' : mode,
  );
  el('#measure-instructions').hidden = !measuring;
  activeButton('#tool-measure', measuring);
  activeButton('#tool-labels', showLabels);
  activeButton('#tool-ceiling', ceiling && mode === 'overview');
  for (const id of ['tool-measure', 'tool-labels', 'tool-dimensions', 'tool-ceiling']) {
    el<HTMLButtonElement>(`#${id}`).disabled =
      mode === 'walk' ||
      exteriorView ||
      (id === 'tool-ceiling' && mode === 'plan') ||
      (measuring && ['tool-labels', 'tool-ceiling'].includes(id));
  }
}

function syncSelection() {
  document.querySelectorAll<HTMLButtonElement>('[data-room], [data-label]').forEach((button) => {
    const selected = (button.dataset.room ?? button.dataset.label) === selectedRoom?.id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll<SVGElement>('[data-map-room]').forEach((item) => {
    const room = viewer.level.rooms.find((room) => room.id === item.dataset.mapRoom);
    item.setAttribute(
      'fill',
      room?.id === selectedRoom?.id ? '#cfdfd3' : room?.kind === 'garage' ? '#e5e6df' : '#f1ebdf',
    );
    item.setAttribute('aria-pressed', String(room?.id === selectedRoom?.id));
  });
}

function renderProjectOptions() {
  const importedIds = new Set(imported.map((p) => p.id));
  projects = [...builtins.filter((p) => !importedIds.has(p.id)), ...imported];
  el<HTMLSelectElement>('#project-select').innerHTML = projects
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join('');
}

function loadProject(id: string, levelId?: string) {
  const p = projects.find((p) => p.id === id) ?? projects[0];
  if (!p) return;
  furnitureLayer?.dispose();
  furnitureLayer = undefined;
  current = p;
  viewer.load(p, levelId);
  selectedRoom = undefined;
  mode = 'overview';
  ceiling = false;
  exteriorView = false;
  el<HTMLButtonElement>('#view-exterior').hidden = !p.site;
  viewer.setCeiling(false);
  viewer.setLights(lights);
  viewer.setDimensions(showDimensions);
  mountFurniture();
  viewer.setEyeHeight(Number(el<HTMLSelectElement>('#eye-height').value));
  viewer.setCutaway(el<HTMLInputElement>('#cutaway').checked);
  el<HTMLInputElement>('#section-height').max = String(viewer.level.ceilingHeight);
  el('#section-value').textContent =
    `${number(Number(el<HTMLInputElement>('#section-height').value))} m`;
  viewer.setSectionHeight(
    el<HTMLInputElement>('#section-enable').checked
      ? Number(el<HTMLInputElement>('#section-height').value)
      : undefined,
  );
  el<HTMLSelectElement>('#project-select').value = p.id;
  el('#header-project').textContent = p.name;
  el('#project-description').textContent = p.description;
  el('#demo-notice').hidden = p.id !== 'studio-demo';
  applyNavigationPreferences();
  el<HTMLSelectElement>('#level-select').innerHTML = p.levels
    .map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`)
    .join('');
  el<HTMLSelectElement>('#level-select').value = viewer.level.id;
  el('#header-level').textContent = viewer.level.name;
  el('#room-count').textContent = String(viewer.level.rooms.length).padStart(2, '0');
  el('#remove-project').hidden = !imported.some((project) => project.id === current.id);
  renderRooms();
  renderLabels();
  renderMinimap();
  renderRoomDetail();
  setMode('overview');
  syncSelection();
  try {
    localStorage.setItem('maison-atelier:last-project', p.id);
  } catch {
    /* browser storage may be unavailable */
  }
}

const roomIcon = (room: Room) =>
  room.kind === 'garage'
    ? 'door'
    : room.kind === 'circulation'
      ? 'walk'
      : room.kind === 'storage'
        ? 'layers'
        : 'plan';
const hasSurfaceDifference = (room: Room) =>
  room.planArea !== undefined && Math.abs(polygonArea(room.polygon) - room.planArea) > 0.1;
function renderRooms() {
  el('#room-list').innerHTML = viewer.level.rooms
    .map(
      (r) =>
        `<button class="room-row${r.id === selectedRoom?.id ? ' selected' : ''}" data-room="${esc(r.id)}"><span class="room-icon">${icon(roomIcon(r), 17)}</span><span class="room-name">${esc(r.name)}</span><span class="room-area">${number(r.planArea ?? polygonArea(r.polygon))}<small>m²</small>${hasSurfaceDifference(r) ? '<sup title="Le contour reconstruit reste à vérifier">*<span class="sr-only">Contour reconstruit à vérifier</span></sup>' : ''}</span>${icon('chevron', 13)}</button>`,
    )
    .join('');
  const note = document.createElement('p');
  note.className = 'room-list-note';
  note.textContent = viewer.level.rooms.some((r) => r.planArea !== undefined)
    ? 'Surfaces du plan · * contour à vérifier'
    : 'Surfaces calculées depuis le modèle';
  el('#room-list').append(note);
  document
    .querySelectorAll<HTMLButtonElement>('[data-room]')
    .forEach((button) => button.addEventListener('click', () => selectRoom(button.dataset.room!)));
}

function selectRoom(id: string, move = true) {
  selectedRoom = viewer.level.rooms.find((r) => r.id === id);
  if (!selectedRoom) return;
  if (move && exteriorView) setMode('overview');
  if (move) viewer.focusRoom(id);
  syncSelection();
  renderRoomDetail();
}

function renderRoomDetail() {
  const room = selectedRoom;
  if (!room) {
    const living = viewer.level.rooms
      .filter((r) => r.kind !== 'garage')
      .reduce((sum, r) => sum + (r.planArea ?? polygonArea(r.polygon)), 0);
    const garage = viewer.level.rooms
      .filter((r) => r.kind === 'garage')
      .reduce((sum, r) => sum + (r.planArea ?? polygonArea(r.polygon)), 0);
    el('#room-detail').innerHTML =
      `<div class="eyebrow">LE PROJET EN UN REGARD</div><div class="project-stats"><div><strong>${number(living)}</strong><span>m² habitables${current.id === 'private-project' ? ' au plan' : ''}</span></div><div><strong>${number(viewer.level.ceilingHeight)}</strong><span>m sous plafond</span></div></div>${garage ? `<div class="garage-stat">${icon('door', 15)} Garage <span>${area(garage)}</span></div>` : ''}<p class="detail-hint">Sélectionnez une pièce pour la découvrir.</p>`;
    return;
  }
  const computed = polygonArea(room.polygon);
  const difference = hasSurfaceDifference(room);
  el('#room-detail').innerHTML =
    `<div class="eyebrow">ESPACE SÉLECTIONNÉ <button id="clear-room" aria-label="Désélectionner la pièce">${icon('close', 14)}</button></div><h2>${esc(room.name)}</h2><div class="room-detail-area">${area(room.planArea ?? computed)} <span>${room.planArea !== undefined ? 'au plan' : 'calculés'}</span></div><div class="detail-data"><span>Surface reconstruite</span><strong>${area(computed)}</strong></div>${difference ? '<p class="precision-note">Raccords à vérifier : les deux surfaces diffèrent.</p>' : ''}<p class="room-note">${esc(room.note ?? 'Dimensions en mètres, entre les faces intérieures des murs finis.')}</p><button id="visit-room" class="visit-room">Visiter cette pièce ${icon('arrow', 16)}</button>`;
  el('#visit-room').addEventListener('click', () => {
    if (setMode('walk')) {
      viewer.focusRoom(room.id);
      setSidebar(false);
    }
  });
  const height = document.createElement('div');
  height.className = 'detail-data';
  height.innerHTML = `<span>Hauteur libre</span><strong>${number(viewer.level.ceilingHeight - (room.floorOffset ?? 0))} m</strong>`;
  el('#visit-room').before(height);
  el('#clear-room').addEventListener('click', () => {
    const previous = selectedRoom?.id;
    selectedRoom = undefined;
    viewer.house.highlights.forEach((m) => m.setEnabled(false));
    syncSelection();
    renderRoomDetail();
    if (previous)
      document.querySelector<HTMLButtonElement>(`[data-room="${CSS.escape(previous)}"]`)?.focus();
  });
}

function renderLabels() {
  el('#scene-labels').innerHTML = viewer.level.rooms
    .map(
      (r) =>
        `<button class="scene-label${r.id === selectedRoom?.id ? ' selected' : ''}" data-label="${esc(r.id)}"><span>${esc(r.name)}</span><small>${area(r.planArea ?? polygonArea(r.polygon))}</small></button>`,
    )
    .join('');
  document
    .querySelectorAll<HTMLButtonElement>('[data-label]')
    .forEach((b) => b.addEventListener('click', () => selectRoom(b.dataset.label!)));
}

function renderMinimap() {
  el('#minimap').innerHTML = minimap(viewer.level, selectedRoom?.id);
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
  el('#mini-caption').textContent = viewer.level.name;
}

function setMode(next: ViewMode, fromViewer = false): boolean {
  if (
    next === 'walk' &&
    matchMedia('(pointer: coarse)').matches &&
    !matchMedia('(any-pointer: fine)').matches
  ) {
    openDialog(
      'VISITE SUR ORDINATEUR',
      '<h2>La visite utilise un clavier et une souris.</h2><p>Sur téléphone, vous pouvez consulter le plan et faire tourner la vue 3D avec les doigts. Ouvrez ce même lien sur ordinateur pour marcher dans la maison.</p>',
    );
    return false;
  }
  mode = next;
  if (exteriorView && (next !== 'overview' || !fromViewer)) {
    exteriorView = false;
    viewer.setExteriorView(false);
  }
  if (viewer.mode !== next) {
    syncingViewerMode = true;
    viewer.setMode(next);
    syncingViewerMode = false;
  }
  if (viewer.mode !== next) {
    mode = viewer.mode;
    return false;
  }
  furnitureLayer?.setMode(next);
  if (selectedRoom && !fromViewer) viewer.focusRoom(selectedRoom.id);
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === next);
    b.setAttribute('aria-pressed', String(b.dataset.view === next));
  });
  el('#viewport').classList.toggle('walking', next === 'walk');
  const titles = {
    overview: [
      'VOTRE MAISON, EN PERSPECTIVE',
      'Prenez de la hauteur.',
      'Explorez les volumes, à votre rythme.',
    ],
    plan: [
      'LES VOLUMES, À L’ÉCHELLE',
      'Chaque mètre compte.',
      'Retrouvez la disposition et les proportions des pièces.',
    ],
    walk: [
      'À HAUTEUR DE REGARD',
      'Entrez chez vous.',
      `Une visite à ${number(Number(el<HTMLSelectElement>('#eye-height').value))} m du sol.`,
    ],
  };
  const title = titles[next];
  el('#view-eyebrow').textContent = title[0];
  el('#view-title').textContent = title[1];
  el('#view-subtitle').textContent = title[2];
  el('#walk-start').hidden = next !== 'walk';
  el('#resume-walk').hidden = true;
  el('#crosshair').hidden = next !== 'walk';
  el('#scene-labels').hidden = next === 'walk' || !showLabels || (ceiling && next === 'overview');
  el('#control-hint').innerHTML =
    next === 'walk'
      ? `<kbd>ZQSD</kbd><span>ou flèches</span><i></i><kbd>E</kbd><span>Portes</span><i></i><kbd>Échap</kbd><span>Libérer la souris</span>`
      : next === 'plan'
        ? `${icon('mouse', 17)}<span>Clic droit pour déplacer</span><i></i><span>Cliquer sur une pièce pour la sélectionner</span>`
        : `${icon('mouse', 17)}<span>Glisser pour tourner</span><i></i><span>Molette pour zoomer</span><i></i><span>Clic droit pour déplacer</span>`;
  syncDisplayControls();
  el('#measure-instructions').hidden = true;
  el('#measure-label').hidden = true;
  el('#width-label').hidden = !showDimensions || next === 'walk';
  el('#depth-label').hidden = !showDimensions || next === 'walk';
  el('#door-prompt').hidden = true;
  return true;
}

function openDialog(title: string, content: string) {
  if (document.pointerLockElement) document.exitPointerLock();
  viewer.setPaused(true);
  el('#dialog-eyebrow').textContent = title;
  el('#dialog-content').innerHTML = content;
  el<HTMLDialogElement>('#info-dialog').showModal();
}

function downloadProject() {
  let levels: Record<string, FurnitureItem[]>;
  try {
    levels = Object.fromEntries(
      current.levels.map((level) => [
        level.id,
        level.id === viewer.level.id ? currentFurniture() : loadLayout(current.id, level.id),
      ]),
    );
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Export indisponible.');
    return;
  }
  const blob = new Blob(
    [JSON.stringify({ ...current, furnishing: { version: 1, levels } }, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${current.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Les données de votre maison ont été exportées.');
}

async function importProject(file: File) {
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('Le projet doit peser moins de 32 Mo.');
    const project = validateProject(JSON.parse(await file.text()));
    const furnishing = (
      project as HouseProject & {
        furnishing?: { version: number; levels: Record<string, unknown> };
      }
    ).furnishing;
    const staged: [string, FurnitureItem[]][] = [];
    if (furnishing !== undefined) {
      if (
        !furnishing ||
        furnishing.version !== 1 ||
        !furnishing.levels ||
        typeof furnishing.levels !== 'object' ||
        Array.isArray(furnishing.levels)
      )
        throw new Error('Aménagement exporté invalide.');
      for (const level of project.levels)
        if (Object.hasOwn(furnishing.levels, level.id))
          staged.push([level.id, validateFurnitureList(furnishing.levels[level.id])]);
    }
    delete (project as HouseProject & { furnishing?: unknown }).furnishing;
    const previous = imported;
    const previousProjectId = current.id;
    const previousLevelId = viewer.level.id;
    const next = [...imported.filter((p) => p.id !== project.id), project];
    if (next.length > 10) throw new Error('Vous pouvez conserver jusqu’à 10 projets importés.');
    const backups = staged.map(
      ([levelId]) =>
        [
          layoutStorageKey(project.id, levelId),
          localStorage.getItem(layoutStorageKey(project.id, levelId)),
        ] as const,
    );
    try {
      for (const [levelId, items] of staged) saveLayout(project.id, levelId, items);
      localStorage.setItem(STORAGE, JSON.stringify(next));
    } catch {
      for (const [key, value] of backups) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      throw new Error(
        'La mémoire locale est indisponible ou pleine. Exportez vos projets avant de libérer de la place.',
      );
    }
    imported = next;
    try {
      renderProjectOptions();
      loadProject(project.id);
    } catch (error) {
      imported = previous;
      for (const [key, value] of backups) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      localStorage.setItem(STORAGE, JSON.stringify(previous));
      renderProjectOptions();
      loadProject(previousProjectId, previousLevelId);
      throw error;
    }
    toast('Maison importée et conservée dans ce navigateur.');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Impossible de lire ce projet.');
  }
}

const NAVIGATION_STORAGE = 'maison-atelier:navigation:v1';
function applyNavigationPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE) ?? '{}');
    if (typeof saved?.speed === 'number' && Number.isFinite(saved.speed))
      el<HTMLInputElement>('#walk-speed').value = String(Math.max(1, Math.min(5, saved.speed)));
    if (typeof saved?.sensitivity === 'number' && Number.isFinite(saved.sensitivity))
      el<HTMLInputElement>('#look-sensitivity').value = String(
        Math.max(50, Math.min(200, saved.sensitivity)),
      );
  } catch {
    /* Use the defaults if preferences are unavailable. */
  }
  updateNavigationPreferences(false);
}
function updateNavigationPreferences(save = true) {
  const speed = Number(el<HTMLInputElement>('#walk-speed').value);
  const sensitivity = Number(el<HTMLInputElement>('#look-sensitivity').value);
  viewer.setWalkSpeed(speed);
  viewer.setLookSensitivity(sensitivity / 100);
  el('#walk-speed-value').textContent = `${number(speed)} m/s`;
  el('#look-sensitivity-value').textContent = `${sensitivity} %`;
  if (save) {
    try {
      localStorage.setItem(NAVIGATION_STORAGE, JSON.stringify({ speed, sensitivity }));
    } catch {
      /* Preferences are optional; scene and project still work. */
    }
  }
}

function wireEvents() {
  el('#walk-speed').addEventListener('input', () => updateNavigationPreferences());
  el('#look-sensitivity').addEventListener('input', () => updateNavigationPreferences());
  el('#go-to').addEventListener('click', () => {
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) {
      setMode('walk');
      return;
    }
    const enabled = !el('#go-to').classList.contains('active');
    viewer.setGoToMode(enabled);
    activeButton('#go-to', enabled);
    syncDisplayControls();
    if (enabled) {
      setSidebar(false);
      toast('Cliquez sur un point libre du sol pour y commencer la visite.');
    }
  });
  el<HTMLSelectElement>('#eye-height').addEventListener('change', (event) => {
    const height = viewer.setEyeHeight(Number((event.target as HTMLSelectElement).value));
    if (mode === 'walk')
      el('#view-subtitle').textContent = `Une visite à ${number(height)} m du sol.`;
  });
  el<HTMLInputElement>('#cutaway').addEventListener('change', (event) =>
    viewer.setCutaway((event.target as HTMLInputElement).checked),
  );
  const updateSection = () => {
    const enabled = el<HTMLInputElement>('#section-enable').checked,
      height = Number(el<HTMLInputElement>('#section-height').value);
    el<HTMLInputElement>('#section-height').disabled = !enabled;
    el('#section-value').textContent = `${number(height)} m`;
    viewer.setSectionHeight(enabled ? height : undefined);
  };
  el('#section-enable').addEventListener('change', updateSection);
  el('#section-height').addEventListener('input', updateSection);
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        mode === 'walk' ||
        draggingFurniture ||
        document.querySelector('dialog[open]') ||
        (event.target instanceof HTMLElement &&
          (event.target.matches('input,textarea,select') || event.target.isContentEditable))
      )
        return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && ['KeyZ', 'KeyY'].includes(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.code === 'KeyY' || event.shiftKey) furnitureHistory.redo();
        else furnitureHistory.undo();
        syncFurniture();
        return;
      }
      const item = currentFurniture().find((candidate) => candidate.id === selectedFurnitureId);
      if (!item) return;
      if (event.code === 'Escape') {
        selectFurniture(undefined);
        return;
      }
      if (item.locked) return;
      const step = event.shiftKey ? 0.1 : 0.01;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (delta[event.code]) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const d = delta[event.code];
        commitFurniture(
          currentFurniture().map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  position: [candidate.position[0] + d[0], candidate.position[1] + d[1]],
                }
              : candidate,
          ),
        );
      } else if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault();
        commitFurniture(currentFurniture().filter((candidate) => candidate.id !== item.id));
      } else if (event.code === 'KeyR' && !modifier) {
        event.preventDefault();
        commitFurniture(
          currentFurniture().map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  rotation: candidate.rotation + ((event.shiftKey ? -1 : 1) * Math.PI) / 12,
                }
              : candidate,
          ),
        );
      }
    },
    true,
  );
  el('#toggle-sidebar').addEventListener('click', () =>
    setSidebar(!el('.workspace').classList.contains('sidebar-open')),
  );
  el('.sidebar-backdrop').addEventListener('click', () => {
    setSidebar(false);
    el('#toggle-sidebar').focus();
  });
  el('.brand').addEventListener('click', (event) => {
    event.preventDefault();
    setMode('overview');
    viewer.reset();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      exteriorView = false;
      viewer.setExteriorView(false);
      setMode(b.dataset.view as ViewMode);
    }),
  );
  el('#view-exterior').addEventListener('click', () => {
    if (!current.site) return;
    setMode('overview');
    exteriorView = true;
    viewer.setExteriorView(true);
    el('#view-eyebrow').textContent = 'LA MAISON SUR SON TERRAIN';
    el('#view-title').textContent = 'Regardez autour.';
    el('#view-subtitle').textContent =
      'Toiture, façades et jardin. Les approximations figurent dans Plans & précision.';
    syncDisplayControls();
  });
  el<HTMLSelectElement>('#project-select').addEventListener('change', (event) =>
    loadProject((event.target as HTMLSelectElement).value),
  );
  el<HTMLSelectElement>('#level-select').addEventListener('change', (event) =>
    loadProject(current.id, (event.target as HTMLSelectElement).value),
  );
  el('#export-project').addEventListener('click', downloadProject);
  el('#import-project').addEventListener('click', () =>
    openDialog(
      'IMPORTER MA MAISON',
      `<h2>Ouvrez votre maison.</h2><p>Choisissez le fichier JSON de votre maison fourni avec le projet. Votre maison et vos meubles restent dans ce navigateur : ce fichier n’est pas envoyé au serveur.</p><div class="dialog-callout">Un plan PDF ou une photo doit d’abord être interprété et converti en projet. Cette version n’effectue pas de reconstruction automatique à partir d’une image.</div><p>Les projets importés sont conservés dans ce navigateur. Exportez-les pour les sauvegarder ou les utiliser sur un autre ordinateur.</p><button class="primary-button" id="choose-file">${icon('plus', 17)} Choisir un fichier JSON</button>`,
    ),
  );
  el('#dialog-content').addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('#choose-file')) {
      el<HTMLDialogElement>('#info-dialog').close();
      el<HTMLInputElement>('#import-file').click();
    }
  });
  el<HTMLInputElement>('#import-file').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) void importProject(input.files[0]);
    input.value = '';
  });
  el('#remove-project').addEventListener('click', () => {
    const next = imported.filter((p) => p.id !== current.id);
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
      imported = next;
      renderProjectOptions();
      loadProject(projects[0].id);
      toast('Projet importé retiré de ce navigateur.');
    } catch {
      toast('Impossible de modifier la mémoire locale.');
    }
  });
  el('#tool-reset').addEventListener('click', () => {
    viewer.reset();
    toast('Vue recentrée.');
  });
  el('#tool-labels').addEventListener('click', () => {
    showLabels = !showLabels;
    syncDisplayControls();
  });
  el('#tool-dimensions').addEventListener('click', () => {
    showDimensions = !showDimensions;
    activeButton('#tool-dimensions', showDimensions);
    viewer.setDimensions(showDimensions);
    el('#width-label').hidden = !showDimensions;
    el('#depth-label').hidden = !showDimensions;
  });
  el('#tool-lights').addEventListener('click', () => {
    lights = !lights;
    activeButton('#tool-lights', lights);
    viewer.setLights(lights);
  });
  el('#tool-ceiling').addEventListener('click', () => {
    ceiling = !ceiling;
    viewer.setCeiling(ceiling);
    syncDisplayControls();
  });
  const endMeasure = () => {
    viewer.setMeasureMode(false);
    syncDisplayControls();
  };
  el('#end-measure').addEventListener('click', endMeasure);
  el('#tool-measure').addEventListener('click', () => {
    if (ceiling && mode === 'overview') {
      ceiling = false;
      viewer.setCeiling(false);
      activeButton('#tool-ceiling', false);
      el('#scene-labels').hidden = !showLabels;
    }
    viewer.setMeasureMode(!viewer.measureMode);
    syncDisplayControls();
    el('#measure-instructions span').textContent = 'Cliquez sur deux points du sol.';
  });
  el('#mini-plan').addEventListener('click', () => setMode('plan'));
  el('#capture-mouse').addEventListener('click', () => {
    el('#walk-start').hidden = true;
    viewer.captureMouse();
  });
  el('#resume-walk').addEventListener('click', () => {
    viewer.captureMouse();
  });
  el('#help').addEventListener('click', () =>
    openDialog(
      'PRENDRE EN MAIN L’ATELIER',
      `<h2>Faites comme chez vous.</h2><div class="help-grid"><div>${icon('cube', 24)}<h3>Vue 3D</h3><p>Glissez avec le bouton gauche pour tourner. Utilisez la molette pour zoomer et le bouton droit pour déplacer la vue.</p></div><div>${icon('walk', 24)}<h3>Visite</h3><p>ZQSD, WASD ou flèches pour marcher. Souris pour regarder, Maj pour accélérer, E pour ouvrir une porte. Échap libère la souris.</p></div><div>${icon('ruler', 24)}<h3>Mesures</h3><p>Activez Mesurer, puis cliquez sur deux points du sol. La distance est exprimée en mètres. Un troisième clic commence une nouvelle mesure.</p></div><div>${icon('plan', 24)}<h3>Vos repères</h3><p>Sélectionnez une pièce dans la liste ou le plan miniature, puis choisissez « Visiter cette pièce » pour vous y rendre.</p></div></div><div class="dialog-callout">Si le navigateur refuse la capture de la souris, cliquez dans la vue puis maintenez le bouton gauche pour regarder autour de vous. Les touches de déplacement restent disponibles.</div><p>Les portes intérieures sont ouvertes au départ. Cliquez sur une porte en vue 3D, ou utilisez E à proximité pendant la visite. Ajoutez un meuble depuis le panneau, puis glissez-le dans la scène. Les flèches déplacent le meuble sélectionné de 1 cm, Maj de 10 cm ; R le tourne de 15°. Ctrl Z annule et Ctrl Maj Z rétablit. Les photos et liens sont des références à dimensions vérifiées, pas une reconstruction automatique.</p>`,
    ),
  );
  el('#source-info').addEventListener('click', () => {
    const rooms = viewer.level.rooms;
    openDialog(
      'PLANS & PRÉCISION',
      `<h2>Les dimensions d’abord.</h2><p class="source-title">${esc(current.source.title)}${current.source.date ? ` · ${esc(current.source.date)}` : ''}</p><span class="status-pill">${esc(current.source.status)}</span><ul class="source-notes">${current.source.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>${current.site ? `<h3>Terrain et extérieur</h3><ul class="source-notes">${current.site.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}<h3>Surfaces : plan et reconstruction</h3><p>Les surfaces calculées concernent les contours de pièces enregistrés. Elles permettent de repérer les écarts ; elles ne constituent pas un relevé sur chantier.</p><table class="area-table"><thead><tr><th>Pièce</th><th>Au plan</th><th>Reconstruite</th></tr></thead><tbody>${rooms.map((r) => `<tr${r.planArea && Math.abs(r.planArea - polygonArea(r.polygon)) > 0.1 ? ' class="area-warning"' : ''}><td>${esc(r.name)}</td><td>${r.planArea === undefined ? '—' : area(r.planArea)}</td><td>${area(polygonArea(r.polygon))}</td></tr>`).join('')}</tbody></table>`,
    );
  });
  const dialog = el<HTMLDialogElement>('#info-dialog');
  el('#close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => viewer.setPaused(false));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && viewer.measureMode) endMeasure();
    if (event.code === 'Escape' && el('.workspace').classList.contains('sidebar-open')) {
      setSidebar(false);
      el('#toggle-sidebar').focus();
    }
  });
}

async function start() {
  try {
    const loaded = await Promise.all(
      (__PUBLIC_BUILD__
        ? ['/projects/studio-demo.json']
        : ['/projects/private-project.json', '/projects/studio-demo.json']
      ).map(async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Impossible de charger les données de la maison.');
        return validateProject(await response.json());
      }),
    );
    builtins = loaded;
    let storageWarning = false;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
      if (Array.isArray(saved))
        for (const p of saved.slice(0, 10)) {
          try {
            imported.push(validateProject(p));
          } catch {
            storageWarning = true;
          }
        }
    } catch {
      storageWarning = true;
    }
    viewer = new HouseViewer(el<HTMLCanvasElement>('#scene'));
    viewer.onModeChange = (next) => {
      if (!syncingViewerMode && current) setMode(next, true);
    };
    viewer.onDestination = () => {
      activeButton('#go-to', false);
      el('#walk-start').hidden = true;
      el<HTMLCanvasElement>('#scene').focus();
      toast('Vous êtes à cet endroit. Glissez pour regarder ou cliquez sur Reprendre la visite.');
    };
    viewer.onDestinationRejected = () =>
      toast('Choisissez un point libre, à distance des murs et des meubles.');
    viewer.onSelectRoom = (id) => selectRoom(id, false);
    viewer.onPointerLockError = () => {
      toast(
        'Capture indisponible : cliquez dans la vue, puis glissez pour regarder autour de vous.',
      );
      el('#resume-walk').hidden = true;
      el<HTMLCanvasElement>('#scene').focus();
    };
    viewer.onMeasure = (measurement) => {
      el('#measure-label').hidden = !measurement?.b;
      if (measurement?.distance !== undefined) {
        el('#measure-label').textContent = `${number(measurement.distance)} m`;
        el('#measure-instructions span').textContent = 'Un nouveau clic commence une autre mesure.';
      } else if (measurement)
        el('#measure-instructions span').textContent = 'Choisissez le deuxième point.';
    };
    viewer.onFrame = (frame) => {
      if (!current) return;
      const labelsVisible =
        mode !== 'walk' && showLabels && !viewer.measureMode && !(ceiling && mode === 'overview');
      el('#orientation-arrow').style.transform = `rotate(${frame.planUpDegrees}deg)`;
      for (const room of viewer.level.rooms) {
        const label = document.querySelector<HTMLButtonElement>(
          `[data-label="${CSS.escape(room.id)}"]`,
        );
        if (!label) continue;
        if (labelsVisible) {
          const p = viewer.project(room.label, (room.floorOffset ?? 0) + 0.04);
          label.hidden =
            !p.visible ||
            (mode === 'overview' &&
              (room.planArea ?? polygonArea(room.polygon)) < 3 &&
              selectedRoom?.id !== room.id);
          label.style.left = `${p.x}px`;
          label.style.top = `${p.y}px`;
        }
      }
      if (showDimensions && mode !== 'walk') {
        const b = bounds(viewer.level.outline);
        for (const [id, point, value] of [
          ['width-label', [b.center[0], b.maxZ + 0.6], b.width],
          ['depth-label', [b.maxX + 0.6, b.center[1]], b.depth],
        ] as [string, [number, number], number][]) {
          const pos = viewer.project(point);
          const element = el(`#${id}`);
          element.textContent = `${number(value)} m`;
          element.hidden = !pos.visible;
          element.style.left = `${pos.x}px`;
          element.style.top = `${pos.y}px`;
        }
      }
      if (viewer.measurement?.b) {
        const { a, b } = viewer.measurement;
        const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const p = viewer.project(
          midpoint,
          floorElevationAt(viewer.level, midpoint) - viewer.level.elevation + 0.1,
        );
        el('#measure-label').style.left = `${p.x}px`;
        el('#measure-label').style.top = `${p.y}px`;
        el('#measure-label').hidden = !p.visible;
      }
      if (mode === 'walk') {
        el('#door-prompt').hidden = !frame.nearDoor || !el('#walk-start').hidden;
        el('#resume-walk').hidden = frame.locked || !el('#walk-start').hidden;
        const marker = document.querySelector<SVGGElement>('#map-marker');
        if (marker) {
          marker.setAttribute('visibility', 'visible');
          marker.setAttribute(
            'transform',
            `translate(${frame.position[0]} ${frame.position[1]}) rotate(${frame.headingDegrees})`,
          );
        }
        const name =
          viewer.level.rooms.find((r) => r.id === frame.roomId)?.name ?? viewer.level.name;
        if (el('#mini-caption').textContent !== name) el('#mini-caption').textContent = name;
      } else {
        document.querySelector('#map-marker')?.setAttribute('visibility', 'hidden');
      }
    };
    renderProjectOptions();
    let initial = builtins[0].id;
    try {
      initial = localStorage.getItem('maison-atelier:last-project') ?? initial;
    } catch {
      /* optional persistence */
    }
    loadProject(initial);
    wireEvents();
    el('#loading').hidden = true;
    if (storageWarning)
      toast(
        'Certains projets locaux n’ont pas pu être restaurés. Les projets fournis restent disponibles.',
      );
  } catch (error) {
    el('#loading').hidden = true;
    el('#fatal-error').hidden = false;
    el('#fatal-error').innerHTML =
      `${icon('info', 30)}<h2>La vue 3D n’a pas pu démarrer.</h2><p>${esc(error instanceof Error ? error.message : 'Erreur de chargement.')}</p><p>Utilisez une version récente de Chrome, Firefox ou Edge, avec l’accélération graphique activée.</p><button class="primary-button" id="reload">Réessayer</button>`;
    el('#reload').addEventListener('click', () => location.reload());
    console.error(error);
  }
}

void start();
