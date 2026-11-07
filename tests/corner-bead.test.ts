import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Level, Point2, Room, Wall } from '../src/model/types';
import { beadFacets, cornerBeadMesh, roomCorners } from '../src/scene/cornerBead';

const key = (point: number[]) => point.map((v) => v.toFixed(6)).join(',');

function room(polygon: Point2[]): Room {
  return {
    id: 'r',
    name: 'Pièce',
    kind: 'living',
    polygon,
    label: [0, 0],
    viewpoint: [0, 0],
  };
}

function level(walls: Wall[], rooms: Room[]): Level {
  return {
    id: 'l',
    name: 'Niveau',
    elevation: 0,
    ceilingHeight: 2.7,
    outline: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    walls,
    rooms,
    lights: [],
    spawn: { position: [4, 3], yaw: 0 },
  };
}

/** The demonstration studio: four walls, each offset by half its thickness. */
function studio(): Level {
  return level(
    [
      { id: 'n', start: [0, 0.15], end: [8, 0.15], thickness: 0.3 },
      { id: 'e', start: [7.85, 0.15], end: [7.85, 5.85], thickness: 0.3 },
      { id: 's', start: [0, 5.85], end: [8, 5.85], thickness: 0.3 },
      { id: 'w', start: [0.15, 0.15], end: [0.15, 5.85], thickness: 0.3 },
    ],
    [
      room([
        [0.3, 0.3],
        [7.7, 0.3],
        [7.7, 5.7],
        [0.3, 5.7],
      ]),
    ],
  );
}

test('a square room yields its four inner corners, not the centreline crossings', () => {
  const corners = roomCorners(studio()).map((bead) => bead.corner.map((v) => +v.toFixed(3)));
  const sorted = corners.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(sorted, [
    [0.3, 0.3],
    [0.3, 5.7],
    [7.7, 0.3],
    [7.7, 5.7],
  ]);
});

test('the corner sits half a thickness inside each centreline', () => {
  const [bead] = roomCorners(studio()).filter((c) => c.corner[0] < 1 && c.corner[1] < 1);
  // The two centrelines cross at (0.15, 0.15); the inner faces at (0.3, 0.3).
  assert.ok(Math.abs(bead.corner[0] - 0.3) < 1e-9);
  assert.ok(Math.abs(bead.corner[1] - 0.3) < 1e-9);
});

test('a convex corner is skipped: its bisector points outside the house', () => {
  const outside = level(
    [
      { id: 'a', start: [0, 0], end: [4, 0], thickness: 0.2 },
      { id: 'b', start: [0, 0], end: [0, 4], thickness: 0.2 },
    ],
    [
      room([
        [-3, -3],
        [-0.1, -3],
        [-0.1, -0.1],
        [-3, -0.1],
      ]),
    ],
  );
  assert.deepEqual(roomCorners(outside), []);
});

test('a T-junction is skipped: the crossing lands in the middle of one wall', () => {
  const tee = level(
    [
      { id: 'a', start: [0, 0], end: [4, 0], thickness: 0.2 },
      { id: 'b', start: [2, 0], end: [2, 3], thickness: 0.2 },
    ],
    [
      room([
        [0.1, 0.1],
        [3.9, 0.1],
        [3.9, 2.9],
        [0.1, 2.9],
      ]),
    ],
  );
  assert.deepEqual(roomCorners(tee), []);
});

test('collinear walls are one wall split in two, not a corner', () => {
  const split = level(
    [
      { id: 'a', start: [0, 0], end: [2, 0], thickness: 0.2 },
      { id: 'b', start: [2, 0], end: [4, 0], thickness: 0.2 },
    ],
    [
      room([
        [0.1, 0.1],
        [3.9, 0.1],
        [3.9, 2.9],
        [0.1, 2.9],
      ]),
    ],
  );
  assert.deepEqual(roomCorners(split), []);
});

test('the bead is a closed solid: every edge is shared by exactly two facets', () => {
  const [bead] = roomCorners(studio());
  const edges = new Map<string, number>();
  for (const facet of beadFacets(bead, 0.004)) {
    for (let i = 0; i < facet.points.length; i++) {
      const a = key(facet.points[i]);
      const b = key(facet.points[(i + 1) % facet.points.length]);
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edges) {
    assert.equal(count, 2, `edge ${edge} must be shared by two facets, found ${count}`);
  }
});

test('the visible facet faces into the room and protrudes by size over root two', () => {
  const [bead] = roomCorners(studio()).filter((c) => c.corner[0] < 1 && c.corner[1] < 1);
  const size = 0.004;
  const [facet] = beadFacets(bead, size);
  // The room is the quadrant x > 0.3, z > 0.3 from this corner.
  assert.ok(facet.normal[0] > 0, 'the facet faces +x');
  assert.ok(facet.normal[2] > 0, 'the facet faces +z');
  const centre = facet.points.reduce(
    (sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4, sum[2] + point[2] / 4],
    [0, 0, 0],
  );
  const offset = Math.hypot(centre[0] - bead.corner[0], centre[2] - bead.corner[1]);
  assert.ok(Math.abs(offset - size / Math.SQRT2) < 1e-9, `protrudes ${offset}`);
});

test('the legs face into their own wall, so back-face culling hides them', () => {
  const [bead] = roomCorners(studio()).filter((c) => c.corner[0] < 1 && c.corner[1] < 1);
  const [, legA, legB] = beadFacets(bead, 0.004);
  // Wall n runs along x at z = 0.3, so its leg must face -z; wall w faces -x.
  assert.ok(legA.normal[2] < 0, 'the leg on wall n faces the wall');
  assert.ok(legB.normal[0] < 0, 'the leg on wall w faces the wall');
});

test('the merged mesh carries one prism per corner', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = cornerBeadMesh(scene, studio(), 0.004, null);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  // Five facets per bead, each with its own vertices: 4 + 4 + 4 + 3 + 3.
  assert.equal(positions.length / 3, 4 * 18);
  mesh.dispose();
  scene.dispose();
  engine.dispose();
});
