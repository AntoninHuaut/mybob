import { pointInPolygon } from '../model/geometry';
import type { Point2 } from '../model/types';

export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LabelBox extends LabelRect {
  id: string;
  priority?: number;
  /** Projected outline of the room that owns the label: the whole label stays inside it. */
  room?: Point2[];
}
export interface LabelPlacement {
  id: string;
  x: number;
  y: number;
  visible: boolean;
  /** Size factor the label was fitted at: below 1 only for a label confined to its room. */
  scale: number;
}

/** A label too big for its room is drawn smaller before it is hidden, never below the last. */
export const LABEL_SCALES = [1, 0.88, 0.76];

export function rectanglesOverlap(a: LabelRect, b: LabelRect, gap = 5) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

function rectangleInsidePolygon(rect: LabelRect, polygon: Point2[]) {
  const { x, y, width, height } = rect;
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    [x + width / 2, y + height / 2],
  ].every((corner) => pointInPolygon(corner as Point2, polygon));
}

/**
 * Further slots for a confined label, nearest to its anchor first: any centre on a coarse grid
 * where the whole label sits inside the room. They stay in the room, so a label never crosses
 * the plan; they only let one that the fixed nudges cannot seat (an L-shaped room, an anchor
 * near a notch) find its place instead of disappearing.
 */
function slotsInside(box: LabelRect, room: Point2[]): [number, number][] {
  const grid = 6;
  const xs = room.map((p) => p[0]);
  const ys = room.map((p) => p[1]);
  const slots: { offset: [number, number]; distance: number }[] = [];
  for (let x = Math.min(...xs) + box.width / 2; x <= Math.max(...xs) - box.width / 2; x += grid)
    for (
      let y = Math.min(...ys) + box.height / 2;
      y <= Math.max(...ys) - box.height / 2;
      y += grid
    ) {
      const offset: [number, number] = [x - box.x, y - box.y];
      slots.push({ offset, distance: Math.hypot(...offset) });
    }
  // One distance per slot: a zoomed room holds thousands, and a comparator computing it
  // twice per comparison made this sort the costliest part of a Plan frame.
  return slots.sort((a, b) => a.distance - b.distance).map((slot) => slot.offset);
}

/**
 * Label anchors are centres; obstacles use top-left rectangles. Never move labels across the
 * plan: a slot whose rectangle is not wholly inside the label's own room is skipped, so a label
 * that cannot fit anywhere in its room, even at the smallest scale, is hidden rather than
 * shown over a wall or in a neighbouring room.
 */
export function layoutLabels(
  boxes: LabelBox[],
  obstacles: LabelRect[],
  viewport: { width: number; height: number },
): LabelPlacement[] {
  const occupied = [...obstacles];
  const results = new Map<string, LabelPlacement>();
  for (const box of [...boxes].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
    let result: LabelPlacement = { id: box.id, x: box.x, y: box.y, visible: false, scale: 1 };
    const step = Math.max(20, box.height + 8);
    search: for (const scale of box.room ? LABEL_SCALES : [1]) {
      const size = { width: box.width * scale, height: box.height * scale };
      const nudges: [number, number][] = [
        [0, 0],
        [0, -step],
        [0, step],
        [-24, 0],
        [24, 0],
        [-24, -step],
        [24, -step],
        [0, -2 * step],
        [0, 2 * step],
      ];
      // The room's grid is built only when no nudge fits: almost every label takes a nudge,
      // and the grid of a room zoomed in Plan holds thousands of slots, rebuilt every frame.
      const room = box.room;
      const slots = function* (): Generator<[number, number]> {
        yield* nudges;
        if (room) yield* slotsInside({ ...box, ...size }, room);
      };
      for (const [dx, dy] of slots()) {
        const rect = {
          x: box.x + dx - size.width / 2,
          y: box.y + dy - size.height / 2,
          ...size,
        };
        if (
          (box.room && !rectangleInsidePolygon(rect, box.room)) ||
          rect.x < 8 ||
          rect.y < 8 ||
          rect.x + rect.width > viewport.width - 8 ||
          rect.y + rect.height > viewport.height - 8 ||
          occupied.some((o) => rectanglesOverlap(rect, o))
        )
          continue;
        result = { id: box.id, x: box.x + dx, y: box.y + dy, visible: true, scale };
        occupied.push(rect);
        break search;
      }
    }
    results.set(box.id, result);
  }
  return boxes.map((box) => results.get(box.id)!);
}
