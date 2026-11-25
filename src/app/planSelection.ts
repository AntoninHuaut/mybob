import { userMessage } from '../errorMessage';
import { alongWall, wallLength } from '../model/geometry';
import {
  deleteOpening,
  deleteWall,
  pickPlan,
  setWallLength,
  setWallThickness,
  updateOpening,
  updateRoom,
  type PlanSelection,
} from '../model/planEdit';
import type { Level, Point2 } from '../model/types';
import { PlanInspector } from '../ui/planInspector';
import { el, toast } from './dom';
import { editableProject, planEditBarOpen, restorePlan } from './planEditBar';
import { applyPlanEdit } from './planHistory';
import { app } from './state';
import { wallToolActive } from './wallDrawing';

/** Pointer distance, in CSS pixels, within which a click still lands on a wall. */
const PICK_PIXELS = 6;

let selection: PlanSelection | undefined;
let inspector: PlanInspector | undefined;

/** Selecting is on in Plan with the edit bar open, unless a drawing tool takes the clicks. */
export const planSelectionLive = () =>
  !!editableProject() && planEditBarOpen() && !wallToolActive() && !app.viewer.measureMode;

export function wirePlanSelection() {
  inspector = new PlanInspector(el('#plan-inspector'), {
    onWall: (id, change) =>
      edit((level) =>
        change.length !== undefined
          ? setWallLength(level, id, change.length)
          : setWallThickness(level, id, change.thickness!),
      ),
    onRoom: (id, change) => edit((level) => updateRoom(level, id, change)),
    onOpening: (wallId, id, change) => edit((level) => updateOpening(level, wallId, id, change)),
    onDelete: removeSelection,
  });
}

/** One undoable plan edit of the displayed level; a refusal throws with its French message. */
function edit(change: (level: Level) => Level) {
  const project = editableProject();
  if (!project) return;
  const levelId = app.viewer.level.id;
  applyPlanEdit(project, {
    ...project,
    levels: project.levels.map((level) => (level.id === levelId ? change(level) : level)),
  });
}

function removeSelection() {
  const target = selection;
  if (!target || target.kind === 'room') return;
  try {
    edit((level) =>
      target.kind === 'wall'
        ? deleteWall(level, target.id)
        : deleteOpening(level, target.wallId, target.id),
    );
    selection = undefined;
    syncPlanSelection();
  } catch (error) {
    toast(userMessage(error, 'Suppression impossible.'));
  }
}

export function selectionPointer(type: 'move' | 'tap', at: Point2) {
  if (type !== 'tap' || !planSelectionLive()) return false;
  selection = pickPlan(app.viewer.level, at, PICK_PIXELS * app.viewer.planMetresPerPixel());
  syncPlanSelection();
  return !!selection;
}

/** Delete, Esc and plan undo/redo while the edit bar is open; true when the key was used. */
export function planSelectionKey(event: KeyboardEvent): boolean {
  if (!editableProject() || !planEditBarOpen()) return false;
  const shortcut = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (shortcut === 'z' || shortcut === 'y')) {
    restorePlan(shortcut === 'y' || event.shiftKey ? 'redo' : 'undo');
    return true;
  }
  if (!selection || !planSelectionLive()) return false;
  if (event.key === 'Escape') {
    selection = undefined;
    syncPlanSelection();
    return true;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!event.repeat) removeSelection();
    return true;
  }
  return false;
}

let scope = '';

export function syncPlanSelection() {
  if (!inspector) return;
  // A plan edit reloads the project, passing through states where editing is off: the
  // selection survives as long as its level does.
  const current = `${app.current?.id}/${app.viewer.level.id}`;
  if (current !== scope || !planEditBarOpen() || wallToolActive()) selection = undefined;
  scope = current;
  const live = planSelectionLive();
  inspector.show(live ? app.viewer.level : undefined, live ? selection : undefined);
  // The selected element may have gone with an undo.
  if (live && selection && el('#plan-inspector').hidden) selection = undefined;
  renderPlanSelection();
}

/** Outlines the selection over the canvas; called again whenever the camera moves. */
export function renderPlanSelection() {
  const svg = document.querySelector<SVGSVGElement>('#plan-selection');
  if (!svg) return;
  const outline = selection && planSelectionLive() && selectionOutline(app.viewer.level, selection);
  svg.toggleAttribute('hidden', !outline);
  if (!outline) {
    if (svg.innerHTML) svg.innerHTML = '';
    return;
  }
  const project = app.viewer.projector();
  const points = outline
    .map((p) => {
      const q = project(p, 0);
      return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
    })
    .join(' ');
  svg.innerHTML = `<polygon class="plan-selection-outline ${selection!.kind}" points="${points}"/>`;
}

function selectionOutline(level: Level, target: PlanSelection): Point2[] | undefined {
  if (target.kind === 'room') return level.rooms.find((r) => r.id === target.id)?.polygon;
  const wall = level.walls.find(
    (w) => w.id === (target.kind === 'wall' ? target.id : target.wallId),
  );
  if (!wall) return;
  const opening =
    target.kind === 'opening' ? wall.openings?.find((o) => o.id === target.id) : undefined;
  if (target.kind === 'opening' && !opening) return;
  const [from, to] = opening
    ? [opening.offset, opening.offset + opening.width]
    : [0, wallLength(wall)];
  const half = wall.thickness / 2;
  return [
    alongWall(wall, from, -half),
    alongWall(wall, to, -half),
    alongWall(wall, to, half),
    alongWall(wall, from, half),
  ];
}
