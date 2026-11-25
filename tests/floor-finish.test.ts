import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { packShareDocument, unpackShareDocument } from '../src/model/linkPacker';
import { validateProject } from '../src/model/validate';
import { createMaterials } from '../src/scene/materials';

test('import and sharing preserve the blond parquet finish', async () => {
  const project = JSON.parse(
    await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
  );
  project.finishes = { ...project.finishes, floorFinish: 'blond-parquet' };
  const imported = validateProject(project);
  assert.equal(imported.finishes?.floorFinish, 'blond-parquet');
  assert.deepEqual(unpackShareDocument(packShareDocument(imported)).finishes, imported.finishes);
  project.finishes.floorFinish = 'unknown';
  assert.throws(() => validateProject(project), /Finition de sol/);
});

test('parquet scales the colour, grain and fine joints to the same strips', (t) => {
  const engine = new NullEngine();
  t.mock.method(engine, 'createCanvas', (width: number, height: number) => ({
    width,
    height,
    getContext: () => ({
      fillRect() {},
      beginPath() {},
      moveTo() {},
      bezierCurveTo() {},
      stroke() {},
    }),
  }));
  const scene = new Scene(engine);
  try {
    const original = createMaterials(scene);
    const parquet = createMaterials(scene, { floorFinish: 'blond-parquet' });
    assert.equal(
      original.concrete.albedoColor.toHexString(),
      parquet.concrete.albedoColor.toHexString(),
    );
    assert.ok(parquet.wood.bumpTexture!.level < original.wood.bumpTexture!.level);
    for (const texture of [
      parquet.wood.albedoTexture,
      parquet.wood.bumpTexture,
      parquet.wood.microSurfaceTexture,
    ]) {
      assert.ok(texture instanceof Texture);
      assert.deepEqual([texture.uScale, texture.vScale], [1.5, 2]);
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
