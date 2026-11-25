import { VISITOR_CLEARANCE } from './visitor';
import type { HouseProject, Point2 } from './types';
import { validateProject } from './validate';

export function createHouse(
  id: string,
  roomName: string,
  width: number,
  depth: number,
  thickness: number,
): HouseProject {
  if (![width, depth, thickness].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('Les dimensions doivent être positives.');
  if (Math.min(width, depth) <= 2 * VISITOR_CLEARANCE)
    throw new Error('La pièce est trop étroite pour la visite.');
  const rectangle = (margin: number): Point2[] => [
    [-margin || 0, -margin || 0],
    [width + margin, -margin || 0],
    [width + margin, depth + margin],
    [-margin || 0, depth + margin],
  ];
  const axes = rectangle(thickness / 2);
  const centre: Point2 = [width / 2, depth / 2];
  const name = roomName.trim();
  return validateProject({
    schemaVersion: 1,
    units: 'm',
    id,
    name,
    description: '',
    source: { title: 'Dessin en plan', status: 'Projet local', notes: [] },
    levels: [
      {
        id: 'level-1',
        name: 'Rez-de-chaussée',
        elevation: 0,
        ceilingHeight: 2.5,
        outline: rectangle(thickness),
        spawn: { position: centre, yaw: 0 },
        lights: [],
        walls: axes.map((start, i) => ({
          id: 'wall-' + (i + 1),
          start,
          end: axes[(i + 1) % 4],
          thickness,
          exterior: true,
        })),
        rooms: [
          {
            id: 'room-1',
            name,
            kind: 'living',
            polygon: rectangle(0),
            label: centre,
            viewpoint: centre,
          },
        ],
      },
    ],
  });
}
