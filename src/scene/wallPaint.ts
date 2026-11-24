import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { Level, Point2, Room, Wall } from '../model/types';
import { alongWall, wallLength } from '../model/geometry';
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
/** How far along the face a reveal looks for its room: room outlines stop short of corners. */
const REVEAL_REACH = 0.25;
const EPSILON = 1e-4;

type Vec3 = [number, number, number];
interface Surface {
  color: string;
  positions: number[];
  normals: number[];
  indices: number[];
}

const pieceTop = (piece: WallPiece, x: number) => {
  const length = piece.end - piece.start;
  return length > 0
    ? piece.from + ((piece.to - piece.from) * (x - piece.start)) / length
    : piece.from;
};

/** `[from, to]` minus the given intervals. */
function subtract(from: number, to: number, cuts: [number, number][]): [number, number][] {
  let parts: [number, number][] = [[from, to]];
  for (const [a, b] of cuts)
    parts = parts.flatMap(([x, y]): [number, number][] =>
      b <= x || a >= y
        ? [[x, y]]
        : [
            ...(a > x ? [[x, a] as [number, number]] : []),
            ...(b < y ? [[b, y] as [number, number]] : []),
          ],
    );
  return parts.filter(([x, y]) => y - x > EPSILON);
}

function insideWall(point: Point2, wall: Wall): boolean {
  const length = wallLength(wall);
  const dx = (wall.end[0] - wall.start[0]) / length,
    dz = (wall.end[1] - wall.start[1]) / length;
  const px = point[0] - wall.start[0],
    pz = point[1] - wall.start[1];
  const along = px * dx + pz * dz;
  return along >= 0 && along <= length && Math.abs(-px * dz + pz * dx) <= wall.thickness / 2;
}

/**
 * The painted faces of a level: for every wall and every room that carries a `wallColor`,
 * one mesh hugging that room's side of the wall, piece by piece, around the openings. The
 * reveals, soffits and ledges of the openings and the free ends of walls are painted too,
 * each half of their depth in the colour of the room on its side.
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
    const length = wallLength(wall);
    const half = wall.thickness / 2 + PAINT_OFFSET;
    const floor = Math.min(...wallPieces.map((piece) => piece.bottom));
    const sample = (sign: number) => sign * (wall.thickness / 2 + SIDE_SAMPLE);
    const byRoom = new Map<string, Surface>();
    const quad = (room: Room, corners: Vec3[], normal: Vec3) => {
      const data = byRoom.get(room.id) ?? {
        color: room.wallColor!,
        positions: [],
        normals: [],
        indices: [],
      };
      byRoom.set(room.id, data);
      const first = data.positions.length / 3;
      for (const corner of corners) {
        data.positions.push(...corner);
        data.normals.push(...normal);
      }
      data.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    };
    /** The room facing one side of the wall nearest to `x`. */
    const roomAt = (sign: number, x: number) => {
      let best: { room: Room; distance: number } | undefined;
      for (const span of wallSideSpans(
        level,
        wall,
        x - REVEAL_REACH,
        x + REVEAL_REACH,
        sample(sign),
      )) {
        const distance = Math.max(0, span.start - x, x - span.end);
        if (!best || distance < best.distance) best = { room: span.room, distance };
      }
      return best?.room;
    };

    for (const sign of [-1, 1] as const) {
      const z = sign * half;
      for (const piece of wallPieces) {
        for (const span of wallSideSpans(level, wall, piece.start, piece.end, sample(sign))) {
          if (!span.room.wallColor) continue;
          // A raised room's paint starts at its own floor, not at the lower neighbour's.
          const bottom = Math.max(piece.bottom, span.room.floorOffset ?? 0);
          const top0 = Math.max(pieceTop(piece, span.start), bottom),
            top1 = Math.max(pieceTop(piece, span.end), bottom);
          if (top0 - bottom < EPSILON && top1 - bottom < EPSILON) continue;
          // Overlapping the reveals by the paint offset closes the corner over the bevel.
          const x0 = span.start - (span.start - piece.start < EPSILON ? PAINT_OFFSET : 0),
            x1 = span.end + (piece.end - span.end < EPSILON ? PAINT_OFFSET : 0);
          quad(
            span.room,
            [
              [x0, bottom - PAINT_OFFSET, z],
              [x1, bottom - PAINT_OFFSET, z],
              [x1, top1, z],
              [x0, top0, z],
            ],
            [0, 0, sign],
          );
        }

        // Reveals: the piece's ends, where no neighbouring piece covers them.
        for (const [x, direction] of [
          [piece.start, -1],
          [piece.end, 1],
        ] as const) {
          const covers = wallPieces
            .filter(
              (other) =>
                other !== piece &&
                Math.abs((direction > 0 ? other.start : other.end) - x) < EPSILON,
            )
            .map((other): [number, number] => [other.bottom, pieceTop(other, x)]);
          const atEnd = x < EPSILON || x > length - EPSILON;
          const buried =
            atEnd &&
            level.walls.some(
              (other) =>
                other !== wall &&
                insideWall(
                  alongWall(wall, x + direction * 0.02, (sign * wall.thickness) / 4),
                  other,
                ),
            );
          const room = buried ? undefined : roomAt(sign, x);
          if (!room?.wallColor) continue;
          const bottom = Math.max(piece.bottom, room.floorOffset ?? 0);
          const X = x + direction * PAINT_OFFSET;
          for (const [y0, y1] of subtract(bottom, pieceTop(piece, x), covers))
            quad(
              room,
              [
                [X, y0, 0],
                [X, y0, z],
                [X, y1, z],
                [X, y1, 0],
              ],
              [direction, 0, 0],
            );
        }

        // Soffit under a lintel, ledge over a sill: where no piece rests on them.
        const flat = Math.abs(piece.from - piece.to) < EPSILON;
        const faces: [number, number][] = [];
        if (piece.bottom > floor + EPSILON) faces.push([piece.bottom, -1]);
        if (flat && piece.from < (wall.height ?? level.ceilingHeight) - EPSILON)
          faces.push([piece.from, 1]);
        for (const [y, up] of faces) {
          const covers = wallPieces
            .filter(
              (other) =>
                other !== piece &&
                (up > 0
                  ? Math.abs(other.bottom - y) < EPSILON
                  : Math.abs(other.from - other.to) < EPSILON &&
                    Math.abs(other.from - y) < EPSILON),
            )
            .map((other): [number, number] => [other.start, other.end]);
          const Y = y + up * PAINT_OFFSET;
          for (const [a, b] of subtract(piece.start, piece.end, covers))
            for (const span of wallSideSpans(level, wall, a, b, sample(sign))) {
              if (!span.room.wallColor || y < (span.room.floorOffset ?? 0)) continue;
              quad(
                span.room,
                [
                  [span.start, Y, 0],
                  [span.end, Y, 0],
                  [span.end, Y, z],
                  [span.start, Y, z],
                ],
                [0, up, 0],
              );
            }
        }
      }
    }
    for (const [roomId, data] of byRoom) {
      const mesh = new Mesh(`wall:${wall.id}:paint:${roomId}`, scene);
      const vertexData = new VertexData();
      vertexData.positions = data.positions;
      vertexData.normals = data.normals;
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
