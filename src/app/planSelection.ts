import { userMessage } from '../errorMessage';
import { alongWall, pointInPolygon, wallLength } from '../model/geometry';
import {
  deleteOpening,
  deleteWall,
  pickPlan,
  placeOpening,
  setWallLength,
  setWallThickness,
  splitWall,
  updateOpening,
  updateRoom,
  type OpeningPlacement,
  type PlanSelection,
} from '../model/planEdit';
import type { Level, Opening, Point2, Wall } from '../model/types';
import { GRID_STEPS_PER_METRE } from '../model/wallDraft';
import type { PlanPointerKind } from '../scene/viewer';
import { escapeHtml, number } from '../ui/format';
import { planToolForKey } from '../ui/planHint';
import { PlanInspector } from '../ui/planInspector';
import { el } from './dom';
import { endDrag, moveDrag, renderDrag, startDrag } from './planDrag';
import {
  editableProject,
  planEditBarOpen,
  planNotice,
  renderPlanHint,
  restorePlan,
  setPlanCursor,
  setPlanTool,
  syncPlanEditBar,
} from './planEditBar';
import { applyPlanEdit } from './planHistory';
import { app } from './state';
import { wallGridOn, wallToolActive } from './wallDrawing';

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
/** What « Porte » / « Fenêtre » would do at the pointer, drawn before the click. */
let hover: OpeningPlacement | undefined;
let hoverPoint: Point2 | undefined;

export const placingOpening = () => placing;
export const selectedKind = () => (planSelectionLive() ? selection?.kind : undefined);

/** Arms « Porte » or « Fenêtre »; the edit bar stops the wall tool first. */
export function setPlacing(kind: 'door' | 'window' | undefined) {
  placing = kind;
}

const openingStep = () => (wallGridOn() ? 1 / GRID_STEPS_PER_METRE : undefined);

function place(kind: 'door' | 'window', at: Point2, tolerance: number) {
  const id = crypto.randomUUID();
  hover = undefined;
  try {
    let wallId = '';
    edit((level) => {
      const placed = placeOpening(level, kind, at, tolerance, id, openingStep());
      if ('error' in placed) throw new Error(placed.error);
      wallId = placed.wallId;
      return placed.level;
    });
    // The tool stays armed to place several in a row; its panel shows the last one.
    selection = { kind: 'opening', wallId, id };
    planNotice(
      kind === 'door'
        ? 'Porte placée. Cliquez un autre mur pour en placer une autre, ou Échap pour la déplacer.'
        : 'Fenêtre placée. Cliquez un autre mur pour en placer une autre, ou Échap pour la déplacer.',
    );
  } catch (error) {
    planNotice(userMessage(error, 'Ouverture impossible ici.'), 'error');
  }
  syncPlanEditBar();
}

/** Previews « Porte » / « Fenêtre » under the pointer and shows what can be dragged. */
function hoverAt(at: Point2, tolerance: number) {
  const level = app.viewer.level;
  hoverPoint = at;
  hover = placing
    ? placeOpening(level, placing, at, tolerance, 'apercu', openingStep())
    : undefined;
  let cursor = '';
  if (placing) cursor = hover && 'error' in hover && hover.wallId ? 'not-allowed' : 'crosshair';
  else {
    const hit = pickPlan(level, at, tolerance);
    const corner = level.walls
      .flatMap((w) => [w.start, w.end])
      .some((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) <= tolerance);
    const onSelection =
      !!hit &&
      !!selection &&
      hit.kind !== 'room' &&
      JSON.stringify(hit) === JSON.stringify(selection);
    cursor = corner || onSelection ? 'move' : hit ? 'pointer' : '';
  }
  setPlanCursor(cursor);
  renderPlanSelection();
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
    planNotice(target.kind === 'wall' ? 'Mur supprimé.' : 'Ouverture supprimée.');
  } catch (error) {
    planNotice(userMessage(error, 'Suppression impossible.'), 'error');
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
        planNotice(userMessage(error, 'Déplacement impossible.'), 'error');
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
    if (planSelectionLive()) hoverAt(at, tolerance);
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

/** Tool keys, Delete, Esc and plan undo/redo while the edit bar is open; true when used. */
export function planSelectionKey(event: KeyboardEvent): boolean {
  if (!editableProject() || !planEditBarOpen()) return false;
  const shortcut = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (shortcut === 'z' || shortcut === 'y')) {
    restorePlan(shortcut === 'y' || event.shiftKey ? 'redo' : 'undo');
    return true;
  }
  const tool = planToolForKey(event);
  if (tool && !app.viewer.measureMode) {
    if (!event.repeat) setPlanTool(tool);
    return true;
  }
  if (placing && event.key === 'Escape') {
    setPlanTool('select');
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
  // selection and an armed « Porte » / « Fenêtre » survive as long as their level does.
  const current = `${app.current?.id}/${app.viewer.level.id}`;
  if (current !== scope || !planEditBarOpen() || wallToolActive()) {
    selection = undefined;
    placing = undefined;
  }
  scope = current;
  const live = planSelectionLive();
  inspector.show(live ? app.viewer.level : undefined, live ? selection : undefined);
  // The selected element may have gone with an undo.
  if (live && selection && el('#plan-inspector').hidden) selection = undefined;
  renderPlanSelection();
  renderPlanHint();
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
  const live = planSelectionLive();
  svg.toggleAttribute('hidden', !live);
  if (!live) {
    if (svg.innerHTML) svg.innerHTML = '';
    return;
  }
  const level = app.viewer.level;
  const project = app.viewer.projector();
  const xy = (p: Point2) => {
    const q = project(p, 0);
    return [q.x.toFixed(1), q.y.toFixed(1)] as const;
  };
  const points = (polygon: Point2[]) => polygon.map((p) => xy(p).join(',')).join(' ');
  let html = '';
  // Every corner can be dragged with Sélection: it shows as a handle.
  if (!placing) {
    const corners = new Map<string, Point2>();
    for (const w of level.walls) for (const p of [w.start, w.end]) corners.set(p.join(','), p);
    for (const p of corners.values()) {
      const [x, y] = xy(p);
      html += `<rect class="plan-handle" x="${(Number(x) - 4).toFixed(1)}" y="${(Number(y) - 4).toFixed(1)}" width="8" height="8"/>`;
    }
  }
  const target = selection;
  const outline = target && selectionOutline(level, target);
  if (target && outline) {
    html += `<polygon class="plan-selection-outline ${target.kind}" points="${points(outline)}"/>`;
    const wallId =
      target.kind === 'wall' ? target.id : target.kind === 'opening' ? target.wallId : '';
    const wall = level.walls.find((w) => w.id === wallId);
    if (wall && target.kind === 'wall') {
      html += dimensions(level, wall, [], xy);
      if (cutOffset !== undefined) {
        const half = wall.thickness / 2 + 0.05;
        const [a, b] = [alongWall(wall, cutOffset, -half), alongWall(wall, cutOffset, half)].map(
          xy,
        );
        html += `<line class="plan-selection-cut" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
      }
    }
    const opening =
      wall && target.kind === 'opening'
        ? wall.openings?.find((o) => o.id === target.id)
        : undefined;
    if (wall && opening) html += dimensions(level, wall, [opening], xy);
  }
  if (placing && hover && hoverPoint) {
    if ('opening' in hover) {
      const wall = hover.level.walls.find((w) => w.id === hover!.wallId)!;
      const { offset, width } = hover.opening;
      const half = wall.thickness / 2 + 0.03;
      const ghost = [
        alongWall(wall, offset, -half),
        alongWall(wall, offset + width, -half),
        alongWall(wall, offset + width, half),
        alongWall(wall, offset, half),
      ];
      html += `<polygon class="plan-ghost" points="${points(ghost)}"/>`;
      html += dimensions(level, wall, [hover.opening], xy);
    } else if (hover.wallId) {
      const [x, y] = xy(hoverPoint);
      html += `<text id="plan-ghost-message" class="plan-drag-message" x="${(Number(x) + 14).toFixed(1)}" y="${(Number(y) - 14).toFixed(1)}">${escapeHtml(hover.error)}</text>`;
    }
  }
  if (svg.innerHTML !== html) svg.innerHTML = html;
}

/**
 * Chain of dimensions along a wall, on its side away from the rooms when it has one: the
 * whole length, or the gaps around an opening and its width.
 */
function dimensions(
  level: Level,
  wall: Wall,
  openings: Opening[],
  xy: (p: Point2) => readonly [string, string],
) {
  const length = wallLength(wall);
  const gap = wall.thickness / 2 + 0.3;
  const middle = alongWall(wall, length / 2, gap);
  const side = level.rooms.some((r) => pointInPolygon(middle, r.polygon)) ? -gap : gap;
  const stops = [0];
  for (const o of openings) stops.push(o.offset, o.offset + o.width);
  stops.push(length);
  let html = '';
  for (let i = 1; i < stops.length; i++) {
    const [from, to] = [stops[i - 1], stops[i]];
    if (to - from < 0.01) continue;
    const [a, b] = [alongWall(wall, from, side), alongWall(wall, to, side)].map(xy);
    const [ta, tb] = [alongWall(wall, from, side * 0.6), alongWall(wall, to, side * 0.6)].map(xy);
    const mid = xy(alongWall(wall, (from + to) / 2, side));
    const label = xy(alongWall(wall, (from + to) / 2, side * 1.45));
    // Beside a vertical line the text starts at the line instead of straddling it.
    const [dx, dy] = [Number(label[0]) - Number(mid[0]), Number(label[1]) - Number(mid[1])];
    const anchor = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'start' : 'end') : 'middle';
    const at = anchor === 'middle' ? label : [Number(mid[0]) + Math.sign(dx) * 6, Number(mid[1])];
    html +=
      `<path class="plan-dimension" d="M${a.join(',')}L${b.join(',')}M${ta.join(',')}L${a.join(',')}M${tb.join(',')}L${b.join(',')}"/>` +
      `<text class="plan-dimension-label" text-anchor="${anchor}" x="${at[0]}" y="${at[1]}">${number(to - from)} m</text>`;
  }
  return html;
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
