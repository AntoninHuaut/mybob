import { distanceToPolygonBoundary, pointInPolygon, wallLength } from './geometry';
import { checkJunctionOpening, cross, difference, withRoomPolygon } from './roomPartition';
import type { Level, Point2, Wall } from './types';
import { VISITOR_CLEARANCE } from './visitor';

const EPS = 0.002;
const dot = (a: Point2, b: Point2) => a[0] * b[0] + a[1] * b[1];

export function movePartition(level: Level, id: string, delta: number): Level {
  const wall = level.walls.find((w) => w.id === id);
  if (!wall || wall.exterior || !Number.isFinite(delta))
    throw new Error('Choisissez une cloison intérieure et un déplacement en mètres.');
  const span = wallLength(wall),
    axis = difference(wall.end, wall.start);
  const tangent: Point2 = [axis[0] / span, axis[1] / span],
    normal: Point2 = [-tangent[1], tangent[0]];
  const distance = (p: Point2) => dot(difference(p, wall.start), normal);
  const offset = (p: Point2) => dot(difference(p, wall.start), tangent);
  function atDistance(a: Point2, b: Point2, target: number) {
    const denominator = distance(b) - distance(a);
    if (Math.abs(denominator) < 1e-7) throw new Error('Ce raccord parallèle est ambigu.');
    const t = (target - distance(a)) / denominator;
    return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as Point2, t };
  }
  const others = level.walls.filter((w) => w.id !== id);
  function junction(p: Point2) {
    const hosts = others.filter((w) => distanceToPolygonBoundary(p, [w.start, w.end]) < EPS);
    if (hosts.length !== 1)
      throw new Error('Le raccord doit correspondre à un seul mur porteur du tracé.');
    const host = hosts[0],
      intersection = atDistance(host.start, host.end, delta);
    if (intersection.t <= 0 || intersection.t >= 1)
      throw new Error('La cloison dépasse son mur de raccord.');
    return { host, point: intersection.point, offset: intersection.t * wallLength(host) };
  }
  const a = junction(wall.start),
    b = junction(wall.end);
  const moved: Wall = { ...wall, start: a.point, end: b.point };
  if (dot(difference(moved.end, moved.start), tangent) <= 0)
    throw new Error('Les raccords de la cloison se croisent.');
  for (const end of [a, b]) checkJunctionOpening(end.host, end.offset, moved);
  if (moved.openings?.some((o) => o.offset + o.width > wallLength(moved) + 0.001))
    throw new Error('Le déplacement rend la cloison trop courte pour son ouverture.');
  for (const other of others) {
    if (other === a.host || other === b.host) continue;
    for (const p of [other.start, other.end]) {
      if (
        offset(p) > -EPS &&
        offset(p) < span + EPS &&
        distance(p) >= Math.min(0, delta) - EPS &&
        distance(p) <= Math.max(0, delta) + EPS
      )
        throw new Error('Le déplacement rencontre un autre raccord.');
    }
    const d = difference(other.end, other.start),
      denom = cross(d, tangent);
    if (Math.abs(denom) < 1e-8) continue;
    const hit = atDistance(other.start, other.end, delta);
    if (
      hit.t >= 0 &&
      hit.t <= 1 &&
      dot(difference(hit.point, moved.start), tangent) >= -EPS &&
      dot(difference(hit.point, moved.end), tangent) <= EPS
    )
      throw new Error('La cloison rencontre un autre mur.');
  }
  const sides = new Set<number>();
  let spawn = level.spawn;
  const rooms = level.rooms.map((room) => {
    const points = room.polygon;
    const edges = points.flatMap((p, i) => {
      const q = points[(i + 1) % points.length],
        d = distance(p),
        e = distance(q);
      const side = Math.sign(d);
      return Math.abs(Math.abs(d) - wall.thickness / 2) < EPS &&
        Math.abs(e - d) < EPS &&
        Math.max(offset(p), offset(q)) > EPS &&
        Math.min(offset(p), offset(q)) < span - EPS
        ? [{ i, side }]
        : [];
    });
    if (!edges.length) return room;
    if (edges.length !== 1 || sides.has(edges[0].side))
      throw new Error('La face de la cloison correspond à plusieurs contours.');
    const { i, side } = edges[0];
    sides.add(side);
    const j = (i + 1) % points.length,
      previous = points[(i + points.length - 1) % points.length],
      after = points[(j + 1) % points.length];
    const target = (side * wall.thickness) / 2 + delta;
    const left = atDistance(previous, points[i], target),
      right = atDistance(after, points[j], target);
    if (
      left.t <= 0 ||
      right.t <= 0 ||
      dot(difference(right.point, left.point), difference(points[j], points[i])) <= 0
    )
      throw new Error('La cloison supprimerait une partie du contour.');
    const polygon = points.map((p, k) => (k === i ? left.point : k === j ? right.point : p));
    const updated = withRoomPolygon(room, polygon);
    if (
      pointInPolygon(level.spawn.position, points) &&
      (!pointInPolygon(level.spawn.position, polygon) ||
        distanceToPolygonBoundary(level.spawn.position, polygon) <= VISITOR_CLEARANCE)
    )
      spawn = { ...spawn, position: updated.viewpoint };
    return updated;
  });
  if (sides.size !== 2)
    throw new Error('Les deux pièces adjacentes ne peuvent pas être identifiées.');
  return { ...level, rooms, walls: level.walls.map((w) => (w === wall ? moved : w)), spawn };
}
