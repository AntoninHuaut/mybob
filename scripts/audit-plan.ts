import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import earcut from 'earcut';
import { validateProject } from '../src/model/validate';
import {
  alongWall,
  pointInOrOnPolygon,
  pointInPolygon,
  polygonArea,
  traversable,
  wallLength,
} from '../src/model/geometry';
import type { HouseProject, Level, Point2, Wall } from '../src/model/types';

const EPS = 1e-9;
const TOUCH = 0.02; // m, endpoints closer than this are considered joined
const NEAR_GAP = 0.3; // m, endpoints this close but not joined are suspicious
const GRID = 0.1; // m, connectivity grid, capped by the thinnest partition
const GRID_SAFETY = 2; // a cell must stay smaller than the half-thickness
// A room/wall overlap thinner than this is an area-fitting rounding,
// not a plan defect: 1 cm over 5 m makes 0.05 m².
const ROOM_WALL_TOLERANCE = 0.05;
// A partition must keep at least this floor contact with the outline,
// otherwise it floats outside the level; exterior walls are exempt.
const OUTLINE_FLOOR_TOLERANCE = 0.01;
// A wall penetrating a declared floor opening by more than this threshold floats over the
// void; a wall bordering its face stays below it.
const VOID_OVERLAP_TOLERANCE = 0.01;
const MAX_CELLS = 400_000;
const cross = (a: Point2, b: Point2, c: Point2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function triangles(polygon: Point2[]): Point2[][] {
  const indices = earcut(polygon.flat());
  const result: Point2[][] = [];
  for (let i = 0; i < indices.length; i += 3)
    result.push(indices.slice(i, i + 3).map((j) => polygon[j]));
  return result;
}

/** Convex clipping of independently triangulated simple polygons, in square metres. */
export function intersectionArea(a: Point2[], b: Point2[]): number {
  let area = 0;
  for (const triangleA of triangles(a)) {
    for (const triangleB of triangles(b)) {
      let clipped = triangleA;
      const sign = Math.sign(cross(triangleB[0], triangleB[1], triangleB[2]));
      for (let i = 0; i < 3 && clipped.length; i++) {
        const edgeA = triangleB[i],
          edgeB = triangleB[(i + 1) % 3];
        const input = clipped;
        clipped = [];
        for (let j = 0; j < input.length; j++) {
          const p = input[j],
            q = input[(j + 1) % input.length];
          const dp = sign * cross(edgeA, edgeB, p),
            dq = sign * cross(edgeA, edgeB, q);
          if (dp >= -EPS) clipped.push(p);
          if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) {
            const t = dp / (dp - dq);
            clipped.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
          }
        }
      }
      if (clipped.length >= 3) area += polygonArea(clipped);
    }
  }
  return area;
}

function wallFootprints(wall: Wall): Point2[][] {
  const result: Point2[][] = [];
  let cursor = 0;
  const rectangle = (start: number, end: number) => {
    if (end - start <= EPS) return;
    result.push([
      alongWall(wall, start, -wall.thickness / 2),
      alongWall(wall, end, -wall.thickness / 2),
      alongWall(wall, end, wall.thickness / 2),
      alongWall(wall, start, wall.thickness / 2),
    ]);
  };
  for (const opening of [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset)) {
    if (!traversable(opening) || (opening.sill ?? 0) > 0) continue;
    rectangle(cursor, opening.offset);
    cursor = opening.offset + opening.width;
  }
  rectangle(cursor, wallLength(wall));
  return result;
}

function distanceToPolygon(point: Point2, polygon: Point2[]): number {
  if (pointInPolygon(point, polygon)) return 0;
  return Math.min(
    ...polygon.map((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      const dx = b[0] - a[0],
        dz = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)),
      );
      return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
    }),
  );
}

function distanceToOutline(point: Point2, outline: Point2[]): number {
  return Math.min(
    ...outline.map((a, i) => {
      const b = outline[(i + 1) % outline.length];
      const dx = b[0] - a[0],
        dz = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)),
      );
      return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
    }),
  );
}

/** Collinear walls whose spans overlap: duplicated or doubled partitions. */
function duplicateWalls(walls: Wall[]): { a: Wall; b: Wall; overlap: number }[] {
  const result: { a: Wall; b: Wall; overlap: number }[] = [];
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i],
        b = walls[j];
      const la = wallLength(a),
        lb = wallLength(b);
      if (la < EPS || lb < EPS) continue;
      const da: Point2 = [(a.end[0] - a.start[0]) / la, (a.end[1] - a.start[1]) / la];
      const db: Point2 = [(b.end[0] - b.start[0]) / lb, (b.end[1] - b.start[1]) / lb];
      if (Math.abs(da[0] * db[1] - da[1] * db[0]) > 0.01) continue;
      const offset = Math.abs(
        (b.start[0] - a.start[0]) * da[1] - (b.start[1] - a.start[1]) * da[0],
      );
      if (offset > TOUCH) continue;
      const project = (p: Point2) => (p[0] - a.start[0]) * da[0] + (p[1] - a.start[1]) * da[1];
      const b0 = project(b.start),
        b1 = project(b.end);
      const overlap = Math.min(la, Math.max(b0, b1)) - Math.max(0, Math.min(b0, b1));
      if (overlap > 0.05) result.push({ a, b, overlap });
    }
  return result;
}

interface Grid {
  cell: number;
  x0: number;
  z0: number;
  cols: number;
  rows: number;
  passable: Uint8Array;
}

function buildGrid(level: Level, solids: Point2[][], cell?: number): Grid {
  // A cell wider than the thinnest partition can jump over it:
  // its centre falls on either side of the wall and the fill goes through.
  const thinnest = Math.min(...level.walls.map((wall) => wall.thickness));
  cell = Math.min(cell ?? GRID, thinnest / GRID_SAFETY);
  const xs = level.outline.map((p) => p[0]),
    zs = level.outline.map((p) => p[1]);
  const x0 = Math.min(...xs),
    z0 = Math.min(...zs);
  let cols = Math.ceil((Math.max(...xs) - x0) / cell);
  let rows = Math.ceil((Math.max(...zs) - z0) / cell);
  while (cols * rows > MAX_CELLS) {
    cell *= 1.5;
    cols = Math.ceil((Math.max(...xs) - x0) / cell);
    rows = Math.ceil((Math.max(...zs) - z0) / cell);
  }
  const passable = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p: Point2 = [x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell];
      if (!pointInPolygon(p, level.outline)) continue;
      if (solids.some((solid) => pointInPolygon(p, solid))) continue;
      passable[r * cols + c] = 1;
    }
  return { cell, x0, z0, cols, rows, passable };
}

function reachable(grid: Grid, start: Point2): Uint8Array {
  const reached = new Uint8Array(grid.cols * grid.rows);
  const cellOf = (p: Point2): [number, number] => [
    Math.floor((p[0] - grid.x0) / grid.cell),
    Math.floor((p[1] - grid.z0) / grid.cell),
  ];
  const [sc, sr] = cellOf(start);
  const queue: number[] = [];
  const seed = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return;
    const index = r * grid.cols + c;
    if (!grid.passable[index] || reached[index]) return;
    reached[index] = 1;
    queue.push(index);
  };
  seed(sc, sr);
  // A spawn placed on a wall or a hair outside the outline: seed the nearest passable cell.
  if (!queue.length)
    for (let radius = 1; radius <= Math.ceil(1 / grid.cell) && !queue.length; radius++)
      for (let dr = -radius; dr <= radius; dr++)
        for (let dc = -radius; dc <= radius; dc++) seed(sc + dc, sr + dr);
  while (queue.length) {
    const index = queue.pop()!;
    const c = index % grid.cols,
      r = Math.floor(index / grid.cols);
    seed(c + 1, r);
    seed(c - 1, r);
    seed(c, r + 1);
    seed(c, r - 1);
  }
  return reached;
}

export function auditPlan(project: HouseProject) {
  const checked = validateProject(project);
  const issues: { level: string; kind: string; ids: string[]; value: number; unit: string }[] = [];
  const levels = checked.levels.map((level) => {
    const walls = level.walls.map((wall) => ({ wall, solids: wallFootprints(wall) }));
    const allSolids = walls.flatMap((entry) => entry.solids);
    const rooms = level.rooms.map((room) => {
      const area = polygonArea(room.polygon);
      for (const { wall, solids } of walls) {
        const overlap = solids.reduce(
          (sum, solid) => sum + intersectionArea(room.polygon, solid),
          0,
        );
        if (overlap > ROOM_WALL_TOLERANCE)
          issues.push({
            level: level.id,
            kind: 'room-solid-wall',
            ids: [room.id, wall.id],
            value: overlap,
            unit: 'm²',
          });
      }
      const delta = room.planArea === undefined ? undefined : area - room.planArea;
      if (delta !== undefined && Math.abs(delta) > Math.max(0.05, room.planArea! * 0.01))
        issues.push({
          level: level.id,
          kind: 'declared-area-residual',
          ids: [room.id],
          value: delta,
          unit: 'm²',
        });
      return { id: room.id, area, declaredArea: room.planArea, delta };
    });
    for (let i = 0; i < level.rooms.length; i++)
      for (let j = i + 1; j < level.rooms.length; j++) {
        const a = level.rooms[i],
          b = level.rooms[j];
        const overlap = intersectionArea(a.polygon, b.polygon);
        if (overlap > 1e-5)
          issues.push({
            level: level.id,
            kind: 'room-room',
            ids: [a.id, b.id],
            value: overlap,
            unit: 'm²',
          });
      }
    for (const { a, b, overlap } of duplicateWalls(level.walls))
      issues.push({
        level: level.id,
        kind: 'duplicate-wall',
        ids: [a.id, b.id],
        value: overlap,
        unit: 'm',
      });
    // A partition that lives entirely outside the outline floats over nothing:
    // plan B's combles carried the ghost of a stairwell wall 59 cm beyond a
    // floor that stops at the roof slope, rendered as a bar hanging under the
    // house. Exterior walls legitimately straddle a recessed outline — a knee
    // wall sits half outside an inset floor — so only interior walls count,
    // and a wall that keeps any floor contact is left alone.
    for (const { wall, solids } of walls) {
      if (wall.exterior || !solids.length) continue;
      const total = solids.reduce((sum, solid) => sum + polygonArea(solid), 0);
      const inside = solids.reduce((sum, solid) => sum + intersectionArea(level.outline, solid), 0);
      if (inside >= OUTLINE_FLOOR_TOLERANCE) continue;
      issues.push({
        level: level.id,
        kind: 'interior-wall-outside-outline',
        ids: [wall.id],
        value: total - inside,
        unit: 'm²',
      });
    }
    // A solid wall standing over a declared stairwell void floats on the hole:
    // plan B's combles carried an invented wall hugging the flight where the
    // drawing only shows a handrail, and it survived surfaces, connectivity
    // and the outline check because its solids touch floor on both sides.
    // Flanking walls end at the void faces and stay under the threshold.
    for (const { wall, solids } of walls) {
      if (wall.exterior) continue;
      let overlap = 0;
      for (const voidPolygon of level.floorVoids ?? [])
        for (const solid of solids) overlap += intersectionArea(voidPolygon, solid);
      if (overlap > VOID_OVERLAP_TOLERANCE)
        issues.push({
          level: level.id,
          kind: 'wall-over-void',
          ids: [wall.id],
          value: overlap,
          unit: 'm²',
        });
    }
    // Wall ends that stop just short of another wall or of the outline: the classic
    // "almost joined" gap that leaves a sliver of floor or a hole in a partition.
    for (const { wall } of walls) {
      for (const end of [wall.start, wall.end]) {
        const toOutline = distanceToOutline(end, level.outline);
        if (toOutline <= TOUCH) continue;
        let nearest = Infinity;
        for (const other of walls) {
          if (other.wall.id === wall.id) continue;
          for (const solid of other.solids)
            nearest = Math.min(nearest, distanceToPolygon(end, solid));
        }
        if (nearest > TOUCH && nearest <= NEAR_GAP)
          issues.push({
            level: level.id,
            kind: 'wall-endpoint-gap',
            ids: [wall.id],
            value: nearest,
            unit: 'm',
          });
      }
    }
    for (const { id, point } of [
      { id: 'spawn', point: level.spawn.position },
      ...level.rooms.map((r) => ({ id: r.id, point: r.viewpoint })),
    ]) {
      for (const { wall, solids } of walls) {
        const clearance = Math.min(...solids.map((solid) => distanceToPolygon(point, solid)));
        if (clearance < 0.17 - EPS)
          issues.push({
            level: level.id,
            kind: 'visitor-wall-clearance',
            ids: [id, wall.id],
            value: clearance,
            unit: 'm',
          });
      }
    }
    if (!level.rooms.some((room) => pointInOrOnPolygon(level.spawn.position, room.polygon)))
      issues.push({
        level: level.id,
        kind: 'spawn-outside-room',
        ids: ['spawn'],
        value: 0,
        unit: 'm²',
      });
    // Floor-plane connectivity: grid flood fill from the spawn through floor-level
    // traversable openings. Approximate by construction; door leaves are not modelled.
    const grid = buildGrid(level, allSolids);
    const reached = reachable(grid, level.spawn.position);
    const reachedRooms: string[] = [];
    for (const room of level.rooms) {
      let hit = false;
      for (let r = 0; r < grid.rows && !hit; r++)
        for (let c = 0; c < grid.cols && !hit; c++) {
          if (!reached[r * grid.cols + c]) continue;
          const p: Point2 = [grid.x0 + (c + 0.5) * grid.cell, grid.z0 + (r + 0.5) * grid.cell];
          if (pointInPolygon(p, room.polygon)) hit = true;
        }
      if (hit) reachedRooms.push(room.id);
      else
        issues.push({
          level: level.id,
          kind: 'room-unreachable',
          ids: [room.id],
          value: 0,
          unit: 'm²',
        });
    }
    const openings = level.walls.flatMap((wall) =>
      (wall.openings ?? []).map((opening) => ({
        id: opening.id,
        wall: wall.id,
        kind: opening.kind,
        start: alongWall(wall, opening.offset),
        end: alongWall(wall, opening.offset + opening.width),
        sill: opening.sill ?? 0,
        height: opening.height,
      })),
    );
    return { id: level.id, rooms, openings, reachedRooms, gridCell: grid.cell };
  });
  return {
    project: checked.id,
    schemaValid: true,
    sourceVerified: false,
    browserInspected: false,
    limitations: [
      'Floor-plane audit only; no door-leaf swing, roof or complete wall-join verification.',
      'Connectivity is a grid flood fill through floor-level traversable openings; it does not model door leaves, thresholds or furniture.',
      'Area residuals require evidence review, not automatic resizing.',
    ],
    levels,
    issues,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2])
      throw new Error('Usage: node --import tsx scripts/audit-plan.ts project.json');
    const result = auditPlan(JSON.parse(await readFile(process.argv[2], 'utf8')));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
