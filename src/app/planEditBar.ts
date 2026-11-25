import { userMessage } from '../errorMessage';
import { activeButton, el, toast } from './dom';
import { planHistory, restorePlanEdit } from './planHistory';
import { findProject, isImported } from './projectLibrary';
import { app } from './state';
import { render as renderWallDraft, stopWallTool, wallGridOn, wallToolActive } from './wallDrawing';

let open = false;

/** Only the visitor's own local projects are editable, and only in Plan. */
export function editableProject() {
  if (app.viewer.mode !== 'plan' || app.readOnlyLink || !isImported(app.current.id)) return;
  return findProject(app.current.id);
}

export function openPlanEditBar() {
  open = true;
}

export function togglePlanEditBar() {
  open = !open;
  if (!open) stopWallTool();
  syncPlanEditBar();
}

export function restorePlan(direction: 'undo' | 'redo') {
  const project = editableProject();
  if (!project) return;
  try {
    restorePlanEdit(project, direction);
  } catch (error) {
    toast(userMessage(error, 'Modification impossible.'));
  }
}

export function syncPlanEditBar() {
  const project = editableProject();
  el('#tool-plan-edit').hidden = !project;
  activeButton('#tool-plan-edit', open);
  el('#plan-edit-bar').hidden = !project || !open;
  activeButton('#wall-tool', wallToolActive());
  el('#wall-options').hidden = !wallToolActive();
  activeButton('#wall-grid', wallGridOn());
  renderWallDraft();
  if (!project) return;
  const { walls } = app.viewer.level;
  const history = planHistory(project);
  el<HTMLButtonElement>('#move-wall').disabled = !walls.some((w) => !w.exterior);
  el<HTMLButtonElement>('#tool-openings').disabled = !walls.length;
  el<HTMLButtonElement>('#undo-plan').disabled = !history.undo.length;
  el<HTMLButtonElement>('#redo-plan').disabled = !history.redo.length;
}
