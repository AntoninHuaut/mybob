/** Local state of the first steps: a card shown once, never blocking. */
export const ONBOARDING_STORAGE = 'maison-atelier:onboarding';

/** Incrementing offers the card again once after a redesign of the welcome. */
export const ONBOARDING_VERSION = 1;

export interface OnboardingState {
  version: number;
  cardSeen: boolean;
  /** The Visite welcome (« Bienvenue chez vous ») was shown once: it never comes back. */
  walkGuideSeen: boolean;
}

export const defaultOnboarding: OnboardingState = {
  version: ONBOARDING_VERSION,
  cardSeen: false,
  walkGuideSeen: false,
};

/** Tolerant read: an absent, unreadable or other-version value starts from scratch. */
export function parseOnboarding(raw: string | null): OnboardingState {
  if (!raw) return { ...defaultOnboarding };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...defaultOnboarding };
    const record = value as Record<string, unknown>;
    if (record.version !== ONBOARDING_VERSION) return { ...defaultOnboarding };
    return {
      version: ONBOARDING_VERSION,
      cardSeen: record.cardSeen === true,
      walkGuideSeen: record.walkGuideSeen === true,
    };
  } catch {
    return { ...defaultOnboarding };
  }
}

export function serializeOnboarding(state: OnboardingState): string {
  return JSON.stringify({
    version: ONBOARDING_VERSION,
    cardSeen: state.cardSeen,
    walkGuideSeen: state.walkGuideSeen,
  });
}

/** Only the card depends on this state: help, demo and projects always stay reachable. */
export function shouldShowStartCard(state: OnboardingState): boolean {
  return !state.cardSeen;
}
