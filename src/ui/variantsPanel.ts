import { escapeHtml } from './format';
import type { VariantBook } from '../furniture/variants';
import type { Level } from '../model/types';
import { variantThumbnail } from './variantThumbnail';
import { captureFocus, restoreFocus } from './focusKeeper';

interface VariantsAdapter {
  getBook(): VariantBook;
  /** When provided, each variant shows a plan preview of this level. */
  getLevel?(): Level;
  onSelect(id: string): void;
  onDuplicate(name: string): void;
  onRename(name: string): void;
  onDelete(): void;
  onError(message: string): void;
}
export class VariantsPanel {
  private editing?: 'duplicate' | 'rename' | 'delete';
  /** The button that opened the name form: focus returns to it when the form closes. */
  private lastAction = 'duplicate';
  constructor(
    private host: HTMLElement,
    private adapter: VariantsAdapter,
  ) {
    host.classList.add('variants-panel');
    host.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement;
      if (target.name === 'layoutVariant') {
        this.editing = undefined;
        adapter.onSelect(target.value);
      }
    });
    host.addEventListener('click', (event) => {
      const thumb = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-variant-thumb]',
      );
      if (thumb) {
        this.editing = undefined;
        adapter.onSelect(thumb.dataset.variantThumb!);
        return;
      }
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-variant-action]',
      )?.dataset.variantAction;
      if (!action) return;
      if (action === 'confirm-delete') {
        adapter.onDelete();
        return;
      }
      if (action !== 'cancel') this.lastAction = action;
      this.editing =
        action === 'cancel' ? undefined : (action as 'duplicate' | 'rename' | 'delete');
      this.render();
      const field = host.querySelector<HTMLInputElement>('input[name=variantName]');
      if (field) {
        field.focus();
        field.select();
      } else restoreFocus(host, `[data-variant-action="${this.lastAction}"]`);
    });
    host.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = host.querySelector<HTMLInputElement>('[name=variantName]')!.value;
      if (this.editing === 'duplicate') adapter.onDuplicate(name);
      else {
        const book = adapter.getBook();
        if (book.variants.find((variant) => variant.id === book.activeId)?.name === name.trim())
          this.finishEditing();
        else adapter.onRename(name);
      }
    });
  }
  finishEditing() {
    this.editing = undefined;
    this.render();
  }
  render() {
    const focused = captureFocus(this.host);
    try {
      const book = this.adapter.getBook();
      const active = book.variants.find((variant) => variant.id === book.activeId)!;
      const nextName = `Option ${book.variants.length + 1}`;
      const level = this.adapter.getLevel?.();
      const thumbnails = level
        ? `<div class="variant-thumbnails" role="group" aria-label="Aperçus des variantes">${book.variants
            .map(
              (variant) =>
                `<button type="button" class="variant-thumbnail${variant.id === book.activeId ? ' active' : ''}" data-variant-thumb="${escapeHtml(variant.id)}" aria-pressed="${variant.id === book.activeId}" title="${escapeHtml(variant.name)}">${variantThumbnail(level, variant.levels[level.id] ?? [])}<span>${escapeHtml(variant.name)}</span></button>`,
            )
            .join('')}</div>`
        : '';
      this.host.innerHTML = `<label>Variante d’aménagement<select name="layoutVariant" aria-label="Variante d’aménagement">${book.variants.map((variant) => `<option value="${escapeHtml(variant.id)}" ${variant.id === book.activeId ? 'selected' : ''}>${escapeHtml(variant.name)}</option>`).join('')}</select></label>${thumbnails}
        <div class="variant-actions"><button type="button" data-variant-action="duplicate" ${book.variants.length >= 10 ? 'disabled' : ''}>Dupliquer</button><button type="button" data-variant-action="rename">Renommer</button><button type="button" data-variant-action="delete" ${book.variants.length <= 1 ? 'disabled title="Conservez au moins une variante"' : ''}>Supprimer</button></div>
        ${this.editing === 'delete' ? `<div class="variant-name-form"><p>Supprimer « ${escapeHtml(active.name)} » et ses meubles sur tous les niveaux ? Cette action est définitive.</p><div class="variant-actions"><button type="button" data-variant-action="cancel">Annuler</button><button type="button" data-variant-action="confirm-delete">Confirmer la suppression</button></div></div>` : this.editing ? `<form class="variant-name-form"><label>${this.editing === 'duplicate' ? 'Nom de la copie' : 'Nom de la variante'}<input name="variantName" maxlength="60" required value="${escapeHtml(this.editing === 'duplicate' ? nextName : active.name)}"></label><div class="variant-actions"><button type="button" data-variant-action="cancel">Annuler</button><button type="submit">${this.editing === 'duplicate' ? 'Créer la copie' : 'Enregistrer'}</button></div></form>` : '<p>Chaque variante conserve les meubles de tous les niveaux. La caméra reste à sa place.</p>'}`;
    } catch (error) {
      this.host.textContent =
        'Variantes indisponibles. Importez une sauvegarde pour restaurer le projet.';
      this.adapter.onError(error instanceof Error ? error.message : 'Variantes illisibles.');
      return;
    }
    if (focused)
      restoreFocus(
        this.host,
        focused,
        `[data-variant-action="${this.lastAction}"]`,
        'select[name="layoutVariant"]',
      );
  }
}
