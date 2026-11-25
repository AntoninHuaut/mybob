import { userMessage } from '../errorMessage';
import { pointInPolygon } from '../model/geometry';
import { escapeHtml as esc } from '../ui/format';
import { FurnitureLayer, type FurnitureOverlays } from '../furniture/layer';
import type { FurnitureViewState } from '../furniture/viewState';
import { FurniturePanel } from '../furniture/panel';
import { STALE_MESSAGE } from '../furniture/variants';
import { VariantsPanel } from '../ui/variantsPanel';
import { ArrangementPanel } from '../ui/arrangementPanel';
import { FurnitureClipboard } from '../furniture/clipboard';
import { chairsAroundTable } from '../furniture/tableChairs';
import { snapDraggedFurniture, defaultSnapSettings } from '../furniture/arrangement';
import { FurnitureHistory, type FurnitureItem } from '../furniture/model';
import { checkFurniture } from '../furniture/checks';
import { findFurniturePlacement, getBuildingPlacementIssues } from '../furniture/placement';
import { flipAgainstPartition, moveFurnitureToRoom, partitionBehind } from '../furniture/roomMove';
import {
  applyFurnitureTransform,
  constrainGroupDrag,
  linkFurniture,
  unlinkFurniture,
} from '../furniture/groups';
import { closeDialog, el, openDialog, pauseForDialog, toast } from './dom';
import { setDisabled, setHidden, setText, setTitle } from '../ui/domWrites';
import { app, READ_ONLY_TOAST } from './state';
import { setMode, setSidebar, syncDisplayControls } from './viewChrome';
import { scheduleLinkHashUpdate } from './shareLinkSync';

/*
 * The furniture of the displayed level: its undo history, selection, scene layer and panels.
 * Every change goes through `commitFurniture`, which checks the building constraints, records
 * the history step and saves the variant.
 */

let furnitureHistory = new FurnitureHistory();
const furnitureClipboard = new FurnitureClipboard();
const furnitureHistories = new Map<string, FurnitureHistory>();
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

/** The arrangement on screen, including an uncommitted drag preview. */
export function currentFurniture() {
  return previewFurniture ?? furnitureHistory.items;
}

/** The committed arrangement of the displayed level: what is saved, exported and linked. */
export function committedFurniture() {
  return furnitureHistory.items;
}

export function setFurnitureView(state: FurnitureViewState) {
  furnitureLayer?.setView(state);
}

export function setFurnitureCirculation(visible: boolean) {
  furnitureLayer?.setCirculation(visible);
}

export function furnitureLabelObstacles(
  project: Parameters<FurnitureLayer['getLabelObstacles']>[0],
) {
  return furnitureLayer?.getLabelObstacles(project) ?? [];
}

export function setLayoutStatus(
  message = 'Aménagement sauvegardé sur cet ordinateur',
  unsaved = false,
) {
  const status = el('#layout-status');
  status.textContent = unsaved ? 'Non sauvegardé' : 'Sauvegardé';
  status.title = message;
  status.setAttribute('aria-label', message);
  status.classList.toggle('unsaved', unsaved);
}

function persistFurniture() {
  try {
    app.layoutSession.save(app.current.id, app.viewer.level.id, furnitureHistory.items);
    refreshLayoutStatus();
    scheduleLinkHashUpdate();
  } catch (error) {
    setLayoutStatus('Aménagement non sauvegardé · exportez le projet', true);
    toast(userMessage(error, 'Sauvegarde indisponible.'));
  }
}

function refreshLayoutStatus() {
  setLayoutStatus(
    app.layoutSession.hasUnsaved
      ? 'Des modifications restent en mémoire dans cette session · exportez les projets concernés avant de fermer'
      : undefined,
    app.layoutSession.hasUnsaved,
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
  if (!app.current || !app.layoutSession.isStale(app.current.id)) return false;
  toast(STALE_MESSAGE);
  return true;
}

function undoFurniture() {
  if (!furnitureStale() && furnitureHistory.undo()) syncFurniture();
}

function redoFurniture() {
  if (!furnitureStale() && furnitureHistory.redo()) syncFurniture();
}

function commitFurniture(items: FurnitureItem[]): boolean {
  if (furnitureStale()) {
    previewFurniture = undefined;
    furnitureLayer?.setItems(furnitureHistory.items);
    furniturePanel?.render();
    return false;
  }
  if (app.readOnlyLink) {
    previewFurniture = undefined;
    furnitureLayer?.setItems(furnitureHistory.items);
    furniturePanel?.render();
    toast(READ_ONLY_TOAST);
    return false;
  }
  try {
    // An unreadable saved book must be restored by import before editing an empty fallback.
    app.layoutSession.active(app.current.id);
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
      const issue = getBuildingPlacementIssues(item, app.viewer.level)[0];
      if (issue) throw new Error(`Placement impossible : ${issue.message}`);
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
  if (!item || item.locked || app.viewer.mode === 'walk' || app.viewer.exteriorView) return;
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
  const level = app.viewer.level;
  const room = level.rooms.find((room) => pointInPolygon(copy.position, room.polygon));
  const placed = findFurniturePlacement(
    { ...copy, position: [copy.position[0] + 0.2, copy.position[1] + 0.2] },
    level,
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
  if (app.readOnlyLink) {
    toast(READ_ONLY_TOAST);
    return;
  }
  const item = currentFurniture().find((candidate) => candidate.id === id);
  if (!item) return;
  const level = app.viewer.level;
  const rooms = level.rooms;
  const partition = partitionBehind(item, level);
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
  el('#cancel-move-room').addEventListener('click', closeDialog);
  document.querySelector('#flip-partition')?.addEventListener('click', () => {
    const result = flipAgainstPartition(currentFurniture(), level, id);
    if (!result.ok) {
      el('#move-room-status').textContent = result.reason;
      return;
    }
    if (!commitFurniture(result.items)) return;
    closeDialog();
    selectFurniture(id);
    toast('Meuble retourné contre l’autre face de la cloison. Annulez avec Ctrl Z.');
  });
  // The list is rebuilt with each dialog, so its listener never piles up.
  document.querySelector('.move-room-list')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-move-room]');
    if (!button) return;
    const room = rooms.find((candidate) => candidate.id === button.dataset.moveRoom);
    const result = moveFurnitureToRoom(currentFurniture(), level, id, button.dataset.moveRoom!);
    if (!result.ok) {
      el('#move-room-status').textContent = result.reason;
      return;
    }
    if (!commitFurniture(result.items)) return;
    closeDialog();
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
  el('#cancel-table-chairs').addEventListener('click', closeDialog);
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
        app.viewer.level,
        {
          width: Number(data.get('width')) / 100,
          depth: Number(data.get('depth')) / 100,
          gap: Number(data.get('gap')) / 100,
          linked: data.get('linked') === 'on',
        },
      );
      if (!commitFurniture(next)) throw new Error('Les chaises ne peuvent pas être placées ici.');
      closeDialog();
      toast('Chaises ajoutées. Ctrl Z annule l’ensemble.');
    } catch (error) {
      el('#table-chairs-status').textContent = userMessage(error, 'Ajout impossible.');
    }
  });
}

/** The floating bar over the selected piece; called on every frame, writes only when shown. */
export function updateFurnitureContext() {
  const toolbar = el('#furniture-context-toolbar');
  const item = furnitureContextItem;
  const viewer = app.viewer;
  if (
    app.readOnlyLink ||
    !selectedFurnitureId ||
    !item ||
    viewer.mode === 'walk' ||
    viewer.exteriorView ||
    draggingFurniture ||
    viewer.measureMode ||
    viewer.goToMode ||
    document.querySelector('dialog[open]')
  ) {
    setHidden(toolbar, true);
    return;
  }
  // Called on every frame while a piece is selected: only changed values are written.
  setText(el('#furniture-context-name'), item.name);
  setHidden(el('#furniture-group-count'), furnitureContextMembers.length < 2);
  setText(el('#furniture-group-count'), `${furnitureContextMembers.length} liés`);
  setTitle(
    el('#furniture-context-name'),
    furnitureContextMembers.length > 1
      ? furnitureContextMembers.map((member) => member.name).join(' + ')
      : item.name,
  );
  toolbar
    .querySelectorAll<HTMLButtonElement>('[data-rotate-selected]')
    .forEach((button) => setDisabled(button, item.locked));
  setDisabled(el<HTMLButtonElement>('#undo-selected-furniture'), !furnitureHistory.canUndo);
  setDisabled(el<HTMLButtonElement>('#redo-selected-furniture'), !furnitureHistory.canRedo);
  setHidden(el('#table-chairs'), item.kind !== 'table');
  setDisabled(
    el<HTMLButtonElement>('#move-selected-furniture'),
    item.locked || furnitureContextMembers.some((member) => member.locked),
  );
  setHidden(toolbar, false);
}

export function selectFurniture(id: string | undefined) {
  if (id && app.viewer.exteriorView) setMode('overview');
  selectedFurnitureId = id;
  furnitureContextItem = id ? currentFurniture().find((item) => item.id === id) : undefined;
  furnitureContextMembers = furnitureContextItem?.groupId
    ? currentFurniture().filter((item) => item.groupId === furnitureContextItem!.groupId)
    : [];
  furnitureLayer?.select(id);
  furniturePanel?.render();
}

export function openFurnitureEditor(id: string) {
  if (app.readOnlyLink) {
    toast(READ_ONLY_TOAST);
    return;
  }
  selectFurniture(id);
  furniturePanel?.openEdit(id);
}

/** Releases the scene layer before the level or the project it belongs to goes away. */
export function unmountFurniture() {
  furnitureLayer?.dispose();
  furnitureLayer = undefined;
}

/** Loads the active variant of the displayed level into a new scene layer and the panels. */
/** How long the last `mountFurniture` spent building the pieces, for the start-up report. */
export let furnitureBuildMs = 0;

export function mountFurniture() {
  const { current, viewer, layoutSession } = app;
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
  const buildStarted = performance.now();
  furnitureLayer = new FurnitureLayer(viewer.scene, viewer.level);
  furnitureLayer.setItems(items);
  furnitureBuildMs = performance.now() - buildStarted;
  furnitureLayer.setOverlays(overlays);
  furnitureLayer.setCirculation(app.display.circulation);
  furnitureLayer.onSelect = selectFurniture;
  furnitureLayer.onEdit = openFurnitureEditor;
  furnitureLayer.onDragBlocked = toast;
  furnitureLayer.onDropPreview = (room) =>
    toast(`Relâchez pour déposer le meuble dans « ${room.name} ».`);
  furnitureLayer.onDroppedInRoom = (room) =>
    toast(`Meuble déposé dans « ${room.name} ». Annulez avec Ctrl Z.`);
  furnitureLayer.snapPlacement = (item, candidates) =>
    snapDraggedFurniture(item, app.viewer.level, candidates, snapSettings, !magnetSuspended);
  furnitureLayer.onDragState = (dragging) => {
    draggingFurniture = dragging;
    if (dragging) app.viewer.orbit.detachControl();
    else if (app.viewer.mode !== 'walk') app.viewer.orbit.attachControl(app.viewer.canvas, true);
  };
  furnitureLayer.onChange = (next, final) => {
    if (final) commitFurniture(next);
    else previewFurniture = next;
  };
  furniturePanel ??= createFurniturePanel();
  furniturePanel.render();
  arrangementPanel ??= new ArrangementPanel(el('#arrangement-panel'), {
    getItems: currentFurniture,
    getSelectedIds: () => arrangedIds,
    getLevel: () => app.viewer.level,
    onApply: commitFurniture,
    onSelection: (ids) => {
      arrangedIds = ids;
    },
    onSnapSettings: (settings) => {
      snapSettings = settings;
    },
  });
  arrangementPanel.render();
  variantsPanel ??= new VariantsPanel(el('#variants-panel'), {
    getBook: () => app.layoutSession.book(app.current.id),
    getLevel: () => app.viewer.level,
    onSelect: (id) => changeVariant(() => app.layoutSession.select(app.current.id, id), true),
    onDuplicate: (name) =>
      changeVariant(() => app.layoutSession.duplicate(app.current.id, name), true),
    onRename: (name) => changeVariant(() => app.layoutSession.rename(app.current.id, name), false),
    onDelete: () => changeVariant(() => app.layoutSession.deleteActive(app.current.id), true),
    onError: toast,
  });
  variantsPanel.render();
  el('#furniture-tab-count').textContent = String(items.length);
  if (restoreError) setLayoutStatus('Aménagement non restauré · importez une sauvegarde', true);
  else refreshLayoutStatus();
}

function createFurniturePanel() {
  return new FurniturePanel(el('#furniture-panel'), {
    getItems: currentFurniture,
    getSelectedId: () => selectedFurnitureId,
    getLevel: () => app.viewer.level,
    getAddPosition: () => app.selectedRoom?.viewpoint ?? app.viewer.level.spawn.position,
    getAddRoomName: () =>
      app.selectedRoom?.name ??
      app.viewer.level.rooms.find((room) =>
        pointInPolygon(app.viewer.level.spawn.position, room.polygon),
      )?.name,
    canUndo: () => furnitureHistory.canUndo,
    canRedo: () => furnitureHistory.canRedo,
    onAdd: (item, linkedTo) => {
      if (app.viewer.exteriorView) setMode('overview');
      const level = app.viewer.level;
      const room =
        level.rooms.find((room) => pointInPolygon(item.position, room.polygon)) ?? app.selectedRoom;
      const placed = findFurniturePlacement(item, level, currentFurniture(), room);
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
        throw new Error(
          app.layoutSession.isStale(app.current.id)
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
          toast('Meubles liés : déplacez ou tournez l’un pour déplacer l’ensemble.');
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
    onUndo: undoFurniture,
    onRedo: redoFurniture,
    onOverlays: (options) => {
      overlays = options;
      furnitureLayer?.setOverlays(options);
      furniturePanel?.render();
    },
    getChecks: () =>
      checkFurniture(currentFurniture(), app.viewer.level).filter(
        (issue) => overlays.clearances || issue.code !== 'clearance',
      ),
    onToast: toast,
    onDialogState: pauseForDialog,
  });
}

function changeVariant(action: () => void, remount: boolean) {
  if (app.readOnlyLink) {
    toast(READ_ONLY_TOAST);
    return;
  }
  const before = JSON.stringify(app.layoutSession.book(app.current.id));
  try {
    action();
  } catch (error) {
    toast(userMessage(error, 'Variante indisponible.'));
  }
  const changed = JSON.stringify(app.layoutSession.book(app.current.id)) !== before;
  if (changed) {
    variantsPanel?.finishEditing();
    if (remount) {
      unmountFurniture();
      mountFurniture();
      syncDisplayControls();
    }
    scheduleLinkHashUpdate();
  }
  refreshLayoutStatus();
}

export function clearProjectHistories(projectId: string) {
  for (const key of furnitureHistories.keys())
    if (JSON.parse(key)[0] === projectId) furnitureHistories.delete(key);
}

/** The floating bar over the selected piece, and the guard against closing with unsaved work. */
export function wireFurnitureToolbar() {
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
    if (!app.layoutSession.hasUnsaved) return;
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
  document
    .querySelectorAll<HTMLButtonElement>('[data-rotate-selected]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        rotateSelectedFurniture(Number(button.dataset.rotateSelected)),
      ),
    );
  el('#undo-selected-furniture').addEventListener('click', undoFurniture);
  el('#redo-selected-furniture').addEventListener('click', redoFurniture);
}

/** Copy/paste, undo/redo, delete, arrow nudges and R rotation of the selected piece. */
export function wireFurnitureShortcuts() {
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
  window.addEventListener('keydown', handleFurnitureKey, true);
}

function handleFurnitureKey(event: KeyboardEvent) {
  const viewer = app.viewer;
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
        if (!event.repeat) toast('Déplacement bloqué par le bâtiment ou un meuble de l’ensemble.');
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
}
