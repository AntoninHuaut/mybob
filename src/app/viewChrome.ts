import { syncPlanEditBar } from './planEditBar';
import { wallToolLive } from './wallDrawing';
import { endWallBrush } from './roomPaint';
import type { ViewMode } from '../scene/viewer';
import { furnitureViewState } from '../furniture/viewState';
import { desktopHint, modeTitle, touchHint as touchHintText } from '../ui/modeChrome';
import { number } from '../ui/format';
import { icon } from '../ui/icons';
import { activeButton, el, openDialog } from './dom';
import { app } from './state';
import { setFurnitureView } from './furnitureController';
import { saveOnboarding } from './preferences';

/*
 * The chrome around the scene, derived from the viewer's accepted state: mode buttons,
 * titles, help, tool availability, sidebar and navigation panel. `syncViewChrome` never
 * requests another transition (docs/ARCHITECTURE.md, "The three modes and their state").
 */

export function setSidebarTab(tab: 'house' | 'furniture', focus = false) {
  for (const name of ['house', 'furniture'] as const) {
    const button = el<HTMLButtonElement>(`#sidebar-${name}-tab`);
    const selected = name === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  el('#house-panel').hidden = tab !== 'house';
  el('#furniture-workspace-panel').hidden = tab !== 'furniture';
}

export function setSidebar(open: boolean) {
  const desktop = matchMedia('(min-width: 761px)').matches;
  const label = open ? 'Masquer le panneau du projet' : 'Afficher le panneau du projet';
  el('.workspace').classList.toggle('sidebar-open', !desktop && open);
  el('.workspace').classList.toggle('sidebar-collapsed', desktop && !open);
  el('#toggle-sidebar').setAttribute('aria-expanded', String(open));
  el('#toggle-sidebar').title = label;
  el('#toggle-sidebar').setAttribute('aria-label', label);
  el('.sidebar-backdrop').hidden = desktop || !open;
  if (!open && el('#project-sidebar').contains(document.activeElement))
    el('#toggle-sidebar').focus();
  el('#project-sidebar').inert = !open;
}

export function setNavigationPanel(open: boolean) {
  const focusInside = el('#navigation-panel').contains(document.activeElement);
  el('#navigation-panel').hidden = !open;
  el('#tool-navigation').setAttribute('aria-expanded', String(open));
  if (open) el('#go-to').focus({ preventScroll: true });
  else if (focusInside) el('#tool-navigation').focus({ preventScroll: true });
}

export function syncDisplayControls() {
  syncPlanEditBar();
  const { viewer, display } = app;
  const measuring = viewer.measureMode;
  activeButton('#go-to', viewer.goToMode);
  activeButton('#view-exterior', viewer.exteriorView);
  const overviewButton = document.querySelector<HTMLButtonElement>('[data-view=overview]')!;
  overviewButton.classList.toggle('active', viewer.mode === 'overview' && !viewer.exteriorView);
  overviewButton.setAttribute(
    'aria-pressed',
    String(viewer.mode === 'overview' && !viewer.exteriorView),
  );
  el('#scene-labels').hidden =
    viewer.mode === 'walk' ||
    viewer.exteriorView ||
    !display.labels ||
    measuring ||
    viewer.goToMode;
  el<HTMLButtonElement>('#go-to').disabled = viewer.mode === 'walk';
  setFurnitureView(
    furnitureViewState({
      mode: viewer.mode,
      exterior: viewer.exteriorView,
      readOnly: app.readOnlyLink,
      measuring: measuring || wallToolLive(),
      pickingDestination: viewer.goToMode,
    }),
  );
  app.measureBar.setActive(measuring);
  activeButton('#tool-measure', measuring);
  activeButton('#tool-labels', display.labels);
  activeButton('#tool-circulation', display.circulation);
  for (const id of ['tool-measure', 'tool-labels', 'tool-dimensions', 'tool-circulation']) {
    el<HTMLButtonElement>(`#${id}`).disabled =
      viewer.mode === 'walk' || viewer.exteriorView || (measuring && id === 'tool-labels');
  }
}

/** The viewer's `canChangeMode` policy: refuses the walk on a touch-only device, with a reason. */
export function canChangeMode(next: ViewMode): boolean {
  if (
    next === 'walk' &&
    matchMedia('(pointer: coarse)').matches &&
    !matchMedia('(any-pointer: fine)').matches
  ) {
    openDialog(
      'VISITE SUR ORDINATEUR',
      '<h2>La visite utilise un clavier et une souris.</h2><p>Sur téléphone, vous pouvez consulter le plan et faire tourner la vue 3D avec les doigts. Ouvrez ce même lien sur ordinateur pour marcher dans la maison.</p>',
    );
    return false;
  }
  return true;
}

/** A transition requested by the UI; adds focus conveniences once the viewer accepted it. */
export function setMode(next: ViewMode): boolean {
  if (!app.viewer.setMode(next)) return false;
  if (app.selectedRoom) app.viewer.focusRoom(app.selectedRoom.id);
  if (next !== 'walk') app.viewer.canvas.focus({ preventScroll: true });
  return true;
}

/** Called only after the viewer has accepted and applied a transition. */
export function syncViewChrome() {
  endWallBrush();
  const { viewer, display } = app;
  const next = viewer.mode;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === next);
    b.setAttribute('aria-pressed', String(b.dataset.view === next));
  });
  el('#viewport').classList.toggle('walking', next === 'walk');
  const title = modeTitle(next, number(Number(el<HTMLSelectElement>('#eye-height').value)));
  el('#view-eyebrow').textContent = title[0];
  el('#view-title').textContent = title[1];
  el('#view-subtitle').textContent = title[2];
  // The welcome shows on the first visit only; afterwards a click in the view
  // captures the mouse, and the control hint keeps the keys on screen.
  el('#walk-start').hidden = next !== 'walk' || app.onboarding.walkGuideSeen;
  if (next === 'walk' && !app.onboarding.walkGuideSeen) {
    app.onboarding = { ...app.onboarding, walkGuideSeen: true };
    saveOnboarding(app.onboarding);
  }
  el('#resume-walk').hidden = true;
  el('#crosshair').hidden = next !== 'walk';
  el('#scene-labels').hidden = next === 'walk' || !display.labels;
  el('#control-hint').innerHTML = desktopHint(next, {
    mouseLeft: icon('mouse-left', 17),
    mouseRight: icon('mouse-right', 17),
    mouseWheel: icon('mouse-wheel', 17),
  });
  const touchHint = document.createElement('span');
  touchHint.className = 'touch-hint';
  touchHint.textContent = touchHintText(next);
  el('#control-hint').append(touchHint);
  if (viewer.exteriorView) {
    el('#view-eyebrow').textContent = 'LA MAISON SUR SON TERRAIN';
    el('#view-title').textContent = 'Extérieur';
    el('#view-subtitle').textContent =
      'Toiture, façades et jardin. Les approximations figurent dans Plans & précision.';
  }
  syncDisplayControls();
  app.measureBar.hide();
  el('#width-label').hidden = !display.dimensions || next === 'walk';
  el('#depth-label').hidden = !display.dimensions || next === 'walk';
  el('#door-prompt').hidden = true;
  el('#stair-prompt').hidden = true;
  el('#furniture-edit-prompt').hidden = true;
}
