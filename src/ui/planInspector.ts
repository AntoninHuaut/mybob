import { userMessage } from '../errorMessage';
import { polygonArea, wallLength } from '../model/geometry';
import type { OpeningMeasurements } from '../model/openingEdit';
import type { PlanSelection } from '../model/planEdit';
import type { Level, Opening, Room, Wall } from '../model/types';
import { area, escapeHtml } from './format';

export interface PlanInspectorHost {
  onWall(id: string, change: { length?: number; thickness?: number }): void;
  onRoom(id: string, change: Partial<Pick<Room, 'name' | 'kind'>>): void;
  onOpening(wallId: string, id: string, change: Partial<OpeningMeasurements>): void;
  onDelete(): void;
  /** Cuts the selected wall where it was clicked. */
  onSplit(): void;
}

const ROOM_KINDS: Record<Room['kind'], string> = {
  living: 'Pièce de vie',
  bedroom: 'Chambre',
  bathroom: 'Salle d’eau',
  circulation: 'Circulation',
  garage: 'Garage',
  storage: 'Rangement',
};
const OPENING_KINDS: Record<Opening['kind'], string> = {
  door: 'Porte',
  window: 'Fenêtre',
  sliding: 'Baie coulissante',
  garage: 'Porte de garage',
};

/** Millimetre display; the stored value keeps its precision until the field is edited. */
const metres = (value: number) => String(Number(value.toFixed(3)));
const metreField = (name: string, label: string, value: number) =>
  `<label>${label}<span class="plan-inspector-unit"><input name="${name}" type="number" min="0" step="0.01" value="${metres(value)}"><span>m</span></span></label>`;
const options = (entries: [string, string][], current: string) =>
  entries
    .map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`,
    )
    .join('');

/** Non-modal side panel of the Plan selection: each changed field is one edit. */
export class PlanInspector {
  private key = '';
  private reference: 'start' | 'end' = 'start';
  private level?: Level;
  private selection?: PlanSelection;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: PlanInspectorHost,
  ) {
    root.hidden = true;
    root.addEventListener('change', (event) => this.onChange(event.target as HTMLInputElement));
    root.addEventListener('submit', (event) => event.preventDefault());
    root.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!action) return;
      const error = root.querySelector('[role=alert]');
      if (error) error.textContent = '';
      try {
        if (action.dataset.action === 'delete') host.onDelete();
        else if (action.dataset.action === 'split') host.onSplit();
      } catch (failure) {
        if (error) error.textContent = userMessage(failure, 'Modification impossible.');
      }
    });
  }

  show(level: Level | undefined, selection: PlanSelection | undefined) {
    this.level = level;
    this.selection = selection;
    const target = level && selection && this.find(level, selection);
    if (!target) {
      this.root.hidden = true;
      this.key = '';
      this.root.innerHTML = '';
      return;
    }
    this.root.hidden = false;
    const key = JSON.stringify(selection);
    if (key !== this.key) {
      this.key = key;
      this.reference = 'start';
      this.root.innerHTML = this.html(target);
    }
    this.refresh(target);
  }

  private find(level: Level, selection: PlanSelection) {
    if (selection.kind === 'room') {
      const room = level.rooms.find((r) => r.id === selection.id);
      return room && { kind: 'room' as const, room };
    }
    const wall = level.walls.find(
      (w) => w.id === (selection.kind === 'wall' ? selection.id : selection.wallId),
    );
    if (!wall) return;
    if (selection.kind === 'wall') return { kind: 'wall' as const, wall };
    const opening = wall.openings?.find((o) => o.id === selection.id);
    return opening && { kind: 'opening' as const, wall, opening };
  }

  private html(target: NonNullable<ReturnType<PlanInspector['find']>>) {
    let title: string;
    let body: string;
    let remove = '';
    if (target.kind === 'wall') {
      title = target.wall.exterior ? 'Mur extérieur' : 'Mur';
      body =
        metreField('length', 'Longueur', wallLength(target.wall)) +
        metreField('thickness', 'Épaisseur', target.wall.thickness) +
        `<button type="button" class="text-button" data-action="split">Couper le mur au point cliqué</button>`;
      remove = 'Supprimer le mur';
    } else if (target.kind === 'room') {
      const { room } = target;
      title = 'Pièce';
      body =
        `<label>Nom<input name="name" type="text" maxlength="80" value="${escapeHtml(room.name)}"></label>` +
        `<label>Type<select name="kind">${options(Object.entries(ROOM_KINDS), room.kind)}</select></label>` +
        `<p class="plan-inspector-value">Surface finie <strong data-value="area"></strong></p>` +
        (room.planArea !== undefined
          ? `<p class="plan-inspector-value">Surface indiquée sur le plan <strong data-value="plan-area"></strong></p>`
          : '');
    } else {
      const { opening } = target;
      title = OPENING_KINDS[opening.kind];
      body =
        metreField('width', 'Largeur', opening.width) +
        metreField('height', 'Hauteur', opening.height) +
        (opening.kind === 'window' || opening.kind === 'sliding'
          ? metreField('sill', 'Hauteur d’allège', opening.sill ?? 0)
          : '') +
        (opening.kind === 'door'
          ? `<label>Charnière<select name="hinge">${options(
              [
                ['start', 'Côté début du mur'],
                ['end', 'Côté fin du mur'],
              ],
              opening.hinge ?? 'start',
            )}</select></label><label>Sens d’ouverture<select name="swing">${options(
              [
                ['1', 'Positif'],
                ['-1', 'Négatif'],
              ],
              String(opening.swing ?? 1),
            )}</select></label>`
          : '') +
        `<label>Distance depuis<select name="reference">${options(
          [
            ['start', 'Le début du mur'],
            ['end', 'La fin du mur'],
          ],
          'start',
        )}</select></label>` +
        metreField('distance', 'Distance au jambage', this.distance(target.wall, opening));
      remove = 'Supprimer l’ouverture';
    }
    return `<form class="plan-inspector-form"><h2>${escapeHtml(title)}</h2>${body}<p role="alert" class="plan-inspector-error"></p>${
      remove
        ? `<button type="button" class="text-button" data-action="delete">${remove}</button>`
        : ''
    }</form>`;
  }

  /** Writes current values into the fields the visitor is not editing. */
  private refresh(target: NonNullable<ReturnType<PlanInspector['find']>>) {
    const set = (name: string, value: string) => {
      const field = this.root.querySelector<HTMLInputElement>(`[name="${name}"]`);
      if (field && field !== document.activeElement && field.value !== value) field.value = value;
    };
    if (target.kind === 'wall') {
      set('length', metres(wallLength(target.wall)));
      set('thickness', metres(target.wall.thickness));
    } else if (target.kind === 'room') {
      set('name', target.room.name);
      set('kind', target.room.kind);
      const write = (name: string, text: string) => {
        const node = this.root.querySelector(`[data-value="${name}"]`);
        if (node && node.textContent !== text) node.textContent = text;
      };
      write('area', area(polygonArea(target.room.polygon)));
      if (target.room.planArea !== undefined) write('plan-area', area(target.room.planArea));
    } else {
      const { opening } = target;
      set('width', metres(opening.width));
      set('height', metres(opening.height));
      set('sill', metres(opening.sill ?? 0));
      set('hinge', opening.hinge ?? 'start');
      set('swing', String(opening.swing ?? 1));
      set('distance', metres(this.distance(target.wall, opening)));
    }
  }

  private distance(wall: Wall, opening: Opening) {
    return this.reference === 'end'
      ? wallLength(wall) - opening.width - opening.offset
      : opening.offset;
  }

  private onChange(field: HTMLInputElement | HTMLSelectElement) {
    const { level, selection } = this;
    const target = level && selection && this.find(level, selection);
    if (!target || !selection) return;
    const error = this.root.querySelector('[role=alert]')!;
    error.textContent = '';
    const name = field.name;
    if (name === 'reference') {
      this.reference = field.value as 'start' | 'end';
      this.refresh(target);
      return;
    }
    const value = Number(field.value);
    if (field.type === 'number' && field.value === '') return;
    try {
      if (selection.kind === 'wall') this.host.onWall(selection.id, { [name]: value });
      else if (selection.kind === 'room') this.host.onRoom(selection.id, { [name]: field.value });
      else if (name === 'distance')
        this.host.onOpening(selection.wallId, selection.id, {
          reference: this.reference,
          distance: value,
        });
      else
        this.host.onOpening(selection.wallId, selection.id, {
          [name]: name === 'hinge' ? field.value : value,
        });
    } catch (failure) {
      error.textContent = userMessage(failure, 'Modification impossible.');
    }
  }
}
