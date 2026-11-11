import type { ViewMode } from '../scene/viewer';

export interface FurnitureViewState {
  mode: ViewMode;
  interactive: boolean;
}

/** Camera projection and editing permission are independent. */
export function furnitureViewState(state: {
  mode: ViewMode;
  exterior: boolean;
  readOnly: boolean;
  measuring: boolean;
  pickingDestination: boolean;
}): FurnitureViewState {
  return {
    mode: state.mode,
    interactive:
      state.mode !== 'walk' &&
      !state.exterior &&
      !state.readOnly &&
      !state.measuring &&
      !state.pickingDestination,
  };
}
