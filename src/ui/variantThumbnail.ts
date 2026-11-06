import type { FurnitureItem } from '../furniture/model';
import type { Level } from '../model/types';
import { bounds } from '../model/geometry';

/** Compact plan preview of one variant: room outlines plus furniture rectangles. */
export function variantThumbnail(level: Level, items: FurnitureItem[]): string {
  const b = bounds(level.outline);
  const rooms = level.rooms
    .map((r) => `<polygon points="${r.polygon.map((p) => p.join(',')).join(' ')}"/>`)
    .join('');
  const furniture = items
    .map((item) => {
      const x = item.position[0] - item.width / 2;
      const y = item.position[1] - item.depth / 2;
      const color = /^#[\da-f]{6}$/i.test(item.color) ? item.color : '#c4b39f';
      const degrees = ((item.rotation * 180) / Math.PI).toFixed(1);
      return `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${item.width.toFixed(3)}" height="${item.depth.toFixed(3)}" fill="${color}" stroke="#20312e" stroke-width="0.04" transform="rotate(${degrees} ${item.position[0].toFixed(3)} ${item.position[1].toFixed(3)})"/>`;
    })
    .join('');
  return `<svg class="variant-thumbnail-svg" viewBox="${b.minX - 0.3} ${b.minZ - 0.3} ${b.width + 0.6} ${b.depth + 0.6}" aria-hidden="true" focusable="false"><g fill="#efe9dc">${rooms}</g>${furniture}</svg>`;
}
