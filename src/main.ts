import { userMessage } from './errorMessage';
import './style.css';
import { SolarPanel } from './ui/solarPanel';
import { appTemplate } from './ui/appTemplate';
import { fullHelpHtml, shortHelpHtml } from './ui/firstSteps';
import { sourceDialogHtml } from './ui/sourcePanel';
import {
  ONBOARDING_STORAGE,
  parseOnboarding,
  serializeOnboarding,
  shouldShowStartCard,
  type OnboardingState,
} from './ui/onboarding';
import { confirmImportReplacement } from './ui/confirmImport';
import { solarPosition } from './scene/solar';
import { HouseViewer, isImmersiveSupported, preloadImmersive, type ViewMode } from './scene/viewer';
import { createEngine } from './scene/engine';
import {
  collectDiagnostics,
  diagnosticLines,
  installDiagnostics,
  viewLabel,
} from './scene/diagnostics';
import {
  copyReport,
  reportProgressHtml,
  reportRequested,
  reportResultHtml,
  withoutReportParameter,
} from './ui/performanceReport';
import { shaderLog } from './scene/shaderLog';
import { FrameRateMeter } from './ui/frameRate';
import type { HouseProject, Room } from './model/types';
import { validateProject } from './model/validate';
import { quarantineExport, restoreProjects } from './projectStorage';
import { pointInPolygon } from './model/geometry';
import { icon } from './ui/icons';
import { escapeHtml as esc, number } from './ui/format';
import { minimap } from './ui/minimap';
import { FurnitureLayer, type FurnitureOverlays } from './furniture/layer';
import { furnitureViewState } from './furniture/viewState';
import { FurniturePanel } from './furniture/panel';
import { VariantSession, STALE_MESSAGE, variantsStorageKey } from './furniture/variants';
import { VariantsPanel } from './ui/variantsPanel';
import { ArrangementPanel } from './ui/arrangementPanel';
import { FurnitureClipboard } from './furniture/clipboard';
import { chairsAroundTable } from './furniture/tableChairs';
import { snapDraggedFurniture, defaultSnapSettings } from './furniture/arrangement';
import { MeasureBar } from './ui/measureBar';
import {
  parseRenderScale,
  RENDER_SCALE_STORAGE,
  renderScaleNote,
  renderScaleOptionsHtml,
  renderScaleValue,
  screenCap,
  type RenderScaleSettings,
} from './ui/renderScale';
import { desktopHint, modeTitle, touchHint as touchHintText } from './ui/modeChrome';
import {
  roomDetailHtml,
  roomHeightHtml,
  roomListNote,
  roomRowsHtml,
  roomSummaryHtml,
  sceneLabelsHtml,
} from './ui/roomPanels';
import { ViewportProjection } from './ui/viewportProjection';
import { exportSceneImage } from './ui/imageExport';
import {
  FurnitureHistory,
  layoutStorageKey,
  validateFurnitureList,
  type FurnitureItem,
} from './furniture/model';
import { checkFurniture } from './furniture/checks';
import { findFurniturePlacement, getBuildingPlacementIssues } from './furniture/placement';
import { flipAgainstPartition, moveFurnitureToRoom, partitionBehind } from './furniture/roomMove';
import {
  applyFurnitureTransform,
  constrainGroupDrag,
  linkFurniture,
  unlinkFurniture,
} from './furniture/groups';
import type { WallDisplay } from './scene/wallCutaway';
import {
  decodeShareLinkHash,
  encodeShareLinkHash,
  isOwnStaleHash,
  isShareLink,
  OWN_HASH_MEMORY_SIZE,
  samePackedState,
  type DecodedShareLink,
} from './model/shareLink';
import { packShareDocument, type ShareDocument } from './model/linkPacker';
import { chooseProjectToReplace } from './ui/chooseProjectToReplace';
import { confirmLinkDivergence } from './ui/confirmLinkDivergence';

const STORAGE = 'maison-atelier:projects:v1';
const MAX_IMPORTED = 10;
const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let viewer: HouseViewer;
let solarPanel: SolarPanel;
let projects: HouseProject[] = [];
let imported: HouseProject[] = [];
let projectsRaw: string | null = null;
let builtins: HouseProject[] = [];
let current: HouseProject;
let selectedRoom: Room | undefined;
let showLabels = true;
let showDimensions = false;
let showCirculation = false;
const measureBar = new MeasureBar();
let lights = true;
let toastTimer: ReturnType<typeof setTimeout>;
let furnitureHistory = new FurnitureHistory();
const furnitureClipboard = new FurnitureClipboard();
const furnitureHistories = new Map<string, FurnitureHistory>();
const layoutSession = new VariantSession();
let variantsPanel: VariantsPanel | undefined;
let arrangementPanel: ArrangementPanel | undefined;
let arrangedIds: string[] = [];
let snapSettings = { ...defaultSnapSettings };
let magnetSuspended = false;
let furnitureLayer: FurnitureLayer | undefined;
let furniturePanel: FurniturePanel | undefined;
let selectedFurnitureId: string | undefined;
let furnitureContextItem: FurnitureItem | undefined;
let furnitureContextMembers: FurnitureItem[] = [];
let previewFurniture: FurnitureItem[] | undefined;
let draggingFurniture = false;
let overlays: FurnitureOverlays = { distances: true, clearances: false, openings: false };
let onboarding: OnboardingState = parseOnboarding(null);
// Share link: a project received through #p1: lives in memory only, read-only
// until « Ajouter à mes projets ». The hash is rewritten (debounced) for every owned
// project, never for a received one — its link stays the one that was shared.
let readOnlyLink = false;
let receivedShare: DecodedShareLink | undefined;
let linkHashTimer: ReturnType<typeof setTimeout>;
let desiredLinkHash: string | undefined;
let linkHashPending = false;
let linkHashWriteScheduled = false;
// Set when the page is being left: a write finishing then would move the memory past the URL
// the reload was started with.
let leavingPage = false;
const LINK_HASH_DEBOUNCE = 500;
const READ_ONLY_TOAST =
  'Ce projet a été reçu par lien : il est en lecture seule. « Ajouter à mes projets » pour le modifier.';
const LINK_HASH_MEMORY = 'maison-atelier:last-link-hash';
const LINK_HASH_EXIT = 'maison-atelier:exit-link-hash';

/** Hashes this tab published, oldest first (the memory once held a single hash). */
function publishedLinkHashes(): string[] {
  const raw = sessionStorage.getItem(LINK_HASH_MEMORY);
  if (raw === null) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (Array.isArray(list)) return list.filter((item) => typeof item === 'string');
  } catch {
    /* A bare hash from the single-hash memory. */
  }
  return [raw];
}

el('#app').innerHTML = appTemplate();

const SOFTWARE_RENDER_HELP =
  'Le navigateur dessine la 3D sans la carte graphique, d’où la lenteur. Activez l’accélération graphique (Chrome, Edge : Paramètres → Système ; Firefox : Paramètres → Performances), puis relancez le navigateur.';

function toast(message: string, durationMs = 5000) {
  clearTimeout(toastTimer);
  el('#toast').textContent = message;
  el('#toast').hidden = false;
  toastTimer = setTimeout(() => {
    el('#toast').hidden = true;
  }, durationMs);
}

function readOnboarding(): OnboardingState {
  try {
    return parseOnboarding(localStorage.getItem(ONBOARDING_STORAGE));
  } catch {
    return parseOnboarding(null);
  }
}

function saveOnboarding(next: OnboardingState) {
  try {
    localStorage.setItem(ONBOARDING_STORAGE, serializeOnboarding(next));
  } catch {
    /* optional persistence */
  }
}

/**
 * The card blocks nothing and only disappears with its close button: a click in the scene is
 * exploration, not an answer. The three actions leave it open so they can be tried in a row.
 */
function dismissStartCard() {
  const card = el('#start-card');
  if (card.hidden) return;
  card.hidden = true;
  onboarding = { ...onboarding, cardSeen: true };
  saveOnboarding(onboarding);
}

function showStartCard() {
  if (!shouldShowStartCard(onboarding)) return;
  el('#start-card').hidden = false;
}

function activeButton(selector: string, active: boolean) {
  el(selector).classList.toggle('active', active);
  el(selector).setAttribute('aria-pressed', String(active));
}

function currentFurniture() {
  return previewFurniture ?? furnitureHistory.items;
}

function setLayoutStatus(message = 'Aménagement sauvegardé sur cet ordinateur', unsaved = false) {
  const status = el('#layout-status');
  status.textContent = unsaved ? 'Non sauvegardé' : 'Sauvegardé';
  status.title = message;
  status.setAttribute('aria-label', message);
  status.classList.toggle('unsaved', unsaved);
}

let projectsStale = false;

/** Another tab has written: this tab no longer saves anything until it is reloaded. */
function showStaleBanner() {
  if (document.querySelector('#stale-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'stale-banner';
  banner.className = 'stale-banner';
  banner.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = 'Ce projet a été modifié dans un autre onglet. Rechargez avant de continuer.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'text-button';
  reload.textContent = 'Recharger';
  reload.addEventListener('click', () => location.reload());
  banner.append(text, reload);
  document.body.prepend(banner);
  setLayoutStatus('Modifié dans un autre onglet · rechargez la page', true);
}

/** Some local projects could not be opened: they are kept, and exportable in one click. */
function showQuarantineBanner(count: number) {
  const banner = document.createElement('div');
  banner.id = 'quarantine-banner';
  banner.className = 'stale-banner';
  banner.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent =
    count === 1
      ? '1 projet local n’a pas pu être ouvert. Il est conservé : exportez-le pour le récupérer.'
      : `${count} projets locaux n’ont pas pu être ouverts. Ils sont conservés : exportez-les pour les récupérer.`;
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'text-button';
  download.textContent = 'Télécharger';
  download.addEventListener('click', () => {
    const blob = new Blob([quarantineExport(localStorage, STORAGE)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'projets-non-restaures.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'text-button';
  close.textContent = 'Fermer';
  close.addEventListener('click', () => banner.remove());
  banner.append(text, download, close);
  document.body.prepend(banner);
}

/** Refuses to overwrite the project list if another tab rewrote it since our read. */
function assertProjectsUnchanged() {
  if (projectsStale || localStorage.getItem(STORAGE) !== projectsRaw) {
    projectsStale = true;
    showStaleBanner();
    throw new Error(STALE_MESSAGE);
  }
}
function writeProjects(list: HouseProject[]) {
  const text = JSON.stringify(list);
  localStorage.setItem(STORAGE, text);
  projectsRaw = text;
}

function persistFurniture() {
  try {
    layoutSession.save(current.id, viewer.level.id, furnitureHistory.items);
    refreshLayoutStatus();
    scheduleLinkHashUpdate();
  } catch (error) {
    setLayoutStatus('Aménagement non sauvegardé · exportez le projet', true);
    toast(userMessage(error, 'Sauvegarde indisponible.'));
  }
}

function refreshLayoutStatus() {
  setLayoutStatus(
    layoutSession.hasUnsaved
      ? 'Des modifications restent en mémoire dans cette session · exportez les projets concernés avant de fermer'
      : undefined,
    layoutSession.hasUnsaved,
  );
}

function syncFurniture(save = true) {
  previewFurniture = undefined;
  if (!furnitureHistory.items.some((item) => item.id === selectedFurnitureId))
    selectedFurnitureId = undefined;
  furnitureLayer?.setItems(furnitureHistory.items);
  furnitureLayer?.select(selectedFurnitureId);
  furnitureContextItem = furnitureHistory.items.find((item) => item.id === selectedFurnitureId);
  furnitureContextMembers = furnitureContextItem?.groupId
    ? furnitureHistory.items.filter((item) => item.groupId === furnitureContextItem!.groupId)
    : [];
  furniturePanel?.render();
  el('#furniture-tab-count').textContent = String(furnitureHistory.items.length);
  arrangedIds = arrangedIds.filter((id) => furnitureHistory.items.some((item) => item.id === id));
  arrangementPanel?.render();
  if (save) persistFurniture();
}

/** Another tab has written this project: no more changes here, popup draft included. */
function furnitureStale(): boolean {
  if (!current || !layoutSession.isStale(current.id)) return false;
  toast(STALE_MESSAGE);
  return true;
}

function commitFurniture(items: FurnitureItem[]): boolean {
  if (furnitureStale()) {
    previewFurniture = undefined;
    furnitureLayer?.setItems(furnitureHistory.items);
    furniturePanel?.render();
    return false;
  }
  if (readOnlyLink) {
    previewFurniture = undefined;
    furnitureLayer?.setItems(furnitureHistory.items);
    furniturePanel?.render();
    toast(READ_ONLY_TOAST);
    return false;
  }
  try {
    // An unreadable saved book must be restored by import before editing an empty fallback.
    layoutSession.active(current.id);
    const previousItems = new Map(furnitureHistory.items.map((item) => [item.id, item]));
    for (const item of items) {
      const previous = previousItems.get(item.id);
      const geometryChanged =
        !previous ||
        previous.width !== item.width ||
        previous.depth !== item.depth ||
        previous.height !== item.height ||
        (previous.elevation ?? 0) !== (item.elevation ?? 0) ||
        JSON.stringify(previous.sofa) !== JSON.stringify(item.sofa) ||
        previous.rotation !== item.rotation ||
        previous.position[0] !== item.position[0] ||
        previous.position[1] !== item.position[1];
      if (!geometryChanged) continue;
      const issue = getBuildingPlacementIssues(item, viewer.level)[0];
      if (issue) throw new Error(`Placement impossible : ${issue.message}`);
    }
    furnitureHistory.commit(items);
  } catch (error) {
    previewFurniture = undefined;
    furnitureLayer?.setItems(furnitureHistory.items);
    furniturePanel?.render();
    toast(userMessage(error, 'Modification invalide.'));
    return false;
  }
  syncFurniture();
  return true;
}

function updateFurniture(item: FurnitureItem) {
  try {
    return commitFurniture(applyFurnitureTransform(currentFurniture(), item));
  } catch (error) {
    toast(userMessage(error, 'Déplacement de l’ensemble impossible.'));
    return false;
  }
}

function rotateSelectedFurniture(degrees: number) {
  const item = currentFurniture().find((candidate) => candidate.id === selectedFurnitureId);
  if (!item || item.locked || viewer.mode === 'walk' || viewer.exteriorView) return;
  updateFurniture({ ...item, rotation: item.rotation + (degrees * Math.PI) / 180 });
}

function duplicateFurniture(id: string) {
  const item = currentFurniture().find((candidate) => candidate.id === id);
  if (!item) return;
  const clipboard = new FurnitureClipboard();
  clipboard.copy(item);
  placeFurnitureCopy(clipboard.paste()!);
}

function placeFurnitureCopy(copy: FurnitureItem) {
  const room = viewer.level.rooms.find((room) => pointInPolygon(copy.position, room.polygon));
  const placed = findFurniturePlacement(
    { ...copy, position: [copy.position[0] + 0.2, copy.position[1] + 0.2] },
    viewer.level,
    currentFurniture(),
    room,
  );
  if (!placed) {
    toast('Pas de place libre pour la copie dans cette pièce.');
    return;
  }
  if (commitFurniture([...currentFurniture(), placed])) selectFurniture(placed.id);
}

/** « Déplacer vers… »: one undoable move into another room, dimensions untouched. */
function openMoveToRoom(id: string) {
  if (readOnlyLink) {
    toast(READ_ONLY_TOAST);
    return;
  }
  const item = currentFurniture().find((candidate) => candidate.id === id);
  if (!item) return;
  const rooms = viewer.level.rooms;
  const partition = partitionBehind(item, viewer.level);
  openDialog(
    'Déplacer le meuble',
    `<h2>Déplacer « ${esc(item.name)} » vers…</h2><p>Le meuble garde ses dimensions et prend la place libre de la pièce la plus proche de sa position actuelle. Un meuble lié emmène son ensemble. Vous pouvez aussi le glisser directement dans une autre pièce.</p>${
      partition
        ? '<button type="button" id="flip-partition" class="move-room">Retourner contre l’autre face de la cloison</button>'
        : ''
    }${
      rooms.length
        ? `<div class="move-room-list" role="group" aria-label="Pièces du niveau">${rooms
            .map(
              (room) =>
                `<button type="button" class="move-room" data-move-room="${esc(room.id)}">${esc(room.name)}</button>`,
            )
            .join('')}</div>`
        : '<p>Ce niveau ne décrit aucune pièce.</p>'
    }<p id="move-room-status" role="status"></p><div class="furniture-dialog-footer"><button type="button" id="cancel-move-room" class="text-button">Annuler</button></div>`,
  );
  el('#cancel-move-room').addEventListener('click', () =>
    el<HTMLDialogElement>('#info-dialog').close(),
  );
  document.querySelector('#flip-partition')?.addEventListener('click', () => {
    const result = flipAgainstPartition(currentFurniture(), viewer.level, id);
    if (!result.ok) {
      el('#move-room-status').textContent = result.reason;
      return;
    }
    if (!commitFurniture(result.items)) return;
    el<HTMLDialogElement>('#info-dialog').close();
    selectFurniture(id);
    toast('Meuble retourné contre l’autre face de la cloison. Annulez avec Ctrl Z.');
  });
  // The list is rebuilt with each dialog, so its listener never piles up.
  document.querySelector('.move-room-list')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-move-room]');
    if (!button) return;
    const room = rooms.find((candidate) => candidate.id === button.dataset.moveRoom);
    const result = moveFurnitureToRoom(
      currentFurniture(),
      viewer.level,
      id,
      button.dataset.moveRoom!,
    );
    if (!result.ok) {
      el('#move-room-status').textContent = result.reason;
      return;
    }
    if (!commitFurniture(result.items)) return;
    el<HTMLDialogElement>('#info-dialog').close();
    selectFurniture(id);
    toast(`Meuble déplacé dans « ${room?.name ?? 'cette pièce'} ». Annulez avec Ctrl Z.`);
  });
}

function openTableChairs() {
  const tableId = selectedFurnitureId;
  if (!currentFurniture().some((item) => item.id === tableId && item.kind === 'table')) return;
  openDialog(
    'Chaises autour de la table',
    `<h2>Installer des chaises</h2><p>Ajoutez des chaises orientées vers la table, réparties sur ses quatre côtés. Les meubles existants restent en place.</p><form id="table-chairs-form"><div class="furniture-field-grid two"><label class="furniture-field">Nombre de chaises<input name="count" type="number" min="1" max="16" step="1" value="8" required></label><label class="furniture-field">Écart à la table <span>cm</span><input name="gap" type="number" min="0" max="100" step="1" value="5" required></label><label class="furniture-field">Largeur d’une chaise <span>cm</span><input name="width" type="number" min="5" max="2000" step="0.1" value="45" required></label><label class="furniture-field">Profondeur d’une chaise <span>cm</span><input name="depth" type="number" min="5" max="2000" step="0.1" value="50" required></label></div><label><input name="linked" type="checkbox" checked> Lier les chaises à la table</label><p id="table-chairs-status" role="status"></p><div class="furniture-dialog-footer"><button type="button" id="cancel-table-chairs" class="text-button">Annuler</button><button type="submit" class="primary-button">Ajouter les chaises</button></div></form>`,
  );
  el('#cancel-table-chairs').addEventListener('click', () =>
    el<HTMLDialogElement>('#info-dialog').close(),
  );
  el('#table-chairs-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    try {
      const next = chairsAroundTable(
        currentFurniture(),
        tableId!,
        Number(data.get('count')),
        viewer.level,
        {
          width: Number(data.get('width')) / 100,
          depth: Number(data.get('depth')) / 100,
          gap: Number(data.get('gap')) / 100,
          linked: data.get('linked') === 'on',
        },
      );
      if (!commitFurniture(next)) throw new Error('Les chaises ne peuvent pas être placées ici.');
      el<HTMLDialogElement>('#info-dialog').close();
      toast('Chaises ajoutées. Ctrl Z annule l’ensemble.');
    } catch (error) {
      el('#table-chairs-status').textContent = userMessage(error, 'Ajout impossible.');
    }
  });
}

function updateFurnitureContext() {
  const toolbar = el('#furniture-context-toolbar');
  const item = furnitureContextItem;
  if (
    readOnlyLink ||
    !selectedFurnitureId ||
    !item ||
    viewer.mode === 'walk' ||
    viewer.exteriorView ||
    draggingFurniture ||
    viewer.measureMode ||
    viewer.goToMode ||
    document.querySelector('dialog[open]')
  ) {
    toolbar.hidden = true;
    return;
  }
  el('#furniture-context-name').textContent = item.name;
  el('#furniture-group-count').hidden = furnitureContextMembers.length < 2;
  el('#furniture-group-count').textContent = `${furnitureContextMembers.length} liés`;
  el('#furniture-context-name').title =
    furnitureContextMembers.length > 1
      ? furnitureContextMembers.map((member) => member.name).join(' + ')
      : item.name;
  toolbar
    .querySelectorAll<HTMLButtonElement>('[data-rotate-selected]')
    .forEach((button) => (button.disabled = item.locked));
  el<HTMLButtonElement>('#undo-selected-furniture').disabled = !furnitureHistory.canUndo;
  el<HTMLButtonElement>('#redo-selected-furniture').disabled = !furnitureHistory.canRedo;
  el('#table-chairs').hidden = item.kind !== 'table';
  el<HTMLButtonElement>('#move-selected-furniture').disabled =
    item.locked || furnitureContextMembers.some((member) => member.locked);
  toolbar.hidden = false;
}

function selectFurniture(id: string | undefined) {
  if (id && viewer.exteriorView) setMode('overview');
  selectedFurnitureId = id;
  furnitureContextItem = id ? currentFurniture().find((item) => item.id === id) : undefined;
  furnitureContextMembers = furnitureContextItem?.groupId
    ? currentFurniture().filter((item) => item.groupId === furnitureContextItem!.groupId)
    : [];
  furnitureLayer?.select(id);
  furniturePanel?.render();
}

function openFurnitureEditor(id: string) {
  if (readOnlyLink) {
    toast(READ_ONLY_TOAST);
    return;
  }
  selectFurniture(id);
  furniturePanel?.openEdit(id);
}

function mountFurniture() {
  let items: FurnitureItem[] = [];
  let restoreError = false;
  try {
    items = layoutSession.load(current.id, viewer.level.id);
  } catch (error) {
    restoreError = true;
    toast(userMessage(error, 'Aménagement illisible.'));
  }
  const historyKey = JSON.stringify([
    current.id,
    restoreError ? '' : layoutSession.active(current.id).id,
    viewer.level.id,
  ]);
  furnitureHistory = furnitureHistories.get(historyKey) ?? new FurnitureHistory(items);
  if (JSON.stringify(furnitureHistory.items) !== JSON.stringify(items))
    furnitureHistory.reset(items);
  if (!restoreError) furnitureHistories.set(historyKey, furnitureHistory);
  arrangedIds = [];
  selectedFurnitureId = undefined;
  previewFurniture = undefined;
  furnitureLayer = new FurnitureLayer(viewer.scene, viewer.level);
  furnitureLayer.setItems(items);
  furnitureLayer.setOverlays(overlays);
  furnitureLayer.setCirculation(showCirculation);
  furnitureLayer.onSelect = selectFurniture;
  furnitureLayer.onEdit = openFurnitureEditor;
  furnitureLayer.onDragBlocked = toast;
  furnitureLayer.onDropPreview = (room) =>
    toast(`Relâchez pour déposer le meuble dans « ${room.name} ».`);
  furnitureLayer.onDroppedInRoom = (room) =>
    toast(`Meuble déposé dans « ${room.name} ». Annulez avec Ctrl Z.`);
  furnitureLayer.snapPlacement = (item, candidates) =>
    snapDraggedFurniture(item, viewer.level, candidates, snapSettings, !magnetSuspended);
  furnitureLayer.onDragState = (dragging) => {
    draggingFurniture = dragging;
    if (dragging) viewer.orbit.detachControl();
    else if (viewer.mode !== 'walk') viewer.orbit.attachControl(viewer.canvas, true);
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
      getAddRoomName: () =>
        selectedRoom?.name ??
        viewer.level.rooms.find((room) => pointInPolygon(viewer.level.spawn.position, room.polygon))
          ?.name,
      canUndo: () => furnitureHistory.canUndo,
      canRedo: () => furnitureHistory.canRedo,
      onAdd: (item, linkedTo) => {
        if (viewer.exteriorView) setMode('overview');
        const room =
          viewer.level.rooms.find((room) => pointInPolygon(item.position, room.polygon)) ??
          selectedRoom;
        const placed = findFurniturePlacement(item, viewer.level, currentFurniture(), room);
        if (!placed)
          throw new Error(
            'Aucune place disponible pour ces dimensions dans cette pièce. Choisissez une autre pièce ou ajustez les dimensions.',
          );
        if (
          linkedTo &&
          Math.hypot(placed.position[0] - item.position[0], placed.position[1] - item.position[1]) >
            0.001
        )
          throw new Error('Pas de place sur ce meuble : retirez ou déplacez l’objet déjà présent.');
        const next = [...currentFurniture(), placed];
        if (!commitFurniture(linkedTo ? linkFurniture(next, placed.id, linkedTo) : next))
          throw new Error(
            layoutSession.isStale(current.id)
              ? STALE_MESSAGE
              : 'Ce meuble ne peut pas être placé ici. Vérifiez ses dimensions.',
          );
        selectFurniture(placed.id);
        if (!matchMedia('(min-width: 761px)').matches) setSidebar(false);
      },
      onUpdate: updateFurniture,
      onApplyDraft: (items, selectedId) => {
        if (!commitFurniture(items)) return false;
        selectFurniture(selectedId);
        return true;
      },
      onLink: (id, other) => {
        try {
          if (commitFurniture(linkFurniture(currentFurniture(), id, other)))
            toast('Meubles liés : déplacez ou tournez l’un pour déplacer l’ensemble.');
        } catch (error) {
          toast(userMessage(error, 'Liaison impossible.'));
        }
      },
      onUnlink: (id) => {
        if (commitFurniture(unlinkFurniture(currentFurniture(), id)))
          toast('Les meubles sont maintenant indépendants.');
      },
      onDelete: (id) => commitFurniture(currentFurniture().filter((item) => item.id !== id)),
      onDuplicate: duplicateFurniture,
      onSelect: selectFurniture,
      onEdit: openFurnitureEditor,
      onUndo: () => {
        if (!furnitureStale() && furnitureHistory.undo()) syncFurniture();
      },
      onRedo: () => {
        if (!furnitureStale() && furnitureHistory.redo()) syncFurniture();
      },
      onOverlays: (options) => {
        overlays = options;
        furnitureLayer?.setOverlays(options);
        furniturePanel?.render();
      },
      getChecks: () =>
        checkFurniture(currentFurniture(), viewer.level).filter(
          (issue) => overlays.clearances || issue.code !== 'clearance',
        ),
      onToast: toast,
      onDialogState: (open) => {
        if (open && document.pointerLockElement) document.exitPointerLock();
        viewer.setPaused(open);
      },
    });
  furniturePanel.render();
  if (!arrangementPanel)
    arrangementPanel = new ArrangementPanel(el('#arrangement-panel'), {
      getItems: currentFurniture,
      getSelectedIds: () => arrangedIds,
      getLevel: () => viewer.level,
      onApply: commitFurniture,
      onSelection: (ids) => {
        arrangedIds = ids;
      },
      onSnapSettings: (settings) => {
        snapSettings = settings;
      },
    });
  arrangementPanel.render();
  if (!variantsPanel)
    variantsPanel = new VariantsPanel(el('#variants-panel'), {
      getBook: () => layoutSession.book(current.id),
      getLevel: () => viewer.level,
      onSelect: (id) => changeVariant(() => layoutSession.select(current.id, id), true),
      onDuplicate: (name) => changeVariant(() => layoutSession.duplicate(current.id, name), true),
      onRename: (name) => changeVariant(() => layoutSession.rename(current.id, name), false),
      onDelete: () => changeVariant(() => layoutSession.deleteActive(current.id), true),
      onError: toast,
    });
  variantsPanel.render();
  el('#furniture-tab-count').textContent = String(items.length);
  if (restoreError) setLayoutStatus('Aménagement non restauré · importez une sauvegarde', true);
  else refreshLayoutStatus();
}

function changeVariant(action: () => void, remount: boolean) {
  if (readOnlyLink) {
    toast(READ_ONLY_TOAST);
    return;
  }
  const before = JSON.stringify(layoutSession.book(current.id));
  try {
    action();
  } catch (error) {
    toast(userMessage(error, 'Variante indisponible.'));
  }
  const changed = JSON.stringify(layoutSession.book(current.id)) !== before;
  if (changed) {
    variantsPanel?.finishEditing();
    if (remount) {
      furnitureLayer?.dispose();
      mountFurniture();
      syncDisplayControls();
    }
    scheduleLinkHashUpdate();
  }
  refreshLayoutStatus();
}

function clearProjectHistories(projectId: string) {
  for (const key of furnitureHistories.keys())
    if (JSON.parse(key)[0] === projectId) furnitureHistories.delete(key);
}

function setSidebarTab(tab: 'house' | 'furniture', focus = false) {
  for (const name of ['house', 'furniture'] as const) {
    const button = el<HTMLButtonElement>(`#sidebar-${name}-tab`);
    const selected = name === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  el('#house-panel').hidden = tab !== 'house';
  el('#furniture-workspace-panel').hidden = tab !== 'furniture';
}

function setSidebar(open: boolean) {
  const desktop = matchMedia('(min-width: 761px)').matches;
  el('.workspace').classList.toggle('sidebar-open', !desktop && open);
  el('.workspace').classList.toggle('sidebar-collapsed', desktop && !open);
  el('#toggle-sidebar').setAttribute('aria-expanded', String(open));
  el('#toggle-sidebar').title = open
    ? 'Masquer le panneau du projet'
    : 'Afficher le panneau du projet';
  el('#toggle-sidebar').setAttribute(
    'aria-label',
    open ? 'Masquer le panneau du projet' : 'Afficher le panneau du projet',
  );
  el('.sidebar-backdrop').hidden = desktop || !open;
  if (!open && el('#project-sidebar').contains(document.activeElement))
    el('#toggle-sidebar').focus();
  el('#project-sidebar').inert = !open;
}

function syncDisplayControls() {
  const measuring = viewer.measureMode;
  activeButton('#go-to', viewer.goToMode);
  activeButton('#view-exterior', viewer.exteriorView);
  const overviewButton = document.querySelector<HTMLButtonElement>('[data-view=overview]')!;
  overviewButton.classList.toggle('active', viewer.mode === 'overview' && !viewer.exteriorView);
  overviewButton.setAttribute(
    'aria-pressed',
    String(viewer.mode === 'overview' && !viewer.exteriorView),
  );
  el('#scene-labels').hidden =
    viewer.mode === 'walk' || viewer.exteriorView || !showLabels || measuring || viewer.goToMode;
  el<HTMLButtonElement>('#go-to').disabled = viewer.mode === 'walk';
  furnitureLayer?.setView(
    furnitureViewState({
      mode: viewer.mode,
      exterior: viewer.exteriorView,
      readOnly: readOnlyLink,
      measuring,
      pickingDestination: viewer.goToMode,
    }),
  );
  measureBar.setActive(measuring);
  activeButton('#tool-measure', measuring);
  activeButton('#tool-labels', showLabels);
  activeButton('#tool-circulation', showCirculation);
  for (const id of ['tool-measure', 'tool-labels', 'tool-dimensions', 'tool-circulation']) {
    el<HTMLButtonElement>(`#${id}`).disabled =
      viewer.mode === 'walk' || viewer.exteriorView || (measuring && id === 'tool-labels');
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

function loadProject(
  id: string,
  levelId?: string,
  override?: HouseProject,
  /** The view to keep across a level change; a project change starts in Vue 3D. */
  keep?: { mode: ViewMode; exterior: boolean },
) {
  // A project received by link is not in `projects`: reloading it by its identifier
  // (level change) must keep its document and its read-only state, instead of falling back
  // to the demonstration.
  const received = override ?? (readOnlyLink && current?.id === id ? current : undefined);
  const p = received ?? projects.find((p) => p.id === id) ?? projects[0];
  if (!p) return;
  readOnlyLink = Boolean(received);
  if (!received) receivedShare = undefined;
  furnitureLayer?.dispose();
  furnitureLayer = undefined;
  current = p;
  layoutSession.register(
    p.id,
    p.levels.map((level) => level.id),
  );
  viewer.load(p, levelId);
  solarPanel.load(p);
  selectedRoom = undefined;
  el<HTMLButtonElement>('#view-exterior').hidden = !p.site;
  viewer.setLights(lights);
  viewer.setDimensions(showDimensions);
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
  el<HTMLSelectElement>('#level-select').value = viewer.level.id;
  el('#header-level').textContent = viewer.level.name;
  el('#room-count').textContent = String(viewer.level.rooms.length).padStart(2, '0');
  const removable = imported.some((project) => project.id === current.id);
  el<HTMLButtonElement>('#remove-project').disabled = !removable;
  el('#remove-project').title = removable
    ? 'Supprimer ce projet de cet ordinateur'
    : 'Les projets fournis ne peuvent pas être supprimés';
  renderRooms();
  renderLabels();
  renderMinimap();
  renderRoomDetail();
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

function renderRooms() {
  el('#room-list').innerHTML = roomRowsHtml(viewer.level.rooms, selectedRoom?.id, icon);
  const note = document.createElement('p');
  note.className = 'room-list-note';
  note.textContent = roomListNote(viewer.level.rooms.some((r) => r.planArea !== undefined));
  el('#room-list').append(note);
  document
    .querySelectorAll<HTMLButtonElement>('[data-room]')
    .forEach((button) => button.addEventListener('click', () => selectRoom(button.dataset.room!)));
}

function selectRoom(id: string, move = true) {
  selectedRoom = viewer.level.rooms.find((r) => r.id === id);
  if (!selectedRoom) return;
  if (move) setSidebarTab('house');
  if (move && viewer.exteriorView) setMode('overview');
  if (move) viewer.focusRoom(id);
  syncSelection();
  renderRoomDetail();
}

function renderRoomDetail() {
  const room = selectedRoom;
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
  el('#scene-labels').innerHTML = sceneLabelsHtml(viewer.level.rooms, selectedRoom?.id);
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

function canChangeMode(next: ViewMode): boolean {
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
  return true;
}

function setMode(next: ViewMode): boolean {
  if (!viewer.setMode(next)) return false;
  if (selectedRoom) viewer.focusRoom(selectedRoom.id);
  if (next !== 'walk') viewer.canvas.focus({ preventScroll: true });
  return true;
}

/** Called only after the viewer has accepted and applied a transition. */
function syncViewChrome() {
  const next = viewer.mode;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === next);
    b.setAttribute('aria-pressed', String(b.dataset.view === next));
  });
  el('#viewport').classList.toggle('walking', next === 'walk');
  const title = modeTitle(next, number(Number(el<HTMLSelectElement>('#eye-height').value)));
  el('#view-eyebrow').textContent = title[0];
  el('#view-title').textContent = title[1];
  el('#view-subtitle').textContent = title[2];
  // The welcome shows on the first visit only; afterwards a click in the view
  // captures the mouse, and the control hint keeps the keys on screen.
  el('#walk-start').hidden = next !== 'walk' || onboarding.walkGuideSeen;
  if (next === 'walk' && !onboarding.walkGuideSeen) {
    onboarding = { ...onboarding, walkGuideSeen: true };
    saveOnboarding(onboarding);
  }
  el('#resume-walk').hidden = true;
  el('#crosshair').hidden = next !== 'walk';
  el('#scene-labels').hidden = next === 'walk' || !showLabels;
  el('#control-hint').innerHTML = desktopHint(next, {
    mouseLeft: icon('mouse-left', 17),
    mouseRight: icon('mouse-right', 17),
    mouseWheel: icon('mouse-wheel', 17),
  });
  const touchHint = document.createElement('span');
  touchHint.className = 'touch-hint';
  touchHint.textContent = touchHintText(next);
  el('#control-hint').append(touchHint);
  if (viewer.exteriorView) {
    el('#view-eyebrow').textContent = 'LA MAISON SUR SON TERRAIN';
    el('#view-title').textContent = 'Extérieur';
    el('#view-subtitle').textContent =
      'Toiture, façades et jardin. Les approximations figurent dans Plans & précision.';
  }
  syncDisplayControls();
  measureBar.hide();
  el('#width-label').hidden = !showDimensions || next === 'walk';
  el('#depth-label').hidden = !showDimensions || next === 'walk';
  el('#door-prompt').hidden = true;
  el('#stair-prompt').hidden = true;
  el('#furniture-edit-prompt').hidden = true;
}

/** `?diagnostic`: measure every view and show a report to copy (`ui/performanceReport.ts`). */
async function measureForReport() {
  history.replaceState(null, '', withoutReportParameter(location.href));
  openDialog('PERFORMANCES', reportProgressHtml(0, 1));
  const { benchmarkViews } = await import('./scene/frameProfiler');
  const lines = await benchmarkViews(viewer, 4, (done, total) => {
    const progress = document.querySelector<HTMLProgressElement>('#report-progress');
    if (progress) {
      progress.max = total;
      progress.value = done;
    }
  });
  const text = [
    ...diagnosticLines(
      collectDiagnostics(viewer.engine, viewer.scene, {
        mode: viewer.mode,
        exterior: viewer.exteriorView,
        environment: viewer.ambience.environment,
        occlusion: viewer.ambience.occlusion,
        idle: viewer.renderingIdle,
        renderScale: viewer.currentRenderScale,
        effectTier: viewer.currentEffectTier,
      }),
    ),
    ...lines,
  ].join('\n');
  openDialog('PERFORMANCES', reportResultHtml(text));
  el('#copy-report').addEventListener('click', async () => {
    const copied = await copyReport(text, el('#report-text'));
    el('#copy-report').textContent = copied ? 'Copié' : 'Texte sélectionné : Ctrl+C';
  });
}

function openDialog(title: string, content: string) {
  if (document.pointerLockElement) document.exitPointerLock();
  viewer.setPaused(true);
  el('#dialog-eyebrow').textContent = title;
  el('#dialog-content').innerHTML = content;
  el<HTMLDialogElement>('#info-dialog').showModal();
}

/** Short help by default; the detailed text stays one click away, nothing removed. */
function openFirstSteps() {
  openDialog('PRENDRE EN MAIN L’ATELIER', shortHelpHtml());
  el('#show-full-help').addEventListener('click', () => {
    el('#dialog-content').innerHTML = fullHelpHtml();
  });
}

/**
 * The current state document, in the shape of a complete export: project, effective
 * arrangement of every level and all the variants. It is what the link carries and
 * what « Exporter » downloads — never the camera nor the navigation preferences.
 */
function currentDocument(): ShareDocument {
  return {
    ...current,
    solar: solarPanel.settings,
    furnishing: {
      version: 1,
      levels: Object.fromEntries(
        current.levels.map((level) => [
          level.id,
          level.id === viewer.level.id
            ? furnitureHistory.items
            : layoutSession.load(current.id, level.id),
        ]),
      ),
      variants: layoutSession.book(current.id),
    },
  };
}

/** The saved state of an owned project, without going through the view: basis of the start-up comparison. */
function storedDocumentFor(project: HouseProject): ShareDocument {
  try {
    layoutSession.register(
      project.id,
      project.levels.map((level) => level.id),
    );
    return {
      ...project,
      solar: solarPanel.settingsFor(project),
      furnishing: {
        version: 1,
        levels: Object.fromEntries(
          project.levels.map((level) => [level.id, layoutSession.load(project.id, level.id)]),
        ),
        variants: layoutSession.book(project.id),
      },
    };
  } catch {
    // Unreadable arrangement: the comparison will be on the project alone, the link
    // will be declared divergent rather than silently accepted.
    return { ...project, solar: solarPanel.settingsFor(project) };
  }
}

function downloadProject() {
  let snapshot: ShareDocument;
  try {
    snapshot = currentDocument();
  } catch (error) {
    toast(userMessage(error, 'Export indisponible.'));
    return;
  }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${current.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Les données de votre maison ont été exportées.');
}

/* ---------------------------------------------------------------------------------------------- */
/* Writing the hash: the URL is a snapshot of the state, updated after every change               */
/* ---------------------------------------------------------------------------------------------- */

function scheduleLinkHashUpdate() {
  clearTimeout(linkHashTimer);
  linkHashWriteScheduled = true;
  linkHashTimer = setTimeout(() => void writeLinkHash(), LINK_HASH_DEBOUNCE);
}

/**
 * Writes the current state into the hash via `history.replaceState` — never `location.hash`,
 * which would stack navigation history on every furniture move. A silent
 * replaceState failure (quota, sandbox) is retried on the next pointerup.
 */
async function writeLinkHash() {
  clearTimeout(linkHashTimer);
  linkHashWriteScheduled = false;
  if (readOnlyLink || !current) return;
  let hash: string;
  try {
    hash = await encodeShareLinkHash(currentDocument());
  } catch {
    return; // Incorruptible state: the JSON export stays the way out.
  }
  if (leavingPage) return;
  desiredLinkHash = hash;
  try {
    history.replaceState(null, '', hash);
  } catch {
    linkHashPending = true;
    return;
  }
  linkHashPending = false;
  // Memory written only once the URL is published: if replaceState fails or if the tab
  // disappears in between, the URL keeps an old hash and the memory must not run ahead of it,
  // otherwise a reload would take its own stale hash for a foreign link.
  try {
    const published = publishedLinkHashes().filter((item) => item !== hash);
    published.push(hash);
    sessionStorage.setItem(
      LINK_HASH_MEMORY,
      JSON.stringify(published.slice(-OWN_HASH_MEMORY_SIZE)),
    );
  } catch {
    /* Without this memory, a stale hash could be taken for an old link. */
  }
}

/**
 * When leaving the page, a pending hash write will never go out (deflate is
 * asynchronous): the URL left in place would describe a stale state, and a reload would
 * take it for an old link. The hash is removed synchronously — an owned project's state
 * lives in local storage, and the next change will rewrite the hash.
 */
function wireLinkHashFlush() {
  const dropStaleHash = () => {
    if (readOnlyLink || !current || !linkHashWriteScheduled) return;
    linkHashWriteScheduled = false;
    desiredLinkHash = undefined;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* The stale hash stays: with no follow-up, it is only ever read back on load. */
    }
  };
  window.addEventListener('pagehide', () => {
    dropStaleHash();
    leavingPage = true;
    // The hash shown when leaving tells a reload overtaken by a write from a deliberate
    // return to an older link (see `isOwnStaleHash`).
    try {
      sessionStorage.setItem(LINK_HASH_EXIT, location.hash);
    } catch {
      /* Without it, an older own hash counts as the tab's own. */
    }
  });
  window.addEventListener('pageshow', () => {
    leavingPage = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') dropStaleHash();
  });
  window.addEventListener('pointerup', () => {
    if (!current || readOnlyLink) return;
    if (!linkHashPending && desiredLinkHash === location.hash) return;
    void writeLinkHash();
  });
}

async function copyShareLink() {
  clearTimeout(linkHashTimer);
  const message = 'Lien copié : il contient une photographie de l’état actuel du projet.';
  try {
    await writeLinkHash();
    await navigator.clipboard.writeText(location.href);
    toast(message);
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = location.href;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast(message);
    } catch {
      toast('Copie impossible : copiez l’adresse depuis la barre d’adresse du navigateur.');
    }
  }
}

type ProjectDocument = {
  project: HouseProject;
  staged: [string, FurnitureItem[]][];
  variants: unknown;
};

/**
 * Validates a complete export project (file or link) and separates the arrangement awaiting
 * installation. Does not modify the received object: a link's document stays intact for
 * a later adoption.
 */
function readProjectDocument(input: unknown): ProjectDocument {
  const project = validateProject(structuredClone(input)) as HouseProject & {
    furnishing?: { version: number; levels: Record<string, unknown>; variants?: unknown };
  };
  const furnishing = project.furnishing;
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
  const variants = furnishing?.variants;
  delete project.furnishing;
  return { project, staged, variants };
}

function purgeProjectData(project: HouseProject) {
  const keys = [
    variantsStorageKey(project.id),
    `maison-atelier:solar:${project.id}`,
    ...project.levels.map((level) => layoutStorageKey(project.id, level.id)),
  ];
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Orphan data with no consequence: the project is no longer listed. */
    }
  }
  layoutSession.forgetProject(project.id);
  clearProjectHistories(project.id);
}

/**
 * Installs a validated project in this browser: local save, variants, then
 * loading. `confirmed` skips the replacement prompt (choice already made
 * by the divergence dialog or the adoption of a received project). Falls back to the
 * previous state if display fails.
 */
async function installProjectDocument(
  incoming: ProjectDocument,
  options: { confirmed?: boolean } = {},
): Promise<boolean> {
  const { project, staged, variants } = incoming;
  const existing = projects.find((candidate) => candidate.id === project.id);
  if (existing)
    layoutSession.register(
      existing.id,
      existing.levels.map((level) => level.id),
    );
  const previousVariantEntry = layoutSession.capture(project.id);
  const nextVariants = layoutSession.prepareImport(
    project.id,
    project.levels.map((level) => level.id),
    staged,
    variants,
  );
  if (
    existing &&
    !(options.confirmed
      ? true
      : await confirmImportReplacement(
          existing.name,
          (open) => {
            if (open && document.pointerLockElement) document.exitPointerLock();
            viewer.setPaused(open);
          },
          current.id === existing.id ? downloadProject : undefined,
        ))
  )
    return false;
  const previous = imported;
  const previousProjectId = current.id;
  const previousLevelId = viewer.level.id;
  let next = [...imported.filter((p) => p.id !== project.id), project];
  let replaced: HouseProject | undefined;
  if (next.length > MAX_IMPORTED) {
    // Limit reached: offer to replace a project rather than failing. Nothing is
    // deleted before the new one has been installed successfully.
    const choice = await chooseProjectToReplace(
      imported.filter((p) => p.id !== project.id).map(({ id, name }) => ({ id, name })),
      MAX_IMPORTED,
      (open) => {
        if (open && document.pointerLockElement) document.exitPointerLock();
        viewer.setPaused(open);
      },
    );
    replaced = imported.find((p) => p.id === choice);
    if (!replaced) return false;
    next = [...imported.filter((p) => p.id !== project.id && p.id !== replaced!.id), project];
  }
  assertProjectsUnchanged();
  const backups = [
    [variantsStorageKey(project.id), localStorage.getItem(variantsStorageKey(project.id))],
  ] as const;
  try {
    localStorage.setItem(variantsStorageKey(project.id), JSON.stringify(nextVariants));
    writeProjects(next);
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
  layoutSession.install(project.id, nextVariants);
  clearProjectHistories(project.id);
  try {
    renderProjectOptions();
    loadProject(project.id);
  } catch (error) {
    imported = previous;
    layoutSession.restore(project.id, previousVariantEntry);
    for (const [key, value] of backups) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    writeProjects(previous);
    renderProjectOptions();
    loadProject(previousProjectId, previousLevelId);
    throw error;
  }
  if (replaced) purgeProjectData(replaced);
  return true;
}

async function importProject(file: File) {
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('Le projet doit peser moins de 32 Mo.');
    const parsed = readProjectDocument(JSON.parse(await file.text()));
    if (await installProjectDocument(parsed))
      toast('Maison importée et conservée dans ce navigateur.');
  } catch (error) {
    toast(userMessage(error, 'Impossible de lire ce projet.'));
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Reading a share link: owner (comparison) or recipient (read-only)                              */
/* ---------------------------------------------------------------------------------------------- */

/**
 * A #p1: link opened at start-up. For the project's owner: identical = silence,
 * different = three outcomes (replace, keep both, ignore) — never a silent
 * loss. For a visitor: the project lives in memory only, read-only,
 * until « Ajouter à mes projets ».
 */
async function openSharedLink(fallbackId: string) {
  // Tab resume: a hash write interrupted or overtaken by a reload leaves a stale hash in
  // the URL. If this tab published it, it is not a shareable link: the (more recent)
  // local state is loaded without a dialog.
  let ownStale = false;
  try {
    const exitHash = sessionStorage.getItem(LINK_HASH_EXIT);
    sessionStorage.removeItem(LINK_HASH_EXIT);
    ownStale = isOwnStaleHash(location.hash, publishedLinkHashes(), exitHash);
  } catch {
    /* Without memory, the dialog will judge normally. */
  }
  if (ownStale) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* No consequence: once reloaded, the hash will be recognised again. */
    }
    loadProject(fallbackId);
    return;
  }
  let link: DecodedShareLink;
  try {
    link = await decodeShareLinkHash(location.hash);
  } catch {
    loadProject(fallbackId);
    toast('Lien illisible : le projet enregistré sur cet ordinateur est chargé.');
    return;
  }
  const existing = projects.find((candidate) => candidate.id === link.document.id);
  if (!existing) {
    openReceivedShare(link, fallbackId);
    return;
  }
  const identical = samePackedState(packShareDocument(storedDocumentFor(existing)), link.packed);
  loadProject(existing.id);
  if (identical) return;
  const choice = await confirmLinkDivergence(existing.name, (open) => {
    if (open && document.pointerLockElement) document.exitPointerLock();
    viewer.setPaused(open);
  });
  if (choice === 'replace') {
    if (await installProjectDocument(readProjectDocument(link.document), { confirmed: true }))
      toast('Projet remplacé par la version du lien.');
  } else if (choice === 'copy') {
    await adoptReceived(link.document);
  }
  // 'ignore': the local project stays displayed; the hash will catch up with the current state.
}

/** The link's project does not exist here: opened in memory only, without touching localStorage. */
function openReceivedShare(link: DecodedShareLink, fallbackId: string) {
  try {
    const { project, staged, variants } = readProjectDocument(link.document);
    layoutSession.register(
      project.id,
      project.levels.map((level) => level.id),
    );
    const nextVariants = layoutSession.prepareImport(
      project.id,
      project.levels.map((level) => level.id),
      staged,
      variants,
    );
    layoutSession.install(project.id, nextVariants);
    receivedShare = link;
    loadProject(project.id, undefined, project);
  } catch (error) {
    loadProject(fallbackId);
    toast(
      error instanceof Error
        ? error.message
        : 'Lien illisible : le projet enregistré sur cet ordinateur est chargé.',
    );
  }
}

/** « Ajouter à mes projets »: copy of the received project under a new identifier, then normal installation. */
async function adoptReceived(source: ShareDocument) {
  const fork: ShareDocument = {
    ...source,
    id: `${source.id}-${crypto.randomUUID().slice(0, 8)}`,
  };
  if (await installProjectDocument(readProjectDocument(fork))) {
    // The shared link must no longer survive a reload: it is removed right
    // away, the deferred write will re-record the owned project's state.
    history.replaceState(null, '', location.pathname + location.search);
    toast('Projet ajouté à vos projets : il est maintenant modifiable.');
  }
}

const NAVIGATION_STORAGE = 'maison-atelier:navigation:v1';
let renderScaleSettings: RenderScaleSettings = { detected: {} };
function saveRenderScale() {
  try {
    localStorage.setItem(RENDER_SCALE_STORAGE, JSON.stringify(renderScaleSettings));
  } catch {
    /* optional persistence */
  }
  el('#render-scale-note').textContent = renderScaleNote(renderScaleSettings);
}
/** « Résolution du rendu »: automatic from what this machine reached, or pinned. */
function applyRenderScale() {
  try {
    renderScaleSettings = parseRenderScale(localStorage.getItem(RENDER_SCALE_STORAGE));
  } catch {
    renderScaleSettings = { detected: {} };
  }
  el<HTMLSelectElement>('#render-scale').value = renderScaleValue(renderScaleSettings.fixed);
  el('#render-scale-note').textContent = renderScaleNote(renderScaleSettings);
  viewer.setRenderScalePolicy(renderScaleSettings.fixed, renderScaleSettings.detected);
  watchScreenCap();
  viewer.onRenderScaleChange = (view, scale) => {
    if (renderScaleSettings.fixed !== undefined) return;
    renderScaleSettings.detected[view] = scale;
    saveRenderScale();
  };
}
/**
 * Several screens: the window may move from a 4K screen to a 1080p one. The cap is read
 * again when the screen changes (Chromium's `change` on `screen`), on resize and focus,
 * and every two seconds, since moving between two screens of the same scale fires nothing.
 */
let watchedCap: number | undefined;
function watchScreenCap() {
  if (watchedCap !== undefined) return;
  watchedCap = screenCap();
  const check = () => {
    const cap = screenCap();
    if (cap === watchedCap) return;
    watchedCap = cap;
    viewer.setScreenCap(cap);
    el('#render-scale').innerHTML = renderScaleOptionsHtml(cap);
    el<HTMLSelectElement>('#render-scale').value = renderScaleValue(renderScaleSettings.fixed, cap);
    el('#render-scale-note').textContent = renderScaleNote(renderScaleSettings, cap);
  };
  (window.screen as Screen & EventTarget).addEventListener?.('change', check);
  window.addEventListener('resize', check);
  window.addEventListener('focus', check);
  window.setInterval(check, 2000);
}
function applyNavigationPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE) ?? '{}');
    if (typeof saved?.speed === 'number' && Number.isFinite(saved.speed))
      el<HTMLInputElement>('#walk-speed').value = String(Math.max(1, Math.min(5, saved.speed)));
    if (typeof saved?.sensitivity === 'number' && Number.isFinite(saved.sensitivity))
      el<HTMLInputElement>('#look-sensitivity').value = String(
        Math.max(50, Math.min(200, saved.sensitivity)),
      );
    if (typeof saved?.occlusion === 'boolean')
      el<HTMLInputElement>('#occlusion-enable').checked = saved.occlusion;
  } catch {
    /* Use the defaults if preferences are unavailable. */
  }
  updateNavigationPreferences(false);
}
function updateNavigationPreferences(save = true) {
  const speed = Number(el<HTMLInputElement>('#walk-speed').value);
  const sensitivity = Number(el<HTMLInputElement>('#look-sensitivity').value);
  const occlusion = el<HTMLInputElement>('#occlusion-enable').checked;
  viewer.setWalkSpeed(speed);
  viewer.setOcclusion(occlusion);
  viewer.setLookSensitivity(sensitivity / 100);
  el('#walk-speed-value').textContent = `${number(speed)} m/s`;
  el('#look-sensitivity-value').textContent = `${sensitivity} %`;
  if (save) {
    try {
      localStorage.setItem(NAVIGATION_STORAGE, JSON.stringify({ speed, sensitivity, occlusion }));
    } catch {
      /* Preferences are optional; scene and project still work. */
    }
  }
}

function setNavigationPanel(open: boolean) {
  const focusInside = el('#navigation-panel').contains(document.activeElement);
  el('#navigation-panel').hidden = !open;
  el('#tool-navigation').setAttribute('aria-expanded', String(open));
  if (open) el('#go-to').focus({ preventScroll: true });
  else if (focusInside) el('#tool-navigation').focus({ preventScroll: true });
}

function wireEvents() {
  wireFurnitureToolbar();
  wireNavigationControls();
  wireKeyboardShortcuts();
  wireProjectControls();
  wireViewportControls();
  wireLinkHashFlush();
}

function wireFurnitureToolbar() {
  const groupCount = document.createElement('span');
  groupCount.id = 'furniture-group-count';
  groupCount.hidden = true;
  el('#furniture-context-name').insertAdjacentElement('afterend', groupCount);
  const chairsButton = document.createElement('button');
  chairsButton.id = 'table-chairs';
  chairsButton.type = 'button';
  chairsButton.hidden = true;
  chairsButton.textContent = 'Chaises';
  chairsButton.title = 'Ajouter des chaises autour de la table';
  chairsButton.setAttribute('aria-label', chairsButton.title);
  el('#furniture-context-toolbar').insertBefore(chairsButton, el('#delete-selected-furniture'));
  chairsButton.addEventListener('click', openTableChairs);
  layoutSession.onStale = showStaleBanner;
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === null || event.key === variantsStorageKey(current.id))
      layoutSession.markStale(current.id);
    else if (event.key === STORAGE) projectsStale = true;
    if (projectsStale) showStaleBanner();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!layoutSession.hasUnsaved) return;
    event.preventDefault();
    event.returnValue = '';
  });
  el('#edit-selected-furniture').addEventListener('click', () => {
    if (selectedFurnitureId) openFurnitureEditor(selectedFurnitureId);
  });
  el('#duplicate-selected-furniture').addEventListener('click', () => {
    if (selectedFurnitureId) duplicateFurniture(selectedFurnitureId);
  });
  el('#move-selected-furniture').addEventListener('click', () => {
    if (selectedFurnitureId) openMoveToRoom(selectedFurnitureId);
  });
  el('#delete-selected-furniture').addEventListener('click', () => {
    if (!selectedFurnitureId) return;
    if (commitFurniture(currentFurniture().filter((item) => item.id !== selectedFurnitureId)))
      toast('Meuble retiré. Annulez depuis Meubles ou avec Ctrl Z.');
  });
}

function wireNavigationControls() {
  el('#tool-navigation').addEventListener('click', () =>
    setNavigationPanel(Boolean(el('#navigation-panel').hidden)),
  );
  el('#close-navigation').addEventListener('click', () => setNavigationPanel(false));
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (
      !el('#navigation-panel').hidden &&
      !el('#navigation-panel').contains(target) &&
      !el('#tool-navigation').contains(target)
    )
      setNavigationPanel(false);
  });
  document
    .querySelectorAll<HTMLButtonElement>('[data-rotate-selected]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        rotateSelectedFurniture(Number(button.dataset.rotateSelected)),
      ),
    );
  el('#undo-selected-furniture').addEventListener('click', () => {
    if (!furnitureStale() && furnitureHistory.undo()) syncFurniture();
  });
  el('#redo-selected-furniture').addEventListener('click', () => {
    if (!furnitureStale() && furnitureHistory.redo()) syncFurniture();
  });
  for (const tab of ['house', 'furniture'] as const) {
    const button = el(`#sidebar-${tab}-tab`);
    button.addEventListener('click', () => setSidebarTab(tab));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 'house'
          : event.key === 'End'
            ? 'furniture'
            : tab === 'house'
              ? 'furniture'
              : 'house';
      setSidebarTab(next, true);
    });
  }
  const responsiveSidebar = matchMedia('(min-width: 761px)');
  setSidebar(responsiveSidebar.matches);
  responsiveSidebar.addEventListener('change', () => setSidebar(responsiveSidebar.matches));
  el('#walk-speed').addEventListener('input', () => updateNavigationPreferences());
  el('#look-sensitivity').addEventListener('input', () => updateNavigationPreferences());
  el('#occlusion-enable').addEventListener('change', () => updateNavigationPreferences());
  el('#render-scale').addEventListener('change', () => {
    const value = el<HTMLSelectElement>('#render-scale').value;
    renderScaleSettings.fixed = value === 'auto' ? undefined : Number(value);
    saveRenderScale();
    viewer.setRenderScalePolicy(renderScaleSettings.fixed, renderScaleSettings.detected);
  });
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
      setNavigationPanel(false);
      setSidebar(false);
      toast('Cliquez sur un point libre du sol pour y commencer la visite.');
    }
  });
  el<HTMLSelectElement>('#eye-height').addEventListener('change', (event) => {
    const height = viewer.setEyeHeight(Number((event.target as HTMLSelectElement).value));
    if (viewer.mode === 'walk')
      el('#view-subtitle').textContent = `Une visite à ${number(height)} m du sol.`;
  });
  el<HTMLSelectElement>('#wall-display').addEventListener('change', (event) =>
    viewer.setWallDisplay((event.target as HTMLSelectElement).value as WallDisplay),
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
}

function wireKeyboardShortcuts() {
  // Snapping is suspended by holding Alt while dragging; no effect elsewhere.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Alt') return;
    magnetSuspended = true;
    if (draggingFurniture) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key !== 'Alt') return;
    magnetSuspended = false;
    if (draggingFurniture) event.preventDefault();
  });
  window.addEventListener('blur', () => {
    magnetSuspended = false;
  });
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        draggingFurniture ||
        document.querySelector('dialog[open]') ||
        (event.target instanceof HTMLElement &&
          (event.target.closest('input,textarea,select') || event.target.isContentEditable))
      )
        return;
      const modifier = event.ctrlKey || event.metaKey;
      const shortcut = event.key.toLowerCase();
      if (
        modifier &&
        !event.altKey &&
        !event.shiftKey &&
        viewer.mode !== 'walk' &&
        !viewer.exteriorView
      ) {
        if (shortcut === 'c') {
          const item = currentFurniture().find((item) => item.id === selectedFurnitureId);
          if (item && !window.getSelection()?.toString()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            furnitureClipboard.copy(item);
            toast('Meuble copié. Ctrl V pour le coller.');
            return;
          }
        } else if (shortcut === 'v') {
          const copy = furnitureClipboard.paste();
          if (copy) {
            event.preventDefault();
            event.stopImmediatePropagation();
            placeFurnitureCopy(copy);
            return;
          }
        }
      }
      if (modifier && !event.altKey && ['z', 'y'].includes(shortcut)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (furnitureStale()) return;
        const changed =
          shortcut === 'y' || event.shiftKey ? furnitureHistory.redo() : furnitureHistory.undo();
        if (changed) syncFurniture();
        return;
      }
      if (event.code === 'Escape') {
        selectFurniture(undefined);
        return;
      }
      if (viewer.mode === 'walk' || viewer.exteriorView) return;
      const item = currentFurniture().find((candidate) => candidate.id === selectedFurnitureId);
      if (!item) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (item.locked) {
          if (!event.repeat)
            toast(`« ${item.name} » est verrouillé. Déverrouillez-le pour le supprimer.`);
        } else commitFurniture(currentFurniture().filter((candidate) => candidate.id !== item.id));
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('button,a,summary,[role=tab],#navigation-panel') &&
        !event.target.closest('#furniture-context-toolbar,[data-furniture-select]')
      )
        return;
      if (item.locked) {
        if (!event.repeat && (event.code.startsWith('Arrow') || shortcut === 'r'))
          toast(`« ${item.name} » est verrouillé. Déverrouillez-le pour le déplacer.`);
        return;
      }
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
        try {
          const next = constrainGroupDrag(
            currentFurniture(),
            item.id,
            [item.position[0] + d[0], item.position[1] + d[1]],
            viewer.level,
          );
          const moved = next.find((member) => member.id === item.id)!;
          if (
            Math.hypot(moved.position[0] - item.position[0], moved.position[1] - item.position[1]) <
            1e-7
          ) {
            if (!event.repeat)
              toast('Déplacement bloqué par le bâtiment ou un meuble de l’ensemble.');
          } else commitFurniture(next);
        } catch (error) {
          if (!event.repeat) toast(userMessage(error, 'Déplacement impossible.'));
        }
      } else if (shortcut === 'r' && !modifier) {
        event.preventDefault();
        updateFurniture({
          ...item,
          rotation: item.rotation + ((event.shiftKey ? -1 : 1) * Math.PI) / 12,
        });
      }
    },
    true,
  );
}

function wireProjectControls() {
  el('#toggle-sidebar').addEventListener('click', () =>
    setSidebar(el('#toggle-sidebar').getAttribute('aria-expanded') !== 'true'),
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
      setMode(b.dataset.view as ViewMode);
    }),
  );
  el('#enter-immersive').addEventListener('click', async () => {
    if (viewer.immersiveActive) {
      void viewer.exitImmersive();
      return;
    }
    if (viewer.mode !== 'walk' && !setMode('walk')) return;
    el('#walk-start').hidden = true;
    try {
      await viewer.enterImmersive();
    } catch (error) {
      console.info(
        `[casque] session refusée : ${error instanceof Error ? error.message : String(error)}`,
      );
      toast('Le casque n’a pas pu ouvrir la visite. Vérifiez qu’il est allumé et autorisé.');
    }
  });
  // Only a browser that can open a headset session shows the button. Asked again when a
  // headset connects or leaves: on a PC, Quest Link often starts after the page is open.
  const checkImmersive = () =>
    void isImmersiveSupported().then((supported) => {
      el('#enter-immersive').hidden = !supported;
      if (supported) void preloadImmersive().catch(() => undefined);
    });
  checkImmersive();
  navigator.xr?.addEventListener?.('devicechange', checkImmersive);
  el('#view-exterior').addEventListener('click', () => {
    if (!current.site) return;
    viewer.setExteriorView(true);
    viewer.canvas.focus({ preventScroll: true });
  });
  el<HTMLSelectElement>('#project-select').addEventListener('change', (event) =>
    loadProject((event.target as HTMLSelectElement).value),
  );
  el<HTMLSelectElement>('#level-select').addEventListener('change', (event) =>
    loadProject(current.id, (event.target as HTMLSelectElement).value, undefined, {
      mode: viewer.mode,
      exterior: viewer.exteriorView,
    }),
  );
  el('#export-project').addEventListener('click', downloadProject);
  el('#copy-link').addEventListener('click', () => void copyShareLink());
  el('#adopt-received-project').addEventListener('click', () => {
    if (receivedShare) void adoptReceived(receivedShare.document);
  });
  el('#export-image').addEventListener('click', () => {
    openDialog(
      'EXPORTER UNE IMAGE',
      `<h2>Garder cette vue</h2><p>Image PNG de la caméra actuelle, sans les panneaux de l’interface. Le fichier est généré sur cet ordinateur.</p><div class="image-export-options"><label><input id="image-labels" type="checkbox" ${showLabels && viewer.mode !== 'walk' ? 'checked' : ''}> Noms et surfaces des pièces</label><label><input id="image-dimensions" type="checkbox" ${showDimensions && viewer.mode !== 'walk' ? 'checked' : ''} ${viewer.mode === 'walk' ? 'disabled' : ''}> Dimensions extérieures</label><label><input id="image-transparent" type="checkbox"> Fond transparent</label><label><input id="image-header" type="checkbox" checked> Cartouche projet</label></div><p id="image-export-status" role="status"></p><button id="download-scene-image" class="primary-button">Télécharger le PNG</button>`,
    );
    el<HTMLButtonElement>('#download-scene-image').addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        await exportSceneImage(viewer, {
          labels: el<HTMLInputElement>('#image-labels').checked,
          dimensions: el<HTMLInputElement>('#image-dimensions').checked,
          transparent: el<HTMLInputElement>('#image-transparent').checked,
          header: el<HTMLInputElement>('#image-header').checked,
          projectName: current.name,
          levelName: viewer.level.name,
          variantName: layoutSession.active(current.id).name,
        });
        el<HTMLDialogElement>('#info-dialog').close();
        toast('Image PNG exportée.');
      } catch (error) {
        el('#image-export-status').textContent = userMessage(error, 'Export image impossible.');
        button.disabled = false;
      }
    });
  });
  el('#import-project').addEventListener('click', () =>
    el<HTMLInputElement>('#import-file').click(),
  );
  el<HTMLInputElement>('#import-file').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) void importProject(input.files[0]);
    input.value = '';
  });
  el('#remove-project').addEventListener('click', () => {
    const project = imported.find((project) => project.id === current.id);
    if (!project) return;
    openDialog(
      'SUPPRIMER CE PROJET',
      `<h2>Supprimer « ${esc(project.name)} » ?</h2><p>Ce projet et les aménagements de ses niveaux seront supprimés de cet ordinateur. Exportez une copie pour les conserver.</p><div class="dialog-actions"><button type="button" class="text-button dialog-actions-start" id="export-before-delete">${icon('export', 17)} Exporter une copie</button><button type="button" class="text-button" id="cancel-delete-project">Annuler</button><button type="button" class="danger-button" id="confirm-delete-project">Supprimer le projet</button></div>`,
    );
    el('#export-before-delete').addEventListener('click', downloadProject);
    el('#cancel-delete-project').addEventListener('click', () =>
      el<HTMLDialogElement>('#info-dialog').close(),
    );
    el('#confirm-delete-project').addEventListener('click', () => {
      const next = imported.filter((candidate) => candidate.id !== project.id);
      const keys = [
        STORAGE,
        variantsStorageKey(project.id),
        `maison-atelier:solar:${project.id}`,
        ...project.levels.map((level) => layoutStorageKey(project.id, level.id)),
      ];
      let backups: [string, string | null][] = [];
      try {
        assertProjectsUnchanged();
        backups = keys.map((key) => [key, localStorage.getItem(key)]);
        writeProjects(next);
        for (const key of keys.slice(1)) localStorage.removeItem(key);
      } catch {
        for (const [key, value] of backups) {
          try {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
          } catch {
            /* Keep reporting the failed operation if storage remains unavailable. */
          }
        }
        toast(
          'Suppression impossible : la mémoire locale est indisponible. Votre projet reste ouvert.',
        );
        return;
      }
      imported = next;
      layoutSession.forgetProject(project.id);
      clearProjectHistories(project.id);
      el<HTMLDialogElement>('#info-dialog').close();
      renderProjectOptions();
      try {
        loadProject(projects[0].id);
        toast('Projet et aménagements supprimés de cet ordinateur.');
      } catch (error) {
        toast(
          error instanceof Error
            ? error.message
            : 'Le projet a été supprimé, mais la vue suivante n’a pas pu être chargée.',
        );
      }
    });
  });
}

function wireViewportControls() {
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
  el('#tool-circulation').addEventListener('click', () => {
    showCirculation = !showCirculation;
    activeButton('#tool-circulation', showCirculation);
    furnitureLayer?.setCirculation(showCirculation);
  });
  el('#tool-solar').addEventListener('click', () => solarPanel.open());
  el('#tool-lights').addEventListener('click', () => {
    lights = !lights;
    activeButton('#tool-lights', lights);
    viewer.setLights(lights);
  });
  const endMeasure = () => {
    viewer.setMeasureMode(false);
    syncDisplayControls();
  };
  measureBar.wire({
    onEnd: endMeasure,
    onClear: () => {
      if (viewer.clearPinnedMeasurements()) {
        toast('Mesures épinglées effacées.');
        return true;
      }
      return false;
    },
  });
  el('#tool-measure').addEventListener('click', () => {
    viewer.setMeasureMode(!viewer.measureMode);
    syncDisplayControls();
    measureBar.resetPrompt();
  });
  el('#mini-plan').addEventListener('click', () => setMode('plan'));
  el('#capture-mouse').addEventListener('click', () => {
    el('#walk-start').hidden = true;
    viewer.captureMouse();
  });
  el('#resume-walk').addEventListener('click', () => {
    viewer.captureMouse();
  });
  el('#help').addEventListener('click', openFirstSteps);
  el('#first-steps').addEventListener('click', openFirstSteps);
  el('#start-card').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-start-action]');
    if (!button) return;
    if (button.dataset.startAction === 'orbit') viewer.tourOrbit();
    else if (button.dataset.startAction === 'plan') setMode('plan');
    else if (button.dataset.startAction === 'walk') setMode('walk');
  });
  el('#close-start-card').addEventListener('click', dismissStartCard);
  el('#source-info').addEventListener('click', () => {
    openDialog('PLANS & PRÉCISION', sourceDialogHtml(current, viewer.level.rooms));
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
    if (document.querySelector('dialog[open]')) return;
    if (event.code === 'Escape') setNavigationPanel(false);
    if (event.code === 'Escape' && viewer.measureMode) endMeasure();
    if (event.code === 'Escape' && el('.workspace').classList.contains('sidebar-open')) {
      setSidebar(false);
      el('#toggle-sidebar').focus();
    }
  });
}

/**
 * The plan-photo overlay was removed; drop the database it left behind so no
 * personal plan image stays in the browser. Idempotent, safe to keep for now.
 */
function dropLegacyPlanPhotoStore(): void {
  try {
    indexedDB?.deleteDatabase('maison-atelier:plan-photo');
  } catch {
    /* optional cleanup */
  }
}

async function start() {
  dropLegacyPlanPhotoStore();
  try {
    const projectPaths = __PUBLIC_BUILD__
      ? ['/projects/studio-demo.json']
      : [...__PRIVATE_PROJECTS__, '/projects/studio-demo.json'];
    const loaded = await Promise.all(
      projectPaths.map(async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Impossible de charger les données de la maison.');
        return validateProject(await response.json());
      }),
    );
    builtins = loaded;
    projectsRaw = localStorage.getItem(STORAGE);
    const restored = restoreProjects(localStorage, STORAGE, validateProject);
    imported.push(...restored.projects);
    const unreadableProjects = restored.unreadable;
    const sceneEngine = createEngine(el<HTMLCanvasElement>('#scene'));
    viewer = new HouseViewer(el<HTMLCanvasElement>('#scene'), sceneEngine);
    const frameRate = new FrameRateMeter(el('#frame-rate'));
    if (viewer.softwareRendering) {
      // A CPU rasteriser draws the scene ten to fifty times slower than any GPU: the
      // usual cause is graphics acceleration switched off in the browser settings.
      el('#software-render').hidden = false;
      el('#software-render').addEventListener('click', () => toast(SOFTWARE_RENDER_HELP, 15000));
    }
    solarPanel = new SolarPanel({
      onApply: (settings, instant) => {
        viewer.setSolar(settings ? solarPosition(settings, instant) : undefined);
        activeButton('#tool-solar', Boolean(settings));
        el('.orientation span').textContent = settings ? 'NORD' : 'HAUT DU PLAN';
        el('.orientation').title = settings
          ? 'Nord géographique renseigné pour ce projet'
          : 'Direction du haut du document de référence';
      },
      onDialogState: (open) => {
        if (open && document.pointerLockElement) document.exitPointerLock();
        viewer.setPaused(open);
      },
    });
    solarPanel.mountTimeline(el('#viewport'));
    viewer.canChangeMode = canChangeMode;
    viewer.onViewChange = syncViewChrome;
    viewer.onDestination = () => {
      activeButton('#go-to', false);
      el('#walk-start').hidden = true;
      el<HTMLCanvasElement>('#scene').focus();
      toast('Vous êtes à cet endroit. Glissez pour regarder ou cliquez sur Reprendre la visite.');
    };
    viewer.onDestinationRejected = () =>
      toast('Choisissez un point libre, à distance des murs et des meubles.');
    // A stair taken in the visit changed the displayed level inside the same scene.
    viewer.onLevelChange = () => {
      furnitureLayer?.dispose();
      furnitureLayer = undefined;
      selectedRoom = undefined;
      mountFurniture();
      el<HTMLInputElement>('#section-height').max = String(viewer.level.ceilingHeight);
      el<HTMLSelectElement>('#level-select').value = viewer.level.id;
      el('#header-level').textContent = viewer.level.name;
      el('#room-count').textContent = String(viewer.level.rooms.length).padStart(2, '0');
      renderRooms();
      renderLabels();
      renderMinimap();
      renderRoomDetail();
      syncSelection();
      if (!readOnlyLink) scheduleLinkHashUpdate();
      toast(`Niveau : ${viewer.level.name}`);
    };
    viewer.onImmersiveChange = (active) => {
      el('#viewport').classList.toggle('immersive', active);
      el('#enter-immersive').setAttribute('aria-pressed', String(active));
      if (!active) toast('Retour à la visite à l’écran.');
    };
    viewer.onSelectRoom = (id) => selectRoom(id, false);
    viewer.onEditFurniture = openFurnitureEditor;
    viewer.onPointerLockError = () => {
      toast(
        'Capture indisponible : cliquez dans la vue, puis glissez pour regarder autour de vous.',
      );
      el<HTMLCanvasElement>('#scene').focus();
    };
    viewer.onMeasure = (measurement) => measureBar.sync(measurement);
    const viewportProjection = new ViewportProjection(
      el('#viewport'),
      measureBar,
      (project) => furnitureLayer?.getLabelObstacles(project) ?? [],
    );
    viewer.onFrame = () => {
      if (!current) return;
      frameRate.update(performance.now(), viewer.engine.getFps());
      updateFurnitureContext();
    };
    // After the image is drawn: the camera matrices are then the ones the rooms were drawn with.
    viewer.onRendered = (frame) => {
      if (!current) return;
      viewportProjection.update(viewer, frame, {
        showLabels,
        showDimensions,
        selectedRoomId: selectedRoom?.id,
        northAngleDeg: solarPanel.settings?.northAngleDeg ?? 0,
      });
    };
    renderProjectOptions();
    let initial = builtins[0].id;
    try {
      initial = localStorage.getItem('maison-atelier:last-project') ?? initial;
    } catch {
      /* optional persistence */
    }
    if (isShareLink(location.hash)) {
      // A link error (10-project limit, rejected document…) is not a failure of the
      // 3D engine: a toast message, then the local project stays usable.
      try {
        await openSharedLink(initial);
      } catch (error) {
        console.error(error);
        if (!current) loadProject(initial);
        toast(
          error instanceof Error
            ? error.message
            : 'Le lien n’a pas pu être ouvert : le projet enregistré sur cet ordinateur est chargé.',
        );
      }
    } else loadProject(initial);
    // Development-only bench: the dynamic import behind `DEV` is what keeps the
    // whole module out of a production build.
    if (import.meta.env.DEV) {
      void import('./ui/fxLab').then(({ mountFxLab }) => mountFxLab(viewer));
    }
    installDiagnostics(
      () =>
        collectDiagnostics(viewer.engine, viewer.scene, {
          mode: viewer.mode,
          exterior: viewer.exteriorView,
          environment: viewer.ambience.environment,
          occlusion: viewer.ambience.occlusion,
          idle: viewer.renderingIdle,
          renderScale: viewer.currentRenderScale,
          effectTier: viewer.currentEffectTier,
        }),
      () => shaderLog.report(),
      async (seconds) => {
        const { profileView, profileLines } = await import('./scene/frameProfiler');
        const view = viewLabel(viewer.mode, viewer.exteriorView);
        return profileLines(await profileView(viewer, seconds * 1000), view).join('\n');
      },
    );
    wireEvents();
    viewer.onPreparingProgress = (fraction) => {
      const bar = el('#loading-progress');
      const percent = Math.round(fraction * 100);
      bar.setAttribute('aria-valuenow', String(percent));
      bar.style.setProperty('--progress', String(fraction));
    };
    // The first view links its shaders behind the start-up screen, which covers the whole
    // page: the header and the sidebar would otherwise look alive while the links stall
    // the page. The other views do the same over the viewport only, with a shorter
    // message, the first time they are opened.
    await viewer.whenReady();
    viewer.onPreparing = (active) => {
      el('#loading span').textContent = 'Préparation de la vue…';
      el('#loading').hidden = !active;
    };
    el('#loading').hidden = true;
    el('#loading').classList.remove('loading-startup');
    onboarding = readOnboarding();
    showStartCard();
    if (unreadableProjects > 0) showQuarantineBanner(unreadableProjects);
    if (reportRequested(location.search)) void measureForReport();
  } catch (error) {
    el('#loading').hidden = true;
    el('#loading').classList.remove('loading-startup');
    el('#fatal-error').hidden = false;
    el('#fatal-error').innerHTML =
      `${icon('info', 30)}<h2>La vue 3D n’a pas pu démarrer.</h2><p>${esc(userMessage(error, 'Erreur de chargement.'))}</p><p>Utilisez une version récente de Chrome, Firefox ou Edge, avec l’accélération graphique activée.</p><button class="primary-button" id="reload">Réessayer</button>`;
    el('#reload').addEventListener('click', () => location.reload());
    console.error(error);
  }
}

void start();
