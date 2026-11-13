import type { HouseProject, Level, Point2, Stair } from '../model/types';
import { stairPassage, stairsDown, type StairDirection } from '../model/stairs';
import type { HouseViewer } from '../scene/viewer';
import { icon } from './icons';

type StairView = Pick<HouseViewer, 'level' | 'mode' | 'exteriorView' | 'measureMode' | 'projector'>;
interface StairButton {
  element: HTMLButtonElement;
  point: Point2;
  height: number;
}

/** Camera-projected level shortcuts, separate from optional room labels. */
export class StairNavigation {
  private project?: HouseProject;
  private level?: Level;
  private buttons: StairButton[] = [];
  private visible = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly changeLevel: (levelId: string) => void,
  ) {}

  private mount(project: HouseProject, level: Level): void {
    this.container.replaceChildren();
    this.buttons = [];
    const add = (stair: Stair, direction: StairDirection) => {
      const passage = stairPassage(project, level, stair.id, direction);
      const target =
        passage && project.levels.find((candidate) => candidate.id === passage.levelId);
      if (!target) return;
      const element = this.container.ownerDocument.createElement('button');
      element.type = 'button';
      element.className = 'stair-level-button';
      element.hidden = true;
      element.title = `${direction === 'up' ? 'Monter' : 'Descendre'} vers ${target.name}`;
      element.setAttribute('aria-label', element.title);
      element.innerHTML = icon(direction === 'up' ? 'stairs-up' : 'stairs-down', 24);
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!this.container.hidden && !element.hidden) this.changeLevel(target.id);
      });
      this.container.append(element);
      this.buttons.push({
        element,
        point: [(stair.start[0] + stair.end[0]) / 2, (stair.start[1] + stair.end[1]) / 2],
        // From above, the return button sits at the floor void rather than below the floor.
        height: direction === 'up' ? stair.rise / 2 + 0.12 : 0.12,
      });
    };
    for (const stair of level.stairs ?? []) add(stair, 'up');
    for (const { stair } of stairsDown(project, level)) add(stair, 'down');
  }

  update(project: HouseProject, viewer: StairView, cameraMoved = true): void {
    const changed = project !== this.project || viewer.level !== this.level;
    if (changed) {
      this.mount(project, viewer.level);
      this.project = project;
      this.level = viewer.level;
    }
    const visible =
      viewer.mode === 'overview' &&
      !viewer.exteriorView &&
      !viewer.measureMode &&
      this.buttons.length > 0;
    const becameVisible = visible && !this.visible;
    this.visible = visible;
    this.container.hidden = !visible;
    if (!visible || (!changed && !cameraMoved && !becameVisible)) return;
    const projectPoint = viewer.projector();
    for (const { element, point, height } of this.buttons) {
      const position = projectPoint(point, height);
      element.hidden = !position.visible;
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
    }
  }
}
