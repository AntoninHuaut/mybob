import { userMessage } from '../errorMessage';
import { alongWall, wallLength } from '../model/geometry';
import {
  addOpening,
  deleteOpening,
  deleteWall,
  pickPlan,
  setWallLength,
  setWallThickness,
  splitWall,
  updateOpening,
  updateRoom,
  type PlanSelection,
} from '../model/planEdit';
import type { Level, Point2 } from '../model/types';
import { GRID_STEPS_PER_METRE } from '../model/wallDraft';
import type { PlanPointerKind } from '../scene/viewer';
import { PlanInspector } from '../ui/planInspector';
import { el, toast } from './dom';
import { endDrag, moveDrag, renderDrag, startDrag } from './planDrag';
import { editableProject, planEditBarOpen, restorePlan, syncPlanEditBar } from './planEditBar';
import { applyPlanEdit } from './planHistory';
import { app } from './state';
import { stopWallTool, wallGridOn, wallToolActive } from './wallDrawing';

/** Pointer distance, in CSS pixels, within which a click still lands on a wall. */
const PICK_PIXELS = 6;
/** Pointer travel, in CSS pixels, beyond which a press is a pan: Babylon's own drag threshold. */
const CLICK_PIXELS = 10;

let selection: PlanSelection | undefined;
/** Where the selected wall was clicked, in metres from its start: « Couper » cuts there. */
let cutOffset: number | undefined;
let inspector: PlanInspector | undefined;
/** « Porte » or « Fenêtre » armed: the next click on a wall places one there. */
let placing: 'door' | 'window' | undefined;
/** Where the left button went down, in client pixels. */
let pressed: [number, number] | undefined;

export const placingOpening = () => placing;

export function togglePlacing(kind: 'door' | 'window') {
  if (!editableProject()) return;
  placing = placing === kind ? undefined : kind;
  if (placing) stopWallTool();
  syncPlanEditBar();
}

function place(kind: 'door' | 'window', at: Point2, tolerance: number) {
  const hit = pickPlan(app.viewer.level, at, tolerance);
  const wallId = hit?.kind === 'wall' ? hit.id : hit?.kind === 'opening' ? hit.wallId : undefined;
  const wall = app.viewer.level.walls.find((w) => w.id === wallId);
  if (!wall) {
    toast(
      kind === 'door'
        ? 'Cliquez sur un mur pour y placer la porte.'
        : 'Cliquez sur un mur pour y placer la fenêtre.',
    );
    return;
  }
  const along =
    ((at[0] - wall.start[0]) * (wall.end[0] - wall.start[0]) +
      (at[1] - wall.start[1]) * (wall.end[1] - wall.start[1])) /
    wallLength(wall);
  const id = crypto.randomUUID();
  try {
    const step = wallGridOn() ? 1 / GRID_STEPS_PER_METRE : undefined;
    edit((level) => addOpening(level, wall.id, kind, along, id, step));
    placing = undefined;
    selection = { kind: 'opening', wallId: wall.id, id };
  } catch (error) {
    toast(userMessage(error, 'Ouverture impossible ici.'));
  }
  syncPlanEditBar();
}

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
    onSplit: () => {
      const target = selection;
      if (target?.kind !== 'wall' || cutOffset === undefined) return;
      const offset = cutOffset;
      edit((level) => splitWall(level, target.id, offset));
    },
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

// A click is a left press released within CLICK_PIXELS, not Babylon's tap (see ARCHITECTURE).
export function selectionPointer(type: PlanPointerKind, at: Point2, event: PointerEvent) {
  const tolerance = PICK_PIXELS * app.viewer.planMetresPerPixel();
  if (type === 'down') pressed = event.button === 0 ? [event.clientX, event.clientY] : undefined;
  if (type === 'up') {
    const from = pressed;
    pressed = undefined;
    const apply = endDrag();
    if (apply) {
      try {
        edit(apply);
      } catch (error) {
        toast(userMessage(error, 'Déplacement impossible.'));
      }
      syncPlanSelection();
      return true;
    }
    const clicked =
      event.button === 0 &&
      !!from &&
      Math.hypot(event.clientX - from[0], event.clientY - from[1]) <= CLICK_PIXELS;
    if (!clicked) return false;
  }
  if (type === 'move') {
    moveDrag(at, event, tolerance);
    return false;
  }
  if (!planSelectionLive()) return false;
  // The click was handled on up: its tap must not reach the viewer's own handling.
  if (type === 'tap') return true;
  if (placing) {
    if (type === 'up') place(placing, at, tolerance);
    return type === 'up';
  }
  if (type === 'down') return startDrag(at, selection, tolerance);
  selection = pickPlan(app.viewer.level, at, tolerance);
  const wall =
    selection?.kind === 'wall' && app.viewer.level.walls.find((w) => w.id === selection!.id);
  cutOffset = wall
    ? Math.round(
        (at[0] - wall.start[0]) * ((wall.end[0] - wall.start[0]) / wallLength(wall)) * 100 +
          (at[1] - wall.start[1]) * ((wall.end[1] - wall.start[1]) / wallLength(wall)) * 100,
      ) / 100
    : undefined;
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
  if (placing && event.key === 'Escape') {
    placing = undefined;
    syncPlanEditBar();
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
  if (!planEditBarOpen() || wallToolActive() || !editableProject()) placing = undefined;
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
  const dragged = renderDrag();
  if (dragged !== undefined) {
    svg.innerHTML = dragged;
    return;
  }
  delete svg.dataset.dragState;
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
  let html = `<polygon class="plan-selection-outline ${selection!.kind}" points="${points}"/>`;
  const wall =
    selection!.kind === 'wall' && app.viewer.level.walls.find((w) => w.id === selection!.id);
  if (wall && cutOffset !== undefined) {
    const half = wall.thickness / 2 + 0.05;
    const [a, b] = [alongWall(wall, cutOffset, -half), alongWall(wall, cutOffset, half)].map((p) =>
      project(p, 0),
    );
    html += `<line class="plan-selection-cut" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`;
  }
  svg.innerHTML = html;
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
