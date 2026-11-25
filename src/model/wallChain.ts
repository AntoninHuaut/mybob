import { distanceToPolygonBoundary, pointInPolygon, polygonInsidePolygon } from './geometry';
import type { Point2 } from './types';
import { simplePolygon } from './validate';
import { VISITOR_CLEARANCE } from './visitor';

export function enclosure(axes: Point2[], thickness: number) {
  if (
    axes.length < 3 ||
    axes.length > 1000 ||
    !simplePolygon(axes) ||
    !Number.isFinite(thickness) ||
    thickness <= 0
  )
    throw new Error('Les murs doivent former un contour fermé sans croisement.');
  let signedArea = 0;
  const normals = axes.map((a, i): Point2 => {
    const b = axes[(i + 1) % axes.length];
    signedArea += a[0] * b[1] - a[1] * b[0];
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      len = Math.hypot(dx, dz);
    return [-dz / len, dx / len];
  });
  function offset(margin: number) {
    return axes.map((a, i): Point2 => {
      const previous = normals[(i + axes.length - 1) % axes.length],
        next = normals[i];
      const denominator = 1 + previous[0] * next[0] + previous[1] * next[1];
      if (denominator < 1e-10) throw new Error('Deux murs se replient sur le même axe.');
      const scale = (margin * Math.sign(signedArea)) / denominator;
      return [a[0] + (previous[0] + next[0]) * scale, a[1] + (previous[1] + next[1]) * scale];
    });
  }
  const polygon = offset(thickness / 2),
    outline = offset(-thickness / 2);
  if (
    !simplePolygon(outline) ||
    !simplePolygon(polygon) ||
    !polygonInsidePolygon(polygon, axes) ||
    polygon.some((a, i) => {
      const b = polygon[(i + 1) % polygon.length],
        normal = normals[i];
      return (b[0] - a[0]) * normal[1] - (b[1] - a[1]) * normal[0] <= 0;
    })
  )
    throw new Error('L’épaisseur des murs ne laisse pas un contour intérieur valide.');
  return { polygon, outline, viewpoint: interiorViewpoint(polygon) };
}

export function interiorViewpoint(polygon: Point2[]) {
  const candidates: Point2[] = [
    polygon.reduce<Point2>(
      (sum, p) => [sum[0] + p[0] / polygon.length, sum[1] + p[1] / polygon.length],
      [0, 0],
    ),
  ];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      c = polygon[(i + 2) % polygon.length];
    const wa = Math.hypot(b[0] - c[0], b[1] - c[1]),
      wb = Math.hypot(c[0] - a[0], c[1] - a[1]),
      wc = Math.hypot(a[0] - b[0], a[1] - b[1]);
    candidates.push([
      (a[0] * wa + b[0] * wb + c[0] * wc) / (wa + wb + wc),
      (a[1] * wa + b[1] * wb + c[1] * wc) / (wa + wb + wc),
    ]);
  }
  const viewpoint = candidates.find(
    (p) => pointInPolygon(p, polygon) && distanceToPolygonBoundary(p, polygon) > VISITOR_CLEARANCE,
  );
  if (!viewpoint) throw new Error('Le contour ne permet pas de placer le point de visite.');
  return viewpoint;
}
