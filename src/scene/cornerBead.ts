import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, Point2, Wall } from '../model/types';
import { pointInPolygon } from '../model/geometry';
import { ceilingHeightAt } from '../model/ceiling';
import { project, windsWithNormal, type Facet } from './beveledBox';

/**
 * A chamfer on the concave vertical corner between two walls.
 *
 * The wall bevel only reaches convex arrises. Where two walls meet inside a room
 * there is no arris at all: the two inner faces cross at a razor concave edge,
 * and the normal flips from one face to the other in a single texel. This module
 * builds the small 45° facet that replaces that edge.
 *
 * It is a bead, not a cut. A concave corner has its material on the outside, so
 * chamfering it would mean removing plaster — which notches the façade, since the
 * wall is only a few centimetres thick. The prism therefore sits in the corner
 * nook and protrudes by `size / √2`; its two legs lie on the wall faces and face
 * into them, so back-face culling hides them and only the facet is drawn.
 */

export interface CornerBead {
  /** The concave corner itself, where the two inner faces meet. */
  corner: Point2;
  /** Unit directions along each inner face, away from the corner. */
  eA: Point2;
  eB: Point2;
  floor: number;
  top: number;
}

function unit2(from: Point2, to: Point2): Point2 {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
}

/** Where two infinite lines cross, or nothing when they are parallel. */
function crossing(
  a: { point: Point2; direction: Point2 },
  b: { point: Point2; direction: Point2 },
): Point2 | undefined {
  const denominator = a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0];
  if (Math.abs(denominator) < 1e-9) return undefined;
  const dx = b.point[0] - a.point[0];
  const dz = b.point[1] - a.point[1];
  const t = (dx * b.direction[1] - dz * b.direction[0]) / denominator;
  return [a.point[0] + a.direction[0] * t, a.point[1] + a.direction[1] * t];
}

/** The end of `wall` that `point` sits on, if it sits on one at all. */
function endAt(wall: Wall, point: Point2, tolerance: number): 'start' | 'end' | undefined {
  const start = Math.hypot(point[0] - wall.start[0], point[1] - wall.start[1]);
  const end = Math.hypot(point[0] - wall.end[0], point[1] - wall.end[1]);
  if (start <= tolerance && start <= end) return 'start';
  if (end <= tolerance) return 'end';
  return undefined;
}

/**
 * Every concave corner of the level.
 *
 * The walls of a project are not drawn endpoint to endpoint: each is offset by
 * half its thickness, so `studio-n` starts at (0, 0.15) and `studio-w` at
 * (0.15, 0.15). The corner is therefore the crossing of the two *inner* faces,
 * not a shared vertex. The bisector of the two wall directions says which side
 * the room is on, and a probe past the corner tells a room corner from a convex
 * one — the latter's bisector points outside the house.
 *
 * A T-junction is skipped: the crossing lands in the middle of one wall, so that
 * wall has no end there.
 */
export function roomCorners(level: Level): CornerBead[] {
  const beads: CornerBead[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < level.walls.length; i++) {
    for (let j = i + 1; j < level.walls.length; j++) {
      const a = level.walls[i];
      const b = level.walls[j];
      const centre = crossing(
        { point: a.start, direction: unit2(a.start, a.end) },
        { point: b.start, direction: unit2(b.start, b.end) },
      );
      if (!centre) continue;
      const tolerance = Math.max(a.thickness, b.thickness);
      const atA = endAt(a, centre, tolerance);
      const atB = endAt(b, centre, tolerance);
      if (!atA || !atB) continue;
      const uA = atA === 'start' ? unit2(a.start, a.end) : unit2(a.end, a.start);
      const uB = atB === 'start' ? unit2(b.start, b.end) : unit2(b.end, b.start);
      const cosine = Math.max(-1, Math.min(1, uA[0] * uB[0] + uA[1] * uB[1]));
      const angle = Math.acos(cosine);
      // Collinear walls are one wall split in two, and a hairpin has no room side.
      if (angle < 0.2 || angle > Math.PI - 0.2) continue;
      const mx = uA[0] + uB[0];
      const mz = uA[1] + uB[1];
      const length = Math.hypot(mx, mz);
      if (length < 1e-6) continue;
      const bisector: Point2 = [mx / length, mz / length];
      // Each inner face is its centreline pushed half a thickness toward the room.
      const inward = (direction: Point2): Point2 => {
        const nx = -direction[1];
        const nz = direction[0];
        return nx * bisector[0] + nz * bisector[1] > 0 ? [nx, nz] : [-nx, -nz];
      };
      const nA = inward(uA);
      const nB = inward(uB);
      const corner = crossing(
        {
          point: [a.start[0] + nA[0] * (a.thickness / 2), a.start[1] + nA[1] * (a.thickness / 2)],
          direction: uA,
        },
        {
          point: [b.start[0] + nB[0] * (b.thickness / 2), b.start[1] + nB[1] * (b.thickness / 2)],
          direction: uB,
        },
      );
      if (!corner) continue;
      const probe: Point2 = [corner[0] + bisector[0] * 0.06, corner[1] + bisector[1] * 0.06];
      const room = level.rooms.find((candidate) => pointInPolygon(probe, candidate.polygon));
      if (!room) continue;
      const key = `${Math.round(corner[0] * 1000)}:${Math.round(corner[1] * 1000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const height = Math.min(
        ceilingHeightAt(level, corner),
        a.height ?? level.ceilingHeight,
        b.height ?? level.ceilingHeight,
      );
      beads.push({
        corner,
        eA: uA,
        eB: uB,
        floor: level.elevation + (room.floorOffset ?? 0),
        top: level.elevation + height,
      });
    }
  }
  return beads;
}

/** The five facets of one bead: the 45° face, two legs, and the two caps. */
export function beadFacets(bead: CornerBead, size: number): Facet[] {
  const [cx, cz] = bead.corner;
  const a: Point2 = [cx + bead.eA[0] * size, cz + bead.eA[1] * size];
  const b: Point2 = [cx + bead.eB[0] * size, cz + bead.eB[1] * size];
  const at = (point: Point2, y: number): [number, number, number] => [point[0], y, point[1]];
  const mx = bead.eA[0] + bead.eB[0];
  const mz = bead.eA[1] + bead.eB[1];
  const length = Math.hypot(mx, mz) || 1;
  const facetNormal: [number, number, number] = [mx / length, 0, mz / length];
  // Each leg faces away from the room, into its own wall.
  const legNormal = (edge: Point2): [number, number, number] => {
    const nx = -edge[1];
    const nz = edge[0];
    const dot = nx * facetNormal[0] + nz * facetNormal[2];
    return dot < 0 ? [nx, 0, nz] : [-nx, 0, -nz];
  };
  const corner = bead.corner;
  return [
    {
      points: [at(a, bead.floor), at(b, bead.floor), at(b, bead.top), at(a, bead.top)],
      normal: facetNormal,
    },
    {
      points: [at(corner, bead.floor), at(a, bead.floor), at(a, bead.top), at(corner, bead.top)],
      normal: legNormal(bead.eA),
    },
    {
      points: [at(corner, bead.floor), at(b, bead.floor), at(b, bead.top), at(corner, bead.top)],
      normal: legNormal(bead.eB),
    },
    {
      points: [at(corner, bead.floor), at(a, bead.floor), at(b, bead.floor)],
      normal: [0, -1, 0],
    },
    {
      points: [at(corner, bead.top), at(a, bead.top), at(b, bead.top)],
      normal: [0, 1, 0],
    },
  ];
}

/** Every bead of the level, merged into one mesh so the visit gains one draw call. */
export function cornerBeadMesh(
  scene: Scene,
  level: Level,
  size: number,
  material: Material | null,
): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const bead of roomCorners(level)) {
    for (const facet of beadFacets(bead, size)) {
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
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  const mesh = new Mesh('corner-beads', scene);
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.receiveShadows = true;
  return mesh;
}
