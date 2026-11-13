import type { HouseProject, Level, Point2, Stair } from '../model/types';
import {
  levelAbove,
  levelBelow,
  stairPassage,
  stairsDown,
  type StairDirection,
} from '../model/stairs';
import type { HouseViewer } from '../scene/viewer';
import { icon } from './icons';

type StairView = Pick<HouseViewer, 'level' | 'mode' | 'exteriorView' | 'measureMode' | 'projector'>;
interface StairButton {
  element: HTMLButtonElement;
  point: Point2;
  height: number;
  physical: boolean;
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
    private readonly floorContainer: HTMLElement = container,
  ) {}

  private mount(project: HouseProject, level: Level): void {
    this.container.replaceChildren();
    if (this.floorContainer !== this.container) this.floorContainer.replaceChildren();
    this.buttons = [];
    const add = (
      target: Level,
      direction: StairDirection,
      point: Point2,
      height: number,
      physical: boolean,
    ) => {
      const element = this.container.ownerDocument.createElement('button');
      element.type = 'button';
      element.className = physical ? 'stair-level-button' : 'floor-level-button';
      element.hidden = true;
      element.title = physical
        ? `${direction === 'up' ? 'Monter' : 'Descendre'} vers ${target.name}`
        : `Voir ${target.name}`;
      element.setAttribute('aria-label', element.title);
      element.innerHTML = icon(`${physical ? 'stairs' : 'level'}-${direction}`, 24);
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!(physical ? this.container : this.floorContainer).hidden && !element.hidden)
          this.changeLevel(target.id);
      });
      (physical ? this.container : this.floorContainer).append(element);
      const button = { element, point, height, physical };
      this.buttons.push(button);
      return button;
    };
    const addStair = (stair: Stair, direction: StairDirection) => {
      const passage = stairPassage(project, level, stair.id, direction);
      const target =
        passage && project.levels.find((candidate) => candidate.id === passage.levelId);
      if (!target) return false;
      add(
        target,
        direction,
        [(stair.start[0] + stair.end[0]) / 2, (stair.start[1] + stair.end[1]) / 2],
        direction === 'up' ? stair.rise / 2 + 0.12 : 0.12,
        true,
      );
      return true;
    };
    for (const stair of level.stairs ?? []) addStair(stair, 'up');
    for (const { stair } of stairsDown(project, level)) addStair(stair, 'down');
    // Keep menu navigation consistent whether a physical stair is modelled or not.
    const above = levelAbove(project, level),
      below = levelBelow(project, level);
    if (above) add(above, 'up', level.spawn.position, 0.12, false);
    if (below) add(below, 'down', level.spawn.position, 0.12, false);
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
    this.floorContainer.hidden = !visible;
    if (!visible || (!changed && !cameraMoved && !becameVisible)) return;
    const projectPoint = this.buttons.some((button) => button.physical)
      ? viewer.projector()
      : undefined;
    for (const { element, point, height, physical } of this.buttons) {
      if (!projectPoint || !physical) {
        element.hidden = false;
        continue;
      }
      const position = projectPoint(point, height);
      element.hidden = !position.visible;
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
    }
  }
}
