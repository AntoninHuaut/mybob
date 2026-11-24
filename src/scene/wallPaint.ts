import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { Level } from '../model/types';
import { wallSideSpans } from '../model/paint';
import type { Materials } from './materials';

/**
 * One solid piece of a wall in the wall's local frame (x along it from `start`, y up from
 * the level datum): its top goes from `from` at `start` to `to` at `end`, flat or under a
 * ceiling slope.
 */
export interface WallPiece {
  start: number;
  end: number;
  bottom: number;
  from: number;
  to: number;
}

/** Paint stands this far off the plaster: enough with the material's depth offset not to flicker. */
export const PAINT_OFFSET = 0.002;
/** Where a side's room is looked for: just off the face, as the skirting does. */
const SIDE_SAMPLE = 0.01;

/**
 * The painted faces of a level: for every wall and every room that carries a `wallColor`,
 * one mesh hugging that room's side of the wall, piece by piece, around the openings.
 * Named `wall:<id>:paint:<room>`, so the façade cutaway clips it with the wall it covers.
 * Never picked nor collided: the plaster behind keeps those roles.
 */
export function buildWallPaint(
  level: Level,
  scene: Scene,
  materials: Materials,
  wallNodes: ReadonlyMap<string, TransformNode>,
  pieces: ReadonlyMap<string, readonly WallPiece[]>,
): Mesh[] {
  if (!level.rooms.some((room) => room.wallColor)) return [];
  const meshes: Mesh[] = [];
  for (const wall of level.walls) {
    const node = wallNodes.get(wall.id);
    const wallPieces = pieces.get(wall.id);
    if (!node || !wallPieces?.length) continue;
    const byRoom = new Map<
      string,
      { color: string; positions: number[]; normals: number[]; uvs: number[]; indices: number[] }
    >();
    for (const sign of [-1, 1] as const) {
      const z = sign * (wall.thickness / 2 + PAINT_OFFSET);
      for (const piece of wallPieces) {
        const length = piece.end - piece.start;
        const top = (x: number) =>
          length > 0
            ? piece.from + ((piece.to - piece.from) * (x - piece.start)) / length
            : piece.from;
        for (const span of wallSideSpans(
          level,
          wall,
          piece.start,
          piece.end,
          sign * (wall.thickness / 2 + SIDE_SAMPLE),
        )) {
          const color = span.room.wallColor;
          if (!color) continue;
          // A raised room's paint starts at its own floor, not at the lower neighbour's.
          const bottom = Math.max(piece.bottom, span.room.floorOffset ?? 0);
          const top0 = Math.max(top(span.start), bottom),
            top1 = Math.max(top(span.end), bottom);
          if (top0 - bottom < 1e-4 && top1 - bottom < 1e-4) continue;
          const data = byRoom.get(span.room.id) ?? {
            color,
            positions: [],
            normals: [],
            uvs: [],
            indices: [],
          };
          byRoom.set(span.room.id, data);
          const first = data.positions.length / 3;
          const corners: [number, number][] = [
            [span.start, bottom],
            [span.end, bottom],
            [span.end, top1],
            [span.start, top0],
          ];
          for (const [x, y] of corners) {
            data.positions.push(x, y, z);
            data.normals.push(0, 0, sign);
            // Metres, as `worldScaleUvs` gives the plaster: the grain keeps its size.
            data.uvs.push(sign > 0 ? x : -x, y);
          }
          data.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
        }
      }
    }
    for (const [roomId, data] of byRoom) {
      const mesh = new Mesh(`wall:${wall.id}:paint:${roomId}`, scene);
      const vertexData = new VertexData();
      vertexData.positions = data.positions;
      vertexData.normals = data.normals;
      vertexData.uvs = data.uvs;
      vertexData.indices = data.indices;
      vertexData.applyToMesh(mesh);
      mesh.parent = node;
      mesh.material = materials.paint(data.color);
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.receiveShadows = true;
      mesh.metadata = { kind: 'paint', roomId };
      mesh.freezeWorldMatrix();
      meshes.push(mesh);
    }
  }
  return meshes;
}
