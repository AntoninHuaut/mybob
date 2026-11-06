import type { Level } from '../model/types';
import { floorElevationAt } from '../model/geometry';
import { footprintParts, validateFurnitureList, type FurnitureItem } from './model';
import { polygonBounds, wallSolids } from './checks';
import { groupMembers } from './groups';

/** Passage too tight to be comfortable (red); anything below ROOMY is shown (amber). */
export const CIRCULATION_TIGHT = 0.6;
export const CIRCULATION_SHOWN = 0.8;
const MIN_GAP = 0.005;
const KEY_KINDS = new Set(['bed', 'sofa', 'table']);

export interface CirculationBand {
  itemId: string;
  axis: 'x' | 'z';
  distance: number;
  /** World-axis rectangle of the passage strip, in metres. */
  rect: { minX: number; minZ: number; maxX: number; maxZ: number };
}

interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  bottom: number;
  top: number;
}

/**
 * Remaining passage strips around key furniture (bed, sofa, table): for each
 * world direction, the distance to the closest blocking obstacle (wall solid
 * or neighbouring footprint). Informative only, never a placement constraint.
 */
export function circulationBands(input: FurnitureItem[], level: Level): CirculationBand[] {
  const items = validateFurnitureList(input);
  const bands: CirculationBand[] = [];
  const walls: Obstacle[] = wallSolids(level).map((solid) => ({
    ...polygonBounds(solid.polygon),
    bottom: solid.bottom,
    top: solid.top,
  }));
  for (const item of items) {
    if (!KEY_KINDS.has(item.kind)) continue;
    const dragged = new Set(groupMembers(items, item.id).map((member) => member.id));
    const box = polygonBounds(footprintParts(item).flat());
    const bottom = floorElevationAt(level, item.position) - level.elevation + (item.elevation ?? 0);
    const obstacles: Obstacle[] = [
      ...walls,
      ...items
        .filter((other) => !dragged.has(other.id))
        .flatMap((other) =>
          footprintParts(other).map((part) => ({
            ...polygonBounds(part),
            bottom:
              floorElevationAt(level, other.position) - level.elevation + (other.elevation ?? 0),
            top:
              floorElevationAt(level, other.position) -
              level.elevation +
              (other.elevation ?? 0) +
              other.height,
          })),
        ),
    ].filter(
      (obstacle) => obstacle.top > bottom + 0.05 && obstacle.bottom < bottom + item.height - 0.05,
    );
    for (const [axis, min, max, spanMin, spanMax] of [
      ['x', box.minX, box.maxX, box.minZ, box.maxZ],
      ['z', box.minZ, box.maxZ, box.minX, box.maxX],
    ] as ['x' | 'z', number, number, number, number][]) {
      for (const direction of [1, -1] as const) {
        const face = direction === 1 ? max : min;
        let distance = Infinity;
        let span: [number, number] = [spanMin, spanMax];
        for (const obstacle of obstacles) {
          const otherMin = axis === 'x' ? obstacle.minX : obstacle.minZ;
          const otherMax = axis === 'x' ? obstacle.maxX : obstacle.maxZ;
          const otherSpan: [number, number] =
            axis === 'x' ? [obstacle.minZ, obstacle.maxZ] : [obstacle.minX, obstacle.maxX];
          if (Math.max(spanMin, otherSpan[0]) >= Math.min(spanMax, otherSpan[1])) continue;
          const gap = direction === 1 ? otherMin - face : face - otherMax;
          if (gap <= MIN_GAP || gap >= distance) continue;
          distance = gap;
          span = [Math.max(spanMin, otherSpan[0]), Math.min(spanMax, otherSpan[1])];
        }
        if (!Number.isFinite(distance) || distance > CIRCULATION_SHOWN) continue;
        const rect =
          axis === 'x'
            ? {
                minX: direction === 1 ? face : face - distance,
                maxX: direction === 1 ? face + distance : face,
                minZ: span[0],
                maxZ: span[1],
              }
            : {
                minX: span[0],
                maxX: span[1],
                minZ: direction === 1 ? face : face - distance,
                maxZ: direction === 1 ? face + distance : face,
              };
        bands.push({ itemId: item.id, axis, distance, rect });
      }
    }
  }
  return bands;
}
