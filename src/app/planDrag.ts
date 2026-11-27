import { getBuildingPlacementIssues } from '../furniture/placement';
import { footprint } from '../furniture/model';
import { userMessage } from '../errorMessage';
import { alongWall, polygonArea, wallLength } from '../model/geometry';
import { moveCorner, moveOpening, moveWall, pickPlan, type PlanSelection } from '../model/planEdit';
import type { Level, Point2, Wall } from '../model/types';
import { GRID_STEPS_PER_METRE, snapDraftPoint } from '../model/wallDraft';
import { area, centimetres, escapeHtml } from '../ui/format';
import { committedFurniture } from './furnitureController';
import { app } from './state';
import { wallGridOn } from './wallDrawing';

type Drag =
  | { kind: 'wall'; id: string; origin: Point2; normal: Point2 }
  | { kind: 'corner'; from: Point2 }
  | { kind: 'opening'; wallId: string; id: string; origin: Point2; offset: number };

interface Preview {
  /** The level as it would be saved on release; absent while the geometry is refused. */
  level?: Level;
  /** The same edit, replayed on the stored project's level on release. */
  apply?: (level: Level) => Level;
  /** What the pointer asks for, drawn in red when refused. */
  walls: Wall[];
  opening?: { wall: Wall; offset: number; width: number };
  error?: string;
  furniture: { names: string[]; outlines: Point2[][] };
}

let drag: Drag | undefined;
let preview: Preview | undefined;
let pointer: Point2 | undefined;

export const dragging = () => !!drag;

/**
 * A press on the selected opening drags it along its wall, on a corner drags the corner, on
 * the selected wall drags it across its axis. The camera stops panning until release.
 */
export function startDrag(at: Point2, selection: PlanSelection | undefined, tolerance: number) {
  const level = app.viewer.level;
  const hit = pickPlan(level, at, tolerance);
  if (selection?.kind === 'opening' && hit?.kind === 'opening' && hit.id === selection.id) {
    const opening = level.walls
      .find((w) => w.id === selection.wallId)
      ?.openings?.find((o) => o.id === selection.id);
    if (!opening) return false;
    drag = {
      kind: 'opening',
      wallId: selection.wallId,
      id: opening.id,
      origin: at,
      offset: opening.offset,
    };
    preview = undefined;
    app.viewer.orbit.detachControl();
    return true;
  }
  const corner = level.walls
    .flatMap((w) => [w.start, w.end])
    .find((p) => Math.hypot(p[0] - at[0], p[1] - at[1]) <= tolerance);
  if (corner) drag = { kind: 'corner', from: corner };
  else if (selection?.kind === 'wall') {
    const wall = level.walls.find((w) => w.id === selection.id);
    if (!wall || hit?.kind !== 'wall' || hit.id !== wall.id) return false;
    const length = wallLength(wall);
    const normal: Point2 = [
      -(wall.end[1] - wall.start[1]) / length,
      (wall.end[0] - wall.start[0]) / length,
    ];
    drag = { kind: 'wall', id: wall.id, origin: at, normal };
  } else return false;
  preview = undefined;
  app.viewer.orbit.detachControl();
  return true;
}

export function moveDrag(at: Point2, event: PointerEvent, tolerance: number) {
  if (!drag) return;
  pointer = at;
  const level = app.viewer.level;
  let apply: (level: Level) => Level;
  let walls: Wall[] = [];
  let opening: Preview['opening'];
  const snap = (value: number) =>
    wallGridOn() ? Math.round(value * GRID_STEPS_PER_METRE) / GRID_STEPS_PER_METRE : value;
  if (drag.kind === 'opening') {
    const { wallId, id, origin } = drag;
    const wall = level.walls.find((w) => w.id === wallId)!;
    const source = wall.openings!.find((o) => o.id === id)!;
    const length = wallLength(wall);
    const along =
      ((at[0] - origin[0]) * (wall.end[0] - wall.start[0]) +
        (at[1] - origin[1]) * (wall.end[1] - wall.start[1])) /
      length;
    const offset = snap(drag.offset + along);
    opening = { wall, offset, width: source.width };
    apply = (l) => moveOpening(l, wallId, id, offset);
  } else if (drag.kind === 'wall') {
    const { id, origin, normal } = drag;
    const raw = (at[0] - origin[0]) * normal[0] + (at[1] - origin[1]) * normal[1];
    const delta = snap(raw);
    const shift = (p: Point2): Point2 => [p[0] + normal[0] * delta, p[1] + normal[1] * delta];
    walls = level.walls
      .filter((w) => w.id === id)
      .map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) }));
    apply = (l) => moveWall(l, id, delta);
  } else {
    const { from } = drag;
    const touching = (w: Wall) =>
      [w.start, w.end].some((p) => p[0] === from[0] && p[1] === from[1]);
    const to = snapDraftPoint(
      level.walls.filter((w) => !touching(w)),
      at,
      { angle: false, grid: wallGridOn(), tolerance },
    ).point;
    const follow = (p: Point2) => (p[0] === from[0] && p[1] === from[1] ? to : p);
    walls = level.walls
      .filter(touching)
      .map((w) => ({ ...w, start: follow(w.start), end: follow(w.end) }));
    apply = (l) => moveCorner(l, from, to);
  }
  try {
    const next = apply(level);
    const furniture = opening ? none() : blockedFurniture(next);
    preview = { level: next, apply, walls, opening, furniture };
  } catch (error) {
    const message = userMessage(error, 'Déplacement impossible.');
    preview = { walls, opening, error: message, furniture: none() };
  }
  const svg = document.querySelector<SVGSVGElement>('#plan-selection');
  if (svg) {
    svg.innerHTML = dragSvg();
    svg.removeAttribute('hidden');
    svg.dataset.dragState = preview.level ? 'valid' : 'invalid';
    svg.dataset.previewLatencyMs = (performance.now() - event.timeStamp).toFixed(1);
  }
}

/** Ends the drag: the edit of the last preview, if it was valid, is the one to save. */
export function endDrag(): ((level: Level) => Level) | undefined {
  if (!drag) return;
  const result = preview?.apply;
  drag = undefined;
  preview = undefined;
  if (app.viewer.mode !== 'walk') app.viewer.orbit.attachControl(app.viewer.canvas, true);
  return result;
}

const none = () => ({ names: [], outlines: [] });

/** Furniture of every arrangement that a moved wall now crosses: listed, never moved. */
function blockedFurniture(next: Level): Preview['furniture'] {
  const project = app.current;
  const level = app.viewer.level;
  const changed = next.walls.filter((w) => !level.walls.includes(w));
  if (!changed.length) return none();
  const probe = { ...next, walls: changed };
  const book = app.layoutSession.book(project.id);
  const names: string[] = [];
  const outlines: Point2[][] = [];
  for (const variant of book.variants) {
    const items =
      variant.id === book.activeId ? committedFurniture() : (variant.levels[level.id] ?? []);
    for (const item of items) {
      if (!getBuildingPlacementIssues(item, probe).some((issue) => issue.code === 'wall')) continue;
      names.push(book.variants.length > 1 ? `${variant.name} · ${item.name}` : item.name);
      if (variant.id === book.activeId) outlines.push(footprint(item));
    }
  }
  return { names, outlines };
}

function dragSvg() {
  if (!preview) return '';
  const project = app.viewer.projector();
  const points = (polygon: Point2[]) =>
    polygon
      .map((p) => {
        const q = project(p, 0);
        return `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
      })
      .join(' ');
  const valid = !!preview.level;
  let html = '';
  if (preview.level) {
    const before = new Map(app.viewer.level.rooms.map((r) => [r.id, r.polygon]));
    for (const room of preview.level.rooms) {
      if (before.get(room.id) === room.polygon) continue;
      html += `<polygon class="plan-drag-room" points="${points(room.polygon)}"/>`;
      const q = project(room.label, 0);
      html += `<text class="plan-drag-area" data-room="${escapeHtml(room.id)}" x="${q.x.toFixed(1)}" y="${q.y.toFixed(1)}">${escapeHtml(room.name)} · ${area(polygonArea(room.polygon))}</text>`;
    }
  }
  for (const outline of preview.furniture.outlines)
    html += `<polygon class="plan-drag-furniture" points="${points(outline)}"/>`;
  for (const wall of preview.walls) {
    const length = wallLength(wall);
    if (!(length > 0)) continue;
    const half = wall.thickness / 2;
    const outline = [
      alongWall(wall, 0, -half),
      alongWall(wall, length, -half),
      alongWall(wall, length, half),
      alongWall(wall, 0, half),
    ];
    html += `<polygon class="plan-drag-wall${valid ? '' : ' invalid'}" points="${points(outline)}"/>`;
  }
  if (preview.opening) {
    const { wall, offset, width } = preview.opening;
    const half = wall.thickness / 2 + 0.03;
    const outline = [
      alongWall(wall, offset, -half),
      alongWall(wall, offset + width, -half),
      alongWall(wall, offset + width, half),
      alongWall(wall, offset, half),
    ];
    html += `<polygon class="plan-drag-wall${valid ? '' : ' invalid'}" points="${points(outline)}"/>`;
    const q = project(alongWall(wall, offset + width / 2, half + 0.25), 0);
    const rest = wallLength(wall) - offset - width;
    html += `<text id="plan-drag-distances" class="plan-drag-area" x="${q.x.toFixed(1)}" y="${q.y.toFixed(1)}">${centimetres(offset)} · ${centimetres(rest)}</text>`;
  }
  const message =
    preview.error ??
    (preview.furniture.names.length
      ? `Meubles gênés : ${preview.furniture.names.join(', ')}`
      : undefined);
  if (message && pointer) {
    const q = project(pointer, 0);
    html += `<text id="plan-drag-message" class="plan-drag-message${valid ? ' warning' : ''}" x="${(q.x + 14).toFixed(1)}" y="${(q.y - 14).toFixed(1)}">${escapeHtml(message)}</text>`;
  }
  return html;
}

export function renderDrag() {
  return drag ? dragSvg() : undefined;
}
