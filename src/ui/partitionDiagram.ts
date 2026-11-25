import { bounds } from '../model/geometry';
import type { Level, Point2 } from '../model/types';
import { escapeHtml } from './format';

export function partitionDiagram(level: Level) {
  const box = bounds(level.outline);
  const pad = Math.max(box.width, box.depth) * 0.05;
  return `<svg aria-label="Plan des pièces et des murs" viewBox="${box.minX - pad} ${box.minZ - pad} ${box.width + 2 * pad} ${box.depth + 2 * pad}" style="width:100%;height:14rem;touch-action:none">
  ${level.rooms.map((room, i) => `<polygon fill="${i % 2 ? '#c7dfd3' : '#ead8c4'}" points="${room.polygon.map((p) => p.join(',')).join(' ')}"><title>${escapeHtml(room.name)}</title></polygon>`).join('')}
  ${level.walls.map((w) => `<line stroke="#625951" stroke-width="${w.thickness}" x1="${w.start[0]}" y1="${w.start[1]}" x2="${w.end[0]}" y2="${w.end[1]}"/>`).join('')}</svg>`;
}

export function diagramPoint(svg: SVGSVGElement, event: PointerEvent): Point2 | undefined {
  const transform = svg.getScreenCTM();
  if (!transform) return;
  const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
  return [local.x, local.y];
}
