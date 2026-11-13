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
  'maison-atelier': { meshes: 262, materials: 27, vertices: 25768 },
  'studio-demo': { meshes: 113, materials: 20, vertices: 16067 },
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
      const house = buildHouse(project.levels[0], scene, createMaterials(scene, project.finishes));
      t.diagnostic(`house meshes: ${house.root.getChildMeshes().length}`);
      if (name === 'maison-atelier') assert.ok(house.root.getChildMeshes().length <= 133);
      const moving = new Set(
        house.doors.flatMap((door) => [door.pivot, door.pivotB, ...door.leaves]),
      );
      for (const mesh of house.root.getChildMeshes()) {
        let node = mesh as import('@babylonjs/core/node').Node | null;
        while (
          node &&
          !moving.has(node as import('@babylonjs/core/Meshes/transformNode').TransformNode)
        )
          node = node.parent;
        assert.equal(mesh.isWorldMatrixFrozen, !node, mesh.name);
      }
      buildExterior(project, project.levels[0], scene);
      layer.setItems(
        (Object.keys(FURNITURE_PRESETS) as FurnitureKind[]).map((kind, i) =>
          createFurniture({ id: `budget-${kind}`, kind, position: [i * 3, 0] }),
        ),
      );
      const bodies = scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture');
      assert.equal(bodies.length, 47);
      assert.equal(new Set(bodies.map((mesh) => mesh.material)).size, 9);
      for (const item of new Set(bodies.map((mesh) => mesh.metadata.id))) {
        const parts = bodies.filter((mesh) => mesh.metadata.id === item);
        assert.equal(parts.length, new Set(parts.map((mesh) => mesh.material)).size);
      }
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
