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
import { HouseViewer, type ViewMode } from './scene/viewer';
import { createEngine } from './scene/engine';
import { collectDiagnostics, installDiagnostics } from './scene/diagnostics';
import { FrameRateMeter } from './ui/frameRate';
import type { HouseProject, Room } from './model/types';
import { validateProject } from './model/validate';
import { bounds, floorElevationAt, pointInPolygon, polygonArea } from './model/geometry';
import { icon } from './ui/icons';
import { area, escapeHtml as esc, number } from './ui/format';
import { minimap } from './ui/minimap';
import { FurnitureLayer, type FurnitureOverlays } from './furniture/layer';
import { FurniturePanel } from './furniture/panel';
import { VariantSession, variantsStorageKey, type VariantBook } from './furniture/variants';
import { VariantsPanel } from './ui/variantsPanel';
import { ArrangementPanel } from './ui/arrangementPanel';
import { FurnitureClipboard } from './furniture/clipboard';
import { chairsAroundTable } from './furniture/tableChairs';
import { snapDraggedFurniture, defaultSnapSettings } from './furniture/arrangement';
import { MeasureBar } from './ui/measureBar';
import { desktopHint, modeTitle, touchHint as touchHintText } from './ui/modeChrome';
import {
  roomDetailHtml,
  roomHeightHtml,
  roomListNote,
  roomRowsHtml,
  roomSummaryHtml,
  sceneLabelsHtml,
} from './ui/roomPanels';
import { layoutLabels, type LabelBox } from './ui/labelLayout';
import { exportSceneImage } from './ui/imageExport';
import {
  FurnitureHistory,
  createFurniture,
  layoutStorageKey,
  validateFurnitureList,
  type FurnitureItem,
} from './furniture/model';
import { checkFurniture } from './furniture/checks';
import { findFurniturePlacement, getBuildingPlacementIssues } from './furniture/placement';
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
  isShareLink,
  samePackedState,
  type DecodedShareLink,
} from './model/shareLink';
import { packShareDocument, type ShareDocument } from './model/linkPacker';
import { confirmLinkDivergence } from './ui/confirmLinkDivergence';

const STORAGE = 'maison-atelier:projects:v1';
const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let viewer: HouseViewer;
let solarPanel: SolarPanel;
let frameRate: FrameRateMeter;
let projects: HouseProject[] = [];
let imported: HouseProject[] = [];
let builtins: HouseProject[] = [];
let current: HouseProject;
let selectedRoom: Room | undefined;
let showLabels = true;
let showDimensions = false;
let showCirculation = false;
const measureBar = new MeasureBar();
let exteriorView = false;
let lights = true;
let mode: ViewMode = 'overview';
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
let syncingViewerMode = false;
let onboarding: OnboardingState = parseOnboarding(null);
// Lien de partage : un projet reçu par #p1: vit en mémoire uniquement, lecture seule
// jusqu'à « Ajouter à mes projets ». Le hash est réécrit (debounce) pour tout projet
// possédé, jamais pour un projet reçu — son lien reste celui qui a été partagé.
let readOnlyLink = false;
let receivedShare: DecodedShareLink | undefined;
let linkHashTimer: ReturnType<typeof setTimeout>;
let desiredLinkHash: string | undefined;
let linkHashPending = false;
let linkHashWriteScheduled = false;
const LINK_HASH_DEBOUNCE = 500;
const READ_ONLY_TOAST =
  'Ce projet a été reçu par lien : il est en lecture seule. « Ajouter à mes projets » pour le modifier.';
const LINK_HASH_MEMORY = 'maison-atelier:last-link-hash';

el('#app').innerHTML = appTemplate();

function toast(message: string) {
  clearTimeout(toastTimer);
  el('#toast').textContent = message;
  el('#toast').hidden = false;
  toastTimer = setTimeout(() => {
    el('#toast').hidden = true;
  }, 5000);
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
 * La carte ne bloque rien et ne disparaît que sur sa croix : un clic dans la scène est une
 * exploration, pas une réponse. Les trois actions la laissent ouverte pour les essayer à la suite.
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

function persistFurniture() {
  try {
    layoutSession.save(current.id, viewer.level.id, furnitureHistory.items);
    refreshLayoutStatus();
    scheduleLinkHashUpdate();
  } catch (error) {
    setLayoutStatus('Aménagement non sauvegardé · exportez le projet', true);
    toast(error instanceof Error ? error.message : 'Sauvegarde indisponible.');
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

function commitFurniture(items: FurnitureItem[]): boolean {
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
      if (issue) throw new Error(`Placement impossible : ${issue.message}`);
    }
    furnitureHistory.commit(items);
  } catch (error) {
    previewFurniture = undefined;
    furnitureLayer?.setItems(furnitureHistory.items);
    furniturePanel?.render();
    toast(error instanceof Error ? error.message : 'Modification invalide.');
    return false;
  }
  syncFurniture();
  return true;
}

function updateFurniture(item: FurnitureItem) {
  try {
    return commitFurniture(applyFurnitureTransform(currentFurniture(), item));
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Déplacement de l’ensemble impossible.');
    return false;
  }
}

function rotateSelectedFurniture(degrees: number) {
  const item = currentFurniture().find((candidate) => candidate.id === selectedFurnitureId);
  if (!item || item.locked || mode === 'walk' || exteriorView) return;
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
      el('#table-chairs-status').textContent =
        error instanceof Error ? error.message : 'Ajout impossible.';
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
    mode === 'walk' ||
    exteriorView ||
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
  toolbar.hidden = false;
}

function selectFurniture(id: string | undefined) {
  if (id && exteriorView) setMode('overview');
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
    toast(error instanceof Error ? error.message : 'Aménagement illisible.');
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
  furnitureLayer.snapPlacement = (item, candidates) =>
    snapDraggedFurniture(item, viewer.level, candidates, snapSettings, !magnetSuspended);
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
      getAddRoomName: () =>
        selectedRoom?.name ??
        viewer.level.rooms.find((room) => pointInPolygon(viewer.level.spawn.position, room.polygon))
          ?.name,
      canUndo: () => furnitureHistory.canUndo,
      canRedo: () => furnitureHistory.canRedo,
      onAdd: (item, linkedTo) => {
        if (exteriorView) setMode('overview');
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
          throw new Error('Pas de place sur ce meuble : retirez ou déplacez l’objet déjà présent.');
        const next = [...currentFurniture(), placed];
        if (!commitFurniture(linkedTo ? linkFurniture(next, placed.id, linkedTo) : next))
          throw new Error('Ce meuble ne peut pas être placé ici. Vérifiez ses dimensions.');
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
            toast('Meubles liés : déplacez ou tournez l’un pour déplacer l’ensemble.');
        } catch (error) {
          toast(error instanceof Error ? error.message : 'Liaison impossible.');
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
        if (furnitureHistory.undo()) syncFurniture();
      },
      onRedo: () => {
        if (furnitureHistory.redo()) syncFurniture();
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
    toast(error instanceof Error ? error.message : 'Variante indisponible.');
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
  activeButton('#view-exterior', exteriorView);
  const overviewButton = document.querySelector<HTMLButtonElement>('[data-view=overview]')!;
  overviewButton.classList.toggle('active', mode === 'overview' && !exteriorView);
  overviewButton.setAttribute('aria-pressed', String(mode === 'overview' && !exteriorView));
  el('#scene-labels').hidden =
    mode === 'walk' || exteriorView || !showLabels || measuring || viewer.goToMode;
  el<HTMLButtonElement>('#go-to').disabled = mode === 'walk';
  furnitureLayer?.setMode(
    readOnlyLink || mode === 'walk' || exteriorView || measuring || viewer.goToMode ? 'walk' : mode,
  );
  measureBar.setActive(measuring);
  activeButton('#tool-measure', measuring);
  activeButton('#tool-labels', showLabels);
  activeButton('#tool-circulation', showCirculation);
  for (const id of ['tool-measure', 'tool-labels', 'tool-dimensions', 'tool-circulation']) {
    el<HTMLButtonElement>(`#${id}`).disabled =
      mode === 'walk' || exteriorView || (measuring && id === 'tool-labels');
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

function loadProject(id: string, levelId?: string, override?: HouseProject) {
  // Un projet reçu par lien ne figure pas dans `projects` : le recharger par son identifiant
  // (changement de niveau) doit garder son document et sa lecture seule, au lieu de retomber
  // sur la démonstration.
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
  mode = 'overview';
  exteriorView = false;
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
    // Le projet reçu n'est pas dans la liste : une entrée dédiée, retirée au prochain
    // chargement normal par renderProjectOptions.
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
  if (move && exteriorView) setMode('overview');
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
    try {
      viewer.setMode(next);
    } finally {
      // A throw inside the viewer must not leave the guard armed: every later
      // mode change would then be ignored and the chrome would never follow.
      syncingViewerMode = false;
    }
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
  const title = modeTitle(next, number(Number(el<HTMLSelectElement>('#eye-height').value)));
  el('#view-eyebrow').textContent = title[0];
  el('#view-title').textContent = title[1];
  el('#view-subtitle').textContent = title[2];
  el('#walk-start').hidden = next !== 'walk';
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
  syncDisplayControls();
  if (next !== 'walk' && !fromViewer) viewer.canvas.focus({ preventScroll: true });
  measureBar.hide();
  el('#width-label').hidden = !showDimensions || next === 'walk';
  el('#depth-label').hidden = !showDimensions || next === 'walk';
  el('#door-prompt').hidden = true;
  el('#furniture-edit-prompt').hidden = true;
  return true;
}

function openDialog(title: string, content: string) {
  if (document.pointerLockElement) document.exitPointerLock();
  viewer.setPaused(true);
  el('#dialog-eyebrow').textContent = title;
  el('#dialog-content').innerHTML = content;
  el<HTMLDialogElement>('#info-dialog').showModal();
}

/** Aide courte par défaut ; le texte détaillé reste à un clic, sans rien retirer. */
function openFirstSteps() {
  openDialog('PRENDRE EN MAIN L’ATELIER', shortHelpHtml());
  el('#show-full-help').addEventListener('click', () => {
    el('#dialog-content').innerHTML = fullHelpHtml();
  });
}

/**
 * Le document d'état courant, dans la forme d'un export complet : projet, aménagement
 * effectif de chaque niveau et toutes les variantes. C'est ce que porte le lien et
 * ce que télécharge « Exporter » — jamais la caméra ni les préférences de navigation.
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

/** L'état enregistré d'un projet possédé, sans passer par la vue : base de la comparaison au démarrage. */
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
    // Aménagement illisible : la comparaison se fera sur le projet seul, le lien
    // sera déclaré divergent plutôt qu'accepté silencieusement.
    return { ...project, solar: solarPanel.settingsFor(project) };
  }
}

function downloadProject() {
  let snapshot: ShareDocument;
  try {
    snapshot = currentDocument();
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Export indisponible.');
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
/* Écriture du hash : l'URL est une photographie de l'état, mise à jour après chaque modification  */
/* ---------------------------------------------------------------------------------------------- */

function scheduleLinkHashUpdate() {
  clearTimeout(linkHashTimer);
  linkHashWriteScheduled = true;
  linkHashTimer = setTimeout(() => void writeLinkHash(), LINK_HASH_DEBOUNCE);
}

/**
 * Écrit l'état courant dans le hash via `history.replaceState` — jamais `location.hash`,
 * qui empilerait l'historique de navigation à chaque déplacement de meuble. Un échec
 * silencieux de replaceState (quota, sandbox) est réessayé au prochain pointerup.
 */
async function writeLinkHash() {
  clearTimeout(linkHashTimer);
  linkHashWriteScheduled = false;
  if (readOnlyLink || !current) return;
  let hash: string;
  try {
    hash = await encodeShareLinkHash(currentDocument());
  } catch {
    return; // État incorruptible : l'export JSON reste la sortie de secours.
  }
  desiredLinkHash = hash;
  try {
    sessionStorage.setItem(LINK_HASH_MEMORY, hash);
  } catch {
    /* Sans ce souvenir, un hash périmé pourrait être pris pour un vieux lien. */
  }
  try {
    history.replaceState(null, '', hash);
    linkHashPending = false;
  } catch {
    linkHashPending = true;
  }
}

/**
 * En quittant la page, une écriture du hash en attente ne partira jamais (le deflate est
 * asynchrone) : l'URL restée sur place décrirait un état périmé, et un rechargement la
 * prendrait pour un vieux lien. Le hash est retiré synchronement — l'état d'un projet
 * possédé vit dans le stockage local, et la prochaine modification réécrira le hash.
 */
function wireLinkHashFlush() {
  const dropStaleHash = () => {
    if (readOnlyLink || !current || !linkHashWriteScheduled) return;
    linkHashWriteScheduled = false;
    desiredLinkHash = undefined;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* Le hash périmé reste : sans suite, il n'est jamais relu qu'au chargement. */
    }
  };
  window.addEventListener('pagehide', dropStaleHash);
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
  const message = 'Lien copié : il contient une photographie de l’état actuel du projet.';
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
      toast('Copie impossible : copiez l’adresse depuis la barre d’adresse du navigateur.');
    }
  }
}

type ProjectDocument = {
  project: HouseProject;
  staged: [string, FurnitureItem[]][];
  variants: unknown;
};

/**
 * Valide un projet d'export complet (fichier ou lien) et sépare l'aménagement en attente
 * d'installation. Ne modifie pas l'objet reçu : le document d'un lien reste intact pour
 * une adoption ultérieure.
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

/**
 * Installe un projet validé dans ce navigateur : sauvegarde locale, variantes, puis
 * chargement. `confirmed` court-circuite la demande de remplacement (choix déjà posé
 * par le dialogue de divergence ou l'adoption d'un projet reçu). Repli sur l'état
 * précédent si l'affichage échoue.
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
  const next = [...imported.filter((p) => p.id !== project.id), project];
  if (next.length > 10) throw new Error('Vous pouvez conserver jusqu’à 10 projets importés.');
  const backups = [
    [variantsStorageKey(project.id), localStorage.getItem(variantsStorageKey(project.id))],
  ] as const;
  try {
    localStorage.setItem(variantsStorageKey(project.id), JSON.stringify(nextVariants));
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
    localStorage.setItem(STORAGE, JSON.stringify(previous));
    renderProjectOptions();
    loadProject(previousProjectId, previousLevelId);
    throw error;
  }
  return true;
}

async function importProject(file: File) {
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('Le projet doit peser moins de 32 Mo.');
    const parsed = readProjectDocument(JSON.parse(await file.text()));
    if (await installProjectDocument(parsed))
      toast('Maison importée et conservée dans ce navigateur.');
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Impossible de lire ce projet.');
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Lecture d'un lien de partage : propriétaire (comparaison) ou destinataire (lecture seule)       */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Un lien #p1: ouvert au démarrage. Pour le propriétaire du projet : identique = silence,
 * différent = trois issues (remplacer, garder les deux, ignorer) — jamais de perte
 * silencieuse. Pour un visiteur : le projet vit en mémoire seule, en lecture seule,
 * jusqu'à « Ajouter à mes projets ».
 */
async function openSharedLink(fallbackId: string) {
  // Reprise d'onglet : une écriture du hash interrompue par un rechargement laisse dans
  // l'URL un hash périmé. S'il est le dernier écrit par cet onglet, ce n'est pas un lien
  // partageable : l'état local (plus récent) est chargé sans dialogue.
  let ownLastHash: string | null = null;
  try {
    ownLastHash = sessionStorage.getItem(LINK_HASH_MEMORY);
  } catch {
    /* Sans mémoire, le dialogue jugera normalement. */
  }
  if (ownLastHash !== null && ownLastHash === location.hash) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* Sans conséquence : rechargé, le hash sera reconnu de nouveau. */
    }
    loadProject(fallbackId);
    return;
  }
  let link: DecodedShareLink;
  try {
    link = await decodeShareLinkHash(location.hash);
  } catch {
    loadProject(fallbackId);
    toast('Lien illisible : le projet enregistré sur cet ordinateur est chargé.');
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
  // 'ignore' : le projet local reste affiché ; le hash reprendra l'état courant.
}

/** Le projet du lien n'existe pas ici : ouverture en mémoire seule, sans toucher au localStorage. */
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
        : 'Lien illisible : le projet enregistré sur cet ordinateur est chargé.',
    );
  }
}

/** « Ajouter à mes projets » : copie du projet reçu sous un nouvel identifiant, puis installation normale. */
async function adoptReceived(source: ShareDocument) {
  const fork: ShareDocument = {
    ...source,
    id: `${source.id}-${crypto.randomUUID().slice(0, 8)}`,
  };
  if (await installProjectDocument(readProjectDocument(fork))) {
    // Le lien partagé ne doit plus survivre à un rechargement : il est retiré tout de
    // suite, l'écriture différée réinscrira l'état du projet possédé.
    history.replaceState(null, '', location.pathname + location.search);
    toast('Projet ajouté à vos projets : il est maintenant modifiable.');
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
  el('#delete-selected-furniture').addEventListener('click', () => {
    if (!selectedFurnitureId) return;
    if (commitFurniture(currentFurniture().filter((item) => item.id !== selectedFurnitureId)))
      toast('Meuble retiré. Annulez depuis Meubles ou avec Ctrl Z.');
  });
}

function wireNavigationControls() {
  el('#tool-navigation').addEventListener('click', () =>
    setNavigationPanel(el('#navigation-panel').hidden),
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
    if (furnitureHistory.undo()) syncFurniture();
  });
  el('#redo-selected-furniture').addEventListener('click', () => {
    if (furnitureHistory.redo()) syncFurniture();
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
    if (mode === 'walk')
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
  // L'aimantation se suspend en maintenant Alt pendant le glisser ; sans effet ailleurs.
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
      if (modifier && !event.altKey && !event.shiftKey && mode !== 'walk' && !exteriorView) {
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
        const changed =
          shortcut === 'y' || event.shiftKey ? furnitureHistory.redo() : furnitureHistory.undo();
        if (changed) syncFurniture();
        return;
      }
      if (event.code === 'Escape') {
        selectFurniture(undefined);
        return;
      }
      if (mode === 'walk' || exteriorView) return;
      const item = currentFurniture().find((candidate) => candidate.id === selectedFurnitureId);
      if (!item) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (item.locked) {
          if (!event.repeat)
            toast(`« ${item.name} » est verrouillé. Déverrouillez-le pour le supprimer.`);
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
          toast(`« ${item.name} » est verrouillé. Déverrouillez-le pour le déplacer.`);
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
          if (!event.repeat)
            toast(error instanceof Error ? error.message : 'Déplacement impossible.');
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
    el('#view-title').textContent = 'Extérieur';
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
  el('#copy-link').addEventListener('click', () => void copyShareLink());
  el('#adopt-received-project').addEventListener('click', () => {
    if (receivedShare) void adoptReceived(receivedShare.document);
  });
  el('#export-image').addEventListener('click', () => {
    openDialog(
      'EXPORTER UNE IMAGE',
      `<h2>Garder cette vue</h2><p>Image PNG de la caméra actuelle, sans les panneaux de l’interface. Le fichier est généré sur cet ordinateur.</p><div class="image-export-options"><label><input id="image-labels" type="checkbox" ${showLabels && mode !== 'walk' ? 'checked' : ''}> Noms et surfaces des pièces</label><label><input id="image-dimensions" type="checkbox" ${showDimensions && mode !== 'walk' ? 'checked' : ''} ${mode === 'walk' ? 'disabled' : ''}> Dimensions extérieures</label><label><input id="image-transparent" type="checkbox"> Fond transparent</label><label><input id="image-header" type="checkbox" checked> Cartouche projet</label></div><p id="image-export-status" role="status"></p><button id="download-scene-image" class="primary-button">Télécharger le PNG</button>`,
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
        el('#image-export-status').textContent =
          error instanceof Error ? error.message : 'Export image impossible.';
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
      `<h2>Supprimer « ${esc(project.name)} » ?</h2><p>Ce projet et les aménagements de ses niveaux seront supprimés de cet ordinateur. Exportez une copie pour les conserver.</p><div class="dialog-actions"><button type="button" class="text-button dialog-actions-start" id="export-before-delete">${icon('export', 17)} Exporter une copie</button><button type="button" class="text-button" id="cancel-delete-project">Annuler</button><button type="button" class="danger-button" id="confirm-delete-project">Supprimer le projet</button></div>`,
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
        backups = keys.map((key) => [key, localStorage.getItem(key)]);
        localStorage.setItem(STORAGE, JSON.stringify(next));
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
          'Suppression impossible : la mémoire locale est indisponible. Votre projet reste ouvert.',
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
    const sceneEngine = createEngine(el<HTMLCanvasElement>('#scene'));
    viewer = new HouseViewer(el<HTMLCanvasElement>('#scene'), sceneEngine);
    frameRate = new FrameRateMeter(el('#frame-rate'));
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
    viewer.onEditFurniture = openFurnitureEditor;
    viewer.onPointerLockError = () => {
      toast(
        'Capture indisponible : cliquez dans la vue, puis glissez pour regarder autour de vous.',
      );
      el<HTMLCanvasElement>('#scene').focus();
    };
    viewer.onMeasure = (measurement) => measureBar.sync(measurement);
    viewer.onFrame = (frame) => {
      if (!current) return;
      frameRate.update(performance.now(), viewer.engine.getFps());
      updateFurnitureContext();
      const labelsVisible = mode !== 'walk' && showLabels && !viewer.measureMode;
      el('#orientation-arrow').style.transform =
        `rotate(${frame.planUpDegrees + (solarPanel.settings?.northAngleDeg ?? 0)}deg)`;
      const labelBoxes: LabelBox[] = [];
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
          if (mode === 'plan' && !label.hidden)
            labelBoxes.push({
              id: room.id,
              x: p.x,
              y: p.y,
              width: label.offsetWidth,
              height: label.offsetHeight,
              priority: selectedRoom?.id === room.id ? 10 : 0,
            });
        }
      }
      if (mode === 'plan' && labelBoxes.length) {
        const viewport = el('#viewport');
        const origin = viewport.getBoundingClientRect();
        const obstacles =
          furnitureLayer?.getLabelObstacles((point, height) => viewer.project(point, height)) ?? [];
        for (const selector of [
          '.viewport-top',
          '.floating-tools',
          '.mini-card',
          '.bottom-controls',
          '.solar-timeline',
          '#furniture-context-toolbar',
          '#navigation-panel',
        ]) {
          const element = viewport.querySelector<HTMLElement>(selector);
          if (!element || element.hidden || !element.offsetWidth || !element.offsetHeight) continue;
          const rect = element.getBoundingClientRect();
          obstacles.push({
            x: rect.left - origin.left,
            y: rect.top - origin.top,
            width: rect.width,
            height: rect.height,
          });
        }
        for (const placed of layoutLabels(labelBoxes, obstacles, {
          width: viewport.clientWidth,
          height: viewport.clientHeight,
        })) {
          const label = document.querySelector<HTMLElement>(
            `[data-label="${CSS.escape(placed.id)}"]`,
          )!;
          label.hidden = !placed.visible;
          label.style.left = `${placed.x}px`;
          label.style.top = `${placed.y}px`;
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
        measureBar.moveTo(p);
      }
      if (mode === 'walk') {
        el('#door-prompt').hidden = !frame.nearDoor || !el('#walk-start').hidden;
        el('#furniture-edit-prompt').hidden =
          !frame.nearFurnitureId ||
          !el('#walk-start').hidden ||
          !!document.querySelector('dialog[open]');
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
    if (isShareLink(location.hash)) await openSharedLink(initial);
    else loadProject(initial);
    // Development-only bench: the dynamic import behind `DEV` is what keeps the
    // whole module out of a production build.
    if (import.meta.env.DEV) {
      void import('./ui/fxLab').then(({ mountFxLab }) => mountFxLab(viewer));
    }
    installDiagnostics(() =>
      collectDiagnostics(viewer.engine, viewer.scene, {
        mode,
        exterior: exteriorView,
        environment: viewer.ambience.environment,
        occlusion: viewer.ambience.occlusion,
      }),
    );
    wireEvents();
    el('#loading').hidden = true;
    onboarding = readOnboarding();
    showStartCard();
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
