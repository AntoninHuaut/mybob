import './panel.css';
import type { Level, Point2 } from '../model/types';
import { escapeHtml as esc } from '../ui/format';
import { icon } from '../ui/icons';
import {
  measurementsFromForm,
  dressingDiagram,
  readDressingRuns,
  sofaDiagram,
} from './measurements';
import { groupMembers } from './groups';
import { FurnitureEditorDraft } from './editorDraft';
import { televisionDimensions } from './television';
import {
  createFurniture,
  dressingBounds,
  FURNITURE_CATEGORIES,
  type DressingRun,
  type FurnitureItem,
} from './model';

export interface FurniturePanelAdapter {
  getItems(): FurnitureItem[];
  getSelectedId(): string | undefined;
  getLevel(): Level;
  getAddPosition?(): Point2;
  getAddRoomName?(): string | undefined;
  onAdd(item: FurnitureItem, linkedTo?: string): void;
  onUpdate(item: FurnitureItem): boolean | void;
  onApplyDraft(items: FurnitureItem[], selectedId: string | undefined): boolean;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  onLink(id: string, otherId: string): void;
  onUnlink(id: string): void;
  onSelect(id: string | undefined): void;
  onEdit(id: string): void;
  onUndo(): void;
  onRedo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  onOverlays(options: { distances: boolean; clearances: boolean; openings: boolean }): void;
  getChecks(): { itemId: string; severity: 'warning' | 'error'; message: string }[];
  onToast(message: string): void;
  onDialogState?(open: boolean): void;
}

const KINDS: Record<FurnitureItem['kind'], string> = {
  sofa: 'Canapé',
  table: 'Table',
  chair: 'Chaise',
  bed: 'Lit',
  wardrobe: 'Armoire',
  dressing: 'Dressing',
  desk: 'Bureau',
  cabinet: 'Commode',
  custom: 'Volume sur mesure',
  'tv-stand': 'Meuble TV',
  tv: 'Téléviseur',
  'coffee-table': 'Table basse',
  bookcase: 'Bibliothèque',
  ottoman: 'Pouf',
  'side-table': 'Table d’appoint',
  toilet: 'WC',
  shower: 'Douche',
  bathtub: 'Baignoire',
  vanity: 'Meuble vasque',
};
const cm = (meters: number) => Math.round(meters * 1000) / 10;
const degrees = (radians: number) =>
  Math.round((((((radians * 180) / Math.PI) % 360) + 360) % 360) * 10) / 10;

function checked(value: boolean) {
  return value ? ' checked' : '';
}
function disabled(value: boolean) {
  return value ? ' disabled' : '';
}

/** Grouped by room so the list stays readable as the catalogue grows. */
function kindOptions(selected: FurnitureItem['kind']) {
  return FURNITURE_CATEGORIES.map(
    (category) =>
      `<optgroup label="${esc(category.title)}">${category.kinds
        .map(
          (kind) =>
            `<option value="${kind}"${kind === selected ? ' selected' : ''}>${KINDS[kind]}</option>`,
        )
        .join('')}</optgroup>`,
  ).join('');
}

/** Depth of the main body: a sofa stores it in its shape, everything else in depth. */
const bodyDepth = (item: FurnitureItem) => item.sofa?.seatDepth ?? item.depth;

function dimensionsFields(item: FurnitureItem) {
  return `<fieldset class="furniture-tv-fields" data-tv-fields${item.kind === 'tv' ? '' : ' hidden disabled'}${item.locked ? ' disabled' : ''}><legend>Taille de l’écran</legend><label class="furniture-field">Diagonale <span>pouces</span><input name="tvDiagonal" type="number" min="5" max="300" step="0.1" placeholder="Ex. 55" value="${item.tvDiagonalInches ?? ''}"></label><p class="furniture-form-note" data-tv-size-note>Écran 16:9. Le pied et les bordures sont estimés ; les dimensions exactes restent ajustables ci-dessous.</p></fieldset><details class="furniture-dimensions" data-dimensions${item.kind === 'tv' ? '' : ' open'}><summary${item.kind === 'tv' ? '' : ' hidden'}>Dimensions exactes (facultatif)</summary><div class="furniture-field-grid"><label class="furniture-field">Largeur <span>cm</span><input name="width" type="number" min="5" max="2000" step="0.1" value="${cm(item.width)}" required${disabled(item.locked)}></label><label class="furniture-field"><span data-depth-label>${depthLabel(item.kind)}</span><span>cm</span><input name="depth" type="number" min="5" max="2000" step="0.1" value="${cm(bodyDepth(item))}" required${disabled(item.locked)}></label><label class="furniture-field">Hauteur <span>cm</span><input name="height" type="number" min="5" max="1000" step="0.1" value="${cm(item.height)}" required${disabled(item.locked)}></label></div></details>`;
}
function depthLabel(kind: string) {
  if (kind === 'sofa') return 'Profondeur du corps';
  if (kind === 'dressing') return 'Profondeur hors tout';
  return 'Profondeur';
}
function syncDepthLabel(form: HTMLFormElement, kind: string) {
  const label = form.querySelector<HTMLElement>('[data-depth-label]');
  if (label) label.textContent = depthLabel(kind);
}
function updateTelevisionFields(form: HTMLFormElement, kind: string, reset = false) {
  const fields = form.querySelector<HTMLFieldSetElement>('[data-tv-fields]');
  if (!fields) return;
  fields.hidden = kind !== 'tv';
  fields.disabled = kind !== 'tv' || form.dataset.geometryLocked === 'true';
  const dimensions = form.querySelector<HTMLDetailsElement>('[data-dimensions]')!;
  dimensions.querySelector('summary')!.hidden = kind !== 'tv';
  if (reset) dimensions.open = kind !== 'tv';
  if (kind === 'tv') {
    const note = form.querySelector<HTMLElement>('[data-tv-size-note]')!;
    const w = (form.elements.namedItem('width') as HTMLInputElement).value;
    const h = (form.elements.namedItem('height') as HTMLInputElement).value;
    note.textContent = `Encombrement estimé : ${w} cm de large, ${h} cm de haut. Écran 16:9 ; pied et bordures estimés. Ajustez les dimensions exactes si nécessaire.`;
  }
}

function sofaFields(item: FurnitureItem) {
  const sofa = item.sofa;
  return `<fieldset class="furniture-shape-fields" data-sofa-fields${item.locked ? ' disabled' : ''}${item.kind === 'sofa' ? '' : ' hidden'}><legend>Forme du canapé</legend><label class="furniture-field">Configuration<select name="sofaShape"><option value="straight"${!sofa ? ' selected' : ''}>Canapé droit</option><option value="corner"${sofa?.shape === 'corner' ? ' selected' : ''}>Canapé d’angle avec dossier en retour</option><option value="chaise"${sofa?.shape === 'chaise' ? ' selected' : ''}>Canapé avec méridienne</option></select></label><div class="furniture-shape-config" data-sofa-config${sofa ? '' : ' hidden'}><label class="furniture-field">Retour vu de face<select name="sofaSide"><option value="left"${sofa?.side !== 'right' ? ' selected' : ''}>À gauche</option><option value="right"${sofa?.side === 'right' ? ' selected' : ''}>À droite</option></select></label><div class="furniture-field-grid two"><label class="furniture-field">Profondeur totale <span>cm</span><input type="number" name="returnDepth" min="5" max="2000" step="0.1" value="${cm(sofa ? item.depth : Math.max(1.8, item.depth + 0.6))}"></label><label class="furniture-field">Largeur du retour <span>cm</span><input type="number" name="returnWidth" min="5" max="2000" step="0.1" value="${cm(sofa?.returnWidth ?? 0.9)}"></label></div><p class="furniture-form-note">Les deux profondeurs partent de l’arrière du dossier. Saisissez la profondeur totale du côté allongé, pas la différence. La largeur du retour est celle de la place allongée vue de face.</p><div class="shape-diagram" data-sofa-diagram></div></div></fieldset>`;
}
function updateSofaFields(form: HTMLFormElement, kind: string, expandDepth = false) {
  const fields = form.querySelector<HTMLFieldSetElement>('[data-sofa-fields]');
  if (!fields) return;
  fields.hidden = kind !== 'sofa';
  fields.disabled = kind !== 'sofa' || form.dataset.geometryLocked === 'true';
  const shape = (form.elements.namedItem('sofaShape') as HTMLSelectElement).value;
  form.querySelector<HTMLElement>('[data-sofa-config]')!.hidden =
    kind !== 'sofa' || shape === 'straight';
  form
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-sofa-config] input, [data-sofa-config] select',
    )
    .forEach((input) => (input.disabled = kind !== 'sofa' || shape === 'straight'));
  if (expandDepth && kind === 'sofa' && shape !== 'straight') {
    const total = form.elements.namedItem('returnDepth') as HTMLInputElement;
    const body = Number((form.elements.namedItem('depth') as HTMLInputElement).value);
    if (Number(total.value) <= body + 5) total.value = String(Math.max(180, body + 60));
  }
  const diagram = form.querySelector<HTMLElement>('[data-sofa-diagram]');
  if (diagram && kind === 'sofa' && shape !== 'straight')
    diagram.innerHTML = sofaDiagram(new FormData(form));
}

function dressingRunRow(run: DressingRun, index: number, count: number) {
  const last = index === count - 1;
  return `<div class="dressing-run" data-dressing-run="${index}"><span class="dressing-run-index">${index + 1}</span><label class="furniture-field">Longueur <span>cm</span><input name="dressingRunLength${index}" type="number" min="20" max="2000" step="0.1" value="${cm(run.length)}" required></label><label class="furniture-field">Ensuite<select name="dressingRunTurn${index}"${last ? ' disabled' : ''}><option value="end"${!run.turn ? ' selected' : ''}>Fin</option><option value="left"${run.turn === 'left' ? ' selected' : ''}>Angle à gauche</option><option value="right"${run.turn === 'right' ? ' selected' : ''}>Angle à droite</option></select></label>${count > 1 ? `<button type="button" class="dressing-remove-run" data-dressing-remove="${index}" aria-label="Retirer le tronçon ${index + 1}" title="Retirer ce tronçon">${icon('close', 14)}</button>` : ''}</div>`;
}
function dressingFields(item: FurnitureItem) {
  return `<fieldset class="furniture-shape-fields" data-dressing-fields${item.locked ? ' disabled' : ''}${item.kind === 'dressing' ? '' : ' hidden'}><legend>Tronçons du dressing</legend><label class="furniture-field">Profondeur <span>cm</span><input name="dressingRunDepth" type="number" min="20" max="2000" step="0.1" value="${cm(item.dressing?.runDepth ?? 0.6)}"></label><div class="dressing-runs" data-dressing-runs></div><button type="button" class="dressing-add-run" data-dressing-add>Ajouter un tronçon</button><p class="furniture-form-note">Chaque tronçon longe un mur ; l’angle part à gauche ou à droite en avançant. Les tronçons partagent leur angle et gardent la même profondeur.</p><div class="shape-diagram" data-dressing-diagram></div></fieldset>`;
}
function readRunsFromForm(form: HTMLFormElement): DressingRun[] {
  return readDressingRuns(
    (name) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? null,
  );
}
/** Renders the run rows and sets each corner select explicitly. */
function applyDressingRuns(form: HTMLFormElement, runs: DressingRun[]) {
  const container = form.querySelector<HTMLElement>('[data-dressing-runs]');
  if (!container) return;
  container.innerHTML = runs.map((run, index) => dressingRunRow(run, index, runs.length)).join('');
  runs.forEach((run, index) => {
    const select = form.elements.namedItem(`dressingRunTurn${index}`) as HTMLSelectElement | null;
    if (select) select.value = run.turn ?? 'end';
  });
  syncDressingTotals(form);
}
/** Overall width and depth follow the runs, so they are shown but never typed. */
function syncDressingTotals(form: HTMLFormElement) {
  const runDepth = Number(
    (form.elements.namedItem('dressingRunDepth') as HTMLInputElement | null)?.value,
  );
  const depth = Number.isFinite(runDepth) && runDepth > 0 ? runDepth / 100 : 0.6;
  const runs = readRunsFromForm(form);
  const bounds = dressingBounds(depth, runs);
  const width = form.elements.namedItem('width') as HTMLInputElement | null;
  const overall = form.elements.namedItem('depth') as HTMLInputElement | null;
  if (width) width.value = String(cm(bounds.width));
  if (overall) overall.value = String(cm(bounds.depth));
  const diagram = form.querySelector<HTMLElement>('[data-dressing-diagram]');
  if (diagram) diagram.innerHTML = dressingDiagram(depth, runs);
}
function updateDressingFields(form: HTMLFormElement, kind: string) {
  const fields = form.querySelector<HTMLFieldSetElement>('[data-dressing-fields]');
  if (!fields) return;
  const locked = form.dataset.geometryLocked === 'true';
  fields.hidden = kind !== 'dressing';
  fields.disabled = kind !== 'dressing' || locked;
  for (const name of ['width', 'depth']) {
    const input = form.elements.namedItem(name) as HTMLInputElement | null;
    if (input) input.disabled = locked || kind === 'dressing';
  }
  if (kind === 'dressing') syncDressingTotals(form);
}

function showerFields(item: FurnitureItem) {
  const type = item.showerType ?? 'bac';
  return `<fieldset class="furniture-shape-fields" data-shower-fields${item.locked ? ' disabled' : ''}${item.kind === 'shower' ? '' : ' hidden'}><legend>Type de douche</legend><label class="furniture-field">Configuration<select name="showerType"><option value="italienne"${type === 'italienne' ? ' selected' : ''}>Douche italienne, sans bac</option><option value="bac"${type === 'bac' ? ' selected' : ''}>Bac de douche et une paroi</option><option value="cabine"${type === 'cabine' ? ' selected' : ''}>Cabine fermée, deux parois</option></select></label><p class="furniture-form-note">La paroi vitrée est à gauche du volume ; tournez le meuble pour la placer autrement. Les dimensions restent celles de l’encombrement au sol.</p></fieldset>`;
}
function updateShowerFields(form: HTMLFormElement, kind: string) {
  const fields = form.querySelector<HTMLFieldSetElement>('[data-shower-fields]');
  if (!fields) return;
  fields.hidden = kind !== 'shower';
  fields.disabled = kind !== 'shower' || form.dataset.geometryLocked === 'true';
}

export class FurniturePanel {
  private dialog: HTMLDialogElement;
  private overlays = { distances: true, clearances: false, openings: false };
  private editDialog: HTMLDialogElement;
  private editId?: string;
  private draft?: FurnitureEditorDraft;

  constructor(
    private container: HTMLElement,
    private adapter: FurniturePanelAdapter,
  ) {
    container.classList.add('furniture-panel');
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'furniture-dialog';
    this.dialog.setAttribute('aria-labelledby', 'furniture-add-title');
    document.body.append(this.dialog);
    container.addEventListener('click', this.click);
    container.addEventListener('dblclick', this.doubleClick);
    container.addEventListener('change', this.change);
    container.addEventListener('input', this.measurementInput);
    this.dialog.addEventListener('click', this.dialogClick);
    this.dialog.addEventListener('change', this.dialogChange);
    this.dialog.addEventListener('input', this.measurementInput);
    this.dialog.addEventListener('submit', this.submitAdd);
    this.dialog.addEventListener('close', this.dialogClosed);
    this.editDialog = document.createElement('dialog');
    this.editDialog.className = 'furniture-dialog furniture-edit-dialog';
    this.editDialog.setAttribute('aria-labelledby', 'furniture-edit-title');
    document.body.append(this.editDialog);
    this.editDialog.addEventListener('click', this.editClick);
    this.editDialog.addEventListener('change', this.change);
    this.editDialog.addEventListener('input', this.measurementInput);
    this.editDialog.addEventListener('submit', this.submitDetails);
    this.editDialog.addEventListener('close', this.editClosed);
    this.render();
  }

  render() {
    const selectedId = this.adapter.getSelectedId();
    const items = this.adapter.getItems();
    const checks = this.adapter.getChecks();
    this.container.innerHTML = `
      <div class="furniture-heading"><div class="eyebrow">Aménagement</div><div class="furniture-history"><button type="button" data-furniture-action="undo" aria-label="Annuler la dernière modification" title="Annuler · Ctrl Z"${disabled(!this.adapter.canUndo())}>↶</button><button type="button" data-furniture-action="redo" aria-label="Rétablir la modification" title="Rétablir · Ctrl Maj Z"${disabled(!this.adapter.canRedo())}>↷</button></div></div>
      <button type="button" class="furniture-add" data-furniture-action="add">${icon('plus', 17)} Ajouter un meuble</button>
      ${items.length ? `<div class="furniture-items" role="group" aria-label="Meubles présents dans ce niveau">${items.map((item) => `<div class="furniture-item${item.id === selectedId ? ' selected' : ''}"><button type="button" class="furniture-item-select" data-furniture-select="${esc(item.id)}" aria-pressed="${item.id === selectedId}"><span class="furniture-item-swatch" style="background:${/^#[a-f\d]{6}$/i.test(item.color) ? item.color : '#a5a18a'}"></span><span class="furniture-item-copy">${esc(item.name)}<small>${cm(item.width)} × ${cm(item.depth)} × ${cm(item.height)} cm</small></span><span class="furniture-item-state">${item.locked ? '🔒' : ''}${checks.some((check) => check.itemId === item.id && check.severity === 'error') ? '<span class="furniture-alert-dot" title="Un conflit est à vérifier">!</span>' : ''}</span></button><button type="button" class="furniture-item-edit" data-furniture-edit-id="${esc(item.id)}" aria-label="Modifier ${esc(item.name)}" title="Modifier">${icon('edit', 15)}</button></div>`).join('')}</div>` : '<p class="furniture-empty">Ajoutez un premier meuble, puis déplacez-le dans la maison pour essayer votre idée.</p>'}
      ${
        items.length
          ? `<fieldset class="furniture-overlays"><legend>Repères</legend><label><input type="checkbox" data-furniture-overlay="distances"${checked(this.overlays.distances)}> Distances aux murs</label><label><input type="checkbox" data-furniture-overlay="clearances"${checked(this.overlays.clearances)}> Espaces de passage</label><label><input type="checkbox" data-furniture-overlay="openings"${checked(this.overlays.openings)}> Ouvertures des meubles</label></fieldset>${checks.length ? `<details class="furniture-checks"${this.container.querySelector<HTMLDetailsElement>('.furniture-checks')?.open ? ' open' : ''}><summary>${checks.length} point${checks.length > 1 ? 's' : ''} à vérifier</summary>${checks.map((check) => `<button type="button" class="furniture-check ${check.severity}" data-furniture-select="${esc(check.itemId)}">${icon('info', 13)}<span>${esc(check.message)}</span></button>`).join('')}<small>Les passages et débattements sont des aides visuelles, à confirmer sur place.</small></details>` : ''}`
          : ''
      }
    `;
  }

  get overlayOptions() {
    return { ...this.overlays };
  }

  private details(item: FurnitureItem) {
    return `<section class="furniture-detail" aria-label="Réglages du meuble">
      <form id="furniture-edit-form" class="furniture-edit-form" data-furniture-edit="${esc(item.id)}" data-geometry-locked="${item.locked}">
        <label class="furniture-field">Nom<input name="name" value="${esc(item.name)}" maxlength="100" required></label>
        ${dimensionsFields(item)}
        ${sofaFields(item)}
        ${dressingFields(item)}
        ${showerFields(item)}
        <details class="furniture-placement"><summary>Placement et options</summary>
        <label class="furniture-field">Hauteur de pose au-dessus du sol <span>cm</span><input name="elevation" type="number" min="0" max="2000" step="0.1" value="${cm(item.elevation ?? 0)}"${disabled(item.locked)}></label>
        <div class="furniture-field-grid"><label class="furniture-field">Position X <span>cm</span><input name="x" type="number" min="-100000" max="100000" step="0.1" value="${cm(item.position[0])}" required${disabled(item.locked)}></label><label class="furniture-field">Position Z <span>cm</span><input name="z" type="number" min="-100000" max="100000" step="0.1" value="${cm(item.position[1])}" required${disabled(item.locked)}></label><label class="furniture-field">Rotation <span>°</span><input name="rotation" type="number" min="-3600" max="3600" step="0.1" value="${degrees(item.rotation)}" required${disabled(item.locked)}></label></div>
        <details class="furniture-advanced"${this.editDialog.querySelector<HTMLDetailsElement>('.furniture-advanced')?.open ? ' open' : ''}><summary>Passage et ouverture</summary><p>Les distances sont proposées pour tester votre aménagement ; ajustez-les à votre usage.</p><div class="furniture-field-grid"><label class="furniture-field">Devant <span>cm</span><input name="front" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.front ?? 0)}"></label><label class="furniture-field">Derrière <span>cm</span><input name="back" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.back ?? 0)}"></label><label class="furniture-field">À gauche <span>cm</span><input name="left" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.left ?? 0)}"></label><label class="furniture-field">À droite <span>cm</span><input name="right" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.right ?? 0)}"></label></div><div class="furniture-field-grid two"><label class="furniture-field">Ouverture<select name="openingKind"><option value="none"${!item.opening ? ' selected' : ''}>Aucune</option><option value="hinged"${item.opening?.kind === 'hinged' ? ' selected' : ''}>Porte battante</option><option value="drawer"${item.opening?.kind === 'drawer' ? ' selected' : ''}>Tiroir</option></select></label><label class="furniture-field">Débattement <span>cm</span><input name="reach" type="number" min="0" max="500" step="1" value="${cm(item.opening?.reach ?? 0.6)}"></label></div></details>
        <label class="furniture-lock"><input type="checkbox" name="locked"${checked(item.locked)}> Verrouiller le meuble</label>
        </details>
      </form>
      <div data-group-controls>${this.groupControls(item)}</div>
      <details class="furniture-more-actions"><summary>Autres actions</summary><div class="furniture-actions">${item.kind === 'tv-stand' ? '<button type="button" data-furniture-action="add-tv">Ajouter une TV dessus</button>' : ''}<button type="button" data-furniture-action="duplicate">Dupliquer</button><button type="button" data-furniture-action="delete" class="furniture-delete">Retirer le meuble</button></div></details>
      <div class="furniture-edit-status" role="status"></div>
      <div class="furniture-dialog-footer"><button type="button" class="furniture-cancel" data-edit-close>Annuler</button><button class="primary-button" type="submit" form="furniture-edit-form">Enregistrer</button></div></section>`;
  }

  focusDimensions() {
    const input = this.editDialog.querySelector<HTMLInputElement>(
      '[data-tv-fields]:not([hidden]) input:not(:disabled), input[name="width"]:not(:disabled), input[name="locked"]',
    );
    input?.focus({ preventScroll: true });
    if (input?.type === 'number') input.select();
  }

  private groupControls(item: FurnitureItem) {
    const items = this.draft?.items ?? this.adapter.getItems();
    const members = groupMembers(items, item.id);
    const candidates = items.filter((other) => !members.some((member) => member.id === other.id));
    if (members.length < 2 && !candidates.length) return '';
    return `<section class="furniture-group-controls" aria-label="Ensemble de meubles"><div class="furniture-group-heading"><strong>Ensemble</strong><span>${members.length > 1 ? `${members.length} meubles` : 'Meuble indépendant'}</span></div>${members.length > 1 ? `<ul class="furniture-group-members">${members.map((m) => `<li>${icon('cube', 15)}<span>${esc(m.name)}</span></li>`).join('')}</ul><button type="button" data-furniture-action="unlink">Séparer les meubles</button>` : ''}<p class="furniture-group-note">Déplacement et rotation ensemble. Les changements seront appliqués avec Enregistrer.</p>${candidates.length ? `<details class="furniture-linker"${this.editDialog.querySelector<HTMLDetailsElement>('.furniture-linker')?.open ? ' open' : ''}><summary>Lier à un autre meuble</summary><div class="furniture-link-row"><label class="furniture-field">Meuble à ajouter<select data-link-target><option value="" disabled selected>Choisir un meuble…</option>${candidates.map((other) => `<option value="${esc(other.id)}">${esc(other.name)}</option>`).join('')}</select></label><button type="button" data-furniture-action="link">Ajouter à l’ensemble</button></div></details>` : ''}</section>`;
  }

  openEdit(id: string) {
    try {
      this.draft = new FurnitureEditorDraft(this.adapter.getItems(), this.adapter.getLevel(), id);
      if (this.dialog.open) this.dialog.close();
      this.renderDraft();
      if (!this.editDialog.open) this.editDialog.showModal();
      this.adapter.onDialogState?.(true);
      this.focusDimensions();
    } catch (error) {
      this.adapter.onToast(
        error instanceof Error ? error.message : 'Impossible d’ouvrir ce meuble.',
      );
    }
  }

  private renderDraft(message = '') {
    const item = this.draft?.selected;
    this.editId = item?.id;
    this.editDialog.innerHTML = `<div class="furniture-dialog-heading"><h2 id="furniture-edit-title">${item ? `Modifier ${esc(item.name)}` : 'Retirer le meuble'}</h2><button type="button" class="icon-button" data-edit-close aria-label="Fermer">${icon('close', 20)}</button></div>${item ? this.details(item) : '<p>Le meuble sera retiré lorsque vous enregistrerez.</p><div class="furniture-edit-status" role="status"></div><div class="furniture-dialog-footer"><button type="button" class="furniture-cancel" data-edit-close>Annuler</button><button type="button" class="primary-button" data-save-draft>Enregistrer</button></div>'}`;
    if (item) {
      const form = this.editDialog.querySelector<HTMLFormElement>('form')!;
      if (item.kind === 'dressing')
        applyDressingRuns(form, item.dressing?.runs ?? [{ length: item.width }]);
      updateSofaFields(form, item.kind);
      updateDressingFields(form, item.kind);
      updateShowerFields(form, item.kind);
      updateTelevisionFields(form, item.kind, true);
      syncDepthLabel(form, item.kind);
    }
    this.setEditStatus(message);
  }

  private setEditStatus(message: string) {
    const status = this.editDialog.querySelector<HTMLElement>('.furniture-edit-status');
    if (status) status.textContent = message;
  }

  private editClick = (event: Event) => {
    if ((event.target as HTMLElement).closest('[data-edit-close]')) {
      this.editDialog.close();
      return;
    }
    if ((event.target as HTMLElement).closest('[data-save-draft]')) {
      this.saveDraft();
      return;
    }
    this.click(event);
  };

  private editClosed = () => {
    if (this.editDialog.open) return;
    this.editId = undefined;
    this.draft = undefined;
    this.dialogClosed();
  };

  private doubleClick = (event: Event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-furniture-select]')
      ?.dataset.furnitureSelect;
    if (id) this.adapter.onEdit(id);
  };

  /** Adding or removing a run rebuilds only the run rows, never the whole form. */
  private dressingRunClick(target: HTMLElement): boolean {
    const form = target.closest<HTMLFormElement>('form');
    if (!form) return false;
    if (target.closest('[data-dressing-add]')) {
      const runs = readRunsFromForm(form);
      if (runs.length >= 12) return true;
      const last = runs[runs.length - 1];
      runs[runs.length - 1] = { ...last, turn: last.turn ?? 'right' };
      runs.push({ length: 1.2 });
      applyDressingRuns(form, runs);
      return true;
    }
    const remove = target.closest<HTMLElement>('[data-dressing-remove]');
    if (!remove) return false;
    const runs = readRunsFromForm(form);
    if (runs.length <= 1) return true;
    runs.splice(Number(remove.dataset.dressingRemove), 1);
    delete runs[runs.length - 1].turn;
    applyDressingRuns(form, runs);
    return true;
  }

  private click = (event: Event) => {
    const target = event.target as HTMLElement;
    if (this.dressingRunClick(target)) return;
    const edit = target.closest<HTMLElement>('[data-furniture-edit-id]');
    if (edit) {
      this.adapter.onEdit(edit.dataset.furnitureEditId!);
      return;
    }
    const select = target.closest<HTMLElement>('[data-furniture-select]');
    if (select) {
      this.adapter.onSelect(select.dataset.furnitureSelect!);
      this.render();
      return;
    }
    const action = target.closest<HTMLElement>('[data-furniture-action]')?.dataset.furnitureAction;
    if (!action) return;
    if (this.editDialog.contains(target) && this.draft) {
      try {
        const other = this.editDialog.querySelector<HTMLSelectElement>('[data-link-target]')?.value;
        if (action === 'link' && !other) {
          this.setEditStatus('Choisissez le meuble à ajouter à l’ensemble.');
          return;
        }
        const form = this.editDialog.querySelector<HTMLFormElement>('form');
        if (form && !this.stageForm(form)) return;
        if (action === 'link' && other) this.draft.link(other);
        else if (action === 'unlink') this.draft.unlink();
        else if (action === 'duplicate') this.draft.duplicate();
        else if (action === 'add-tv') this.draft.addTelevision();
        else if (action === 'delete') this.draft.remove();
        else return;
        this.renderDraft(
          action === 'link'
            ? 'Liaison préparée. Enregistrez pour déplacer ces meubles ensemble.'
            : 'Modification préparée. Enregistrez pour l’appliquer, ou annulez.',
        );
      } catch (error) {
        this.setEditStatus(error instanceof Error ? error.message : 'Cette action est impossible.');
      }
      return;
    }
    if (action === 'add') this.openAdd();
    else if (action === 'undo') {
      this.adapter.onUndo();
      this.render();
    } else if (action === 'redo') {
      this.adapter.onRedo();
      this.render();
    } else if (action === 'deselect') {
      this.adapter.onSelect(undefined);
      this.render();
    }
  };

  private measurementInput = (event: Event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form');
    if (!form) return;
    const kind =
      (form.elements.namedItem('kind') as HTMLSelectElement | null)?.value ??
      this.draft?.items.find((item) => item.id === form.dataset.furnitureEdit)?.kind ??
      this.adapter.getItems().find((item) => item.id === form.dataset.furnitureEdit)?.kind ??
      'custom';
    const name = (event.target as HTMLInputElement).name;
    if (kind === 'tv' && name === 'tvDiagonal') {
      const inches = Number((form.elements.namedItem('tvDiagonal') as HTMLInputElement).value);
      if (inches >= 5 && inches <= 300) {
        const dims = televisionDimensions(inches);
        for (const key of ['width', 'depth', 'height'] as const)
          (form.elements.namedItem(key) as HTMLInputElement).value = String(cm(dims[key]));
      }
    } else if (kind === 'tv' && ['width', 'height'].includes(name)) {
      (form.elements.namedItem('tvDiagonal') as HTMLInputElement).value = '';
    }
    updateSofaFields(form, kind);
    updateDressingFields(form, kind);
    updateShowerFields(form, kind);
    updateTelevisionFields(form, kind);
    syncDepthLabel(form, kind);
  };

  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === 'locked' && !input.checked && this.editDialog.contains(input)) {
      const item = this.draft?.selected;
      const form = input.closest<HTMLFormElement>('form');
      if (item && form) {
        // Unlock the isolated draft so dimensions can be edited before the same Save.
        this.draft!.update({ ...item, locked: false });
        form.dataset.geometryLocked = 'false';
        for (const name of ['width', 'depth', 'height', 'elevation', 'x', 'z', 'rotation'])
          (form.elements.namedItem(name) as HTMLInputElement).disabled = false;
        updateSofaFields(form, item.kind);
        updateDressingFields(form, item.kind);
        updateShowerFields(form, item.kind);
        updateTelevisionFields(form, item.kind);
        syncDepthLabel(form, item.kind);
      }
    }
    if (input.name === 'sofaShape') {
      const form = input.closest<HTMLFormElement>('form');
      if (form) updateSofaFields(form, 'sofa', true);
    }
    const key = input.dataset.furnitureOverlay as keyof typeof this.overlays | undefined;
    if (key) {
      this.overlays[key] = input.checked;
      this.adapter.onOverlays({ ...this.overlays });
    }
  };

  private stageForm(form: HTMLFormElement): boolean {
    const item = this.draft?.selected;
    if (!item || !form.reportValidity()) return false;
    const data = new FormData(form);
    const value = (key: string, fallback: number) =>
      data.has(key) ? Number(data.get(key)) : fallback;
    const openingKind = String(data.get('openingKind'));
    const next: FurnitureItem = {
      ...item,
      name: String(data.get('name')).trim(),
      ...(item.locked
        ? {
            width: item.width,
            depth: item.depth,
            height: item.height,
            elevation: item.elevation,
            sofa: item.sofa,
            tvDiagonalInches: item.tvDiagonalInches,
          }
        : measurementsFromForm(data, item.kind)),
      position: [
        value('x', item.position[0] * 100) / 100,
        value('z', item.position[1] * 100) / 100,
      ],
      rotation: (value('rotation', degrees(item.rotation)) * Math.PI) / 180,
      locked: data.get('locked') === 'on',
      clearances: {
        front: value('front', 0) / 100,
        back: value('back', 0) / 100,
        left: value('left', 0) / 100,
        right: value('right', 0) / 100,
      },
      opening:
        openingKind === 'none'
          ? undefined
          : { kind: openingKind as 'hinged' | 'drawer', reach: value('reach', 60) / 100 },
    };
    // Displayed centimetres are rounded for readability. Untouched controls must
    // preserve the original metres, particularly for objects flush against a wall.
    const unchanged = (name: string) => {
      const field = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (!field) return true;
      if (field instanceof HTMLSelectElement) {
        const initial =
          Array.from(field.options).find((option) => option.defaultSelected)?.value ??
          field.options[0]?.value;
        return field.value === initial;
      }
      return field.value === field.defaultValue;
    };
    if (item.kind !== 'dressing' && unchanged('width')) next.width = item.width;
    if (unchanged('height')) next.height = item.height;
    if (unchanged('elevation')) next.elevation = item.elevation;
    if (next.sofa) {
      if (unchanged('depth')) next.sofa.seatDepth = item.sofa?.seatDepth ?? item.depth;
      if (item.sofa && unchanged('returnWidth')) next.sofa.returnWidth = item.sofa.returnWidth;
      if (item.sofa && unchanged('returnDepth')) next.depth = item.depth;
    } else if (next.dressing) {
      // Width and depth follow the runs; untouched runs keep their exact stored metres.
      if (item.dressing && item.dressing.runs.length === next.dressing.runs.length) {
        next.dressing.runs = next.dressing.runs.map((run, index) => {
          const original = item.dressing!.runs[index];
          return unchanged(`dressingRunLength${index}`) ? { ...run, length: original.length } : run;
        });
        if (unchanged('dressingRunDepth')) next.dressing.runDepth = item.dressing.runDepth;
      }
      const bounds = dressingBounds(next.dressing.runDepth, next.dressing.runs);
      next.width = bounds.width;
      next.depth = bounds.depth;
    } else if (unchanged('depth')) next.depth = bodyDepth(item);
    if (unchanged('x')) next.position[0] = item.position[0];
    if (unchanged('z')) next.position[1] = item.position[1];
    if (unchanged('rotation')) next.rotation = item.rotation;
    if (['front', 'back', 'left', 'right'].every(unchanged)) next.clearances = item.clearances;
    if (unchanged('openingKind') && unchanged('reach')) next.opening = item.opening;
    this.draft!.update(next);
    return true;
  }

  private saveDraft() {
    if (!this.draft) return;
    try {
      const form = this.editDialog.querySelector<HTMLFormElement>('form');
      if (form && !this.stageForm(form)) return;
      if (!this.adapter.onApplyDraft(this.draft.items, this.draft.selectedId)) {
        this.setEditStatus(
          'Modification refusée. Vérifiez les dimensions et la position du meuble.',
        );
        return;
      }
      this.editDialog.close();
      this.render();
      this.adapter.onToast('Aménagement modifié.');
    } catch (error) {
      this.setEditStatus(
        error instanceof Error ? error.message : 'Impossible de modifier ce meuble.',
      );
    }
  }

  private submitDetails = (event: Event) => {
    event.preventDefault();
    this.saveDraft();
  };

  openAdd() {
    if (this.editDialog.open) this.editDialog.close();
    const initial = createFurniture({ kind: 'sofa' });
    this.dialog.innerHTML = `<div class="furniture-dialog-heading"><h2 id="furniture-add-title">Ajouter un meuble</h2><button type="button" class="icon-button" data-add-close aria-label="Fermer">${icon('close', 20)}</button></div><p>Renseignez ses dimensions réelles.${this.adapter.getAddRoomName?.() ? ` Placement dans : <strong>${esc(this.adapter.getAddRoomName()!)}</strong>.` : ''} Vous pourrez ensuite le déplacer dans la maison.</p>
      <form id="furniture-add-form"><div class="furniture-field-grid two"><label class="furniture-field">Type de meuble<select name="kind">${kindOptions(initial.kind)}</select></label><label class="furniture-field">Nom<input name="name" value="${esc(initial.name)}" maxlength="100" required></label></div>${dimensionsFields(initial)}<label class="furniture-field">Hauteur de pose au-dessus du sol <span>cm</span><input name="elevation" type="number" min="0" max="2000" step="0.1" value="${cm(initial.elevation ?? 0)}"></label>${sofaFields(initial)}${dressingFields(initial)}${showerFields(initial)}<p class="furniture-form-note">Les valeurs proposées sont des exemples. Remplacez-les par les mesures du meuble, poignées et accoudoirs compris.</p><label class="furniture-field furniture-tone-field">Teinte du volume<input name="color" type="color" value="${initial.color}"><span>Une teinte de repérage pour le volume simplifié.</span></label>
      <div class="furniture-add-status" role="status"></div><div class="furniture-dialog-footer"><button type="button" class="furniture-cancel" data-add-close>Annuler</button><button type="submit" class="primary-button">Ajouter dans la maison ${icon('arrow', 17)}</button></div></form>`;
    const form = this.dialog.querySelector<HTMLFormElement>('form')!;
    updateSofaFields(form, initial.kind);
    updateDressingFields(form, initial.kind);
    updateShowerFields(form, initial.kind);
    updateTelevisionFields(form, initial.kind, true);
    syncDepthLabel(form, initial.kind);
    this.dialog.showModal();
    this.adapter.onDialogState?.(true);
  }

  private dialogClick = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-add-close]')) {
      this.dialog.close();
      return;
    }
    this.dressingRunClick(target);
  };

  private dialogChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const form = this.dialog.querySelector<HTMLFormElement>('form')!;
    if (input.name === 'kind') {
      const preset = createFurniture({ kind: input.value as FurnitureItem['kind'] });
      (form.elements.namedItem('sofaShape') as HTMLSelectElement).value = 'straight';
      (form.elements.namedItem('sofaSide') as HTMLSelectElement).value = 'left';
      (form.elements.namedItem('returnDepth') as HTMLInputElement).value = '180';
      (form.elements.namedItem('returnWidth') as HTMLInputElement).value = '90';
      (form.elements.namedItem('showerType') as HTMLSelectElement).value = 'bac';
      (form.elements.namedItem('elevation') as HTMLInputElement).value = String(
        cm(preset.elevation ?? 0),
      );
      updateSofaFields(form, input.value);
      updateShowerFields(form, input.value);
      for (const key of ['width', 'depth', 'height'] as const)
        (form.elements.namedItem(key) as HTMLInputElement).value = String(cm(preset[key]));
      (form.elements.namedItem('name') as HTMLInputElement).value = preset.name;
      (form.elements.namedItem('color') as HTMLInputElement).value = preset.color;
      (form.elements.namedItem('tvDiagonal') as HTMLInputElement).value = String(
        preset.tvDiagonalInches ?? '',
      );
      updateTelevisionFields(form, input.value, true);
      // A fresh dressing starts as a single run matching the preset width.
      (form.elements.namedItem('dressingRunDepth') as HTMLInputElement).value = String(
        cm(preset.dressing?.runDepth ?? 0.6),
      );
      applyDressingRuns(form, preset.dressing?.runs ?? [{ length: preset.width }]);
      updateDressingFields(form, input.value);
      syncDepthLabel(form, input.value);
    }
    if (input.name === 'sofaShape')
      updateSofaFields(form, (form.elements.namedItem('kind') as HTMLSelectElement).value, true);
  };

  private submitAdd = (event: Event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const status = this.dialog.querySelector<HTMLElement>('.furniture-add-status')!;
    try {
      const item = createFurniture({
        kind: String(data.get('kind')) as FurnitureItem['kind'],
        name: String(data.get('name')).trim(),
        ...measurementsFromForm(data, String(data.get('kind')) as FurnitureItem['kind']),
        position: [
          ...(this.adapter.getAddPosition?.() ?? this.adapter.getLevel().spawn.position),
        ] as Point2,
        color: String(data.get('color')),
      });
      this.adapter.onAdd(item);
      this.dialog.close();
      this.adapter.onToast('Meuble ajouté. Glissez-le dans la vue pour le placer.');
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : 'Impossible d’ajouter ce meuble.';
    }
  };

  private dialogClosed = () => {
    this.adapter.onDialogState?.(this.dialog.open || this.editDialog.open);
  };

  dispose() {
    this.container.removeEventListener('click', this.click);
    this.container.removeEventListener('dblclick', this.doubleClick);
    this.container.removeEventListener('change', this.change);
    this.container.removeEventListener('input', this.measurementInput);
    if (this.dialog.open) this.dialog.close();
    if (this.editDialog.open) this.editDialog.close();
    this.dialog.remove();
    this.editDialog.remove();
    this.container.replaceChildren();
  }
}
