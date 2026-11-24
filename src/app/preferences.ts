import {
  ONBOARDING_STORAGE,
  parseOnboarding,
  serializeOnboarding,
  shouldShowStartCard,
  type OnboardingState,
} from '../ui/onboarding';
import {
  parseRenderScale,
  RENDER_SCALE_STORAGE,
  renderScaleNote,
  renderScaleOptionsHtml,
  renderScaleValue,
  screenCap,
  type RenderScaleSettings,
} from '../ui/renderScale';
import { number } from '../ui/format';
import { el } from './dom';
import { app } from './state';

/* ---------------------------------------------------------------------------------------------- */
/* Welcome card                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export function readOnboarding(): OnboardingState {
  try {
    return parseOnboarding(localStorage.getItem(ONBOARDING_STORAGE));
  } catch {
    return parseOnboarding(null);
  }
}

export function saveOnboarding(next: OnboardingState) {
  try {
    localStorage.setItem(ONBOARDING_STORAGE, serializeOnboarding(next));
  } catch {
    /* optional persistence */
  }
}

/**
 * The card blocks nothing and only disappears with its close button: a click in the scene is
 * exploration, not an answer. The three actions leave it open so they can be tried in a row.
 */
export function dismissStartCard() {
  const card = el('#start-card');
  if (card.hidden) return;
  card.hidden = true;
  app.onboarding = { ...app.onboarding, cardSeen: true };
  saveOnboarding(app.onboarding);
}

export function showStartCard() {
  if (!shouldShowStartCard(app.onboarding)) return;
  el('#start-card').hidden = false;
}

/* ---------------------------------------------------------------------------------------------- */
/* « Résolution du rendu »                                                                         */
/* ---------------------------------------------------------------------------------------------- */

let renderScaleSettings: RenderScaleSettings = { detected: {} };

function saveRenderScale() {
  try {
    localStorage.setItem(RENDER_SCALE_STORAGE, JSON.stringify(renderScaleSettings));
  } catch {
    /* optional persistence */
  }
  el('#render-scale-note').textContent = renderScaleNote(renderScaleSettings);
}

/** « Résolution du rendu »: automatic from what this machine reached, or pinned. */
export function applyRenderScale() {
  try {
    renderScaleSettings = parseRenderScale(localStorage.getItem(RENDER_SCALE_STORAGE));
  } catch {
    renderScaleSettings = { detected: {} };
  }
  el<HTMLSelectElement>('#render-scale').value = renderScaleValue(renderScaleSettings.fixed);
  el('#render-scale-note').textContent = renderScaleNote(renderScaleSettings);
  app.viewer.setRenderScalePolicy(renderScaleSettings.fixed, renderScaleSettings.detected);
  watchScreenCap();
  app.viewer.onRenderScaleChange = (view, scale) => {
    if (renderScaleSettings.fixed !== undefined) return;
    renderScaleSettings.detected[view] = scale;
    saveRenderScale();
  };
}

/** The « Résolution du rendu » select changed: pin a scale, or go back to automatic. */
export function chooseRenderScale(value: string) {
  renderScaleSettings.fixed = value === 'auto' ? undefined : Number(value);
  saveRenderScale();
  app.viewer.setRenderScalePolicy(renderScaleSettings.fixed, renderScaleSettings.detected);
}

/**
 * Several screens: the window may move from a 4K screen to a 1080p one. The cap is read
 * again when the screen changes (Chromium's `change` on `screen`), on resize and focus,
 * and every two seconds, since moving between two screens of the same scale fires nothing.
 */
let watchedCap: number | undefined;
function watchScreenCap() {
  if (watchedCap !== undefined) return;
  watchedCap = screenCap();
  const check = () => {
    const cap = screenCap();
    if (cap === watchedCap) return;
    watchedCap = cap;
    app.viewer.setScreenCap(cap);
    el('#render-scale').innerHTML = renderScaleOptionsHtml(cap);
    el<HTMLSelectElement>('#render-scale').value = renderScaleValue(renderScaleSettings.fixed, cap);
    el('#render-scale-note').textContent = renderScaleNote(renderScaleSettings, cap);
  };
  (window.screen as Screen & EventTarget).addEventListener?.('change', check);
  window.addEventListener('resize', check);
  window.addEventListener('focus', check);
  window.setInterval(check, 2000);
}

/* ---------------------------------------------------------------------------------------------- */
/* Walk speed, look sensitivity, occlusion                                                        */
/* ---------------------------------------------------------------------------------------------- */

const NAVIGATION_STORAGE = 'maison-atelier:navigation:v1';

export function applyNavigationPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE) ?? '{}');
    if (typeof saved?.speed === 'number' && Number.isFinite(saved.speed))
      el<HTMLInputElement>('#walk-speed').value = String(Math.max(1, Math.min(5, saved.speed)));
    if (typeof saved?.sensitivity === 'number' && Number.isFinite(saved.sensitivity))
      el<HTMLInputElement>('#look-sensitivity').value = String(
        Math.max(50, Math.min(200, saved.sensitivity)),
      );
    if (typeof saved?.occlusion === 'boolean')
      el<HTMLInputElement>('#occlusion-enable').checked = saved.occlusion;
  } catch {
    /* Use the defaults if preferences are unavailable. */
  }
  updateNavigationPreferences(false);
}

export function updateNavigationPreferences(save = true) {
  const speed = Number(el<HTMLInputElement>('#walk-speed').value);
  const sensitivity = Number(el<HTMLInputElement>('#look-sensitivity').value);
  const occlusion = el<HTMLInputElement>('#occlusion-enable').checked;
  app.viewer.setWalkSpeed(speed);
  app.viewer.setOcclusion(occlusion);
  app.viewer.setLookSensitivity(sensitivity / 100);
  el('#walk-speed-value').textContent = `${number(speed)} m/s`;
  el('#look-sensitivity-value').textContent = `${sensitivity} %`;
  if (save) {
    try {
      localStorage.setItem(NAVIGATION_STORAGE, JSON.stringify({ speed, sensitivity, occlusion }));
    } catch {
      /* Preferences are optional; scene and project still work. */
    }
  }
}
