import { wallLength } from './geometry';
import type { Opening, Wall } from './types';

export interface OpeningMeasurements {
  kind: Opening['kind'];
  reference: 'start' | 'end';
  distance: number;
  width: number;
  height: number;
  sill?: number;
  hinge?: Opening['hinge'];
  swing?: Opening['swing'];
}

export function editOpening(wall: Wall, id: string, measurements: OpeningMeasurements): Opening {
  const { reference, distance, ...dimensions } = measurements;
  const existing = wall.openings?.find((opening) => opening.id === id);
  const length = wallLength(wall);
  const offset = reference === 'end' ? length - dimensions.width - distance : distance;
  if (
    !Number.isFinite(distance) ||
    distance < 0 ||
    offset < -1e-9 ||
    offset + dimensions.width > length + 0.001
  )
    throw new Error('L’ouverture dépasse le bout du mur.');
  if (
    wall.openings?.some(
      (other) =>
        other.id !== id &&
        offset < other.offset + other.width - 0.001 &&
        offset + dimensions.width > other.offset + 0.001,
    )
  )
    throw new Error('L’ouverture chevauche une autre ouverture.');
  return {
    ...(existing ?? { exterior: wall.exterior }),
    ...dimensions,
    kind: existing?.kind ?? dimensions.kind,
    id,
    offset: Math.max(0, offset),
  };
}
