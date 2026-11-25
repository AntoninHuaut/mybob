import {
  alongWall,
  distanceToPolygonBoundary,
  pointInPolygon,
  polygonInsidePolygon,
  wallLength,
} from './geometry';
import type { Level, Point2, Room, Wall } from './types';
import { simplePolygon } from './validate';
import { interiorViewpoint } from './wallChain';
import { VISITOR_CLEARANCE } from './visitor';

export interface Junction {
  wallId: string;
  offset: number;
}
export const difference = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
export const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];
const length = (p: Point2) => Math.hypot(...p);
const EPS = 1e-7;

export function wallJunction(level: Level, junction: Junction) {
  const host = level.walls.find((wall) => wall.id === junction.wallId);
  if (
    !host ||
    !Number.isFinite(junction.offset) ||
    junction.offset < 0 ||
    junction.offset > wallLength(host) + EPS
  )
    throw new Error('Le raccord doit se trouver sur le mur choisi.');
  return { host, point: alongWall(host, junction.offset) };
}

export function checkJunctionOpening(host: Wall, offset: number, partition: Wall) {
  const tangent = difference(partition.end, partition.start),
    axis = difference(host.end, host.start);
  const sine = Math.abs(cross(axis, tangent)) / (wallLength(host) * wallLength(partition));
  if (sine < EPS) throw new Error('La cloison doit rejoindre le mur en travers.');
  const cosine = Math.sqrt(Math.max(0, 1 - sine * sine));
  const half = (partition.thickness + host.thickness * cosine) / (2 * sine);
  if (
    host.openings?.some(
      (o) => o.offset < offset + half - EPS && o.offset + o.width > offset - half + EPS,
    )
  )
    throw new Error('Le raccord de la cloison recouvre une ouverture.');
}

export function withRoomPolygon(room: Room, polygon: Point2[]): Room {
  if (polygon.length < 3 || !simplePolygon(polygon))
    throw new Error('La cloison ne délimite pas deux pièces simples.');
  const usable = (p: Point2) =>
    pointInPolygon(p, polygon) && distanceToPolygonBoundary(p, polygon) > VISITOR_CLEARANCE;
  const viewpoint = usable(room.viewpoint) ? room.viewpoint : interiorViewpoint(polygon);
  return {
    ...room,
    polygon,
    viewpoint,
    label: pointInPolygon(room.label, polygon) ? room.label : viewpoint,
  };
}

function clippedRoom(source: Room, partition: Wall, side: number, hosts: Wall[][]) {
  const polygon: Point2[] = [];
  const direction = difference(partition.end, partition.start);
  const span = length(direction);
  const signed = (p: Point2) =>
    (side * cross(direction, difference(p, partition.start))) / span - partition.thickness / 2;
  const crossings: Point2[] = [];
  const add = (p: Point2) => {
    if (!polygon.length || length(difference(p, polygon[polygon.length - 1])) > EPS)
      polygon.push(p);
  };
  for (let i = 0; i < source.polygon.length; i++) {
    const a = source.polygon[i],
      b = source.polygon[(i + 1) % source.polygon.length];
    const da = signed(a),
      db = signed(b);
    if (da >= 0) add(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db),
        p: Point2 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      add(p);
      crossings.push(p);
    }
  }
  if (polygon.length && length(difference(polygon[0], polygon[polygon.length - 1])) < EPS)
    polygon.pop();
  const touches = (p: Point2, wall: Wall) =>
    distanceToPolygonBoundary(p, [wall.start, wall.end]) <= wall.thickness / 2 + 0.003;
  if (
    crossings.length !== 2 ||
    !hosts.every((incident) => crossings.some((p) => incident.some((w) => touches(p, w)))) ||
    !polygonInsidePolygon(polygon, source.polygon)
  )
    throw new Error('Les deux raccords doivent partager la pièce en deux contours fermés.');
  return withRoomPolygon(source, polygon);
}

export function divideRoom(
  level: Level,
  roomId: string,
  ends: [Junction, Junction],
  thickness: number,
  names: [string, string],
  ids: [string, string],
): Level {
  const room = level.rooms.find((r) => r.id === roomId);
  if (
    !room ||
    ends[0].wallId === ends[1].wallId ||
    !Number.isFinite(thickness) ||
    thickness <= 0 ||
    names.some((n) => !n.trim())
  )
    throw new Error('Choisissez deux murs distincts, une épaisseur et deux noms.');
  const first = wallJunction(level, ends[0]),
    second = wallJunction(level, ends[1]);
  const partition: Wall = { id: ids[0], start: first.point, end: second.point, thickness };
  if (wallLength(partition) < EPS) throw new Error('La cloison doit avoir une longueur positive.');
  const hosts: [Wall, Wall] = [first.host, second.host];
  hosts.forEach((host, i) => checkJunctionOpening(host, ends[i].offset, partition));
  const incident = [first, second].map(({ point, host }) => [
    host,
    ...level.walls.filter((w) => {
      if (w === host) return false;
      const atStart = length(difference(point, w.start)) < EPS,
        atEnd = length(difference(point, w.end)) < EPS;
      if (!atStart && !atEnd) return false;
      checkJunctionOpening(w, atStart ? 0 : wallLength(w), partition);
      return true;
    }),
  ]);
  const direction = difference(partition.end, partition.start);
  for (const wall of level.walls) {
    if (hosts.includes(wall)) continue;
    const axis = difference(wall.end, wall.start),
      rel = difference(wall.start, partition.start),
      denom = cross(direction, axis);
    if (Math.abs(denom) < EPS) {
      if (
        Math.abs(cross(direction, rel)) / length(direction) < (thickness + wall.thickness) / 2 &&
        [wall.start, wall.end]
          .map((p) => difference(p, partition.start))
          .map((p) => (p[0] * direction[0] + p[1] * direction[1]) / length(direction) ** 2)
          .sort((a, b) => a - b)
          .every((v, i) => (i === 0 ? v < 1 : v > 0))
      )
        throw new Error('La cloison chevauche un autre mur.');
      continue;
    }
    const t = cross(rel, axis) / denom,
      u = cross(rel, direction) / denom;
    if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS)
      throw new Error('La cloison traverse un autre mur.');
  }
  const kept = { ...clippedRoom(room, partition, 1, incident), name: names[0].trim() };
  const added = {
    ...clippedRoom(room, partition, -1, incident),
    id: ids[1],
    name: names[1].trim(),
  };
  delete added.planArea;
  delete added.note;
  const rooms = level.rooms.flatMap((r) => (r.id === roomId ? [kept, added] : [r]));
  const spawn =
    pointInPolygon(level.spawn.position, room.polygon) &&
    ![kept, added].some(
      (r) =>
        pointInPolygon(level.spawn.position, r.polygon) &&
        distanceToPolygonBoundary(level.spawn.position, r.polygon) > VISITOR_CLEARANCE,
    )
      ? { ...level.spawn, position: kept.viewpoint }
      : level.spawn;
  return { ...level, rooms, walls: [...level.walls, partition], spawn };
}
