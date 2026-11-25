import type { HouseProject, Point2 } from '../model/types';
import { enclosure, nextCorner } from '../model/wallChain';
import { polygonArea } from '../model/geometry';
import { validateProject } from '../model/validate';
import { area } from '../ui/format';
import { el, openDialog, closeDialog, pauseForDialog } from './dom';
import { installProjectDocument } from './projectLibrary';
import { openPlanEditBar } from './planEditBar';
import { rememberPlanEdit } from './planHistory';
import { setMode } from './viewChrome';
import { userMessage } from '../errorMessage';

export function openWallDrawing() {
  openDialog(
    'NOUVELLE MAISON',
    `<form id="wall-chain" class="plan-form"><h2>Dessiner les murs</h2>
    <p>Cliquez chaque angle. Les murs suivent des angles de 45° ; maintenez Maj pour un angle libre. Pour imposer une longueur, saisissez-la avant de pointer la direction. Cliquez sur le premier angle pour fermer la pièce.</p>
    <svg class="plan-sketch" viewBox="0 0 12 8" aria-label="Dessin des axes des murs"><polyline fill="none" stroke="#875335" stroke-width=".06"/><line stroke="#875335" stroke-dasharray=".12 .08" stroke-width=".04"/><g fill="#5e4231"></g></svg>
    <div class="plan-sketch-actions"><button type="button" class="text-button" id="chain-back">Retirer le dernier point</button><button type="button" class="text-button" id="chain-close">Fermer le contour</button><span id="chain-status" aria-live="polite"></span></div>
    <div class="plan-form-grid"><label>Longueur du prochain mur entre axes (m)<input type="number" name="length" min="0.001" step="any" placeholder="Libre"></label>
    <label>Épaisseur finie des murs (m)<input type="number" name="thickness" value="0.20" min="0.001" step="any" required></label>
    <label>Nom de la pièce<input name="room" required value="Séjour"></label></div>
    <div class="dialog-actions"><button type="button" class="text-button" id="chain-cancel">Annuler</button><button type="submit" class="primary-button" disabled>Créer la maison</button></div></form>`,
  );
  const form = el<HTMLFormElement>('#wall-chain');
  const svg = form.querySelector('svg')!;
  const field = (key: string) => form.elements.namedItem(key) as HTMLInputElement;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const status = el('#chain-status');
  const points: Point2[] = [];
  let closed = false;
  function draw() {
    const chain = closed ? [...points, points[0]] : points;
    svg.querySelector('polyline')!.setAttribute('points', chain.map((p) => p.join(',')).join(' '));
    svg.querySelector('g')!.innerHTML = points
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".09"/>`)
      .join('');
    svg.querySelector('line')!.setAttribute('visibility', 'hidden');
    el<HTMLButtonElement>('#chain-close').disabled = closed || points.length < 3;
    el<HTMLButtonElement>('#chain-back').disabled = !points.length;
    submit.disabled = true;
    status.textContent = '';
    if (closed) {
      try {
        const shape = enclosure(points, field('thickness').valueAsNumber);
        status.textContent = 'Surface intérieure : ' + area(polygonArea(shape.polygon));
        submit.disabled = false;
      } catch (error) {
        status.textContent = userMessage(error, 'Contour invalide.');
      }
    }
  }
  function target(event: PointerEvent): Point2 | undefined {
    const transform = svg.getScreenCTM();
    if (!transform) return;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    const p: Point2 = [local.x, local.y];
    const last = points.at(-1);
    if (!last) return p;
    const first = points[0];
    const typed = field('length').valueAsNumber;
    const near = (q: Point2, tolerance: number) =>
      points.length >= 3 && Math.hypot(q[0] - first[0], q[1] - first[1]) < tolerance;
    if (Number.isNaN(typed) && near(p, 0.18)) return first;
    const end = nextCorner(last, p, Number.isNaN(typed) ? undefined : typed, !event.shiftKey);
    return end && near(end, 1e-8) ? first : end;
  }
  svg.onpointermove = (event) => {
    if (closed || !points.length) return;
    const next = target(event);
    if (!next) return;
    const line = svg.querySelector('line')!,
      last = points[points.length - 1];
    for (const [key, value] of Object.entries({
      x1: last[0],
      y1: last[1],
      x2: next[0],
      y2: next[1],
      visibility: 'visible',
    }))
      line.setAttribute(key, String(value));
  };
  svg.onpointerdown = (event) => {
    if (event.button !== 0 || closed) return;
    const next = target(event);
    if (!next) return;
    if (next === points[0]) closed = true;
    else points.push(next);
    field('length').value = '';
    if (!closed) {
      const xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]);
      const left = Math.min(0, ...xs) - 0.2,
        top = Math.min(0, ...ys) - 0.2;
      svg.setAttribute(
        'viewBox',
        [left, top, Math.max(12, ...xs) - left + 0.2, Math.max(8, ...ys) - top + 0.2].join(' '),
      );
    }
    draw();
  };
  el('#chain-close').onclick = () => {
    closed = true;
    draw();
  };
  el('#chain-back').onclick = () => {
    if (!closed) points.pop();
    closed = false;
    draw();
  };
  el('#chain-cancel').onclick = closeDialog;
  field('thickness').oninput = draw;
  draw();
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!closed || submit.disabled) return;
    submit.disabled = true;
    try {
      const thickness = field('thickness').valueAsNumber;
      const { polygon, viewpoint, outline } = enclosure(points, thickness);
      const name = field('room').value.trim();
      const project: HouseProject = validateProject({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name,
        units: 'm',
        description: '',
        source: { title: 'Dessin en plan', status: 'Projet local', notes: [] },
        levels: [
          {
            id: 'level-1',
            name: 'Rez-de-chaussée',
            ceilingHeight: 2.5,
            elevation: 0,
            outline,
            lights: [],
            spawn: { position: viewpoint, yaw: 0 },
            rooms: [{ id: 'room-1', name, kind: 'living', polygon, label: viewpoint, viewpoint }],
            walls: points.map((start, i) => ({
              id: 'wall-' + (i + 1),
              start,
              end: points[(i + 1) % points.length],
              thickness,
              exterior: true,
            })),
          },
        ],
      });
      const blank = structuredClone(project);
      blank.levels[0].walls = [];
      blank.levels[0].rooms = [];
      if (await installProjectDocument({ project, staged: [], variants: undefined })) {
        rememberPlanEdit(blank, project);
        closeDialog();
        openPlanEditBar();
        setMode('plan');
      } else pauseForDialog(true);
    } catch (error) {
      status.textContent = userMessage(error, 'Création impossible.');
    } finally {
      submit.disabled = false;
    }
  };
}
