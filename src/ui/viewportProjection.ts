import type { Level, Point2 } from '../model/types';
import { bounds, floorElevationAt, pointInPolygon, polygonArea } from '../model/geometry';
import type { HouseViewer, FrameInfo } from '../scene/viewer';
import { number } from './format';
import { layoutLabels, type LabelBox, type LabelRect } from './labelLayout';
import type { MeasureBar } from './measureBar';
import { setAttribute, setHidden, setText } from './domWrites';

type ProjectedView = Pick<
  HouseViewer,
  'mode' | 'level' | 'measureMode' | 'measurement' | 'project'
> &
  Partial<Pick<HouseViewer, 'projector'>>;
type Project = (point: Point2, height?: number) => { x: number; y: number; visible: boolean };
interface ProjectionPreferences {
  showLabels: boolean;
  showDimensions: boolean;
  selectedRoomId?: string;
  northAngleDeg: number;
}

/** Projects scene information into viewport labels and walk HUD; owns no application state. */
export class ViewportProjection {
  private labelsDirty = true;
  /** What the labels were last projected for, besides the camera. */
  private readonly projected: unknown[] = [];
  private projectedLevel?: Level;
  private arrow = '';
  private readonly roomLabels = new Map<string, HTMLElement>();
  private readonly elements = new Map<string, HTMLElement>();

  constructor(
    private readonly viewport: HTMLElement,
    private readonly measureBar: Pick<MeasureBar, 'moveTo'>,
    private readonly getFurnitureObstacles: (project: Project) => LabelRect[],
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

  /** Looked up once, and again only once the element left the page (a project reload). */
  private readonly element = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const cached = this.elements.get(selector);
    if (cached?.isConnected) return cached as T;
    const found = this.viewport.querySelector<T>(selector)!;
    this.elements.set(selector, found);
    return found;
  };

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
    const arrow = `rotate(${frame.planUpDegrees + northAngleDeg}deg)`;
    if (arrow !== this.arrow) {
      this.arrow = arrow;
      el('#orientation-arrow').style.transform = arrow;
    }
    const { a, b } = viewer.measurement ?? {};
    // Compared and kept in place: no array is built per frame.
    let changed = false;
    const keep = (index: number, value: unknown) => {
      if (this.projected[index] === value) return;
      this.projected[index] = value;
      changed = true;
    };
    keep(0, showLabels);
    keep(1, showDimensions);
    keep(2, selectedRoomId);
    keep(3, northAngleDeg);
    keep(4, viewer.mode);
    keep(5, viewer.measureMode);
    keep(6, a?.[0]);
    keep(7, a?.[1]);
    keep(8, b?.[0]);
    keep(9, b?.[1]);
    keep(10, frame.furnitureObstaclesRevision);
    const projectLabels =
      frame.cameraMoved !== false ||
      this.labelsDirty ||
      changed ||
      viewer.level !== this.projectedLevel;
    this.labelsDirty = false;
    this.projectedLevel = viewer.level;
    if (projectLabels) {
      // One camera transform and one canvas size for the whole frame (`projector`).
      const project: Project =
        viewer.projector?.() ?? ((point, height) => viewer.project(point, height));
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
          const p = project(room.label, (room.floorOffset ?? 0) + 0.04);
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
              const c = project(corner, (room.floorOffset ?? 0) + 0.04);
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
        const obstacles = this.getFurnitureObstacles(project);
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
          const pos = project(point);
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
        const p = project(
          midpoint,
          floorElevationAt(viewer.level, midpoint) - viewer.level.elevation + 0.1,
        );
        this.measureBar.moveTo(p);
      }
    }
    const marker = this.viewport.querySelector<SVGGElement>('#map-marker');
    if (viewer.mode === 'walk') {
      const starting = !el('#walk-start').hidden;
      setHidden(el('#door-prompt'), !frame.nearDoor || starting);
      setHidden(el('#stair-prompt'), !frame.nearStair || starting);
      if (frame.nearStair)
        setText(
          el('#stair-prompt-label'),
          frame.nearStair === 'up' ? 'Monter à l’étage' : 'Descendre',
        );
      setHidden(
        el('#furniture-edit-prompt'),
        !frame.nearFurnitureId ||
          starting ||
          !!this.viewport.ownerDocument.querySelector('dialog[open]'),
      );
      setHidden(el('#resume-walk'), frame.locked || starting);
      if (marker) {
        setAttribute(marker, 'visibility', 'visible');
        setAttribute(
          marker,
          'transform',
          `translate(${frame.position[0]} ${frame.position[1]}) rotate(${frame.headingDegrees})`,
        );
      }
      const name = viewer.level.rooms.find((r) => r.id === frame.roomId)?.name ?? viewer.level.name;
      setText(el('#mini-caption'), name);
    } else if (marker) {
      setAttribute(marker, 'visibility', 'hidden');
    }
  }
}
