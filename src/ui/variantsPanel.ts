import { escapeHtml } from './format';
import type { VariantBook } from '../furniture/variants';

interface VariantsAdapter {
  getBook(): VariantBook;
  onSelect(id: string): void;
  onDuplicate(name: string): void;
  onRename(name: string): void;
  onError(message: string): void;
}
export class VariantsPanel {
  private editing?: 'duplicate' | 'rename';
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
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-variant-action]',
      )?.dataset.variantAction;
      if (!action) return;
      this.editing = action === 'cancel' ? undefined : (action as 'duplicate' | 'rename');
      this.render();
      host.querySelector<HTMLInputElement>('input[name=variantName]')?.select();
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
    try {
      const book = this.adapter.getBook();
      const active = book.variants.find((variant) => variant.id === book.activeId)!;
      const nextName = `Option ${book.variants.length + 1}`;
      this.host.innerHTML = `<label>Variante d’aménagement<select name="layoutVariant" aria-label="Variante d’aménagement">${book.variants.map((variant) => `<option value="${escapeHtml(variant.id)}" ${variant.id === book.activeId ? 'selected' : ''}>${escapeHtml(variant.name)}</option>`).join('')}</select></label>
        <div class="variant-actions"><button type="button" data-variant-action="duplicate" ${book.variants.length >= 10 ? 'disabled' : ''}>Dupliquer</button><button type="button" data-variant-action="rename">Renommer</button></div>
        ${this.editing ? `<form class="variant-name-form"><label>${this.editing === 'duplicate' ? 'Nom de la copie' : 'Nom de la variante'}<input name="variantName" maxlength="60" required value="${escapeHtml(this.editing === 'duplicate' ? nextName : active.name)}"></label><div class="variant-actions"><button type="button" data-variant-action="cancel">Annuler</button><button type="submit">${this.editing === 'duplicate' ? 'Créer la copie' : 'Enregistrer'}</button></div></form>` : '<p>Chaque variante conserve les meubles de tous les niveaux. La caméra reste à sa place.</p>'}`;
    } catch (error) {
      this.host.textContent =
        'Variantes indisponibles. Importez une sauvegarde pour restaurer le projet.';
      this.adapter.onError(error instanceof Error ? error.message : 'Variantes illisibles.');
    }
  }
}
