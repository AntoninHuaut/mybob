import type { HouseProject } from '../model/types';
import { savePlanProject } from './projectLibrary';

interface History {
  undo: HouseProject[];
  redo: HouseProject[];
}
const histories = new WeakMap<HouseProject, History>();
// Saving reloads the view before the history entry exists: the edit bar refreshes afterwards.
let changed = () => {};

export function watchPlanHistory(listener: () => void) {
  changed = listener;
}

export function planHistory(project: HouseProject) {
  return histories.get(project) ?? { undo: [], redo: [] };
}

export function applyPlanEdit(current: HouseProject, next: HouseProject) {
  savePlanProject(current, next);
  rememberPlanEdit(current, next);
}

export function rememberPlanEdit(current: HouseProject, next: HouseProject) {
  const history = planHistory(current);
  histories.delete(current);
  histories.set(next, { undo: [...history.undo.slice(-49), current], redo: [] });
  changed();
}

export function restorePlanEdit(current: HouseProject, direction: keyof History) {
  const history = planHistory(current);
  const target = history[direction].at(-1);
  if (!target) return;
  savePlanProject(current, target);
  const other = direction === 'undo' ? 'redo' : 'undo';
  histories.delete(current);
  histories.set(target, {
    ...history,
    [direction]: history[direction].slice(0, -1),
    [other]: [...history[other], current],
  });
  changed();
}
