import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { beveledBox, beveledBoxData, beveledBoxFacets } from '../src/scene/beveledBox';

const key = (point: number[]) => point.map((v) => v.toFixed(6)).join(',');

test('the chamfered solid is closed: every edge is shared by exactly two facets', () => {
  const facets = beveledBoxFacets(4, 2.5, 0.2, 0.004);
  const edges = new Map<string, number>();
  for (const facet of facets) {
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

test('the chamfered solid keeps the requested dimensions', () => {
  const data = beveledBoxData(4, 2.5, 0.2, 0.004);
  const positions = data.positions as number[];
  const axis = (offset: number) => {
    const values = positions.filter((_, i) => i % 3 === offset);
    return [Math.min(...values), Math.max(...values)];
  };
  assert.deepEqual(axis(0), [-2, 2], 'width is preserved');
  assert.deepEqual(axis(1), [-1.25, 1.25], 'height is preserved');
  assert.deepEqual(axis(2), [-0.1, 0.1], 'depth is preserved');
});

test('the chamfer adds facets without moving the faces', () => {
  const plain = beveledBoxFacets(4, 2.5, 0.2, 0);
  const chamfered = beveledBoxFacets(4, 2.5, 0.2, 0.004);
  assert.equal(plain.length, 6 + 12 + 8, 'the topology is the same, the bevel is zero');
  assert.equal(chamfered.length, plain.length);
  // With a zero bevel the chamfer strips collapse onto the faces; with a real one
  // the face quad is inset, which is what creates the highlight band.
  const face = chamfered[0];
  assert.equal(face.points[0][0], 2, 'the +X face stays at x = 2');
  assert.ok(
    Math.abs(face.points[0][1]) < 1.25,
    'the +X face is inset in y, so the chamfer has somewhere to sit',
  );
});

test('a thin element cannot invert its own chamfer', () => {
  // A 12 mm skirting with a 4 mm bevel would leave nothing of the face.
  const facets = beveledBoxFacets(1, 0.075, 0.012, 0.004);
  for (const facet of facets) {
    for (const point of facet.points) {
      assert.ok(Math.abs(point[2]) <= 0.006 + 1e-9, 'the solid stays inside its depth');
    }
  }
});

test('the winding matches the one Babylon uses for its own boxes', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  try {
    const reference = MeshBuilder.CreateBox('plain', { width: 2, height: 2, depth: 2 }, scene);
    const chamfered = beveledBox('chamfered', 2, 2, 2, 0.02, scene);
    const winding = (mesh: typeof reference) => {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      const indices = mesh.getIndices()!;
      const signs = new Set<number>();
      for (let t = 0; t < indices.length; t += 3) {
        const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
        const e1 = [
          positions[b * 3] - positions[a * 3],
          positions[b * 3 + 1] - positions[a * 3 + 1],
          positions[b * 3 + 2] - positions[a * 3 + 2],
        ];
        const e2 = [
          positions[c * 3] - positions[a * 3],
          positions[c * 3 + 1] - positions[a * 3 + 1],
          positions[c * 3 + 2] - positions[a * 3 + 2],
        ];
        const cross = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const dot =
          cross[0] * normals[a * 3] + cross[1] * normals[a * 3 + 1] + cross[2] * normals[a * 3 + 2];
        signs.add(Math.sign(dot));
      }
      return signs;
    };
    assert.deepEqual(
      [...winding(chamfered)],
      [...winding(reference)],
      'a chamfered box must be wound like a plain one, or its chamfers are culled',
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('the chamfered box carries world-scale UVs', () => {
  const data = beveledBoxData(4, 2.5, 0.2, 0.004);
  const uvs = data.uvs as number[];
  const u = uvs.filter((_, i) => i % 2 === 0);
  const v = uvs.filter((_, i) => i % 2 === 1);
  // The face is inset by the chamfer, so the span stops a bevel short of the edge.
  assert.ok(Math.abs(Math.max(...u) - 2) < 0.01, 'a 4 m wall spans four one-metre tiles');
  assert.ok(Math.abs(Math.max(...v) - 1.25) < 0.01, 'a 2.5 m wall spans two and a half tiles');
});
