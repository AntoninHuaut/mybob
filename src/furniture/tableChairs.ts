import type { Level } from '../model/types';
import { createFurniture, localToWorld, validateFurnitureList, type FurnitureItem } from './model';
import { checkFurniture } from './checks';
import { linkFurniture } from './groups';

export interface TableChairOptions {
  width: number;
  depth: number;
  gap: number;
  linked: boolean;
}

/** A complete, validated snapshot: no partial ring of chairs is ever committed. */
export function chairsAroundTable(
  items: FurnitureItem[],
  tableId: string,
  count: number,
  level: Level,
  options: TableChairOptions,
): FurnitureItem[] {
  let next = validateFurnitureList(items);
  const table = next.find((item) => item.id === tableId);
  if (!table || table.kind !== 'table') throw new Error('Sélectionnez une table.');
  if (!Number.isInteger(count) || count < 1 || count > 16)
    throw new Error('Choisissez de 1 à 16 chaises.');
  if (!Number.isFinite(options.gap) || options.gap < 0 || options.gap > 1)
    throw new Error('L’écart à la table doit être compris entre 0 et 100 cm.');
  const chair = createFurniture({ kind: 'chair', width: options.width, depth: options.depth });
  const lengths = [table.width, table.width, table.depth, table.depth];
  const seats = [0, 0, 0, 0];
  for (let n = 0; n < count; n++) {
    const side = lengths
      .map((length, index) => ({ index, spacing: length / (seats[index] + 1) }))
      .filter(({ index }) => (seats[index] + 1) * chair.width <= lengths[index] + 0.002)
      .sort((a, b) => b.spacing - a.spacing || a.index - b.index)[0]?.index;
    if (side === undefined)
      throw new Error(
        'Ces chaises ne tiennent pas autour de cette table. Réduisez leur nombre ou leur largeur.',
      );
    seats[side]++;
  }
  for (let side = 0; side < 4; side++)
    for (let i = 0; i < seats[side]; i++) {
      const along = ((i + 0.5) / seats[side] - 0.5) * lengths[side];
      const across = (side < 2 ? table.depth : table.width) / 2 + chair.depth / 2 + options.gap;
      const position =
        side < 2
          ? localToWorld(table, along, side === 0 ? -across : across)
          : localToWorld(table, side === 2 ? -across : across, along);
      const added = createFurniture({
        ...chair,
        id: undefined,
        name: `Chaise ${next.filter((item) => item.kind === 'chair').length + 1}`,
        position,
        rotation: table.rotation + [0, Math.PI, Math.PI / 2, -Math.PI / 2][side],
      });
      const candidate = [...next, added];
      const issue = checkFurniture(candidate, level).find(
        (issue) => issue.itemId === added.id && issue.severity === 'error',
      );
      if (issue)
        throw new Error(
          `Pas assez de place autour de la table : ${issue.message} Déplacez la table ou réduisez le nombre de chaises.`,
        );
      next = options.linked ? linkFurniture(candidate, table.id, added.id) : candidate;
    }
  return validateFurnitureList(next);
}
