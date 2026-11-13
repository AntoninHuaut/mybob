import type { FurnitureItem, KitchenSlot } from './model';

const cm = (value: number) => Math.round(value * 1000) / 10;
const numberField = (name: string, label: string, value: number, min = 0, max = 2000) =>
  `<label class="furniture-field">${label}<input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="0.1" required></label>`;

export function kitchenFields(item: FurnitureItem): string {
  const k = item.kitchen;
  return `<fieldset data-kitchen-fields class="furniture-shape-fields"${item.kind === 'kitchen' ? '' : ' hidden disabled'}><legend>Plan de travail et équipements</legend>
    ${numberField('worktopHeight', 'Hauteur du plan (cm)', cm(k?.worktopHeight ?? 0.9), 30)}
    <label class="furniture-field">Teinte du plan<input type="color" name="worktopColor" value="${k?.worktopColor ?? '#b58d62'}"></label>
    <label><input type="checkbox" name="kitchenWallUnits"${k?.wallUnits ? ' checked' : ''}> Meubles hauts</label>
    ${numberField('kitchenWallBottom', 'Bas des meubles hauts (cm)', cm(k?.wallUnits?.bottom ?? 1.4))}
    ${numberField('kitchenWallHeight', 'Hauteur des meubles hauts (cm)', cm(k?.wallUnits?.height ?? 0.7), 10)}
    ${numberField('kitchenWallDepth', 'Profondeur des meubles hauts (cm)', cm(k?.wallUnits?.depth ?? 0.35), 10)}
    <p class="furniture-form-note">La hauteur hors tout inclut les colonnes et les meubles hauts. Les positions des équipements partent du début du tronçon. Pour un îlot, ajoutez une cuisine droite distincte.</p>
    <div data-kitchen-slots>${(k?.slots ?? []).map((slot, i) => slotRow(slot, i, true)).join('')}</div>
    <button type="button" data-kitchen-add>Ajouter un équipement</button></fieldset>`;
}
function slotRow(slot: KitchenSlot, i: number, original = false): string {
  return `<div data-kitchen-slot data-original-slot="${original ? i : ''}" class="furniture-field-grid two"><label class="furniture-field">Équipement<select name="kitchenKind${i}">${(['sink', 'hob', 'oven', 'fridge'] as const).map((kind, n) => `<option value="${kind}"${slot.kind === kind ? ' selected' : ''}>${['Évier', 'Plaque', 'Colonne four', 'Colonne réfrigérateur'][n]}</option>`).join('')}</select></label>
    ${numberField(`kitchenRun${i}`, 'Tronçon (numéro)', slot.run + 1, 1, 12)}
    ${numberField(`kitchenOffset${i}`, 'Position (cm)', cm(slot.offset))}
    ${numberField(`kitchenWidth${i}`, 'Largeur (cm)', cm(slot.width), 20)}
    <label data-kitchen-microwave${slot.kind === 'oven' ? '' : ' hidden'}><input type="checkbox" name="kitchenMicrowave${i}"${slot.microwave ? ' checked' : ''}${slot.kind === 'oven' ? '' : ' disabled'}> Micro-ondes au-dessus du four</label>
    <button type="button" data-kitchen-remove="${i}">Retirer cet équipement</button></div>`;
}
export function kitchenSlotClick(target: HTMLElement): boolean {
  const form = target.closest('form');
  const container = form?.querySelector('[data-kitchen-slots]');
  if (!form || !container) return false;
  if (target.closest('[data-kitchen-add]')) {
    const count = container.children.length;
    if (count < 48)
      container.insertAdjacentHTML(
        'beforeend',
        slotRow({ kind: 'sink', run: 0, offset: 0, width: 0.6 }, count),
      );
    return true;
  }
  const remove = target.closest('[data-kitchen-remove]');
  if (!remove) return false;
  remove.closest('[data-kitchen-slot]')?.remove();
  Array.from(container.children).forEach((row, i) =>
    row.querySelectorAll('input, select').forEach((input) => {
      const element = input as HTMLInputElement;
      element.name = element.name.replace(/\d+$/, String(i));
    }),
  );
  return true;
}
export function initializeKitchenSlots(form: HTMLFormElement, slots: KitchenSlot[]): void {
  slots.forEach((slot, i) => {
    const select = form.elements.namedItem(`kitchenKind${i}`) as HTMLSelectElement;
    select.value = slot.kind;
    kitchenSlotChange(select);
  });
}
export function kitchenSlotChange(target: HTMLElement): void {
  const select = target as HTMLSelectElement;
  if (!select.name?.startsWith('kitchenKind')) return;
  const row = select.closest('[data-kitchen-slot]');
  const label = row?.querySelector<HTMLElement>('[data-kitchen-microwave]');
  const input = label?.querySelector<HTMLInputElement>('input');
  if (!label || !input) return;
  const oven = select.value === 'oven';
  label.hidden = !oven;
  input.disabled = !oven;
  if (!oven) input.checked = false;
}
export function kitchenSlotsFromForm(data: FormData): KitchenSlot[] {
  const slots: KitchenSlot[] = [];
  for (let i = 0; data.has(`kitchenKind${i}`); i++)
    slots.push({
      kind: String(data.get(`kitchenKind${i}`)) as KitchenSlot['kind'],
      run: Number(data.get(`kitchenRun${i}`)) - 1,
      offset: Number(data.get(`kitchenOffset${i}`)) / 100,
      width: Number(data.get(`kitchenWidth${i}`)) / 100,
      ...(data.get(`kitchenKind${i}`) === 'oven' && data.has(`kitchenMicrowave${i}`)
        ? { microwave: true }
        : {}),
    });
  return slots;
}
