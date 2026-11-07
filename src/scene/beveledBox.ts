import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

/**
 * A box with chamfered edges.
 *
 * A real wall corner is not a razor edge: it carries a bead of a few millimetres
 * that catches the light. The sharp edge is the strongest "3D model" cue left in
 * the visit, because the normal flips from one face to the other in a single
 * texel and no highlight can sit on it.
 *
 * The solid is the six faces inset by the bevel, twelve chamfer strips along the
 * edges, and eight triangles closing the corners. Every facet carries its own
 * vertices, so the shading stays flat and the chamfer reads as its own surface.
 */

/** A quad or triangle of the solid, with the normal it must be shaded with. */
export interface Facet {
  points: [number, number, number][];
  normal: [number, number, number];
}

function unit(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/**
 * The facets of a chamfered box centred on the origin. `bevel` is clamped so a
 * thin element — a 12 mm skirting — cannot invert its own geometry.
 */
export function beveledBoxFacets(
  width: number,
  height: number,
  depth: number,
  bevel: number,
): Facet[] {
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const b = Math.max(0, Math.min(bevel, hx * 0.49, hy * 0.49, hz * 0.49));
  const ix = hx - b;
  const iy = hy - b;
  const iz = hz - b;
  const facets: Facet[] = [];

  // The six faces, inset by the bevel on their four sides.
  facets.push({
    points: [
      [hx, -iy, -iz],
      [hx, -iy, iz],
      [hx, iy, iz],
      [hx, iy, -iz],
    ],
    normal: [1, 0, 0],
  });
  facets.push({
    points: [
      [-hx, -iy, iz],
      [-hx, -iy, -iz],
      [-hx, iy, -iz],
      [-hx, iy, iz],
    ],
    normal: [-1, 0, 0],
  });
  facets.push({
    points: [
      [-ix, hy, -iz],
      [ix, hy, -iz],
      [ix, hy, iz],
      [-ix, hy, iz],
    ],
    normal: [0, 1, 0],
  });
  facets.push({
    points: [
      [-ix, -hy, iz],
      [ix, -hy, iz],
      [ix, -hy, -iz],
      [-ix, -hy, -iz],
    ],
    normal: [0, -1, 0],
  });
  facets.push({
    points: [
      [-ix, -iy, hz],
      [ix, -iy, hz],
      [ix, iy, hz],
      [-ix, iy, hz],
    ],
    normal: [0, 0, 1],
  });
  facets.push({
    points: [
      [ix, -iy, -hz],
      [-ix, -iy, -hz],
      [-ix, iy, -hz],
      [ix, iy, -hz],
    ],
    normal: [0, 0, -1],
  });

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      // Edge between the ±X face and the ±Y face, running along z.
      facets.push({
        points: [
          [sx * hx, sy * iy, -iz],
          [sx * hx, sy * iy, iz],
          [sx * ix, sy * hy, iz],
          [sx * ix, sy * hy, -iz],
        ],
        normal: unit(sx, sy, 0),
      });
    }
    for (const sz of [-1, 1]) {
      // Edge between the ±X face and the ±Z face, running along y.
      facets.push({
        points: [
          [sx * hx, -iy, sz * iz],
          [sx * hx, iy, sz * iz],
          [sx * ix, iy, sz * hz],
          [sx * ix, -iy, sz * hz],
        ],
        normal: unit(sx, 0, sz),
      });
    }
  }
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // Edge between the ±Y face and the ±Z face, running along x.
      facets.push({
        points: [
          [-ix, sy * hy, sz * iz],
          [ix, sy * hy, sz * iz],
          [ix, sy * iy, sz * hz],
          [-ix, sy * iy, sz * hz],
        ],
        normal: unit(0, sy, sz),
      });
    }
  }

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        facets.push({
          points: [
            [sx * hx, sy * iy, sz * iz],
            [sx * ix, sy * hy, sz * iz],
            [sx * ix, sy * iy, sz * hz],
          ],
          normal: unit(sx, sy, sz),
        });
      }
    }
  }

  return facets;
}

/** World-scale UVs: the face is picked from the normal, so the order does not matter. */
export function project(point: [number, number, number], normal: [number, number, number]) {
  const [x, y, z] = point;
  const [nx, ny, nz] = normal.map(Math.abs) as [number, number, number];
  if (nx >= ny && nx >= nz) return [z, y];
  if (ny >= nx && ny >= nz) return [x, z];
  return [x, y];
}

/**
 * Babylon winds its boxes so that the cross product of the first two edges
 * points *against* the vertex normal in a right-handed scene. A facet wound the
 * other way is culled as a back face, so this is what keeps the chamfers visible.
 */
export function windsWithNormal(
  points: [number, number, number][],
  normal: [number, number, number],
) {
  const [a, b, c] = points;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  return cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] > 0;
}

/** The mesh data of a chamfered box, ready for `VertexData.applyToMesh`. */
export function beveledBoxData(width: number, height: number, depth: number, bevel: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const facet of beveledBoxFacets(width, height, depth, bevel)) {
    const points = windsWithNormal(facet.points, facet.normal)
      ? [...facet.points].reverse()
      : facet.points;
    const start = positions.length / 3;
    for (const point of points) {
      positions.push(...point);
      normals.push(...facet.normal);
      uvs.push(...project(point, facet.normal));
    }
    for (let i = 1; i < points.length - 1; i++) indices.push(start, start + i, start + i + 1);
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  return data;
}

/** A chamfered box centred on the origin, like `MeshBuilder.CreateBox`. */
export function beveledBox(
  name: string,
  width: number,
  height: number,
  depth: number,
  bevel: number,
  scene: Scene,
): Mesh {
  const mesh = new Mesh(name, scene);
  beveledBoxData(width, height, depth, bevel).applyToMesh(mesh);
  return mesh;
}
