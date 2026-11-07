import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import {
  bounceFaces,
  bouncePolynomial,
  createInteriorEnvironment,
  createInteriorOcclusion,
  INTERIOR_GROUND_COLOR,
} from '../src/scene/interiorAmbience';

/** Mirrors `computeEnvironmentIrradiance` from Babylon's harmonics shader. */
function irradiance(polynomial: ReturnType<typeof bouncePolynomial>, normal: number[]) {
  const [nx, ny, nz] = normal;
  const channel = (vector: { asArray(): number[] }, index: number) => vector.asArray()[index];
  return [0, 1, 2].map((index) => {
    const x = channel(polynomial.x, index),
      y = channel(polynomial.y, index),
      z = channel(polynomial.z, index),
      xx = channel(polynomial.xx, index),
      yy = channel(polynomial.yy, index),
      zz = channel(polynomial.zz, index),
      xy = channel(polynomial.xy, index),
      yz = channel(polynomial.yz, index),
      zx = channel(polynomial.zx, index);
    return (
      (xx - zz) * nx * nx +
      (yy - zz) * ny * ny +
      zz +
      xy * nx * ny +
      zx * nx * nz +
      yz * ny * nz +
      x * nx +
      y * ny +
      z * nz
    );
  });
}

function fixture() {
  const engine = new NullEngine({
    renderWidth: 800,
    renderHeight: 600,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('walk', 0, 1, 5, Vector3.Zero(), scene);
  return { engine, scene, camera };
}

test('the generated environment lights every wall, not only the ceiling and floor', () => {
  const polynomial = bouncePolynomial(bounceFaces());
  const normals = {
    right: [1, 0, 0],
    left: [-1, 0, 0],
    up: [0, 1, 0],
    down: [0, -1, 0],
    front: [0, 0, 1],
    back: [0, 0, -1],
  };
  for (const [name, normal] of Object.entries(normals)) {
    const value = irradiance(polynomial, normal);
    assert.ok(
      value.every((channel) => channel > 0),
      `${name} must receive positive irradiance, got ${value.join(', ')}`,
    );
  }
  const up = irradiance(polynomial, normals.up);
  const down = irradiance(polynomial, normals.down);
  assert.ok(
    up[0] > down[0],
    'the ceiling bounce must stay brighter than the floor bounce so the room reads top-to-bottom',
  );
});

test('the visit ground bounce is darker than the editor one', () => {
  const editor = [0.7137, 0.7059, 0.6353];
  assert.ok(INTERIOR_GROUND_COLOR.r < editor[0]);
  assert.ok(INTERIOR_GROUND_COLOR.g < editor[1]);
  assert.ok(INTERIOR_GROUND_COLOR.b < editor[2]);
});

test('an engine without raw textures or a geometry buffer degrades to no ambience', () => {
  const { engine, scene, camera } = fixture();
  try {
    assert.equal(
      createInteriorEnvironment(scene),
      undefined,
      'NullEngine cannot upload a raw cube texture, so the visit keeps its previous lighting',
    );
    assert.equal(
      createInteriorOcclusion(scene, camera),
      undefined,
      'no geometry buffer means no ambient occlusion',
    );
    assert.ok(
      !scene.geometryBufferRenderer,
      'a refused occlusion must not leave the geometry buffer rendering every frame',
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
