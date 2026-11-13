import { PINNABLE_SCALES } from '../scene/adaptiveResolution';

/** Per browser: the pinned render scale, or the scales this machine reached per view. */
export const RENDER_SCALE_STORAGE = 'maison-atelier:render-scale:v1';

export interface RenderScaleSettings {
  /** A scale pinned in the Navigation panel; absent means automatic. */
  fixed?: number;
  /** Automatic mode: the scale each view reached last time, its start next time. */
  detected: Record<string, number>;
}

const VIEW_LABELS: Record<string, string> = {
  walk: 'Visite',
  overview: 'Vue 3D',
  'overview+exterior': 'Extérieur',
  plan: 'Plan',
};

const percent = (scale: number) => `${Math.round(scale * 100)} %`;
const pinnable = (value: unknown): value is number =>
  typeof value === 'number' && PINNABLE_SCALES.some((scale) => Math.abs(scale - value) < 1e-6);

/** Tolerant read: anything unreadable means automatic, nothing detected yet. */
export function parseRenderScale(raw: string | null): RenderScaleSettings {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object') return { detected: {} };
    const record = value as Record<string, unknown>;
    const detected: Record<string, number> = {};
    if (record.detected && typeof record.detected === 'object')
      for (const [view, scale] of Object.entries(record.detected))
        if (view in VIEW_LABELS && pinnable(scale)) detected[view] = scale;
    return pinnable(record.fixed) ? { fixed: record.fixed, detected } : { detected };
  } catch {
    return { detected: {} };
  }
}

/** The Navigation panel's field: « Automatique », then every pinnable scale. */
export function renderScaleFieldHtml(): string {
  const options = PINNABLE_SCALES.map(
    (scale) => `<option value="${scale}">${percent(scale)}</option>`,
  ).join('');
  return `<label>Résolution du rendu<select id="render-scale"><option value="auto">Automatique</option>${options}</select></label><small id="render-scale-note"></small>`;
}

/** The line under the field: what automatic does, and what it found on this machine. */
export function renderScaleNote(settings: RenderScaleSettings): string {
  if (settings.fixed !== undefined)
    return `Fixée à ${percent(settings.fixed)} pour toutes les vues : elle ne s’adapte plus, même si l’image ralentit.`;
  const found = Object.entries(settings.detected)
    .filter(([view]) => VIEW_LABELS[view])
    .map(([view, scale]) => `${VIEW_LABELS[view]} ${percent(scale)}`);
  return `Automatique : plus nette au-dessus de 100 images/s, jusqu’à 150 % ; moins nette sous 40.${found.length ? ` Sur cet ordinateur : ${found.join(', ')}.` : ''}`;
}
