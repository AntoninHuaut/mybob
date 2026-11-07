/** État local des premiers pas : une carte montrée une fois, jamais bloquante. */
export const ONBOARDING_STORAGE = 'maison-atelier:onboarding';

/** Incrémenter repropose la carte une fois après une refonte de l’accueil. */
export const ONBOARDING_VERSION = 1;

export interface OnboardingState {
  version: number;
  cardSeen: boolean;
}

export const defaultOnboarding: OnboardingState = {
  version: ONBOARDING_VERSION,
  cardSeen: false,
};

/** Lecture tolérante : une valeur absente, illisible ou d’une autre version repart de zéro. */
export function parseOnboarding(raw: string | null): OnboardingState {
  if (!raw) return { ...defaultOnboarding };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...defaultOnboarding };
    const record = value as Record<string, unknown>;
    if (record.version !== ONBOARDING_VERSION) return { ...defaultOnboarding };
    return { version: ONBOARDING_VERSION, cardSeen: record.cardSeen === true };
  } catch {
    return { ...defaultOnboarding };
  }
}

export function serializeOnboarding(state: OnboardingState): string {
  return JSON.stringify({ version: ONBOARDING_VERSION, cardSeen: state.cardSeen });
}

/** Seule la carte dépend de cet état : l’aide, la démo et les projets restent toujours accessibles. */
export function shouldShowStartCard(state: OnboardingState): boolean {
  return !state.cardSeen;
}
