import type { Level } from '../model/types';
import type { FurnitureItem } from './model';
import type { FurnitureIssue } from './checks';

/** Screening only: upright rectangular object, no tilt, no path or packaging simulation. */
export function deliveryChecks(items: FurnitureItem[], level: Level): FurnitureIssue[] {
  const doors = level.walls
    .flatMap((wall) => wall.openings ?? [])
    .filter((opening) => opening.exterior && opening.kind === 'door');
  if (!doors.length) return [];
  return items
    .filter(
      (item) =>
        !doors.some(
          (door) =>
            Math.min(item.width, item.depth) <= door.width - 0.05 &&
            item.height <= door.height - 0.025,
        ),
    )
    .map((item) => ({
      itemId: item.id,
      severity: 'warning' as const,
      message:
        'Livraison à vérifier : ce volume ne passe pas debout dans une porte d’entrée modélisée. Inclinaison, emballage et trajet non simulés.',
    }));
}
