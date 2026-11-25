import { FURNITURE_SURFACES, type FurnitureSurface } from './model';

const LABELS: Record<FurnitureSurface, string> = {
  wood: 'Bois',
  stone: 'Pierre ou ardoise',
  gloss: 'Brillant ou laqué',
};

/** A select of the furniture materials; the empty value is plain matte. */
export function surfaceField(name: string, label: string, value?: FurnitureSurface): string {
  const options = [
    `<option value=""${value ? '' : ' selected'}>Uni mat</option>`,
    ...FURNITURE_SURFACES.map(
      (surface) =>
        `<option value="${surface}"${surface === value ? ' selected' : ''}>${LABELS[surface]}</option>`,
    ),
  ];
  return `<label class="furniture-field">${label}<select name="${name}">${options.join('')}</select></label>`;
}

/** The form value as a surface, or undefined for plain matte and unknown values. */
export function surfaceFromForm(value: FormDataEntryValue | null): FurnitureSurface | undefined {
  return FURNITURE_SURFACES.find((surface) => surface === value);
}
