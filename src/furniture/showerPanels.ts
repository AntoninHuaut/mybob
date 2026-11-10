import type { FurnitureItem, ShowerPanelSide } from './model';

/** Glass thickness of a shower panel, in metres. */
export const SHOWER_PANEL_THICKNESS = 0.02;

/** One glass panel in the shower's local frame (centre and size, metres). */
export interface ShowerPanelRect {
  side: ShowerPanelSide;
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
}

/**
 * The glass panels of a shower. A panel without a span covers its whole side; a span shorter
 * than the side leaves the rest open. Side panels start at the back (where the shower head
 * is), front and back panels at the left unless the span says `from: 'right'`. A span longer
 * than the side is clamped, so shrinking a shower never invalidates it.
 */
export function showerPanelRects(item: FurnitureItem): ShowerPanelRect[] {
  if (item.kind !== 'shower') return [];
  const { width: w, depth: d } = item;
  const t = SHOWER_PANEL_THICKNESS;
  return (item.showerPanels ?? ['left']).map((side) => {
    const span = item.showerPanelSpans?.[side];
    if (side === 'front' || side === 'back') {
      const length = Math.min(span?.length ?? w, w);
      const x = span?.from === 'right' ? w / 2 - length / 2 : -w / 2 + length / 2;
      return {
        side,
        x: span ? x : 0,
        z: side === 'back' ? -d / 2 + t / 2 : d / 2 - t / 2,
        sizeX: length,
        sizeZ: t,
      };
    }
    const length = Math.min(span?.length ?? d, d);
    return {
      side,
      x: side === 'left' ? -w / 2 + t / 2 : w / 2 - t / 2,
      z: span ? -d / 2 + length / 2 : 0,
      sizeX: t,
      sizeZ: length,
    };
  });
}

/** Metres left open along a side: the whole side when it carries no panel. */
export function showerOpening(item: FurnitureItem, side: ShowerPanelSide): number {
  const run = side === 'front' || side === 'back' ? item.width : item.depth;
  const rect = showerPanelRects(item).find((panel) => panel.side === side);
  if (!rect) return run;
  return Math.max(0, run - (side === 'front' || side === 'back' ? rect.sizeX : rect.sizeZ));
}
