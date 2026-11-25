import {
  ONBOARDING_STORAGE,
  parseOnboarding,
  serializeOnboarding,
  shouldShowStartCard,
  type OnboardingState,
} from '../ui/onboarding';
import {
  forDevice,
  LEGACY_RENDER_SCALE_STORAGE,
  parseQuality,
  QUALITY_STORAGE,
  qualityNote,
  screenCap,
  type QualitySettings,
} from '../ui/quality';
import { QUALITIES, qualitySeed, type Quality } from '../scene/adaptiveResolution';
import { engineInfo, gpuName, type DiagnosticEngine } from '../scene/diagnostics';
import { gpuClass } from '../scene/deviceProfile';
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

/* « Qualité »                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/** Walk speed and look sensitivity; it also held the occlusion switch « Qualité » replaced. */
const NAVIGATION_STORAGE = 'maison-atelier:navigation:v1';

let qualitySettings: QualitySettings = { quality: 'auto', detected: {} };

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveQuality() {
  try {
    localStorage.setItem(QUALITY_STORAGE, JSON.stringify(qualitySettings));
    localStorage.removeItem(LEGACY_RENDER_SCALE_STORAGE);
  } catch {
    /* optional persistence */
  }
  el('#quality').title = qualityNote(qualitySettings);
}

const viewerEngine = () => app.viewer.engine as unknown as DiagnosticEngine;

/** Hands the viewer the chosen quality, seeded by this GPU's class for a never-measured view. */
function configureQuality() {
  const engine = viewerEngine();
  const seed = qualitySeed(gpuClass(engineInfo(engine).renderer, navigator.userAgent));
  app.viewer.setQuality(qualitySettings.quality, qualitySettings.detected, seed);
}

/** « Qualité »: the saved choice (or the two settings it replaced), on this GPU. */
export function applyQuality() {
  const legacy = {
    renderScale: stored(LEGACY_RENDER_SCALE_STORAGE),
    navigation: stored(NAVIGATION_STORAGE),
  };
  const raw = stored(QUALITY_STORAGE);
  const read = parseQuality(raw, legacy);
  qualitySettings = forDevice(read, gpuName(viewerEngine()));
  // Written only to finish a migration or record a new GPU, not on every project load.
  if (raw === null || read.device !== qualitySettings.device) saveQuality();
  else el('#quality').title = qualityNote(qualitySettings);
  el<HTMLSelectElement>('#quality').value = qualitySettings.quality;
  configureQuality();
  watchScreenCap();
  app.viewer.onQualityChange = (view, start) => {
    if (qualitySettings.quality !== 'auto') return;
    qualitySettings.detected[view] = start;
    saveQuality();
  };
}

/** The « Qualité » select changed. */
export function chooseQuality(value: string) {
  if (!QUALITIES.includes(value as Quality)) return;
  qualitySettings.quality = value as Quality;
  saveQuality();
  configureQuality();
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
    el('#quality').title = qualityNote(qualitySettings, cap);
  };
  (window.screen as Screen & EventTarget).addEventListener?.('change', check);
  window.addEventListener('resize', check);
  window.addEventListener('focus', check);
  window.setInterval(check, 2000);
}

/* ---------------------------------------------------------------------------------------------- */
/* Walk speed, look sensitivity                                                                   */
/* ---------------------------------------------------------------------------------------------- */

export function applyNavigationPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE) ?? '{}');
    if (typeof saved?.speed === 'number' && Number.isFinite(saved.speed))
      el<HTMLInputElement>('#walk-speed').value = String(Math.max(1, Math.min(5, saved.speed)));
    if (typeof saved?.sensitivity === 'number' && Number.isFinite(saved.sensitivity))
      el<HTMLInputElement>('#look-sensitivity').value = String(
        Math.max(50, Math.min(200, saved.sensitivity)),
      );
  } catch {
    /* Use the defaults if preferences are unavailable. */
  }
  updateNavigationPreferences(false);
}

export function updateNavigationPreferences(save = true) {
  const speed = Number(el<HTMLInputElement>('#walk-speed').value);
  const sensitivity = Number(el<HTMLInputElement>('#look-sensitivity').value);
  app.viewer.setWalkSpeed(speed);
  app.viewer.setLookSensitivity(sensitivity / 100);
  el('#walk-speed-value').textContent = `${number(speed)} m/s`;
  el('#look-sensitivity-value').textContent = `${sensitivity} %`;
  if (save) {
    try {
      localStorage.setItem(NAVIGATION_STORAGE, JSON.stringify({ speed, sensitivity }));
    } catch {
      /* Preferences are optional; scene and project still work. */
    }
  }
}
