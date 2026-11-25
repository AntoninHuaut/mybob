import {
  EFFECT_TIERS,
  QUALITIES,
  RENDER_SCALES,
  upscaleCap,
  upscales,
  type Quality,
  type QualityStart,
} from '../scene/adaptiveResolution';

/** This screen's sharpest render scale (`upscaleCap`), from the browser's screen. */
export function screenCap(): number {
  if (typeof window === 'undefined') return 1;
  return upscaleCap(
    window.screen?.width ?? 0,
    window.screen?.height ?? 0,
    window.devicePixelRatio || 1,
  );
}

/** Per browser: the « Qualité » chosen, and where each view stood on this GPU. */
export const QUALITY_STORAGE = 'maison-atelier:quality:v1';
/** Replaced by `QUALITY_STORAGE`: read once to migrate, then removed. */
export const LEGACY_RENDER_SCALE_STORAGE = 'maison-atelier:render-scale:v1';

export interface QualitySettings {
  quality: Quality;
  /** The GPU the detected starts were measured on. */
  device?: string;
  /** Automatic: where each view stood last time, its start next time. */
  detected: Record<string, QualityStart>;
}

/** The raw values of the two settings « Qualité » replaced. */
export interface LegacyQuality {
  renderScale: string | null;
  navigation: string | null;
}

const VIEW_LABELS: Record<string, string> = {
  walk: 'Visite',
  overview: 'Vue 3D',
  'overview+exterior': 'Extérieur',
  plan: 'Plan',
};

// Every ladder step on a 2K (125 % cap) or 4K (150 %) screen.
const SCALES = [...RENDER_SCALES, ...upscales(1.25), ...upscales(1.5)];
const validScale = (value: unknown): value is number =>
  typeof value === 'number' && SCALES.some((scale) => Math.abs(scale - value) < 1e-6);
const validTier = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= EFFECT_TIERS;

function readObject(raw: string | null): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The old resolution pin and occlusion switch, mapped to the closest quality. */
function migrate(legacy: LegacyQuality): QualitySettings {
  const scale = readObject(legacy.renderScale);
  const detected: Record<string, QualityStart> = {};
  const found = scale?.detected;
  if (found && typeof found === 'object')
    for (const [view, value] of Object.entries(found))
      if (view in VIEW_LABELS && validScale(value)) detected[view] = { scale: value, tier: 0 };
  let quality: Quality = 'auto';
  if (validScale(scale?.fixed)) quality = scale.fixed >= 1 ? 'high' : 'medium';
  if (readObject(legacy.navigation)?.occlusion === false) quality = 'low';
  return { quality, detected };
}

/** Tolerant read: anything unreadable means automatic, nothing detected yet. */
export function parseQuality(raw: string | null, legacy: LegacyQuality): QualitySettings {
  const record = readObject(raw);
  if (!record) return migrate(legacy);
  if (!QUALITIES.includes(record.quality as Quality)) return { quality: 'auto', detected: {} };
  const detected: Record<string, QualityStart> = {};
  if (record.detected && typeof record.detected === 'object')
    for (const [view, value] of Object.entries(record.detected as Record<string, unknown>)) {
      const start = value as Partial<QualityStart> | null;
      if (view in VIEW_LABELS && validScale(start?.scale) && validTier(start?.tier))
        detected[view] = { scale: start.scale, tier: start.tier };
    }
  const settings: QualitySettings = { quality: record.quality as Quality, detected };
  if (typeof record.device === 'string') settings.device = record.device;
  return settings;
}

/** Automatic starts measured on another GPU (a laptop switching graphics) are dropped. */
export function forDevice(settings: QualitySettings, device: string): QualitySettings {
  const other = settings.quality === 'auto' && settings.device !== undefined;
  return {
    ...settings,
    device,
    detected: other && settings.device !== device ? {} : settings.detected,
  };
}

const LABELS: Record<Quality, string> = {
  auto: 'Automatique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

/** The header's select; what the choice does is its tooltip (`qualityNote`). */
export function qualityFieldHtml(): string {
  const options = QUALITIES.map(
    (quality) => `<option value="${quality}">${LABELS[quality]}</option>`,
  );
  return `<label class="header-quality"><span>Qualité</span><select id="quality">${options.join('')}</select></label>`;
}

const percent = (scale: number) => `${Math.round(scale * 100)} %`;
const TIER_NOTES = [
  '',
  ' sans ombres des angles',
  ' sans ombres des angles, ombres simplifiées',
  ' sans ombres des angles, ombres simplifiées, sans halo',
];

/** The line under the field: what the choice does, and what automatic found on this machine. */
export function qualityNote(settings: QualitySettings, cap = screenCap()): string {
  const sharper =
    cap > 1 ? `, plus nette jusqu’à ${percent(cap)} sur cet écran tant que l’image suit` : '';
  if (settings.quality === 'high')
    return `Haute : tous les effets, jamais sous 100 %${sharper}. Peut ralentir un petit ordinateur.`;
  if (settings.quality === 'medium')
    return 'Moyenne : tous les effets, image à 67 % : plus fluide, un peu moins nette.';
  if (settings.quality === 'low')
    return 'Basse : image à 67 %, sans ombres des angles, ombres simplifiées et sans halo. Pour un ordinateur très lent.';
  const found = Object.entries(settings.detected)
    .filter(([view]) => VIEW_LABELS[view])
    .map(
      ([view, start]) =>
        `${VIEW_LABELS[view]} ${percent(start.scale)}${TIER_NOTES[start.tier] ?? ''}`,
    );
  return `Automatique : sous 40 images/s, baisse d’abord la résolution, jusqu’à 67 %, puis les ombres des angles, les ombres douces et le halo${sharper}.${found.length ? ` Sur cet ordinateur : ${found.join(', ')}.` : ''}`;
}
