import type { Level } from '../model/types';
import { localToWorld, type FurnitureItem } from './model';
import { buildingTranslationTimes, getBuildingPlacementIssues } from './placement';

/** Keep resizing local: only redistribute the growth between the two opposite faces. */
export function fitFurnitureResize(
  before: FurnitureItem,
  after: FurnitureItem,
  level: Level,
  accepts: (candidate: FurnitureItem) => boolean,
): FurnitureItem {
  const growthX = Math.max(0, after.width - before.width) / 2;
  const growthZ = Math.max(0, after.depth - before.depth) / 2;
  if (
    (!growthX && !growthZ) ||
    before.locked ||
    before.rotation !== after.rotation ||
    before.position.some((value, axis) => value !== after.position[axis]) ||
    (before.elevation ?? 0) !== (after.elevation ?? 0) ||
    getBuildingPlacementIssues(before, level).length ||
    accepts(after)
  )
    return after;

  const at = (x: number, z: number): FurnitureItem => ({
    ...after,
    position: localToWorld(before, x, z),
  });
  const candidates: FurnitureItem[] = [];
  for (const x of [0, -growthX, growthX])
    for (const z of [0, -growthZ, growthZ]) {
      if (!x && !z) continue;
      const end = at(x, z);
      const times = buildingTranslationTimes(
        after,
        [end.position[0] - after.position[0], end.position[1] - after.position[1]],
        level,
      );
      const first = times.find((time) => time > 0 && accepts(at(x * time, z * time)));
      if (first === undefined) continue;
      // Find the nearest valid centre on this growth direction, not a new room placement.
      let low = 0,
        high = first;
      for (let step = 0; step < 26; step++) {
        const middle = (low + high) / 2;
        if (accepts(at(x * middle, z * middle))) high = middle;
        else low = middle;
      }
      candidates.push(at(x * high, z * high));
    }
  candidates.sort(
    (a, b) =>
      Math.hypot(a.position[0] - before.position[0], a.position[1] - before.position[1]) -
      Math.hypot(b.position[0] - before.position[0], b.position[1] - before.position[1]),
  );
  return candidates[0] ?? after;
}
