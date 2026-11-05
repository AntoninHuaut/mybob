import './panel.css';
import type { Level, Point2 } from '../model/types';
import { escapeHtml as esc } from '../ui/format';
import { icon } from '../ui/icons';
import { measurementsFromForm, sofaDiagram } from './measurements';
import { groupMembers } from './groups';
import { televisionDimensions } from './television';
import { createFurniture, validateFurnitureList, type FurnitureItem } from './model';

export interface FurniturePanelAdapter {
  getItems(): FurnitureItem[];
  getSelectedId(): string | undefined;
  getLevel(): Level;
  getAddPosition?(): Point2;
  getAddRoomName?(): string | undefined;
  onAdd(item: FurnitureItem, linkedTo?: string): void;
  onUpdate(item: FurnitureItem): void;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  onLink(id: string, otherId: string): void;
  onUnlink(id: string): void;
  onSelect(id: string | undefined): void;
  onEdit(id: string): void;
  isEditing?(): boolean;
  onUndo(): void;
  onRedo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  onOverlays(options: { distances: boolean; clearances: boolean; openings: boolean }): void;
  onSnap(id: string): void;
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
  desk: 'Bureau',
  cabinet: 'Meuble de rangement',
  custom: 'Volume sur mesure',
  'tv-stand': 'Meuble TV',
  tv: 'Téléviseur',
  'coffee-table': 'Table basse',
  bookcase: 'Bibliothèque',
  ottoman: 'Pouf',
  'side-table': 'Table d’appoint',
};
const FAVORITES_KEY = 'maison-atelier:furniture-favorites:v1';
const suggestedSpaces = (kind: FurnitureItem['kind']): NonNullable<FurnitureItem['clearances']> => {
  if (kind === 'table') return { front: 0.75, back: 0.75, left: 0.75, right: 0.75 };
  if (kind === 'bed') return { front: 0.6, back: 0.05, left: 0.6, right: 0.6 };
  if (kind === 'wardrobe' || kind === 'desk')
    return { front: 0.8, back: 0.05, left: 0.05, right: 0.05 };
  if (kind === 'chair') return { front: 0.4, back: 0.6, left: 0.15, right: 0.15 };
  return { front: 0.6, back: 0.05, left: 0.1, right: 0.1 };
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

function dimensionsFields(item: FurnitureItem) {
  return `<fieldset class="furniture-tv-fields" data-tv-fields${item.kind === 'tv' ? '' : ' hidden disabled'}${item.locked ? ' disabled' : ''}><legend>Taille de l’écran</legend><label class="furniture-field">Diagonale <span>pouces</span><input name="tvDiagonal" type="number" min="5" max="300" step="0.1" placeholder="Ex. 55" value="${item.tvDiagonalInches ?? ''}"></label><p class="furniture-form-note" data-tv-size-note>Écran 16:9. Le pied et les bordures sont estimés ; les dimensions exactes restent ajustables ci-dessous.</p></fieldset><details class="furniture-dimensions" data-dimensions${item.kind === 'tv' ? '' : ' open'}><summary${item.kind === 'tv' ? '' : ' hidden'}>Dimensions exactes (facultatif)</summary><div class="furniture-field-grid"><label class="furniture-field">Largeur <span>cm</span><input name="width" type="number" min="5" max="2000" step="0.1" value="${cm(item.width)}" required${disabled(item.locked)}></label><label class="furniture-field"><span data-depth-label>${item.kind === 'sofa' ? 'Profondeur du corps du canapé' : 'Profondeur'}</span><span>cm</span><input name="depth" type="number" min="5" max="2000" step="0.1" value="${cm(item.sofa?.seatDepth ?? item.depth)}" required${disabled(item.locked)}></label><label class="furniture-field">Hauteur <span>cm</span><input name="height" type="number" min="5" max="1000" step="0.1" value="${cm(item.height)}" required${disabled(item.locked)}></label></div></details>`;
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
  return `<fieldset class="furniture-sofa-fields" data-sofa-fields${item.locked ? ' disabled' : ''}${item.kind === 'sofa' ? '' : ' hidden'}><legend>Forme du canapé</legend><label class="furniture-field">Configuration<select name="sofaShape"><option value="straight"${!sofa ? ' selected' : ''}>Canapé droit</option><option value="corner"${sofa?.shape === 'corner' ? ' selected' : ''}>Canapé d’angle avec dossier en retour</option><option value="chaise"${sofa?.shape === 'chaise' ? ' selected' : ''}>Canapé avec méridienne</option></select></label><div class="furniture-sofa-config" data-sofa-config${sofa ? '' : ' hidden'}><label class="furniture-field">Retour vu de face<select name="sofaSide"><option value="left"${sofa?.side !== 'right' ? ' selected' : ''}>À gauche</option><option value="right"${sofa?.side === 'right' ? ' selected' : ''}>À droite</option></select></label><div class="furniture-field-grid two"><label class="furniture-field">Profondeur totale côté allongé <span>cm</span><input type="number" name="returnDepth" min="5" max="2000" step="0.1" value="${cm(sofa ? item.depth : Math.max(1.8, item.depth + 0.6))}"></label><label class="furniture-field">Largeur de la méridienne / du retour <span>cm</span><input type="number" name="returnWidth" min="5" max="2000" step="0.1" value="${cm(sofa?.returnWidth ?? 0.9)}"></label></div><p class="furniture-form-note">Les deux profondeurs partent de l’arrière du dossier. Saisissez la profondeur totale du côté allongé, pas la différence. La largeur du retour est celle de la place allongée vue de face.</p><div class="sofa-diagram" data-sofa-diagram></div></div></fieldset>`;
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
  const depthLabel = form.querySelector<HTMLElement>('[data-depth-label]');
  if (depthLabel)
    depthLabel.textContent = kind === 'sofa' ? 'Profondeur du corps du canapé' : 'Profondeur';
  if (expandDepth && kind === 'sofa' && shape !== 'straight') {
    const total = form.elements.namedItem('returnDepth') as HTMLInputElement;
    const body = Number((form.elements.namedItem('depth') as HTMLInputElement).value);
    if (Number(total.value) <= body + 5) total.value = String(Math.max(180, body + 60));
  }
  const diagram = form.querySelector<HTMLElement>('[data-sofa-diagram]');
  if (diagram && kind === 'sofa' && shape !== 'straight')
    diagram.innerHTML = sofaDiagram(new FormData(form));
}

export class FurniturePanel {
  private dialog: HTMLDialogElement;
  private overlays = { distances: true, clearances: false, openings: false };
  private selectedAtRender?: string;
  private favorites: FurnitureItem[] = [];
  private template?: FurnitureItem;

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
    container.addEventListener('submit', this.submitDetails);
    this.dialog.addEventListener('click', this.dialogClick);
    this.dialog.addEventListener('change', this.dialogChange);
    this.dialog.addEventListener('input', this.measurementInput);
    this.dialog.addEventListener('submit', this.submitAdd);
    this.dialog.addEventListener('close', this.dialogClosed);
    try {
      this.favorites = validateFurnitureList(
        JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]'),
      );
    } catch {
      this.favorites = [];
    }
    this.render();
  }

  render(force = false) {
    const selectedId = this.adapter.getSelectedId();
    const active = document.activeElement;
    // Live drag updates must not replace a number currently being edited.
    if (
      !force &&
      selectedId === this.selectedAtRender &&
      (active instanceof HTMLInputElement ||
        active instanceof HTMLSelectElement ||
        active instanceof HTMLTextAreaElement) &&
      this.container.contains(active)
    )
      return;
    this.selectedAtRender = selectedId;
    const items = this.adapter.getItems();
    const selected = items.find((item) => item.id === selectedId);
    const checks = this.adapter.getChecks();
    this.container.innerHTML = `
      <div class="furniture-heading"><div class="eyebrow">Aménagement <span>${items.length}</span></div><div class="furniture-history"><button type="button" data-furniture-action="undo" aria-label="Annuler la dernière modification" title="Annuler · Ctrl Z"${disabled(!this.adapter.canUndo())}>↶</button><button type="button" data-furniture-action="redo" aria-label="Rétablir la modification" title="Rétablir · Ctrl Maj Z"${disabled(!this.adapter.canRedo())}>↷</button></div></div>
      <button type="button" class="furniture-add" data-furniture-action="add">${icon('plus', 17)} Ajouter un meuble</button>
      ${items.length ? `<div class="furniture-items" role="group" aria-label="Meubles présents dans ce niveau">${items.map((item) => `<button type="button" class="furniture-item${item.id === selectedId ? ' selected' : ''}" data-furniture-select="${esc(item.id)}" aria-pressed="${item.id === selectedId}"><span class="furniture-item-swatch" style="background:${/^#[a-f\d]{6}$/i.test(item.color) ? item.color : '#a5a18a'}"></span><span>${esc(item.name)}<small>${cm(item.width)} × ${cm(item.depth)} × ${cm(item.height)} cm</small></span><span class="furniture-item-state">${item.locked ? '🔒' : ''}${checks.some((check) => check.itemId === item.id) ? '<span class="furniture-alert-dot" title="Un point est à vérifier">!</span>' : ''}</span></button>`).join('')}</div>` : '<p class="furniture-empty">Ajoutez un premier meuble, puis déplacez-le dans la maison pour essayer votre idée.</p>'}
      ${selected ? (this.adapter.isEditing?.() !== false ? this.details(selected) : `<p class="furniture-empty">Double-cliquez sur le meuble dans la vue pour modifier ses dimensions.</p><button class="furniture-apply" type="button" data-furniture-action="edit">Modifier ${esc(selected.name)}</button>`) : items.length ? '<p class="furniture-empty">Sélectionnez un meuble, puis double-cliquez dans la vue pour ouvrir ses réglages.</p>' : ''}
      ${
        items.length
          ? `<fieldset class="furniture-overlays"><legend>Voir les espaces utiles</legend><label><input type="checkbox" data-furniture-overlay="distances"${checked(this.overlays.distances)}> Distances aux murs</label><label><input type="checkbox" data-furniture-overlay="clearances"${checked(this.overlays.clearances)}> Espaces de passage</label><label><input type="checkbox" data-furniture-overlay="openings"${checked(this.overlays.openings)}> Ouvertures des meubles</label></fieldset><div class="furniture-checks" aria-live="polite">${
              checks.length
                ? `<strong>${checks.length} point${checks.length > 1 ? 's' : ''} à vérifier</strong>${checks
                    .slice(0, 6)
                    .map(
                      (check) =>
                        `<button type="button" class="furniture-check ${check.severity}" data-furniture-select="${esc(check.itemId)}">${icon('info', 13)}<span>${esc(check.message)}</span></button>`,
                    )
                    .join(
                      '',
                    )}${checks.length > 6 ? '<p>Les autres points apparaissent en sélectionnant les meubles concernés.</p>' : ''}`
                : `<p class="furniture-check-ok">${icon('check', 14)} Aucun conflit détecté dans ces contrôles simplifiés.</p>`
            }<small>Les passages et débattements sont des aides visuelles, à confirmer sur place.</small></div>`
          : ''
      }
    `;
    const editForm = this.container.querySelector<HTMLFormElement>('[data-furniture-edit]');
    if (editForm && selected) {
      updateSofaFields(editForm, selected.kind);
      updateTelevisionFields(editForm, selected.kind, true);
    }
  }

  get overlayOptions() {
    return { ...this.overlays };
  }

  private details(item: FurnitureItem) {
    return `<section class="furniture-detail" aria-label="Modifier le meuble sélectionné"><div class="furniture-detail-title"><strong>${esc(item.name)}</strong><button type="button" data-furniture-action="deselect" aria-label="Désélectionner ce meuble">${icon('close', 15)}</button></div>
      <form class="furniture-edit-form" data-furniture-edit="${esc(item.id)}" data-geometry-locked="${item.locked}">
        <label class="furniture-field">Nom<input name="name" value="${esc(item.name)}" maxlength="100" required></label>
        ${dimensionsFields(item)}
        <label class="furniture-field">Hauteur de pose au-dessus du sol <span>cm</span><input name="elevation" type="number" min="0" max="2000" step="0.1" value="${cm(item.elevation ?? 0)}"${disabled(item.locked)}></label>
        ${item.kind === 'sofa' ? sofaFields(item) : ''}
        <div class="furniture-field-grid"><label class="furniture-field">Position X <span>cm</span><input name="x" type="number" min="-100000" max="100000" step="1" value="${cm(item.position[0])}" required${disabled(item.locked)}></label><label class="furniture-field">Position Z <span>cm</span><input name="z" type="number" min="-100000" max="100000" step="1" value="${cm(item.position[1])}" required${disabled(item.locked)}></label><label class="furniture-field">Rotation <span>°</span><input name="rotation" type="number" min="-3600" max="3600" step="1" value="${degrees(item.rotation)}" required${disabled(item.locked)}></label></div>
        <details class="furniture-advanced"${this.container.querySelector<HTMLDetailsElement>('.furniture-advanced')?.open ? ' open' : ''}><summary>Passage et ouverture</summary><p>Les distances sont proposées pour tester votre aménagement ; ajustez-les à votre usage.</p><div class="furniture-field-grid"><label class="furniture-field">Devant <span>cm</span><input name="front" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.front ?? 0)}"></label><label class="furniture-field">Derrière <span>cm</span><input name="back" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.back ?? 0)}"></label><label class="furniture-field">À gauche <span>cm</span><input name="left" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.left ?? 0)}"></label><label class="furniture-field">À droite <span>cm</span><input name="right" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.right ?? 0)}"></label></div><div class="furniture-field-grid two"><label class="furniture-field">Ouverture<select name="openingKind"><option value="none"${!item.opening ? ' selected' : ''}>Aucune</option><option value="hinged"${item.opening?.kind === 'hinged' ? ' selected' : ''}>Porte battante</option><option value="drawer"${item.opening?.kind === 'drawer' ? ' selected' : ''}>Tiroir</option></select></label><label class="furniture-field">Débattement <span>cm</span><input name="reach" type="number" min="0" max="500" step="1" value="${cm(item.opening?.reach ?? 0.6)}"></label></div></details>
        <div class="furniture-edit-actions"><label class="furniture-lock"><input type="checkbox" name="locked"${checked(item.locked)}> Verrouiller</label><button class="furniture-apply" type="submit">Appliquer</button></div>
      </form>
      ${this.groupControls(item)}<div class="furniture-actions">${item.kind === 'tv-stand' ? '<button type="button" data-furniture-action="add-tv">Ajouter une TV dessus</button>' : ''}<button type="button" data-furniture-action="snap"${disabled(item.locked)}>Contre un mur</button><button type="button" data-furniture-action="rotate"${disabled(item.locked)}>Tourner de 90°</button><button type="button" data-furniture-action="duplicate">Dupliquer</button><button type="button" data-furniture-action="favorite">☆ Favori</button><button type="button" data-furniture-action="delete" class="furniture-delete">${icon('trash', 13)} Retirer</button></div><p class="furniture-key-hint">Dans la scène : flèches pour déplacer de 1 cm, Maj pour 10 cm.</p></section>`;
  }

  focusDimensions() {
    const input = this.container.querySelector<HTMLInputElement>(
      '[data-tv-fields]:not([hidden]) input:not(:disabled), input[name="width"]:not(:disabled), input[name="locked"]',
    );
    this.container.querySelector('.furniture-detail')?.scrollIntoView({ block: 'nearest' });
    input?.focus({ preventScroll: true });
    if (input?.type === 'number') input.select();
  }

  private groupControls(item: FurnitureItem) {
    const items = this.adapter.getItems();
    const members = groupMembers(items, item.id);
    const candidates = items.filter((other) => !members.some((member) => member.id === other.id));
    return `<section class="furniture-group-controls">${members.length > 1 ? `<p><strong>Ensemble de ${members.length} meubles</strong><br>${members.map((m) => esc(m.name)).join(' + ')}</p><button type="button" data-furniture-action="unlink">Séparer les meubles</button>` : ''}${candidates.length ? `<details class="furniture-linker"${this.container.querySelector<HTMLDetailsElement>('.furniture-linker')?.open ? ' open' : ''}><summary>Lier à un autre meuble</summary><p>Ils se déplaceront et tourneront ensemble, en gardant leur position relative.</p><label class="furniture-field">Choisir le meuble<select data-link-target>${candidates.map((other) => `<option value="${esc(other.id)}">${esc(other.name)}</option>`).join('')}</select></label><button type="button" data-furniture-action="link">Lier ces meubles</button></details>` : ''}</section>`;
  }

  private doubleClick = (event: Event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-furniture-select]')
      ?.dataset.furnitureSelect;
    if (id) this.adapter.onEdit(id);
  };

  private click = (event: Event) => {
    const target = event.target as HTMLElement;
    const select = target.closest<HTMLElement>('[data-furniture-select]');
    if (select) {
      this.adapter.onSelect(select.dataset.furnitureSelect!);
      this.render();
      return;
    }
    const action = target.closest<HTMLElement>('[data-furniture-action]')?.dataset.furnitureAction;
    if (!action) return;
    const item = this.adapter.getItems().find((item) => item.id === this.adapter.getSelectedId());
    if (action === 'edit' && item) {
      this.adapter.onEdit(item.id);
      return;
    }
    if (action === 'link' && item) {
      const other = this.container.querySelector<HTMLSelectElement>('[data-link-target]')?.value;
      if (other) this.adapter.onLink(item.id, other);
      return;
    }
    if (action === 'unlink' && item) {
      this.adapter.onUnlink(item.id);
      return;
    }
    if (action === 'add') this.openAdd();
    else if (action === 'add-tv' && item) {
      try {
        this.adapter.onAdd(
          createFurniture({
            kind: 'tv',
            position: [...item.position],
            rotation: item.rotation,
            elevation: (item.elevation ?? 0) + item.height,
          }),
          item.id,
        );
        this.adapter.onToast('Téléviseur ajouté. Ajustez ses dimensions à votre modèle.');
      } catch (error) {
        this.adapter.onToast(
          error instanceof Error ? error.message : 'Impossible de placer le téléviseur.',
        );
      }
    } else if (action === 'undo') {
      this.adapter.onUndo();
      this.render();
    } else if (action === 'redo') {
      this.adapter.onRedo();
      this.render();
    } else if (action === 'deselect') {
      this.adapter.onSelect(undefined);
      this.render();
    } else if (item) {
      if (action === 'delete') this.adapter.onDelete(item.id);
      else if (action === 'duplicate') this.adapter.onDuplicate(item.id);
      else if (action === 'snap') this.adapter.onSnap(item.id);
      else if (action === 'rotate' && !item.locked)
        this.adapter.onUpdate({ ...item, rotation: item.rotation + Math.PI / 2 });
      else if (action === 'favorite') this.saveFavorite(item);
      this.render();
    }
  };

  private measurementInput = (event: Event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('form');
    if (!form) return;
    const kind =
      (form.elements.namedItem('kind') as HTMLSelectElement | null)?.value ??
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
    updateTelevisionFields(form, kind);
  };

  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
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

  private submitDetails = (event: Event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-furniture-edit]');
    if (!form) return;
    event.preventDefault();
    const item = this.adapter.getItems().find((item) => item.id === form.dataset.furnitureEdit);
    if (!item || !form.reportValidity()) return;
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
    try {
      this.adapter.onUpdate(next);
      this.render(true);
    } catch (error) {
      this.adapter.onToast(
        error instanceof Error ? error.message : 'Impossible de modifier ce meuble.',
      );
    }
  };

  openAdd() {
    this.template = undefined;
    const initial = createFurniture({ kind: 'sofa' });
    this.dialog.innerHTML = `<div class="furniture-dialog-heading"><h2 id="furniture-add-title">Ajouter un meuble</h2><button type="button" class="icon-button" data-add-close aria-label="Fermer">${icon('close', 20)}</button></div><p>Renseignez ses dimensions réelles.${this.adapter.getAddRoomName?.() ? ` Placement dans : <strong>${esc(this.adapter.getAddRoomName()!)}</strong>.` : ''} Vous pourrez ensuite le déplacer dans la maison.</p>
      <form id="furniture-add-form"><div class="furniture-field-grid two"><label class="furniture-field">Type de meuble<select name="kind">${Object.entries(
        KINDS,
      )
        .map(
          ([value, title]) =>
            `<option value="${value}"${value === initial.kind ? ' selected' : ''}>${title}</option>`,
        )
        .join(
          '',
        )}</select></label><label class="furniture-field">Nom<input name="name" value="${esc(initial.name)}" maxlength="100" required></label></div>${dimensionsFields(initial)}<label class="furniture-field">Hauteur de pose au-dessus du sol <span>cm</span><input name="elevation" type="number" min="0" max="2000" step="0.1" value="${cm(initial.elevation ?? 0)}"></label>${sofaFields(initial)}<p class="furniture-form-note">Les valeurs proposées sont des exemples. Remplacez-les par les mesures du meuble, poignées et accoudoirs compris.</p><label class="furniture-field furniture-tone-field">Teinte du volume<input name="color" type="color" value="${initial.color}"><span>Une teinte de repérage pour le volume simplifié.</span></label>
      ${this.favorites.length ? `<details class="furniture-favorites"><summary>Reprendre un favori (${this.favorites.length})</summary>${this.favorites.map((favorite, i) => `<button type="button" data-use-favorite="${i}">${esc(favorite.name)} <small>${cm(favorite.width)} × ${cm(favorite.depth)} cm</small></button>`).join('')}</details>` : ''}<div class="furniture-add-status" role="status"></div><div class="furniture-dialog-footer"><button type="button" class="furniture-cancel" data-add-close>Annuler</button><button type="submit" class="primary-button">Ajouter dans la maison ${icon('arrow', 17)}</button></div></form>`;
    updateSofaFields(this.dialog.querySelector<HTMLFormElement>('form')!, initial.kind);
    updateTelevisionFields(this.dialog.querySelector<HTMLFormElement>('form')!, initial.kind, true);
    this.dialog.showModal();
    this.adapter.onDialogState?.(true);
  }

  private dialogClick = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-add-close]')) {
      this.dialog.close();
      return;
    }
    const favoriteIndex = target.closest<HTMLElement>('[data-use-favorite]')?.dataset.useFavorite;
    if (favoriteIndex !== undefined) this.applyFavorite(Number(favoriteIndex));
  };

  private dialogChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const form = this.dialog.querySelector<HTMLFormElement>('form')!;
    if (input.name === 'kind') {
      this.template = undefined;
      const preset = createFurniture({ kind: input.value as FurnitureItem['kind'] });
      (form.elements.namedItem('sofaShape') as HTMLSelectElement).value = 'straight';
      (form.elements.namedItem('sofaSide') as HTMLSelectElement).value = 'left';
      (form.elements.namedItem('returnDepth') as HTMLInputElement).value = '180';
      (form.elements.namedItem('returnWidth') as HTMLInputElement).value = '90';
      (form.elements.namedItem('elevation') as HTMLInputElement).value = String(
        cm(preset.elevation ?? 0),
      );
      updateSofaFields(form, input.value);
      for (const key of ['width', 'depth', 'height'] as const)
        (form.elements.namedItem(key) as HTMLInputElement).value = String(cm(preset[key]));
      (form.elements.namedItem('name') as HTMLInputElement).value = preset.name;
      (form.elements.namedItem('color') as HTMLInputElement).value = preset.color;
      (form.elements.namedItem('tvDiagonal') as HTMLInputElement).value = String(
        preset.tvDiagonalInches ?? '',
      );
      updateTelevisionFields(form, input.value, true);
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
        clearances:
          this.template?.clearances ??
          suggestedSpaces(String(data.get('kind')) as FurnitureItem['kind']),
        opening: this.template?.opening,
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
    this.adapter.onDialogState?.(false);
  };

  private saveFavorite(item: FurnitureItem) {
    const favorite = { ...structuredClone(item), position: [0, 0] as Point2, locked: false };
    const next = [
      ...this.favorites.filter(
        (old) => old.id !== item.id && !(old.name === item.name && old.kind === item.kind),
      ),
      favorite,
    ].slice(-8);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      this.favorites = next;
      this.adapter.onToast('Favori conservé : vous pourrez le reprendre depuis Ajouter un meuble.');
    } catch {
      this.adapter.onToast(
        'Impossible de conserver ce favori : la mémoire locale est pleine ou indisponible.',
      );
    }
  }

  private applyFavorite(index: number) {
    const favorite = this.favorites[index];
    if (!favorite) return;
    this.template = structuredClone(favorite);
    const form = this.dialog.querySelector<HTMLFormElement>('form')!;
    for (const key of ['name', 'kind', 'color'] as const)
      (form.elements.namedItem(key) as HTMLInputElement).value = favorite[key];
    for (const key of ['width', 'depth', 'height'] as const)
      (form.elements.namedItem(key) as HTMLInputElement).value = String(cm(favorite[key]));
    (form.elements.namedItem('elevation') as HTMLInputElement).value = String(
      cm(favorite.elevation ?? 0),
    );
    (form.elements.namedItem('sofaShape') as HTMLSelectElement).value =
      favorite.sofa?.shape ?? 'straight';
    (form.elements.namedItem('sofaSide') as HTMLSelectElement).value =
      favorite.sofa?.side ?? 'left';
    (form.elements.namedItem('depth') as HTMLInputElement).value = String(
      cm(favorite.sofa?.seatDepth ?? favorite.depth),
    );
    (form.elements.namedItem('returnDepth') as HTMLInputElement).value = String(
      cm(favorite.sofa ? favorite.depth : 1.8),
    );
    (form.elements.namedItem('returnWidth') as HTMLInputElement).value = String(
      cm(favorite.sofa?.returnWidth ?? 0.9),
    );
    (form.elements.namedItem('tvDiagonal') as HTMLInputElement).value = String(
      favorite.tvDiagonalInches ?? '',
    );
    updateSofaFields(form, favorite.kind);
    updateTelevisionFields(form, favorite.kind, true);
  }

  dispose() {
    this.container.removeEventListener('click', this.click);
    this.container.removeEventListener('dblclick', this.doubleClick);
    this.container.removeEventListener('change', this.change);
    this.container.removeEventListener('input', this.measurementInput);
    this.container.removeEventListener('submit', this.submitDetails);
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
    this.container.replaceChildren();
  }
}
