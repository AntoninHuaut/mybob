import { distanceToPolygonBoundary, pointInPolygon, wallLength } from './geometry';
import type { Point2, Room, Wall } from './types';
import { simplePolygon } from './validate';
import { interiorViewpoint } from './wallChain';
import { VISITOR_CLEARANCE } from './visitor';

export const difference = (a: Point2, b: Point2): Point2 => [a[0] - b[0], a[1] - b[1]];
export const cross = (a: Point2, b: Point2) => a[0] * b[1] - a[1] * b[0];
const EPS = 1e-7;

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
