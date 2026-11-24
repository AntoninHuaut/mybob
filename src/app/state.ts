import type { HouseProject, Room } from '../model/types';
import type { DecodedShareLink } from '../model/shareLink';
import type { HouseViewer } from '../scene/viewer';
import type { SolarPanel } from '../ui/solarPanel';
import { MeasureBar } from '../ui/measureBar';
import { VariantSession } from '../furniture/variants';
import { parseOnboarding, type OnboardingState } from '../ui/onboarding';

/** Imported projects, as a JSON array; the key keeps its historical prefix on purpose. */
export const STORAGE = 'maison-atelier:projects:v1';
export const MAX_IMPORTED = 10;
export const READ_ONLY_TOAST =
  'Ce projet a été reçu par lien : il est en lecture seule. « Ajouter à mes projets » pour le modifier.';

/**
 * Screen state shared by the `src/app/` modules. Each field has one writer, named in its
 * comment; the others only read it. Furniture, project-list and link-hash state stay private
 * to their own module.
 */
export const app = {
  /** Created once by `start` (main.ts). */
  viewer: undefined as unknown as HouseViewer,
  /** Created once by `start` (main.ts). */
  solarPanel: undefined as unknown as SolarPanel,
  /** The displayed project; written by `loadProject` (projectView.ts). Unset until the first load. */
  current: undefined as unknown as HouseProject,
  /** Written by the room panels (projectView.ts). */
  selectedRoom: undefined as Room | undefined,
  /**
   * Share link: a project received through #p1: lives in memory only, read-only until
   * « Ajouter à mes projets ». Written by `loadProject`.
   */
  readOnlyLink: false,
  /** Written by `loadProject` and `openReceivedShare` (shareLinkSync.ts). */
  receivedShare: undefined as DecodedShareLink | undefined,
  /** Toolbar toggles; written by the viewport controls (controls.ts). */
  display: { labels: true, dimensions: false, circulation: false, lights: true },
  /** Written by preferences.ts and `syncViewChrome` (viewChrome.ts). */
  onboarding: parseOnboarding(null) as OnboardingState,
  measureBar: new MeasureBar(),
  layoutSession: new VariantSession(),
};
