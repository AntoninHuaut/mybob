import { userMessage } from '../errorMessage';
import { planHint, planHintHtml, type PlanNotice, type PlanTool } from '../ui/planHint';
import { activeButton, el, toast } from './dom';
import { planHistory, restorePlanEdit } from './planHistory';
import { findProject, isImported } from './projectLibrary';
import {
  placingOpening,
  selectedKind,
  selectionPointer,
  setPlacing,
  syncPlanSelection,
} from './planSelection';
import { app } from './state';
import {
  render as renderWallDraft,
  startWallTool,
  stopWallTool,
  wallDraftState,
  wallGridOn,
  wallPointer,
  wallToolActive,
} from './wallDrawing';

let open = false;
let notice: PlanNotice | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let hintHtml = '';

/** Only the visitor's own local projects are editable, and only in Plan. */
export function editableProject() {
  if (app.viewer.mode !== 'plan' || app.readOnlyLink || !isImported(app.current.id)) return;
  return findProject(app.current.id);
}

export const planEditBarOpen = () => open;

export function openPlanEditBar() {
  open = true;
}

export function togglePlanEditBar() {
  if (!editableProject()) {
    toast(
      app.readOnlyLink
        ? 'Ajoutez ce projet à vos projets pour modifier son plan.'
        : 'Les exemples fournis ne se modifient pas. Créez une nouvelle maison ou importez la vôtre.',
    );
    return;
  }
  open = !open;
  if (!open) setPlanTool('select');
  syncPlanEditBar();
}

export const planTool = (): PlanTool =>
  wallToolActive() ? 'wall' : (placingOpening() ?? 'select');

/** One tool at a time takes the Plan clicks; Sélection is the resting one. */
export function setPlanTool(tool: PlanTool) {
  if (!editableProject()) return;
  notice = undefined;
  if (tool === 'wall') {
    setPlacing(undefined);
    if (!wallToolActive()) startWallTool();
  } else {
    stopWallTool();
    setPlacing(tool === 'select' ? undefined : tool);
  }
  syncPlanEditBar();
}

let cursorSet = false;

/** The Plan pointer's cursor while editing; cleared only when this module set it. */
export function setPlanCursor(cursor: string) {
  if (!cursor && !cursorSet) return;
  cursorSet = !!cursor;
  if (app.viewer.canvas.style.cursor !== cursor) app.viewer.canvas.style.cursor = cursor;
}

/** A short confirmation or refusal shown in place of the hint, near where the visitor looks. */
export function planNotice(text: string, tone: PlanNotice['tone'] = 'success') {
  notice = { text, tone };
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => {
      notice = undefined;
      renderPlanHint();
    },
    tone === 'error' ? 6000 : 4000,
  );
  renderPlanHint();
}

export function restorePlan(direction: 'undo' | 'redo') {
  const project = editableProject();
  if (!project || !planHistory(project)[direction].length) return;
  try {
    restorePlanEdit(project, direction);
    planNotice(direction === 'undo' ? 'Modification annulée.' : 'Modification rétablie.');
  } catch (error) {
    planNotice(userMessage(error, 'Modification impossible.'), 'error');
  }
}

/** Written only when its text changes: the wall tool calls it on every pointer move. */
export function renderPlanHint() {
  const hint = el('#plan-hint');
  const live = !!editableProject() && open && !app.viewer.measureMode;
  if (hint.hidden !== !live) hint.hidden = !live;
  if (!live) return;
  const html = planHintHtml(
    planHint({
      tool: planTool(),
      walls: app.viewer.level.walls.length,
      selection: selectedKind(),
      ...wallDraftState(),
    }),
    notice,
  );
  if (html !== hintHtml || hint.innerHTML !== html) {
    hintHtml = html;
    hint.innerHTML = html;
  }
  hint.dataset.tone = notice?.tone ?? 'hint';
  hint.setAttribute('role', notice?.tone === 'error' ? 'alert' : 'status');
}

export function syncPlanEditBar() {
  const project = editableProject();
  el('#tool-plan-edit').hidden = app.viewer.mode !== 'plan';
  activeButton('#tool-plan-edit', !!project && open);
  el('#plan-edit-bar').hidden = !project || !open;
  el('#viewport').classList.toggle('plan-editing', !!project && open);
  const tool = planTool();
  activeButton('#select-tool', tool === 'select');
  activeButton('#wall-tool', tool === 'wall');
  activeButton('#place-door', tool === 'door');
  activeButton('#place-window', tool === 'window');
  el('#wall-options').hidden = tool !== 'wall';
  activeButton('#wall-grid', wallGridOn());
  app.viewer.planPointer =
    !project || !open ? undefined : tool === 'wall' ? wallPointer : selectionPointer;
  if (!project || !open) setPlanCursor('');
  renderWallDraft();
  syncPlanSelection();
  renderPlanHint();
  if (!project) return;
  const { walls } = app.viewer.level;
  const history = planHistory(project);
  for (const kind of ['door', 'window'] as const)
    el<HTMLButtonElement>(`#place-${kind}`).disabled = !walls.length;
  el<HTMLButtonElement>('#undo-plan').disabled = !history.undo.length;
  el<HTMLButtonElement>('#redo-plan').disabled = !history.redo.length;
}
