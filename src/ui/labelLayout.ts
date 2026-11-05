export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LabelBox extends LabelRect {
  id: string;
  priority?: number;
}
export interface LabelPlacement {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export function rectanglesOverlap(a: LabelRect, b: LabelRect, gap = 5) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/** Label anchors are centres; obstacles use top-left rectangles. Never move labels across the plan. */
export function layoutLabels(
  boxes: LabelBox[],
  obstacles: LabelRect[],
  viewport: { width: number; height: number },
): LabelPlacement[] {
  const occupied = [...obstacles];
  const results = new Map<string, LabelPlacement>();
  for (const box of [...boxes].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
    let result: LabelPlacement = { id: box.id, x: box.x, y: box.y, visible: false };
    const step = Math.max(20, box.height + 8);
    for (const [dx, dy] of [
      [0, 0],
      [0, -step],
      [0, step],
      [-24, 0],
      [24, 0],
      [-24, -step],
      [24, -step],
      [0, -2 * step],
      [0, 2 * step],
    ]) {
      const rect = {
        x: box.x + dx - box.width / 2,
        y: box.y + dy - box.height / 2,
        width: box.width,
        height: box.height,
      };
      if (
        rect.x < 8 ||
        rect.y < 8 ||
        rect.x + rect.width > viewport.width - 8 ||
        rect.y + rect.height > viewport.height - 8 ||
        occupied.some((o) => rectanglesOverlap(rect, o))
      )
        continue;
      result = { id: box.id, x: box.x + dx, y: box.y + dy, visible: true };
      occupied.push(rect);
      break;
    }
    results.set(box.id, result);
  }
  return boxes.map((box) => results.get(box.id)!);
}
