import { pointInPolygon } from './geometry';
import type { HouseProject, Level, Point2, Stair } from './types';

/**
 * Taking a stair in the visit: which level it leads to and where the visitor lands. A stair
 * belongs to the lower level and rises to the next level up; the upper level reaches it
 * through its floor void and goes down the same flight.
 */

export type StairDirection = 'up' | 'down';

export interface StairPassage {
  stairId: string;
  direction: StairDirection;
  /** The level the visitor arrives on. */
  levelId: string;
  /** Where the visitor lands, past the flight, on the arrival level's floor. */
  arrival: Point2;
  /** The way the visitor faces on arrival, on the plan: the way the flight was walked. */
  heading: Point2;
}

/** A flight lands on a level when its rise meets that level's floor, within this tolerance. */
export const STAIR_LANDING_TOLERANCE = 0.15;
/** First landing try past the flight, then further steps while still over the floor void. */
export const STAIR_CLEARANCE = 0.5;
const CLEARANCE_STEP = 0.25;
const CLEARANCE_MAX = 2;

export function levelAbove(project: HouseProject, level: Level): Level | undefined {
  return project.levels
    .filter((candidate) => candidate.elevation > level.elevation)
    .sort((a, b) => a.elevation - b.elevation)[0];
}

export function levelBelow(project: HouseProject, level: Level): Level | undefined {
  return project.levels
    .filter((candidate) => candidate.elevation < level.elevation)
    .sort((a, b) => b.elevation - a.elevation)[0];
}

function landsOn(lower: Level, stair: Stair, upper: Level): boolean {
  return Math.abs(lower.elevation + stair.rise - upper.elevation) <= STAIR_LANDING_TOLERANCE;
}

/** The flights of the level below that land on `level`: they go down from its floor void. */
export function stairsDown(project: HouseProject, level: Level): { stair: Stair; base: Level }[] {
  const below = levelBelow(project, level);
  if (!below) return [];
  return (below.stairs ?? [])
    .filter((stair) => landsOn(below, stair, level))
    .map((stair) => ({ stair, base: below }));
}

function axis(stair: Stair): Point2 | undefined {
  const dx = stair.end[0] - stair.start[0];
  const dz = stair.end[1] - stair.start[1];
  const run = Math.hypot(dx, dz);
  return run > 1e-6 ? [dx / run, dz / run] : undefined;
}

/** Steps away from `from` along `direction` until the point leaves every floor void. */
function clearOfVoids(level: Level, from: Point2, direction: Point2): Point2 {
  const at = (distance: number): Point2 => [
    from[0] + direction[0] * distance,
    from[1] + direction[1] * distance,
  ];
  for (let distance = STAIR_CLEARANCE; distance <= CLEARANCE_MAX; distance += CLEARANCE_STEP) {
    const point = at(distance);
    if (!(level.floorVoids ?? []).some((polygon) => pointInPolygon(point, polygon))) return point;
  }
  return at(STAIR_CLEARANCE);
}

/** The passage a stair offers from `level`, or nothing if it leads nowhere modelled. */
export function stairPassage(
  project: HouseProject,
  level: Level,
  stairId: string,
  direction: StairDirection,
): StairPassage | undefined {
  if (direction === 'up') {
    const stair = level.stairs?.find((candidate) => candidate.id === stairId);
    const above = levelAbove(project, level);
    const along = stair && axis(stair);
    if (!stair || !above || !along || !landsOn(level, stair, above)) return undefined;
    return {
      stairId,
      direction,
      levelId: above.id,
      arrival: clearOfVoids(above, stair.end, along),
      heading: along,
    };
  }
  const flight = stairsDown(project, level).find(({ stair }) => stair.id === stairId);
  const along = flight && axis(flight.stair);
  if (!flight || !along) return undefined;
  const back: Point2 = [-along[0], -along[1]];
  return {
    stairId,
    direction,
    levelId: flight.base.id,
    arrival: clearOfVoids(flight.base, flight.stair.start, back),
    heading: back,
  };
}
