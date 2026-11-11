import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FixtureLights } from '../src/scene/fixtureLights';

test('range assignments exclude distant fittings and refresh after range and mesh changes', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const lights = Array.from(
      { length: 8 },
      (_, i) => new PointLight(`lamp-${i}`, new Vector3(i * 10, 2, 0), scene),
    );
    lights.forEach((l) => (l.range = 5.5));
    const meshes = Array.from({ length: 8 }, (_, i) => {
      const mesh = MeshBuilder.CreateBox(`wall-${i}`, { size: 1 }, scene);
      mesh.position.x = i * 10;
      return mesh;
    });
    assert.equal(
      meshes[7].lightSources.length,
      8,
      'legacy Babylon assignment includes distant lamps',
    );
    const unreachable = new PointLight('unreachable', new Vector3(1000, 1000, 1000), scene);
    unreachable.range = 1;
    lights.push(unreachable);
    const assignments = new FixtureLights(scene, lights, []);
    assignments.refresh();
    meshes.forEach((mesh, i) => assert.deepEqual(mesh.lightSources, [lights[i]]));
    assert.equal(unreachable.includedOnlyMeshes.length, 0);
    assert.ok(meshes.every((mesh) => !unreachable.canAffectMesh(mesh)));
    const edge = MeshBuilder.CreateBox('range-edge', { size: 1 }, scene);
    edge.position.set(6.5, 2, 0);
    assignments.refresh();
    assert.ok(!edge.lightSources.includes(lights[0]));
    lights[0].range = 7;
    assignments.refresh();
    assert.ok(edge.lightSources.includes(lights[0]));
    edge.position.x = 1000;
    assignments.refresh();
    assert.equal(edge.lightSources.length, 0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
import { readFileSync } from 'node:fs';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { buildHouse, poseDoor } from '../src/scene/buildHouse';
import type { Materials } from '../src/scene/materials';
import type { HouseProject } from '../src/model/types';
import { FurnitureLayer } from '../src/furniture/layer';
import { createFurniture } from '../src/furniture/model';
import { refreshFixtureLights } from '../src/scene/fixtureLights';

test('audited eight-room house assigns every static receiver and rebuilt furniture by world range', () => {
  const project: HouseProject = JSON.parse(
    readFileSync(new URL('./fixtures/eight-room-lighting.json', import.meta.url), 'utf8'),
  );
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const material = new StandardMaterial('test', scene);
    const materials = Object.fromEntries(
      ['plaster', 'wood', 'concrete', 'frame', 'glass', 'metal', 'slab', 'glow', 'selection'].map(
        (k) => [k, material],
      ),
    ) as unknown as Materials;
    const house = buildHouse(project.levels[0], scene, materials);
    house.pointLights.forEach((l) => l.setEnabled(true));
    refreshFixtureLights(scene);
    const moving = new Set(
      house.doors.flatMap((d) => [
        ...d.pivot.getChildMeshes(),
        ...(d.pivotB?.getChildMeshes() ?? []),
      ]),
    );
    for (const mesh of scene.meshes.filter((m) => !moving.has(m))) {
      const b = mesh.getBoundingInfo().boundingBox;
      const expected = house.pointLights.filter((l) => {
        const p = l.getAbsolutePosition();
        let distance = 0;
        for (const axis of ['x', 'y', 'z'] as const) {
          const delta = Math.max(b.minimumWorld[axis] - p[axis], 0, p[axis] - b.maximumWorld[axis]);
          distance += delta * delta;
        }
        return distance <= l.range * l.range;
      });
      assert.deepEqual(mesh.lightSources, expected, mesh.name);
    }
    const layer = new FurnitureLayer(scene, project.levels[0]);
    const item = createFurniture({ kind: 'table' });
    item.position = [4, 3];
    layer.setItems([item]);
    let mesh = scene.meshes.find((m) => m.metadata?.kind === 'furniture')!;
    assert.deepEqual(mesh.lightSources, [house.pointLights[0]]);
    item.position = [60, 3];
    item.width += 0.1;
    layer.setItems([item]);
    mesh = scene.meshes.find((m) => m.metadata?.kind === 'furniture')!;
    assert.deepEqual(mesh.lightSources, [house.pointLights[7]]);
    const door = house.doors[0];
    const before = door.leaves.map((m) => [...m.lightSources]);
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      door.progress = progress;
      poseDoor(door);
      door.leaves.forEach((m, i) => assert.deepEqual(m.lightSources, before[i]));
    }
    layer.dispose();
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
