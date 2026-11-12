import type { Level, Point2 } from '../model/types';
import { bounds, floorElevationAt, pointInPolygon, polygonArea } from '../model/geometry';
import type { HouseViewer, FrameInfo } from '../scene/viewer';
import { number } from './format';
import { layoutLabels, type LabelBox, type LabelRect } from './labelLayout';
import type { MeasureBar } from './measureBar';

type ProjectedView = Pick<
  HouseViewer,
  'mode' | 'level' | 'measureMode' | 'measurement' | 'project'
>;
interface ProjectionPreferences {
  showLabels: boolean;
  showDimensions: boolean;
  selectedRoomId?: string;
  northAngleDeg: number;
}

/** Projects scene information into viewport labels and walk HUD; owns no application state. */
export class ViewportProjection {
  private labelsDirty = true;
  private preferencesSignature = '';
  private projectedLevel?: Level;
  private readonly roomLabels = new Map<string, HTMLElement>();

  constructor(
    private readonly viewport: HTMLElement,
    private readonly measureBar: Pick<MeasureBar, 'moveTo'>,
    private readonly getFurnitureObstacles: () => LabelRect[],
  ) {
    for (const event of [
      'click',
      'input',
      'change',
      'pointerup',
      'keydown',
      'keyup',
      'pointercancel',
    ])
      viewport.ownerDocument.addEventListener(event, () => {
        this.labelsDirty = true;
      });
    if (typeof ResizeObserver !== 'undefined')
      new ResizeObserver(() => {
        this.labelsDirty = true;
      }).observe(viewport);
  }

  private readonly element = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    this.viewport.querySelector<T>(selector)!;

  private roomLabelElement(id: string): HTMLElement | undefined {
    const cached = this.roomLabels.get(id);
    if (cached && this.viewport.contains(cached)) return cached;
    const found = Array.from(this.viewport.querySelectorAll<HTMLElement>('[data-label]')).find(
      (label) => label.dataset.label === id,
    );
    if (found) this.roomLabels.set(id, found);
    else this.roomLabels.delete(id);
    return found;
  }

  update(viewer: ProjectedView, frame: FrameInfo, preferences: ProjectionPreferences): void {
    const el = this.element;
    const { showLabels, showDimensions, selectedRoomId, northAngleDeg } = preferences;
    const labelsVisible = viewer.mode !== 'walk' && showLabels && !viewer.measureMode;
    el('#orientation-arrow').style.transform = `rotate(${frame.planUpDegrees + northAngleDeg}deg)`;
    const signature = JSON.stringify([
      preferences,
      viewer.mode,
      viewer.measureMode,
      viewer.measurement,
      frame.furnitureObstaclesRevision,
    ]);
    const projectLabels =
      frame.cameraMoved !== false ||
      this.labelsDirty ||
      signature !== this.preferencesSignature ||
      viewer.level !== this.projectedLevel;
    this.labelsDirty = false;
    this.preferencesSignature = signature;
    this.projectedLevel = viewer.level;
    if (projectLabels) {
      const planLabels: {
        id: string;
        label: HTMLElement;
        x: number;
        y: number;
        room?: Point2[];
      }[] = [];
      for (const room of viewer.level.rooms) {
        const label = this.roomLabelElement(room.id);
        if (!label) continue;
        if (labelsVisible) {
          const p = viewer.project(room.label, (room.floorOffset ?? 0) + 0.04);
          label.hidden =
            !p.visible ||
            (viewer.mode === 'overview' &&
              (room.planArea ?? polygonArea(room.polygon)) < 3 &&
              selectedRoomId !== room.id);
          label.style.left = `${p.x}px`;
          label.style.top = `${p.y}px`;
          label.style.setProperty('--label-scale', '1');
          if (viewer.mode === 'plan' && !label.hidden) {
            // The layout may nudge the label, never out of its own room on screen. A label
            // anchored outside its polygon on purpose is not confined.
            const outline = room.polygon.map((corner) => {
              const c = viewer.project(corner, (room.floorOffset ?? 0) + 0.04);
              return [c.x, c.y] as Point2;
            });
            planLabels.push({
              id: room.id,
              label,
              x: p.x,
              y: p.y,
              room: pointInPolygon([p.x, p.y], outline) ? outline : undefined,
            });
          }
        }
      }
      // Sizes are read only once every label is written: one layout for the whole
      // frame, where a read after each write forced one layout per room.
      const labelBoxes: LabelBox[] = planLabels.map(({ id, label, x, y, room }) => ({
        id,
        x,
        y,
        room,
        width: label.offsetWidth,
        height: label.offsetHeight,
        priority: selectedRoomId === id ? 10 : 0,
      }));
      if (viewer.mode === 'plan' && labelBoxes.length) {
        const viewport = this.viewport;
        const origin = viewport.getBoundingClientRect();
        const obstacles = this.getFurnitureObstacles();
        for (const selector of [
          '.viewport-top',
          '.floating-tools',
          '.mini-card',
          '.bottom-controls',
          '.solar-timeline',
          '#furniture-context-toolbar',
          '#navigation-panel',
        ]) {
          const element = viewport.querySelector<HTMLElement>(selector);
          if (!element || element.hidden || !element.offsetWidth || !element.offsetHeight) continue;
          const rect = element.getBoundingClientRect();
          obstacles.push({
            x: rect.left - origin.left,
            y: rect.top - origin.top,
            width: rect.width,
            height: rect.height,
          });
        }
        for (const placed of layoutLabels(labelBoxes, obstacles, {
          width: viewport.clientWidth,
          height: viewport.clientHeight,
        })) {
          const label = this.roomLabelElement(placed.id)!;
          label.hidden = !placed.visible;
          label.style.left = `${placed.x}px`;
          label.style.top = `${placed.y}px`;
          label.style.setProperty('--label-scale', String(placed.scale));
        }
      }
      if (showDimensions && viewer.mode !== 'walk') {
        const b = bounds(viewer.level.outline);
        for (const [id, point, value] of [
          ['width-label', [b.center[0], b.maxZ + 0.6], b.width],
          ['depth-label', [b.maxX + 0.6, b.center[1]], b.depth],
        ] as [string, [number, number], number][]) {
          const pos = viewer.project(point);
          const element = el(`#${id}`);
          element.textContent = `${number(value)} m`;
          element.hidden = !pos.visible;
          element.style.left = `${pos.x}px`;
          element.style.top = `${pos.y}px`;
        }
      }
      if (viewer.measurement?.b) {
        const { a, b } = viewer.measurement;
        const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const p = viewer.project(
          midpoint,
          floorElevationAt(viewer.level, midpoint) - viewer.level.elevation + 0.1,
        );
        this.measureBar.moveTo(p);
      }
    }
    if (viewer.mode === 'walk') {
      el('#door-prompt').hidden = !frame.nearDoor || !el('#walk-start').hidden;
      el('#furniture-edit-prompt').hidden =
        !frame.nearFurnitureId ||
        !el('#walk-start').hidden ||
        !!this.viewport.ownerDocument.querySelector('dialog[open]');
      el('#resume-walk').hidden = frame.locked || !el('#walk-start').hidden;
      const marker = this.viewport.querySelector<SVGGElement>('#map-marker');
      if (marker) {
        marker.setAttribute('visibility', 'visible');
        marker.setAttribute(
          'transform',
          `translate(${frame.position[0]} ${frame.position[1]}) rotate(${frame.headingDegrees})`,
        );
      }
      const name = viewer.level.rooms.find((r) => r.id === frame.roomId)?.name ?? viewer.level.name;
      if (el('#mini-caption').textContent !== name) el('#mini-caption').textContent = name;
    } else {
      this.viewport.querySelector('#map-marker')?.setAttribute('visibility', 'hidden');
    }
  }
}
