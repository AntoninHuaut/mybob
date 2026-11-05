import './panel.css';
import type { Level, Point2 } from '../model/types';
import { escapeHtml as esc } from '../ui/format';
import { icon } from '../ui/icons';
import { createFurniture, validateFurnitureList, type FurnitureItem } from './model';

export interface FurniturePanelAdapter {
  getItems(): FurnitureItem[];
  getSelectedId(): string | undefined;
  getLevel(): Level;
  getAddPosition?(): Point2;
  onAdd(item: FurnitureItem): void;
  onUpdate(item: FurnitureItem): void;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  onSelect(id: string | undefined): void;
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

export class FurniturePanel {
  private dialog: HTMLDialogElement;
  private image?: string;
  private sourceMode: 'dimensions' | 'photo' | 'link' = 'dimensions';
  private overlays = { distances: true, clearances: false, openings: false };
  private selectedAtRender?: string;
  private favorites: FurnitureItem[] = [];
  private photoVersion = 0;
  private photoLoading = false;
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
    container.addEventListener('change', this.change);
    container.addEventListener('submit', this.submitDetails);
    container.addEventListener('focusout', this.focusout);
    this.dialog.addEventListener('click', this.dialogClick);
    this.dialog.addEventListener('change', this.dialogChange);
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

  render() {
    const selectedId = this.adapter.getSelectedId();
    const active = document.activeElement;
    // Live drag updates must not replace a number currently being edited.
    if (
      selectedId === this.selectedAtRender &&
      active instanceof HTMLInputElement &&
      this.container.contains(active)
    )
      return;
    this.selectedAtRender = selectedId;
    const items = this.adapter.getItems();
    const selected = items.find((item) => item.id === selectedId);
    const checks = this.adapter.getChecks();
    this.container.innerHTML = `
      <div class="furniture-heading"><div class="eyebrow">VOTRE AMÉNAGEMENT <span>${items.length}</span></div><div class="furniture-history"><button type="button" data-furniture-action="undo" aria-label="Annuler la dernière modification" title="Annuler · Ctrl Z"${disabled(!this.adapter.canUndo())}>↶</button><button type="button" data-furniture-action="redo" aria-label="Rétablir la modification" title="Rétablir · Ctrl Maj Z"${disabled(!this.adapter.canRedo())}>↷</button></div></div>
      <button type="button" class="furniture-add" data-furniture-action="add">${icon('plus', 17)} Ajouter un meuble</button>
      ${items.length ? `<div class="furniture-items" role="group" aria-label="Meubles présents dans ce niveau">${items.map((item) => `<button type="button" class="furniture-item${item.id === selectedId ? ' selected' : ''}" data-furniture-select="${esc(item.id)}" aria-pressed="${item.id === selectedId}"><span class="furniture-item-swatch" style="background:${/^#[a-f\d]{6}$/i.test(item.color) ? item.color : '#a5a18a'}"></span><span>${esc(item.name)}<small>${cm(item.width)} × ${cm(item.depth)} × ${cm(item.height)} cm</small></span><span class="furniture-item-state">${item.locked ? '🔒' : ''}${checks.some((check) => check.itemId === item.id) ? '<span class="furniture-alert-dot" title="Un point est à vérifier">!</span>' : ''}</span></button>`).join('')}</div>` : '<p class="furniture-empty">Ajoutez un premier meuble, puis déplacez-le dans la maison pour essayer votre idée.</p>'}
      ${selected ? this.details(selected) : items.length ? '<p class="furniture-empty">Cliquez sur un meuble dans la scène ou dans cette liste pour le modifier.</p>' : ''}
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
  }

  get overlayOptions() {
    return { ...this.overlays };
  }

  private details(item: FurnitureItem) {
    const reference = item.source?.url;
    let safeLink: string | undefined;
    if (reference) {
      try {
        const u = new URL(reference);
        if (['https:', 'http:'].includes(u.protocol)) safeLink = u.href;
      } catch {
        /* invalid saved link is not rendered */
      }
    }
    const image =
      item.source?.image && /^data:image\/(jpeg|png|webp);base64,/i.test(item.source.image)
        ? item.source.image
        : undefined;
    return `<section class="furniture-detail" aria-label="Modifier le meuble sélectionné"><div class="furniture-detail-title"><strong>${esc(item.name)}</strong><button type="button" data-furniture-action="deselect" aria-label="Désélectionner ce meuble">${icon('close', 15)}</button></div>
      ${image ? `<img class="furniture-reference-thumb" src="${esc(image)}" alt="Photo de référence de ${esc(item.name)}">` : ''}
      ${safeLink ? `<a class="furniture-source-link" href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer">Voir la fiche du meuble ↗</a>` : ''}
      <form class="furniture-edit-form" data-furniture-edit="${esc(item.id)}">
        <label class="furniture-field">Nom<input name="name" value="${esc(item.name)}" maxlength="100" required></label>
        <div class="furniture-field-grid"><label class="furniture-field">Largeur <span>cm</span><input name="width" type="number" min="5" max="2000" step="0.1" value="${cm(item.width)}" required${disabled(item.locked)}></label><label class="furniture-field">Profondeur <span>cm</span><input name="depth" type="number" min="5" max="2000" step="0.1" value="${cm(item.depth)}" required${disabled(item.locked)}></label><label class="furniture-field">Hauteur <span>cm</span><input name="height" type="number" min="5" max="1000" step="0.1" value="${cm(item.height)}" required${disabled(item.locked)}></label></div>
        <div class="furniture-field-grid"><label class="furniture-field">Position X <span>cm</span><input name="x" type="number" min="-100000" max="100000" step="1" value="${cm(item.position[0])}" required${disabled(item.locked)}></label><label class="furniture-field">Position Z <span>cm</span><input name="z" type="number" min="-100000" max="100000" step="1" value="${cm(item.position[1])}" required${disabled(item.locked)}></label><label class="furniture-field">Rotation <span>°</span><input name="rotation" type="number" min="-3600" max="3600" step="1" value="${degrees(item.rotation)}" required${disabled(item.locked)}></label></div>
        <details class="furniture-advanced"><summary>Passage et ouverture</summary><p>Les distances sont proposées pour tester votre aménagement ; ajustez-les à votre usage.</p><div class="furniture-field-grid"><label class="furniture-field">Devant <span>cm</span><input name="front" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.front ?? 0)}"></label><label class="furniture-field">Derrière <span>cm</span><input name="back" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.back ?? 0)}"></label><label class="furniture-field">À gauche <span>cm</span><input name="left" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.left ?? 0)}"></label><label class="furniture-field">À droite <span>cm</span><input name="right" type="number" min="0" max="500" step="1" value="${cm(item.clearances?.right ?? 0)}"></label></div><div class="furniture-field-grid two"><label class="furniture-field">Ouverture<select name="openingKind"><option value="none"${!item.opening ? ' selected' : ''}>Aucune</option><option value="hinged"${item.opening?.kind === 'hinged' ? ' selected' : ''}>Porte battante</option><option value="drawer"${item.opening?.kind === 'drawer' ? ' selected' : ''}>Tiroir</option></select></label><label class="furniture-field">Débattement <span>cm</span><input name="reach" type="number" min="0" max="500" step="1" value="${cm(item.opening?.reach ?? 0.6)}"></label></div></details>
        <div class="furniture-edit-actions"><label class="furniture-lock"><input type="checkbox" name="locked"${checked(item.locked)}> Verrouiller</label><button class="furniture-apply" type="submit">Appliquer</button></div>
      </form>
      <div class="furniture-actions"><button type="button" data-furniture-action="snap"${disabled(item.locked)}>Contre un mur</button><button type="button" data-furniture-action="rotate"${disabled(item.locked)}>Tourner de 90°</button><button type="button" data-furniture-action="duplicate">Dupliquer</button><button type="button" data-furniture-action="favorite">☆ Favori</button><button type="button" data-furniture-action="delete" class="furniture-delete">${icon('trash', 13)} Retirer</button></div><p class="furniture-key-hint">Dans la scène : flèches pour déplacer de 1 cm, Maj pour 10 cm.</p></section>`;
  }

  private click = (event: Event) => {
    const target = event.target as HTMLElement;
    const select = target.closest<HTMLElement>('[data-furniture-select]');
    if (select) {
      this.adapter.onSelect(select.dataset.furnitureSelect!);
      this.render();
      return;
    }
    const action = target.closest<HTMLElement>('[data-furniture-action]')?.dataset.furnitureAction;
    const item = this.adapter.getItems().find((item) => item.id === this.adapter.getSelectedId());
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

  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.furnitureOverlay as keyof typeof this.overlays | undefined;
    if (key) {
      this.overlays[key] = input.checked;
      this.adapter.onOverlays({ ...this.overlays });
    }
  };

  private focusout = () => {
    queueMicrotask(() => {
      if (!this.container.contains(document.activeElement)) this.render();
    });
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
      width: value('width', item.width * 100) / 100,
      depth: value('depth', item.depth * 100) / 100,
      height: value('height', item.height * 100) / 100,
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
      this.render();
    } catch (error) {
      this.adapter.onToast(
        error instanceof Error ? error.message : 'Impossible de modifier ce meuble.',
      );
    }
  };

  openAdd() {
    this.image = undefined;
    this.sourceMode = 'dimensions';
    this.photoVersion++;
    this.photoLoading = false;
    this.template = undefined;
    const initial = createFurniture({ kind: 'sofa' });
    this.dialog.innerHTML = `<div class="furniture-dialog-heading"><span class="eyebrow">ESSAYER UN MEUBLE</span><button type="button" class="icon-button" data-add-close aria-label="Fermer">${icon('close', 20)}</button></div><h2 id="furniture-add-title">Faites-lui une place.</h2><p>Choisissez sa forme et renseignez ses dimensions réelles. Vous pourrez ensuite le déplacer dans la maison.</p><div class="furniture-source-tabs" role="group" aria-label="Référence du meuble"><button type="button" data-source-mode="dimensions" aria-pressed="true">Dimensions</button><button type="button" data-source-mode="photo" aria-pressed="false">Photo</button><button type="button" data-source-mode="link" aria-pressed="false">Lien marchand</button></div>
      <form id="furniture-add-form"><div class="furniture-source-photo" hidden><label class="furniture-photo-picker">${icon('plus', 18)}<span>Choisir une photo de référence</span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label><div class="furniture-photo-preview" hidden><img alt="Photo de référence du meuble"><button type="button" data-remove-photo>Retirer la photo</button></div><p class="furniture-form-note">La photo sert de référence. La forme 3D reste une représentation simplifiée : les dimensions sont à saisir.</p></div><div class="furniture-source-link" hidden><label class="furniture-field">Lien de la fiche produit<input name="url" type="url" placeholder="https://…" maxlength="2000" disabled></label><p class="furniture-form-note">Le lien est conservé avec le meuble. Recopiez les dimensions de la fiche ; cette version ne les récupère pas automatiquement.</p></div>
      <div class="furniture-field-grid two"><label class="furniture-field">Type de meuble<select name="kind">${Object.entries(
        KINDS,
      )
        .map(
          ([value, title]) =>
            `<option value="${value}"${value === initial.kind ? ' selected' : ''}>${title}</option>`,
        )
        .join(
          '',
        )}</select></label><label class="furniture-field">Nom<input name="name" value="${esc(initial.name)}" maxlength="100" required></label></div><div class="furniture-field-grid"><label class="furniture-field">Largeur <span>cm</span><input name="width" type="number" min="5" max="2000" step="0.1" value="${cm(initial.width)}" required></label><label class="furniture-field">Profondeur <span>cm</span><input name="depth" type="number" min="5" max="2000" step="0.1" value="${cm(initial.depth)}" required></label><label class="furniture-field">Hauteur <span>cm</span><input name="height" type="number" min="5" max="1000" step="0.1" value="${cm(initial.height)}" required></label></div><p class="furniture-form-note">Les valeurs proposées sont des exemples. Remplacez-les par les mesures du meuble, poignées et accoudoirs compris.</p><label class="furniture-field furniture-tone-field">Teinte du volume<input name="color" type="color" value="${initial.color}"><span>Une teinte de repérage pour le volume simplifié.</span></label>
      ${this.favorites.length ? `<details class="furniture-favorites"><summary>Reprendre un favori (${this.favorites.length})</summary>${this.favorites.map((favorite, i) => `<button type="button" data-use-favorite="${i}">${esc(favorite.name)} <small>${cm(favorite.width)} × ${cm(favorite.depth)} cm</small></button>`).join('')}</details>` : ''}<div class="furniture-add-status" role="status"></div><div class="furniture-dialog-footer"><button type="button" class="furniture-cancel" data-add-close>Annuler</button><button type="submit" class="primary-button">Ajouter dans la maison ${icon('arrow', 17)}</button></div></form>`;
    this.dialog.showModal();
    this.adapter.onDialogState?.(true);
  }

  private dialogClick = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-add-close]')) {
      this.dialog.close();
      return;
    }
    const mode = target.closest<HTMLElement>('[data-source-mode]')?.dataset.sourceMode as
      typeof this.sourceMode | undefined;
    if (mode) {
      this.sourceMode = mode;
      this.dialog
        .querySelectorAll<HTMLButtonElement>('[data-source-mode]')
        .forEach((button) =>
          button.setAttribute('aria-pressed', String(button.dataset.sourceMode === mode)),
        );
      this.dialog.querySelector<HTMLElement>('.furniture-source-photo')!.hidden = mode !== 'photo';
      this.dialog.querySelector<HTMLElement>('.furniture-source-link')!.hidden = mode !== 'link';
      this.dialog.querySelector<HTMLInputElement>('[name="url"]')!.disabled = mode !== 'link';
    }
    if (target.closest('[data-remove-photo]')) {
      this.image = undefined;
      this.photoVersion++;
      this.photoLoading = false;
      this.dialog.querySelector<HTMLElement>('.furniture-photo-preview')!.hidden = true;
      (this.dialog.querySelector('[name="photo"]') as HTMLInputElement).value = '';
    }
    const favoriteIndex = target.closest<HTMLElement>('[data-use-favorite]')?.dataset.useFavorite;
    if (favoriteIndex !== undefined) this.applyFavorite(Number(favoriteIndex));
  };

  private dialogChange = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const form = this.dialog.querySelector<HTMLFormElement>('form')!;
    if (input.name === 'kind') {
      this.template = undefined;
      const preset = createFurniture({ kind: input.value as FurnitureItem['kind'] });
      for (const key of ['width', 'depth', 'height'] as const)
        (form.elements.namedItem(key) as HTMLInputElement).value = String(cm(preset[key]));
      (form.elements.namedItem('name') as HTMLInputElement).value = preset.name;
      (form.elements.namedItem('color') as HTMLInputElement).value = preset.color;
    }
    if (input.name === 'photo' && input.files?.[0]) {
      const version = ++this.photoVersion;
      const status = this.dialog.querySelector<HTMLElement>('.furniture-add-status')!;
      this.photoLoading = true;
      this.image = undefined;
      this.dialog.querySelector<HTMLElement>('.furniture-photo-preview')!.hidden = true;
      status.textContent = 'Préparation de la photo…';
      try {
        const image = await this.preparePhoto(input.files[0]);
        if (version !== this.photoVersion || !this.dialog.open) return;
        this.image = image;
        this.dialog.querySelector<HTMLImageElement>('.furniture-photo-preview img')!.src = image;
        this.dialog.querySelector<HTMLElement>('.furniture-photo-preview')!.hidden = false;
        status.textContent = '';
      } catch (error) {
        if (version === this.photoVersion) {
          this.image = undefined;
          status.textContent =
            error instanceof Error ? error.message : 'Impossible de lire cette photo.';
        }
      } finally {
        if (version === this.photoVersion) this.photoLoading = false;
      }
    }
  };

  private submitAdd = (event: Event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const status = this.dialog.querySelector<HTMLElement>('.furniture-add-status')!;
    try {
      if (this.sourceMode === 'photo' && this.photoLoading)
        throw new Error('La photo est en cours de préparation. Patientez un instant.');
      if (this.sourceMode === 'photo' && !this.image)
        throw new Error('Choisissez une photo, ou utilisez l’onglet Dimensions.');
      const urlText = this.sourceMode === 'link' ? String(data.get('url') ?? '').trim() : '';
      if (this.sourceMode === 'link' && !urlText)
        throw new Error('Ajoutez le lien de la fiche produit, ou utilisez l’onglet Dimensions.');
      let url: string | undefined;
      if (urlText) {
        const parsed = new URL(urlText);
        if (!['https:', 'http:'].includes(parsed.protocol))
          throw new Error('Utilisez un lien commençant par https:// ou http://.');
        url = parsed.href;
      }
      const item = createFurniture({
        kind: String(data.get('kind')) as FurnitureItem['kind'],
        name: String(data.get('name')).trim(),
        width: Number(data.get('width')) / 100,
        depth: Number(data.get('depth')) / 100,
        height: Number(data.get('height')) / 100,
        position: [
          ...(this.adapter.getAddPosition?.() ?? this.adapter.getLevel().spawn.position),
        ] as Point2,
        clearances:
          this.template?.clearances ??
          suggestedSpaces(String(data.get('kind')) as FurnitureItem['kind']),
        opening: this.template?.opening,
        color: String(data.get('color')),
        source:
          url || (this.sourceMode === 'photo' && this.image)
            ? {
                url,
                image: this.sourceMode === 'photo' ? this.image : undefined,
                note: 'Volume simplifié ; dimensions renseignées par l’utilisateur.',
              }
            : undefined,
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
    this.photoVersion++;
    this.photoLoading = false;
    this.adapter.onDialogState?.(false);
  };

  private async preparePhoto(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
      throw new Error('Choisissez une photo JPG, PNG ou WebP.');
    if (file.size > 12 * 1024 * 1024) throw new Error('La photo doit peser moins de 12 Mo.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Le navigateur ne peut pas préparer cette photo.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.82);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

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
    this.image = favorite.source?.image;
    this.photoVersion++;
    this.photoLoading = false;
    (form.elements.namedItem('url') as HTMLInputElement).value = favorite.source?.url ?? '';
    this.dialog.querySelector<HTMLElement>('.furniture-photo-preview')!.hidden = true;
    this.dialog.querySelector<HTMLButtonElement>('[data-source-mode="dimensions"]')!.click();
    if (this.image) {
      this.sourceMode = 'photo';
      this.dialog.querySelector<HTMLButtonElement>('[data-source-mode="photo"]')!.click();
      this.dialog.querySelector<HTMLImageElement>('.furniture-photo-preview img')!.src = this.image;
      this.dialog.querySelector<HTMLElement>('.furniture-photo-preview')!.hidden = false;
    } else if (favorite.source?.url)
      this.dialog.querySelector<HTMLButtonElement>('[data-source-mode="link"]')!.click();
  }

  dispose() {
    this.container.removeEventListener('click', this.click);
    this.container.removeEventListener('change', this.change);
    this.container.removeEventListener('submit', this.submitDetails);
    this.container.removeEventListener('focusout', this.focusout);
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
    this.container.replaceChildren();
  }
}
