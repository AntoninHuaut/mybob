import { userMessage } from '../errorMessage';
import type { PlanPointerKind } from '../scene/viewer';
import type { Point2 } from '../model/types';
import { nextCorner } from '../model/wallChain';
import { addWallChain, emptyHouse, snapDraftPoint, type DraftSnap } from '../model/wallDraft';
import { number } from '../ui/format';
import { el, toast } from './dom';
import {
  editableProject,
  openPlanEditBar,
  planNotice,
  renderPlanHint,
  setPlanCursor,
  setPlanTool,
  syncPlanEditBar,
} from './planEditBar';
import { applyPlanEdit } from './planHistory';
import { installProjectDocument } from './projectLibrary';
import { app } from './state';
import { setMode, setSidebar, syncDisplayControls } from './viewChrome';

/** Pointer distance, in CSS pixels, within which a corner or a wall attracts the draft. */
const SNAP_PIXELS = 12;
const R = Math.SQRT1_2;
const COMPASS: Point2[] = [
  [1, 0],
  [R, R],
  [0, 1],
  [-R, R],
  [-1, 0],
  [-R, -R],
  [0, -1],
  [R, -R],
];
const ARROWS: Record<string, Point2> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

let active = false;
let grid = true;
let points: Point2[] = [];
let cursor: DraftSnap | undefined;
let pointer: Point2 | undefined;
let free = false;
let typed = '';

export const wallToolActive = () => active;
/** Armed and on screen: Plan, a local project, the edit bar open, « Mesurer » off. */
export const wallToolLive = () => active && !el('#plan-edit-bar').hidden && !app.viewer.measureMode;
export const wallGridOn = () => grid;

/** What the hint needs: corners drawn, and what a click at the pointer would do. */
export function wallDraftState(): { corners: number; target?: 'close' | 'join' } {
  if (!wallToolLive() || !points.length || !cursor || typed) return { corners: points.length };
  if (closes(cursor.point)) return { corners: points.length, target: 'close' };
  if (cursor.kind === 'corner' || cursor.kind === 'wall')
    return { corners: points.length, target: 'join' };
  return { corners: points.length };
}

const closes = (p: Point2) => {
  const first = points[0];
  return points.length >= 3 && !!first && Math.hypot(p[0] - first[0], p[1] - first[1]) < 1e-9;
};

export function startWallTool() {
  if (!editableProject()) return;
  active = true;
  points = [];
  typed = '';
  el<HTMLInputElement>('#wall-thickness').value = app.viewer.level.walls.length ? '0.10' : '0.20';
  syncDisplayControls();
  render();
}

export function stopWallTool() {
  if (!active) return;
  active = false;
  points = [];
  cursor = undefined;
  typed = '';
  syncDisplayControls();
  render();
}

export function toggleWallGrid() {
  grid = !grid;
  syncPlanEditBar();
  render();
}

/** « Nouvelle maison »: an empty local house, opened in Plan with the wall tool on. */
export async function startNewHouse() {
  try {
    const project = emptyHouse(crypto.randomUUID());
    if (!(await installProjectDocument({ project, staged: [], variants: undefined }))) return;
    openPlanEditBar();
    // On a narrow screen the project drawer covers the plan to draw on.
    if (!matchMedia('(min-width: 761px)').matches) setSidebar(false);
    setMode('plan');
    setPlanTool('wall');
  } catch (error) {
    toast(userMessage(error, 'Création impossible.'));
  }
}

function snap(at: Point2): DraftSnap {
  return snapDraftPoint(app.viewer.level.walls, at, {
    last: points.at(-1),
    corners: points.length >= 3 ? [points[0]] : [],
    angle: !free,
    grid,
    tolerance: SNAP_PIXELS * app.viewer.planMetresPerPixel(),
  });
}

export function wallPointer(type: PlanPointerKind, at: Point2, event: PointerEvent) {
  if (!wallToolLive() || type === 'down' || type === 'up') return false;
  pointer = at;
  free = event.shiftKey;
  setPlanCursor('crosshair');
  cursor = snap(at);
  if (type === 'tap') addCorner(cursor);
  render();
  return true;
}

function addCorner(target: DraftSnap) {
  const p = target.point;
  if (closes(p)) {
    commit(true);
    return;
  }
  const last = points.at(-1);
  if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-9) return;
  points.push(p);
  typed = '';
  // Reaching an existing wall ends a partition there.
  if (points.length >= 2 && onExistingWall(p)) commit(false);
}

function onExistingWall(p: Point2) {
  const hit = snapDraftPoint(app.viewer.level.walls, p, {
    angle: false,
    grid: false,
    tolerance: 1e-6,
  });
  return hit.kind === 'corner' || hit.kind === 'wall';
}

function commit(closed: boolean) {
  const project = editableProject();
  const chain = points;
  points = [];
  typed = '';
  if (!project) return;
  try {
    const levelId = app.viewer.level.id;
    const thickness = el<HTMLInputElement>('#wall-thickness').valueAsNumber;
    const levels = project.levels.map((level) =>
      level.id === levelId ? addWallChain(level, chain, closed, thickness) : level,
    );
    applyPlanEdit(project, { ...project, levels });
    el<HTMLInputElement>('#wall-thickness').value = '0.10';
    planNotice(
      closed
        ? 'Pièce fermée. Tracez les cloisons en partant d’un mur, puis placez portes et fenêtres.'
        : 'Murs ajoutés.',
    );
  } catch (error) {
    planNotice(userMessage(error, 'Ces murs ne peuvent pas être ajoutés.'), 'error');
  }
  render();
}

/** Typed digits fix the next length; Enter follows the pointer, an arrow key its direction. */
export function wallToolKey(event: KeyboardEvent): boolean {
  if (!wallToolLive()) return false;
  const key = event.key;
  if (key === 'Escape') {
    if (points.length) points = [];
    else setPlanTool('select');
  } else if (/^[0-9]$/.test(key) || ((key === '.' || key === ',') && !typed.includes('.'))) {
    if (!points.length) return false;
    typed += key === ',' ? '.' : key;
  } else if (key === 'Backspace') {
    if (typed) typed = typed.slice(0, -1);
    else points.pop();
  } else if (key === 'Enter') {
    if (typed) placeTyped();
    else if (points.length >= 2) commit(false);
    else return false;
  } else if (key in ARROWS && typed) {
    placeTyped(screenDirection(ARROWS[key]));
  } else return false;
  render();
  return true;
}

function placeTyped(direction?: Point2) {
  const last = points.at(-1);
  const length = Number(typed);
  if (!last || !(length > 0)) return;
  const toward = direction ? [last[0] + direction[0], last[1] + direction[1]] : pointer;
  if (!toward) return;
  const end = nextCorner(last, toward as Point2, length, direction ? true : !free);
  if (end) addCorner({ point: end, kind: 'free' });
}

/** The plan direction among the eight 45° steps that best matches an on-screen direction. */
function screenDirection([sx, sy]: Point2): Point2 {
  const project = app.viewer.projector();
  const origin = points.at(-1)!;
  const o = project(origin);
  let best: Point2 = [1, 0];
  let score = -Infinity;
  for (const d of COMPASS) {
    const q = project([origin[0] + d[0], origin[1] + d[1]]);
    const len = Math.hypot(q.x - o.x, q.y - o.y);
    const s = ((q.x - o.x) * sx + (q.y - o.y) * sy) / len;
    if (s > score) [best, score] = [d, s];
  }
  return best;
}

/** Draws the grid, the chain, the rubber band and its length over the canvas. */
export function render() {
  const svg = document.querySelector<SVGSVGElement>('#wall-draft')!;
  const live = wallToolLive();
  svg.toggleAttribute('hidden', !live);
  renderPlanHint();
  if (!live) return;
  const viewer = app.viewer;
  const project = viewer.projector();
  const at = (p: Point2) => {
    const q = project(p, 0);
    return { x: q.x.toFixed(1), y: q.y.toFixed(1) };
  };
  const pair = (p: Point2) => `${at(p).x},${at(p).y}`;
  let html = '';
  if (grid) html += gridPath(pair);
  // Existing corners a new wall can join; `data-point` keeps their plan position.
  const joints = new Map<string, Point2>();
  for (const w of viewer.level.walls) for (const p of [w.start, w.end]) joints.set(p.join(','), p);
  for (const [key, p] of joints) {
    const { x, y } = at(p);
    html += `<circle class="wall-draft-joint" cx="${x}" cy="${y}" r="3.5" data-point="${key}"/>`;
  }
  const last = points.at(-1);
  const preview = last && cursor ? previewEnd(last) : undefined;
  const thickness = el<HTMLInputElement>('#wall-thickness').valueAsNumber || 0.1;
  // Walls show with their real thickness, centred on the axis being drawn.
  const band = (a: Point2, b: Point2) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(length > 0)) return '';
    const [nx, ny] = [
      ((a[1] - b[1]) / length) * (thickness / 2),
      ((b[0] - a[0]) / length) * (thickness / 2),
    ];
    return [
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ]
      .map((p) => pair(p as Point2))
      .join(' ');
  };
  const { target } = wallDraftState();
  if (target === 'close')
    html += `<polygon class="wall-draft-fill" points="${points.map(pair).join(' ')}"/>`;
  for (let i = 1; i < points.length; i++)
    html += `<polygon class="wall-draft-chain" points="${band(points[i - 1], points[i])}"/>`;
  if (last && preview) {
    html += `<polygon class="wall-draft-band" points="${band(last, preview)}"/>`;
    const [a, b] = [at(last), at(preview)];
    html += `<line class="wall-draft-axis" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
  }
  for (const p of points) {
    const { x, y } = at(p);
    html += `<circle class="wall-draft-corner" cx="${x}" cy="${y}" r="4"/>`;
  }
  if (cursor && !typed) {
    const { x, y } = at(cursor.point);
    html += `<circle class="wall-draft-snap ${target ?? cursor.kind}" cx="${x}" cy="${y}" r="7"/>`;
    // What the click will do, by the pointer: a newcomer reads it where they look.
    const label =
      target === 'close'
        ? 'Fermer la pièce'
        : target === 'join'
          ? 'Terminer ici'
          : !points.length && (cursor.kind === 'wall' || cursor.kind === 'corner')
            ? 'Commencer une cloison ici'
            : '';
    if (label)
      html += `<text id="wall-draft-target" class="wall-draft-target" x="${(Number(x) + 12).toFixed(1)}" y="${(Number(y) - 12).toFixed(1)}">${label}</text>`;
  }
  if (last && preview) {
    const length = Math.hypot(preview[0] - last[0], preview[1] - last[1]);
    const middle = project([(last[0] + preview[0]) / 2, (last[1] + preview[1]) / 2], 0);
    const text = typed ? `${typed.replace('.', ',')} m` : `${number(length)} m`;
    html += `<text id="wall-draft-length" class="wall-draft-length${typed ? ' typed' : ''}" x="${middle.x.toFixed(1)}" y="${(middle.y - 10).toFixed(1)}">${text}</text>`;
  }
  svg.innerHTML = html;
}

/** One-metre lines over the visible part of the plan; the snap itself is 5 cm. */
function gridPath(pair: (p: Point2) => string) {
  const viewer = app.viewer;
  const a = viewer.groundPoint(0, 0);
  const b = viewer.groundPoint(viewer.canvas.clientWidth, viewer.canvas.clientHeight);
  if (!a || !b) return '';
  const [x0, x1] = [a[0], b[0]].sort((u, v) => u - v);
  const [z0, z1] = [a[1], b[1]].sort((u, v) => u - v);
  if (x1 - x0 + z1 - z0 > 400) return '';
  let d = '';
  for (let x = Math.ceil(x0); x <= x1; x++) d += `M${pair([x, z0])}L${pair([x, z1])}`;
  for (let z = Math.ceil(z0); z <= z1; z++) d += `M${pair([x0, z])}L${pair([x1, z])}`;
  return `<path class="wall-draft-grid" d="${d}"/>`;
}

function previewEnd(last: Point2): Point2 | undefined {
  if (!typed) return cursor?.point;
  const length = Number(typed);
  if (!pointer || !(length > 0)) return cursor?.point;
  return nextCorner(last, pointer, length, !free) ?? cursor?.point;
}
