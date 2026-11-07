import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { worldScaleUvs } from '../src/scene/buildHouse';
import {
  greyFromField,
  normalFromHeight,
  createSurfaceTextures,
  surfaceMapData,
  type SurfaceMapData,
} from '../src/scene/surfaceTextures';

function channel(map: SurfaceMapData, x: number, y: number, c: number) {
  return map.data[(y * map.size + x) * 4 + c];
}

test('a flat height field gives a flat normal', () => {
  const size = 8;
  const flat = new Float32Array(size * size).fill(0.5);
  const map = normalFromHeight(flat, size, 4);
  for (let i = 0; i < size * size; i++) {
    assert.equal(map[i * 4], 128, 'no tilt in x');
    assert.equal(map[i * 4 + 1], 128, 'no tilt in y');
    assert.equal(map[i * 4 + 2], 255, 'the normal points straight out');
  }
});

test('a ramp tilts the normal against the slope', () => {
  const size = 8;
  const ramp = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ramp[y * size + x] = x / size;
  const map = normalFromHeight(ramp, size, 4);
  const middle = (4 * size + 4) * 4;
  assert.ok(map[middle] < 128, 'a rising slope must lean the normal towards -x');
  assert.equal(map[middle + 1], 128, 'a ramp along x must not tilt y');
});

test('a grey field becomes an opaque grey texture', () => {
  const field = new Float32Array([0, 0.5, 1, 2]);
  const map = greyFromField(field, 2);
  assert.deepEqual(
    [...map],
    [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255, 255, 255, 255, 255],
  );
});

/** The seam is one texel wide in the periodic domain, so it must not stand out. */
function assertTiles(map: SurfaceMapData, name: string) {
  for (let y = 0; y < map.size; y++) {
    let interior = 0;
    for (let x = 0; x < map.size - 1; x++) {
      for (let c = 0; c < 3; c++) {
        interior = Math.max(interior, Math.abs(channel(map, x, y, c) - channel(map, x + 1, y, c)));
      }
    }
    for (let c = 0; c < 3; c++) {
      const seam = Math.abs(channel(map, 0, y, c) - channel(map, map.size - 1, y, c));
      assert.ok(
        seam <= interior * 1.5 + 2,
        `${name} must tile horizontally: seam ${seam} against an interior step of ${interior} at row ${y}`,
      );
    }
  }
  for (let x = 0; x < map.size; x++) {
    let interior = 0;
    for (let y = 0; y < map.size - 1; y++) {
      for (let c = 0; c < 3; c++) {
        interior = Math.max(interior, Math.abs(channel(map, x, y, c) - channel(map, x, y + 1, c)));
      }
    }
    for (let c = 0; c < 3; c++) {
      const seam = Math.abs(channel(map, x, 0, c) - channel(map, x, map.size - 1, c));
      assert.ok(
        seam <= interior * 1.5 + 2,
        `${name} must tile vertically: seam ${seam} against an interior step of ${interior} at column ${x}`,
      );
    }
  }
}

test('every generated map tiles without a seam', () => {
  const maps = surfaceMapData();
  for (const [name, map] of Object.entries(maps)) assertTiles(map, name);
});

test('the relief maps carry relief and the roughness maps stay near one', () => {
  const maps = surfaceMapData();
  for (const name of ['plasterNormal', 'woodNormal', 'concreteNormal', 'metalNormal'] as const) {
    const map = maps[name];
    let min = 255;
    let max = 0;
    for (let i = 0; i < map.size * map.size; i++) {
      const value = map.data[i * 4];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    assert.ok(max - min > 8, `${name} must actually tilt, got a range of ${max - min}`);
  }
  for (const name of [
    'plasterRoughness',
    'woodRoughness',
    'concreteRoughness',
    'metalRoughness',
  ] as const) {
    const map = maps[name];
    let min = 255;
    let max = 0;
    for (let i = 0; i < map.size * map.size; i++) {
      const value = map.data[i * 4];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    assert.ok(min > 100, `${name} multiplies the material roughness, so it must stay near one`);
    assert.ok(max - min > 4, `${name} must vary, otherwise it is a constant`);
  }
});

test('the parquet roughness varies from plank to plank', () => {
  const map = surfaceMapData().woodRoughness;
  // Two texels in the same row but different planks must not be identical: the
  // whole point is that the floor stops being uniformly matte.
  const row = 8;
  const first = channel(map, 8, row, 0);
  const second = channel(map, 8 + 128, row, 0);
  assert.notEqual(first, second, 'two planks must not share the same roughness');
});

test('box UVs are rewritten in metres, whatever the face', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const mesh = MeshBuilder.CreateBox('wall', { width: 4, height: 2.5, depth: 0.2 }, scene);
    worldScaleUvs(mesh);
    const uvs = mesh.getVerticesData(VertexBuffer.UVKind)!;
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    let largeFaceU = 0;
    let largeFaceV = 0;
    for (let i = 0; i < normals.length / 3; i++) {
      if (Math.abs(normals[i * 3 + 2]) < 0.5) continue;
      largeFaceU = Math.max(largeFaceU, Math.abs(uvs[i * 2]));
      largeFaceV = Math.max(largeFaceV, Math.abs(uvs[i * 2 + 1]));
    }
    assert.equal(largeFaceU, 2, 'a 4 m wall spans four one-metre tiles, so u reaches 2');
    assert.equal(largeFaceV, 1.25, 'a 2.5 m wall spans two and a half tiles, so v reaches 1.25');
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('the maps reach the GPU as tiling textures', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const textures = createSurfaceTextures(scene);
    const expected: [keyof typeof textures, number][] = [
      ['plasterNormal', 256],
      ['plasterRoughness', 256],
      ['woodNormal', 512],
      ['woodRoughness', 512],
      ['concreteNormal', 256],
      ['concreteRoughness', 256],
      ['metalNormal', 256],
      ['metalRoughness', 256],
    ];
    for (const [name, size] of expected) {
      const texture = textures[name];
      assert.equal(texture.getSize().width, size, `${name} must be ${size} px`);
      assert.equal(texture.wrapU, Texture.WRAP_ADDRESSMODE, `${name} must tile`);
      assert.equal(texture.wrapV, Texture.WRAP_ADDRESSMODE, `${name} must tile`);
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
