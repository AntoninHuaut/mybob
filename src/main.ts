import './style.css';
import { SolarPanel } from './ui/solarPanel';
import { confirmImportReplacement } from './ui/confirmImport';
import { solarPosition } from './scene/solar';
import { HouseViewer, type ViewMode } from './scene/viewer';
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
import { layoutLabels, type LabelBox } from './ui/labelLayout';
import { exportSceneImage } from './ui/imageExport';
import {
  FurnitureHistory,
  createFurniture,
  layoutStorageKey,
  validateFurnitureList,
  type FurnitureItem,
} from './furniture/model';
import { checkFurniture, snapFurniture } from './furniture/checks';
import { findFurniturePlacement, getBuildingPlacementIssues } from './furniture/placement';
import {
  applyFurnitureTransform,
  constrainGroupDrag,
  linkFurniture,
  unlinkFurniture,
} from './furniture/groups';
import type { WallDisplay } from './scene/wallCutaway';

const STORAGE = 'maison-atelier:projects:v1';
const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let viewer: HouseViewer;
let solarPanel: SolarPanel;
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
let furnitureHistory = new FurnitureHistory();
const furnitureClipboard = new FurnitureClipboard();
const furnitureHistories = new Map<string, FurnitureHistory>();
const layoutSession = new VariantSession();
let variantsPanel: VariantsPanel | undefined;
let arrangementPanel: ArrangementPanel | undefined;
let arrangedIds: string[] = [];
let snapSettings = { ...defaultSnapSettings };
let furnitureLayer: FurnitureLayer | undefined;
let furniturePanel: FurniturePanel | undefined;
let selectedFurnitureId: string | undefined;
let furnitureContextItem: FurnitureItem | undefined;
let furnitureContextMembers: FurnitureItem[] = [];
let previewFurniture: FurnitureItem[] | undefined;
let draggingFurniture = false;
let overlays: FurnitureOverlays = { distances: true, clearances: false, openings: false };
let syncingViewerMode = false;

el('#app').innerHTML = `
  <header class="app-header">
    <button id="toggle-sidebar" class="mobile-menu-button" aria-controls="project-sidebar" aria-expanded="false" aria-label="Afficher les pièces et projets">${icon('layers', 20)}</button>
    <a class="brand" href="#" aria-label="Maison, revenir à la vue d’ensemble"><span class="brand-mark">${icon('house', 23)}</span><span>maison<span class="brand-dot">.</span><small>ATELIER 3D</small></span></a>
    <div class="header-separator"></div><div class="project-breadcrumb"><span id="header-project">Votre espace</span>${icon('chevron', 13)}<span id="header-level">Rez-de-chaussée</span></div>
    <div class="header-actions"><span id="layout-status" class="layout-status" role="status" title="Aménagement sauvegardé sur cet ordinateur" aria-label="Aménagement sauvegardé sur cet ordinateur">Sauvegardé</span><button class="text-button" id="export-project" title="Exporter les données du projet">${icon('export', 17)}<span>Exporter</span></button><button class="text-button" id="export-image" title="Exporter une image de la vue" aria-label="Exporter une image de la vue">${icon('image', 17)}<span>Image</span></button><button class="icon-button" id="help" title="Aide et commandes" aria-label="Aide et commandes">${icon('help')}</button></div>
  </header>
  <div class="workspace">
    <button class="sidebar-backdrop" aria-label="Fermer le panneau des pièces" hidden></button>
    <aside class="sidebar" id="project-sidebar" aria-label="Projets et pièces">
      <section class="project-section"><div class="eyebrow">Mon projet</div><label for="project-select" class="sr-only">Choisir une maison</label><div class="project-select-row"><div class="select-wrap"><span class="select-icon">${icon('house', 20)}</span><select id="project-select"></select>${icon('down', 15)}</div><button id="remove-project" class="project-delete icon-button" disabled title="Les projets fournis ne peuvent pas être supprimés" aria-label="Supprimer le projet importé">${icon('trash', 18)}</button></div><p id="project-description" class="muted"></p><p id="demo-notice" class="demo-notice" hidden>Vous consultez une démonstration. Importez le fichier JSON de votre maison pour afficher votre projet. Il reste dans ce navigateur.</p><button id="import-project" class="import-button">${icon('plus', 16)} Importer ma maison</button><p class="project-privacy">Fichier JSON · conservé sur cet ordinateur</p><input type="file" id="import-file" accept="application/json,.json" hidden/></section>
      <div class="sidebar-tabs" role="tablist" aria-label="Outils du projet"><button type="button" id="sidebar-house-tab" role="tab" aria-selected="true" aria-controls="house-panel" tabindex="0">${icon('house', 17)} Maison</button><button type="button" id="sidebar-furniture-tab" role="tab" aria-selected="false" aria-controls="furniture-workspace-panel" tabindex="-1">${icon('layers', 17)} Meubles <span id="furniture-tab-count">0</span></button></div>
      <section id="house-panel" role="tabpanel" aria-labelledby="sidebar-house-tab" tabindex="0">
<section class="level-section"><div class="eyebrow">Pièces <span id="room-count"></span></div><label for="level-select" class="sr-only">Choisir le niveau</label><div class="level-selector">${icon('layers', 17)}<select id="level-select"></select><span class="level-dot"></span></div><div id="room-list" class="room-list"></div></section>
      <section class="room-detail" id="room-detail"></section>
      </section>
      <section id="furniture-workspace-panel" role="tabpanel" aria-labelledby="sidebar-furniture-tab" tabindex="0" hidden><section id="variants-panel" aria-label="Variantes d’aménagement"></section><section id="furniture-panel" aria-label="Aménager la maison"></section><section id="arrangement-panel" aria-label="Placement précis"></section></section>

      <div class="sidebar-bottom"><button class="source-button" id="source-info">${icon('info', 17)}<span>Plans et précision<small>Cotes, hypothèses et points à vérifier</small></span>${icon('chevron', 15)}</button></div>
    </aside>
    <main class="viewport" id="viewport" aria-label="Atelier de visite 3D">
      <canvas id="scene" tabindex="0" aria-label="Vue 3D de la maison. Utilisez le bouton Visite pour vous déplacer au clavier."></canvas>
      <div class="viewport-top"><div class="view-heading"><span class="eyebrow" id="view-eyebrow">VOTRE MAISON, EN PERSPECTIVE</span><h1 id="view-title">Vue 3D</h1><p id="view-subtitle">Explorez les volumes, à votre rythme.</p></div><div class="view-switch" role="group" aria-label="Mode de visualisation"><button data-view="overview" class="active" aria-pressed="true">${icon('cube', 17)}Vue 3D</button><button id="view-exterior" aria-pressed="false" hidden>${icon('house', 17)}Extérieur</button><button data-view="plan" aria-pressed="false">${icon('plan', 17)}Plan</button><button data-view="walk" aria-pressed="false">${icon('walk', 17)}Visite</button></div></div>
      <div class="floating-tools" role="group" aria-label="Options d’affichage"><button class="tool-button" id="tool-navigation" title="Réglages de navigation" aria-controls="navigation-panel" aria-expanded="false">${icon('compass')}<span>Navigation</span></button><div class="tool-divider"></div><button class="tool-button" id="tool-measure" aria-pressed="false" title="Mesurer une distance au sol">${icon('ruler')}<span>Mesurer</span></button><div class="tool-divider"></div><button class="tool-button" id="tool-solar" title="Soleil selon le lieu, la date et l’heure" aria-haspopup="dialog">${icon('sun')}<span>Soleil</span></button><button class="tool-button active" id="tool-labels" aria-pressed="true" title="Afficher les noms des pièces">${icon('label')}<span>Pièces</span></button><button class="tool-button" id="tool-dimensions" aria-pressed="false" title="Afficher les dimensions extérieures">${icon('plan')}<span>Cotes</span></button><button class="tool-button active" id="tool-lights" aria-pressed="true" title="Allumer les éclairages intérieurs">${icon('bulb')}<span>Éclairages intérieurs</span></button><button class="tool-button" id="tool-ceiling" aria-pressed="false" title="Afficher le plafond en vue 3D">${icon('roof')}<span>Plafond</span></button><div class="tool-divider"></div><button class="tool-button" id="tool-reset" title="Recentrer la vue">${icon('reset')}<span>Recentrer</span></button></div>
      <section class="navigation-settings navigation-panel" id="navigation-panel" aria-label="Navigation et caméra" hidden><div class="navigation-panel-heading"><strong>Navigation</strong><button type="button" id="close-navigation" class="icon-button" aria-label="Fermer les réglages de navigation">${icon('close', 18)}</button></div><div class="navigation-settings-body"><button id="go-to" class="visit-room" aria-pressed="false">Cliquer pour entrer ici</button><p>Choisissez un point libre du sol, puis explorez au clavier.</p><label>Vitesse de marche <output id="walk-speed-value">2,8 m/s</output><input id="walk-speed" type="range" min="1" max="5" step="0.2" value="2.8"></label><label>Sensibilité de la souris <output id="look-sensitivity-value">100 %</output><input id="look-sensitivity" type="range" min="50" max="200" step="10" value="100"></label><small>Maj pour marcher plus vite. Ces réglages sont conservés sur cet ordinateur.</small><label>Hauteur du regard<select id="eye-height"><option value="1.65">Debout · 1,65 m</option><option value="1.15">Assis · 1,15 m</option><option value="0.95">À 0,95 m</option><option value="1.80">À 1,80 m</option></select></label><label>Affichage des murs<select id="wall-display"><option value="auto">Automatique</option><option value="full">Murs complets</option><option value="low">Murs bas</option></select></label><label class="navigation-check"><input type="checkbox" id="section-enable"> Vue en coupe</label><label>Hauteur de coupe <output id="section-value">1,20 m</output><input id="section-height" type="range" min="0.4" max="2.5" step="0.05" value="1.2" disabled></label><small>En automatique, les murs gênants s’abaissent selon la vue. La visite conserve les volumes complets.</small></div></section>
      <div id="scene-labels" class="scene-labels"></div>
      <div id="furniture-context-toolbar" class="furniture-context-toolbar" role="group" aria-label="Actions du meuble sélectionné" hidden><span id="furniture-context-name"></span><button type="button" id="edit-selected-furniture" aria-label="Modifier le meuble sélectionné" title="Modifier le meuble">${icon('edit', 16)}</button><button type="button" data-rotate-selected="-90" aria-label="Tourner le meuble de 90 degrés vers la gauche" title="Tourner de 90° vers la gauche">↶ 90°</button><button type="button" data-rotate-selected="90" aria-label="Tourner le meuble de 90 degrés vers la droite" title="Tourner de 90° vers la droite">↷ 90°</button><button type="button" data-rotate-selected="15" aria-label="Tourner le meuble de 15 degrés" title="Rotation précise de 15°">+15°</button><button type="button" id="duplicate-selected-furniture" aria-label="Dupliquer le meuble sélectionné" title="Dupliquer le meuble">${icon('copy', 17)}</button><button type="button" id="snap-selected-furniture" aria-label="Placer le meuble sélectionné contre un mur" title="Placer contre un mur">${icon('wall-snap', 17)}</button><button type="button" id="delete-selected-furniture" aria-label="Retirer le meuble sélectionné" title="Retirer le meuble">${icon('trash', 17)}</button></div>
      <div class="dimension-label" id="width-label" hidden></div><div class="dimension-label" id="depth-label" hidden></div>
      <div id="measure-label" class="measurement-label" hidden></div>
      <div id="measure-instructions" class="measure-instructions" hidden>${icon('ruler', 17)}<span>Cliquez sur deux points du sol.</span><button id="end-measure" aria-label="Quitter la mesure">${icon('close', 15)}</button></div>
      <div id="crosshair" class="crosshair" hidden></div>
      <div id="door-prompt" class="door-prompt" hidden><kbd>E</kbd> Ouvrir / fermer la porte</div><div id="furniture-edit-prompt" class="door-prompt" hidden><kbd>F</kbd> Modifier le meuble</div>
      <div id="walk-start" class="walk-start" hidden><div class="walk-start-icon">${icon('walk', 25)}</div><h2>Bienvenue chez vous.</h2><p>Avancez avec <strong>ZQSD</strong> ou les <strong>flèches</strong>.<br>Regardez autour de vous avec la souris.</p><button class="primary-button" id="capture-mouse">Entrer dans la visite ${icon('arrow', 17)}</button><small>Échap pour libérer la souris · E pour une porte</small></div>
      <button id="resume-walk" class="resume-walk" hidden>${icon('mouse', 17)} Reprendre la visite</button>
      <div class="orientation" title="Direction du haut du document de référence"><span>HAUT DU PLAN</span><svg id="orientation-arrow" width="23" height="23" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 6 18-6-4-6 4Z" fill="currentColor"/></svg></div>
      <div class="mini-card"><div class="mini-heading"><span>VOUS REPÉRER</span><button id="mini-plan" aria-label="Ouvrir la vue en plan" title="Vue en plan">${icon('plan', 15)}</button></div><div id="minimap"></div><div class="mini-caption" id="mini-caption">Rez-de-chaussée</div></div>
      <div class="bottom-controls"><div class="control-hint" id="control-hint"><kbd>ZQSD</kbd><span>Déplacer la vue</span><i></i>${icon('mouse-left', 17)}<span>Glisser gauche pour tourner</span><i></i>${icon('mouse-right', 17)}<span>Glisser droit pour déplacer</span></div><div class="scale-note"><span class="scale-line"></span> Dimensions en mètres</div></div>
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

function snapSelectedFurniture(id: string) {
  const items = currentFurniture(),
    item = items.find((candidate) => candidate.id === id);
  if (!item || item.locked) return;
  const snapped = snapFurniture(item, viewer.level, items, 0.3);
  if (
    Math.hypot(snapped.position[0] - item.position[0], snapped.position[1] - item.position[1]) <
    0.001
  ) {
    toast('Rapprochez le meuble du mur (moins de 30 cm), puis réessayez.');
    return;
  }
  updateFurniture(snapped);
}

function updateFurnitureContext() {
  const toolbar = el('#furniture-context-toolbar');
  const item = furnitureContextItem;
  if (
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
  el<HTMLButtonElement>('#snap-selected-furniture').disabled = item.locked;
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
  furnitureLayer.onSelect = selectFurniture;
  furnitureLayer.onEdit = openFurnitureEditor;
  furnitureLayer.onDragBlocked = toast;
  furnitureLayer.snapPlacement = (item, candidates) =>
    snapDraggedFurniture(item, viewer.level, candidates, snapSettings);
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
      onSnap: snapSelectedFurniture,
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
      onSelect: (id) => changeVariant(() => layoutSession.select(current.id, id), true),
      onDuplicate: (name) => changeVariant(() => layoutSession.duplicate(current.id, name), true),
      onRename: (name) => changeVariant(() => layoutSession.rename(current.id, name), false),
      onError: toast,
    });
  variantsPanel.render();
  el('#furniture-tab-count').textContent = String(items.length);
  if (restoreError) setLayoutStatus('Aménagement non restauré · importez une sauvegarde', true);
  else refreshLayoutStatus();
}

function changeVariant(action: () => void, remount: boolean) {
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
  layoutSession.register(
    p.id,
    p.levels.map((level) => level.id),
  );
  viewer.load(p, levelId);
  solarPanel.load(p);
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
  viewer.setWallDisplay(el<HTMLSelectElement>('#wall-display').value as WallDisplay);
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
  if (move) setSidebarTab('house');
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
    `<div class="eyebrow">Pièce sélectionnée <button id="clear-room" aria-label="Désélectionner la pièce">${icon('close', 14)}</button></div><h2>${esc(room.name)}</h2><div class="room-detail-area">${area(room.planArea ?? computed)} <span>${room.planArea !== undefined ? 'au plan' : 'calculés'}</span></div><div class="detail-data"><span>Surface reconstruite</span><strong>${area(computed)}</strong></div>${difference ? '<p class="precision-note">Raccords à vérifier : les deux surfaces diffèrent.</p>' : ''}<p class="room-note">${esc(room.note ?? 'Dimensions en mètres, entre les faces intérieures des murs finis.')}</p><button id="visit-room" class="visit-room">Visiter cette pièce ${icon('arrow', 16)}</button>`;
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
    overview: ['VOTRE MAISON, EN PERSPECTIVE', 'Vue 3D', 'Explorez les volumes, à votre rythme.'],
    plan: [
      'LES VOLUMES, À L’ÉCHELLE',
      'Plan de la maison',
      'Retrouvez la disposition et les proportions des pièces.',
    ],
    walk: [
      'À HAUTEUR DE REGARD',
      'Visite intérieure',
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
        ? `<kbd>ZQSD</kbd><span>Déplacer la vue · Maj pour accélérer</span><i></i>${icon('mouse-left', 17)}<span>Glisser pour déplacer</span><i></i>${icon('mouse-wheel', 17)}<span>Molette pour zoomer</span>`
        : `<kbd>ZQSD</kbd><span>Déplacer la vue</span><i></i>${icon('mouse-left', 17)}<span>Glisser gauche pour tourner</span><i></i>${icon('mouse-right', 17)}<span>Glisser droit pour déplacer</span><i></i>${icon('mouse-wheel', 17)}<span>Molette pour zoomer</span>`;
  const touchHint = document.createElement('span');
  touchHint.className = 'touch-hint';
  touchHint.textContent =
    next === 'plan'
      ? 'Glisser pour déplacer · Pincer pour zoomer'
      : next === 'walk'
        ? 'Glisser pour regarder · Clavier pour marcher'
        : 'Glisser pour tourner · Deux doigts pour déplacer ou zoomer';
  el('#control-hint').append(touchHint);
  syncDisplayControls();
  if (next !== 'walk' && !fromViewer) viewer.canvas.focus({ preventScroll: true });
  el('#measure-instructions').hidden = true;
  el('#measure-label').hidden = true;
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

function downloadProject() {
  let levels: Record<string, FurnitureItem[]>;
  let variants: VariantBook;
  try {
    levels = Object.fromEntries(
      current.levels.map((level) => [
        level.id,
        level.id === viewer.level.id
          ? furnitureHistory.items
          : layoutSession.load(current.id, level.id),
      ]),
    );
    variants = layoutSession.book(current.id);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Export indisponible.');
    return;
  }
  const blob = new Blob(
    [
      JSON.stringify(
        { ...current, solar: solarPanel.settings, furnishing: { version: 1, levels, variants } },
        null,
        2,
      ),
    ],
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
        furnishing?: { version: number; levels: Record<string, unknown>; variants?: unknown };
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
      furnishing?.variants,
    );
    if (
      existing &&
      !(await confirmImportReplacement(
        existing.name,
        (open) => {
          if (open && document.pointerLockElement) document.exitPointerLock();
          viewer.setPaused(open);
        },
        current.id === existing.id ? downloadProject : undefined,
      ))
    )
      return;
    delete (project as HouseProject & { furnishing?: unknown }).furnishing;
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

function setNavigationPanel(open: boolean) {
  const focusInside = el('#navigation-panel').contains(document.activeElement);
  el('#navigation-panel').hidden = !open;
  el('#tool-navigation').setAttribute('aria-expanded', String(open));
  if (open) el('#go-to').focus({ preventScroll: true });
  else if (focusInside) el('#tool-navigation').focus({ preventScroll: true });
}

function wireEvents() {
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
  el('#snap-selected-furniture').addEventListener('click', () => {
    if (selectedFurnitureId) snapSelectedFurniture(selectedFurnitureId);
  });
  el('#delete-selected-furniture').addEventListener('click', () => {
    if (!selectedFurnitureId) return;
    if (commitFurniture(currentFurniture().filter((item) => item.id !== selectedFurnitureId)))
      toast('Meuble retiré. Annulez depuis Meubles ou avec Ctrl Z.');
  });
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
  el('#export-image').addEventListener('click', () => {
    openDialog(
      'EXPORTER UNE IMAGE',
      `<h2>Garder cette vue</h2><p>Image PNG de la caméra actuelle, sans les panneaux de l’interface. Le fichier est généré sur cet ordinateur.</p><div class="image-export-options"><label><input id="image-labels" type="checkbox" ${showLabels && mode !== 'walk' ? 'checked' : ''}> Noms et surfaces des pièces</label><label><input id="image-dimensions" type="checkbox" ${showDimensions && mode !== 'walk' ? 'checked' : ''} ${mode === 'walk' ? 'disabled' : ''}> Dimensions extérieures</label></div><p id="image-export-status" role="status"></p><button id="download-scene-image" class="primary-button">Télécharger le PNG</button>`,
    );
    el<HTMLButtonElement>('#download-scene-image').addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        await exportSceneImage(viewer, {
          labels: el<HTMLInputElement>('#image-labels').checked,
          dimensions: el<HTMLInputElement>('#image-dimensions').checked,
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
      `<h2>Supprimer « ${esc(project.name)} » ?</h2><p>Ce projet et les aménagements de ses niveaux seront supprimés de cet ordinateur. Exportez une copie pour les conserver.</p><button type="button" class="text-button" id="export-before-delete">${icon('export', 17)} Exporter avant de supprimer</button><button type="button" class="primary-button" id="confirm-delete-project">Supprimer le projet</button><button type="button" class="text-button" id="cancel-delete-project">Annuler</button>`,
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
  el('#tool-solar').addEventListener('click', () => solarPanel.open());
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
      `<h2>Faites comme chez vous.</h2><div class="help-grid"><div>${icon('cube', 24)}<h3>Vue 3D</h3><p>ZQSD ou WASD pour déplacer la vue, Maj pour accélérer. Glissez avec le bouton gauche pour tourner, le bouton droit pour déplacer ; utilisez la molette pour zoomer. Les flèches déplacent aussi la vue quand aucun meuble n’est sélectionné.</p></div><div>${icon('walk', 24)}<h3>Visite</h3><p>ZQSD, WASD ou flèches pour marcher. Souris pour regarder, Maj pour accélérer, E pour ouvrir une porte, F pour modifier le meuble visé. Échap libère la souris.</p></div><div>${icon('ruler', 24)}<h3>Mesures</h3><p>Activez Mesurer, puis cliquez sur deux points du sol. La distance est exprimée en mètres. Un troisième clic commence une nouvelle mesure.</p></div><div>${icon('plan', 24)}<h3>Vos repères</h3><p>Sélectionnez une pièce dans la liste ou le plan miniature, puis choisissez « Visiter cette pièce » pour vous y rendre.</p></div></div><div class="dialog-callout">Si le navigateur refuse la capture de la souris, cliquez dans la vue puis maintenez le bouton gauche pour regarder autour de vous. Les touches de déplacement restent disponibles.</div><p>Les portes intérieures sont ouvertes au départ. Cliquez sur une porte en vue 3D, ou utilisez E à proximité pendant la visite. Ajoutez un meuble depuis le panneau Meubles, puis glissez-le dans la scène. Dans la fenêtre de modification, les changements restent en aperçu jusqu’à validation ; Annuler conserve l’aménagement précédent. Les flèches déplacent le meuble sélectionné de 1 cm, Maj de 10 cm ; R le tourne de 15°. Ctrl Z annule et Ctrl Maj Z rétablit. Renseignez les dimensions réelles du meuble et sa configuration.</p><h3>Affichage des murs</h3><p>Dans Navigation, choisissez Automatique, Murs complets ou Murs bas pour dégager la vue. La visite conserve les murs complets.</p><h3>Importer votre maison</h3><p>Le bouton « Importer ma maison » ouvre un fichier JSON de projet fourni séparément. Le PDF du constructeur doit d’abord être converti. La maison et les meubles sont conservés dans ce navigateur ; Exporter permet de garder une copie ou de changer d’ordinateur.</p>`,
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
    if (document.querySelector('dialog[open]')) return;
    if (event.code === 'Escape') setNavigationPanel(false);
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
      el('#resume-walk').hidden = true;
      el<HTMLCanvasElement>('#scene').focus();
    };
    viewer.onMeasure = (measurement) => {
      el('#measure-label').hidden = !measurement?.b;
      if (measurement?.distance !== undefined) {
        el('#measure-label').textContent =
          `${number(measurement.distance)} m${measurement.aligned ? ' · droit' : ''}`;
        el('#measure-instructions span').textContent = measurement.preview
          ? 'Cliquez pour confirmer · Maj : droit · Alt : libre'
          : 'Un nouveau clic commence une autre mesure.';
      } else if (measurement)
        el('#measure-instructions span').textContent =
          'Déplacez le pointeur · Maj : droit · Alt : libre';
    };
    viewer.onFrame = (frame) => {
      if (!current) return;
      updateFurnitureContext();
      const labelsVisible =
        mode !== 'walk' && showLabels && !viewer.measureMode && !(ceiling && mode === 'overview');
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
        el('#measure-label').style.left = `${p.x}px`;
        el('#measure-label').style.top = `${p.y}px`;
        el('#measure-label').hidden = !p.visible;
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
