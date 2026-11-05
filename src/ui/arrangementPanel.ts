import './arrangementPanel.css';
import type { FurnitureItem } from '../furniture/model';
import type { Level } from '../model/types';
import {
  alignFurniture,
  distributeFurniture,
  defaultSnapSettings,
  type ArrangementAxis,
  type AlignmentEdge,
  type SnapSettings,
} from '../furniture/arrangement';
import { escapeHtml as esc } from './format';

export interface ArrangementAdapter {
  getItems(): FurnitureItem[];
  getSelectedIds(): string[];
  getLevel(): Level;
  onApply(items: FurnitureItem[]): boolean | void;
  onSelection(ids: string[]): void;
  onSnapSettings(settings: SnapSettings): void;
}

export class ArrangementPanel {
  private settings = { ...defaultSnapSettings };
  private signature = '';
  private section = document.createElement('details');

  constructor(
    private host: HTMLElement,
    private adapter: ArrangementAdapter,
  ) {
    this.section.className = 'arrangement-panel';
    this.section.innerHTML = `<summary>Placement précis</summary><div class="arrangement-body">
      <p>Cochez les meubles à placer ensemble. Le premier coché sert de référence ; les ensembles liés restent solidaires.</p>
      <div data-arrangement-items class="arrangement-items"></div>
      <div class="arrangement-selection"><span data-selection-count></span><button type="button" data-clear-selection>Effacer la sélection</button></div>
      <div class="arrangement-row"><label>Axe du plan<select data-arrangement-axis><option value="x">X · horizontal</option><option value="z">Z · vertical</option></select></label><label>Aligner les<select data-alignment-edge><option value="min">Bords de début</option><option value="center">Centres</option><option value="max">Bords de fin</option></select></label></div>
      <div class="arrangement-actions"><button type="button" data-align>Aligner</button><button type="button" data-distribute>Espacements égaux</button></div>
      <p>La répartition garde les deux extrêmes en place et demande au moins trois meubles ou ensembles.</p>
      <fieldset><legend>Accrochage pendant le glisser</legend><label class="arrangement-check"><input type="checkbox" data-snap-grid> Grille</label><label class="arrangement-check"><input type="checkbox" data-snap-walls> Murs proches · 12 cm</label><label>Pas de grille <span class="arrangement-grid-size"><input data-grid-size type="number" min="1" max="100" step="1" value="10" aria-label="Pas de grille en centimètres"> cm</span></label></fieldset>
      <p data-arrangement-status role="status"></p></div>`;
    this.host.append(this.section);
    this.section.addEventListener('click', this.click);
    this.section.addEventListener('change', this.change);
    this.render();
  }

  get snapSettings(): SnapSettings {
    return { ...this.settings };
  }

  render() {
    const items = this.adapter.getItems();
    const ids = this.adapter.getSelectedIds();
    const signature = JSON.stringify(
      items.map((item) => [item.id, item.name, item.groupId, item.locked]),
    );
    if (signature !== this.signature) {
      this.signature = signature;
      this.query('[data-arrangement-items]').innerHTML = items.length
        ? items
            .map(
              (item) =>
                `<label class="arrangement-check"><input type="checkbox" data-arrangement-select="${esc(item.id)}"><span>${esc(item.name)}${item.groupId ? ' · ensemble lié' : ''}${item.locked ? ' · verrouillé' : ''}</span></label>`,
            )
            .join('')
        : '<p>Ajoutez des meubles pour les aligner.</p>';
    }
    this.section
      .querySelectorAll<HTMLInputElement>('[data-arrangement-select]')
      .forEach((input) => {
        input.checked = ids.includes(input.dataset.arrangementSelect!);
      });
    this.query('[data-selection-count]').textContent =
      `${ids.length} sélectionné${ids.length > 1 ? 's' : ''}`;
    this.query<HTMLButtonElement>('[data-align]').disabled = ids.length < 2;
    this.query<HTMLButtonElement>('[data-distribute]').disabled = ids.length < 3;
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.section.querySelector<T>(selector)!;
  }

  private click = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.hasAttribute('data-clear-selection')) {
      this.adapter.onSelection([]);
      this.render();
      return;
    }
    if (!button.hasAttribute('data-align') && !button.hasAttribute('data-distribute')) return;
    try {
      const axis = this.query<HTMLSelectElement>('[data-arrangement-axis]')
        .value as ArrangementAxis;
      const edge = this.query<HTMLSelectElement>('[data-alignment-edge]').value as AlignmentEdge;
      const args = [
        this.adapter.getItems(),
        this.adapter.getSelectedIds(),
        this.adapter.getLevel(),
        axis,
      ] as const;
      const next = button.hasAttribute('data-align')
        ? alignFurniture(...args, edge)
        : distributeFurniture(...args);
      if (this.adapter.onApply(next) === false)
        throw new Error('Placement refusé. Vérifiez les dimensions et les obstacles.');
      this.query('[data-arrangement-status]').textContent =
        'Placement appliqué. Vous pouvez l’annuler avec Ctrl Z.';
      this.render();
    } catch (error) {
      this.query('[data-arrangement-status]').textContent =
        error instanceof Error ? error.message : 'Placement impossible.';
    }
  };

  private change = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.arrangementSelect !== undefined) {
      const ids = this.adapter
        .getSelectedIds()
        .filter((id) => id !== input.dataset.arrangementSelect);
      if (input.checked) ids.push(input.dataset.arrangementSelect);
      this.adapter.onSelection(ids);
      this.render();
    }
    if (input.matches('[data-snap-grid], [data-snap-walls], [data-grid-size]')) {
      const grid = this.query<HTMLInputElement>('[data-grid-size]');
      const enabled = this.query<HTMLInputElement>('[data-snap-grid]').checked;
      const validSize = grid.checkValidity() && Number.isFinite(grid.valueAsNumber);
      if (enabled && !validSize) {
        grid.reportValidity();
        return;
      }
      this.settings = {
        grid: enabled,
        walls: this.query<HTMLInputElement>('[data-snap-walls]').checked,
        gridSize: validSize ? grid.valueAsNumber / 100 : this.settings.gridSize,
      };
      this.adapter.onSnapSettings(this.snapSettings);
    }
  };

  dispose() {
    this.section.removeEventListener('click', this.click);
    this.section.removeEventListener('change', this.change);
    this.section.remove();
  }
}
