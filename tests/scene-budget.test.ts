import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { buildHouse } from '../src/scene/buildHouse';
import { buildExterior } from '../src/scene/buildExterior';
import { createMaterials } from '../src/scene/materials';
import { FurnitureLayer } from '../src/furniture/layer';
import { createFurniture, FURNITURE_PRESETS, type FurnitureKind } from '../src/furniture/model';
import { validateProject } from '../src/model/validate';

// Count objects, not frame times: NullEngine cannot measure GPU performance.
// Baselines include real materials, exterior, and one default piece of every kind.
const budgets = {
  'maison-atelier': { meshes: 482, materials: 125, vertices: 16022 },
  'studio-demo': { meshes: 212, materials: 118, vertices: 6321 },
};

for (const name of ['maison-atelier', 'studio-demo'] as const) {
  test(`the furnished ${name} scene stays within its object budget`, async (t) => {
    const project = validateProject(
      JSON.parse(
        await readFile(new URL(`../public/projects/${name}.json`, import.meta.url), 'utf8'),
      ),
    );
    const engine = new NullEngine();
    // NullEngine needs no texture pixels. Only stub the canvas drawing API; the
    // production material factories still allocate and register every resource.
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
    scene.useRightHandedSystem = true;
    const layer = new FurnitureLayer(scene, project.levels[0]);
    try {
      buildHouse(project.levels[0], scene, createMaterials(scene, project.finishes));
      buildExterior(project, project.levels[0], scene);
      layer.setItems(
        (Object.keys(FURNITURE_PRESETS) as FurnitureKind[]).map((kind, i) =>
          createFurniture({ id: `budget-${kind}`, kind, position: [i * 3, 0] }),
        ),
      );
      const actual = {
        meshes: scene.meshes.length,
        materials: scene.materials.length,
        vertices: scene.meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0),
      };
      t.diagnostic(JSON.stringify(actual));
      for (const key of ['meshes', 'materials', 'vertices'] as const) {
        assert.ok(
          actual[key] <= budgets[name][key],
          `${name} ${key}: ${actual[key]} > ${budgets[name][key]}`,
        );
      }
    } finally {
      layer.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
}
