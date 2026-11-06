import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import earcut from 'earcut';
import { validateProject } from '../src/model/validate';
import {
  alongWall,
  pointInPolygon,
  polygonArea,
  traversable,
  wallLength,
} from '../src/model/geometry';
import type { HouseProject, Point2, Wall } from '../src/model/types';

const EPS = 1e-9;
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

export function auditPlan(project: HouseProject) {
  const checked = validateProject(project);
  const issues: { level: string; kind: string; ids: string[]; value: number; unit: string }[] = [];
  const levels = checked.levels.map((level) => {
    const walls = level.walls.map((wall) => ({ wall, solids: wallFootprints(wall) }));
    const rooms = level.rooms.map((room) => {
      const area = polygonArea(room.polygon);
      for (const { wall, solids } of walls) {
        const overlap = solids.reduce(
          (sum, solid) => sum + intersectionArea(room.polygon, solid),
          0,
        );
        if (overlap > 1e-5)
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
    return { id: level.id, rooms, openings };
  });
  return {
    project: checked.id,
    schemaValid: true,
    sourceVerified: false,
    browserInspected: false,
    limitations: [
      'Floor-plane audit only; no connectivity, swing, roof or complete wall-join verification.',
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
