import type { Level, Point2 } from '../model/types';
import { alongWall, bounds } from '../model/geometry';
import { escapeHtml } from './format';

export function minimap(level: Level, selectedId?: string) {
  const b = bounds(level.outline);
  const points = (ps: Point2[]) => ps.map(p => p.join(',')).join(' ');
  const walls = level.walls.map(w => {
    const openings = (w.openings ?? []).map(o => {
      const a = alongWall(w, o.offset), z = alongWall(w, o.offset + o.width);
      return `<line x1="${a[0]}" y1="${a[1]}" x2="${z[0]}" y2="${z[1]}" stroke="${o.kind === 'window' ? '#a4c5c0' : '#faf9f4'}" stroke-width="${w.thickness + .035}"/>`;
    }).join('');
    return `<line x1="${w.start[0]}" y1="${w.start[1]}" x2="${w.end[0]}" y2="${w.end[1]}" stroke="#9daba1" stroke-width="${w.thickness}"/>${openings}`;
  }).join('');
  const rooms = level.rooms.map(r => `<polygon points="${points(r.polygon)}" fill="${r.id === selectedId ? '#cfdfd3' : r.kind === 'garage' ? '#e5e6df' : '#f1ebdf'}" data-map-room="${escapeHtml(r.id)}" tabindex="0" role="button" aria-label="${escapeHtml(r.name)}"/>`).join('');
  return `<svg class="minimap-svg" viewBox="${b.minX - .6} ${b.minZ - .6} ${b.width + 1.2} ${b.depth + 1.2}" aria-label="Plan de repérage du niveau" role="group"><polygon points="${points(level.outline)}" fill="#faf9f4"/>${rooms}<g pointer-events="none">${walls}</g><g id="map-marker" pointer-events="none" visibility="hidden"><path d="M0,-.8 .38,0 -.38,0Z" fill="#2e6655" fill-opacity=".2"/><circle r=".18" fill="#265e4c" stroke="white" stroke-width=".07"/></g></svg>`;
}
