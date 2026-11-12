import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { pointInPolygon } from '../src/model/geometry';
import type { Point2 } from '../src/model/types';
import {
  layoutLabels,
  rectanglesOverlap as overlap,
  type LabelBox,
  type LabelPlacement,
  type LabelRect,
} from '../src/ui/labelLayout';

const REFERENCE_SCALES = [1, 0.88, 0.76];

// The layout as it was before the room grid became lazy (#251): built eagerly for every
// confined label and sorted with a distance computed in the comparator. Kept verbatim as
// the oracle — the faster layout must place every label exactly where this one did.
function referenceInside(rect: LabelRect, polygon: Point2[]) {
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
function referenceSlots(box: LabelRect, room: Point2[]): [number, number][] {
  const grid = 6;
  const xs = room.map((p) => p[0]);
  const ys = room.map((p) => p[1]);
  const slots: [number, number][] = [];
  for (let x = Math.min(...xs) + box.width / 2; x <= Math.max(...xs) - box.width / 2; x += grid)
    for (let y = Math.min(...ys) + box.height / 2; y <= Math.max(...ys) - box.height / 2; y += grid)
      slots.push([x - box.x, y - box.y]);
  return slots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
}

/**
 * Label anchors are centres; obstacles use top-left rectangles. Never move labels across the
 * plan: a slot whose rectangle is not wholly inside the label's own room is skipped, so a label
 * that cannot fit anywhere in its room, even at the smallest scale, is hidden rather than
 * shown over a wall or in a neighbouring room.
 */
function referenceLayout(
  boxes: LabelBox[],
  obstacles: LabelRect[],
  viewport: { width: number; height: number },
): LabelPlacement[] {
  const occupied = [...obstacles];
  const results = new Map<string, LabelPlacement>();
  for (const box of [...boxes].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
    let result: LabelPlacement = { id: box.id, x: box.x, y: box.y, visible: false, scale: 1 };
    const step = Math.max(20, box.height + 8);
    search: for (const scale of box.room ? REFERENCE_SCALES : [1]) {
      const size = { width: box.width * scale, height: box.height * scale };
      const slots: [number, number][] = [
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
      if (box.room) slots.push(...referenceSlots({ ...box, ...size }, box.room));
      for (const [dx, dy] of slots) {
        const rect = {
          x: box.x + dx - size.width / 2,
          y: box.y + dy - size.height / 2,
          ...size,
        };
        if (
          (box.room && !referenceInside(rect, box.room)) ||
          rect.x < 8 ||
          rect.y < 8 ||
          rect.x + rect.width > viewport.width - 8 ||
          rect.y + rect.height > viewport.height - 8 ||
          occupied.some((o) => overlap(rect, o))
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

const room = fc
  .tuple(
    fc.integer({ min: 0, max: 900 }),
    fc.integer({ min: 0, max: 600 }),
    fc.integer({ min: 40, max: 700 }),
    fc.integer({ min: 40, max: 500 }),
    fc.boolean(),
  )
  .map(([x, y, w, h, notch]): Point2[] =>
    notch
      ? [
          [x, y],
          [x + w, y],
          [x + w, y + h / 2],
          [x + w / 2, y + h / 2],
          [x + w / 2, y + h],
          [x, y + h],
        ]
      : [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ],
  );

const box = fc
  .tuple(
    room,
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.integer({ min: 30, max: 160 }),
    fc.integer({ min: 14, max: 48 }),
    fc.boolean(),
    fc.integer({ min: 0, max: 10 }),
  )
  .map(([polygon, u, v, width, height, confined, priority]) => {
    const xs = polygon.map((p) => p[0]);
    const ys = polygon.map((p) => p[1]);
    const x = Math.min(...xs) + u * (Math.max(...xs) - Math.min(...xs));
    const y = Math.min(...ys) + v * (Math.max(...ys) - Math.min(...ys));
    return { x, y, width, height, priority, room: confined ? polygon : undefined };
  });

test('the lazy room grid places every label exactly where the eager one did', () => {
  fc.assert(
    fc.property(
      fc.array(box, { minLength: 1, maxLength: 8 }),
      fc.array(
        fc.record({
          x: fc.integer({ min: 0, max: 1200 }),
          y: fc.integer({ min: 0, max: 800 }),
          width: fc.integer({ min: 10, max: 300 }),
          height: fc.integer({ min: 10, max: 200 }),
        }),
        { maxLength: 5 },
      ),
      (raw, obstacles) => {
        const boxes: LabelBox[] = raw.map((b, index) => ({ ...b, id: `room-${index}` }));
        const viewport = { width: 1280, height: 900 };
        assert.deepEqual(
          layoutLabels(boxes, obstacles, viewport),
          referenceLayout(boxes, obstacles, viewport),
        );
      },
    ),
    { numRuns: 300 },
  );
});

test('a zoomed room no longer costs its whole grid when the anchor fits', () => {
  // 1200 × 800 px on screen: about 26,000 grid slots, never needed for a centred label.
  const polygon: Point2[] = [
    [0, 0],
    [1200, 0],
    [1200, 800],
    [0, 800],
  ];
  const boxes: LabelBox[] = [
    { id: 'living', x: 600, y: 400, width: 120, height: 32, room: polygon },
  ];
  const start = performance.now();
  for (let frame = 0; frame < 60; frame++) layoutLabels(boxes, [], { width: 1280, height: 900 });
  const lazy = performance.now() - start;
  const eagerStart = performance.now();
  for (let frame = 0; frame < 60; frame++) referenceLayout(boxes, [], { width: 1280, height: 900 });
  const eager = performance.now() - eagerStart;
  assert.ok(
    lazy * 10 < eager,
    `lazy ${lazy.toFixed(1)} ms vs eager ${eager.toFixed(1)} ms for 60 frames`,
  );
});
