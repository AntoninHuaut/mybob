import assert from 'node:assert/strict';
import test from 'node:test';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Ray } from '@babylonjs/core/Culling/ray';
import { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { PointerInfo, PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
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

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { DoorInstance } from '../src/scene/buildHouse';

test('swept assignment includes a mid-swing-only lamp for leaf and handle under scaled parents', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const parent = new TransformNode('transformed-house', scene);
    parent.position.set(10, 3, 5);
    parent.rotation.y = 0.31;
    parent.scaling.setAll(2);
    const pivot = new TransformNode('jamb', scene);
    pivot.parent = parent;
    const leaf = MeshBuilder.CreateBox('leaf', { width: 2, height: 2, depth: 0.04 }, scene);
    leaf.parent = pivot;
    leaf.position.set(1, 1, 0);
    const handle = MeshBuilder.CreateBox('handle', { size: 0.1 }, scene);
    handle.parent = leaf;
    handle.position.set(0.95, 0, 0);
    const door: DoorInstance = {
      id: 'swept',
      exterior: false,
      pivot,
      leaf,
      leaves: [leaf, handle],
      opening: { id: 'opening', kind: 'door', offset: 0, width: 2, height: 2, swing: 1 },
      baseElevation: 0,
      center: Vector3.Zero(),
      open: false,
      progress: 0,
      target: 0,
      fold: 1,
    };
    door.progress = 0.5;
    poseDoor(door);
    handle.computeWorldMatrix(true);
    const lamp = new PointLight('intermediate-only', handle.getAbsolutePosition().clone(), scene);
    lamp.range = 0.15;
    const outside = new PointLight('outside-sweep', new Vector3(100, 100, 100), scene);
    outside.range = 0.15;
    const reaches = (mesh: typeof leaf) => {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      const p = lamp.getAbsolutePosition();
      const deltas = ['x', 'y', 'z'].map((axis) => {
        const a = axis as 'x' | 'y' | 'z';
        return Math.max(box.minimumWorld[a] - p[a], 0, p[a] - box.maximumWorld[a]);
      });
      return deltas.reduce((sum, d) => sum + d * d, 0) <= lamp.range ** 2;
    };
    for (const endpoint of [0, 1]) {
      door.progress = endpoint;
      poseDoor(door);
      assert.equal(reaches(leaf), false, 'lamp misses endpoint leaf bounds');
      assert.equal(reaches(handle), false, 'lamp misses endpoint handle bounds');
    }
    door.progress = 0.5;
    poseDoor(door);
    assert.equal(reaches(leaf), true);
    assert.equal(reaches(handle), true);
    door.progress = 0;
    poseDoor(door);
    new FixtureLights(scene, [lamp, outside], [door]).refresh();
    for (const mesh of [leaf, handle]) {
      assert.ok(
        mesh.lightSources.includes(lamp),
        'closed-pose assignment covers intermediate swing',
      );
      assert.ok(!mesh.lightSources.includes(outside), 'out-of-sweep lamp is excluded');
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('merged PBR furniture refreshes exact fitting intersections on rebuild, live movement and final room drop', () => {
  const project: HouseProject = JSON.parse(
    readFileSync(new URL('./fixtures/eight-room-lighting.json', import.meta.url), 'utf8'),
  );
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const layer = new FurnitureLayer(scene, project.levels[0]);
  try {
    const material = new StandardMaterial('test', scene);
    const materials = Object.fromEntries(
      ['plaster', 'wood', 'concrete', 'frame', 'glass', 'metal', 'slab', 'glow', 'selection'].map(
        (key) => [key, material],
      ),
    ) as unknown as Materials;
    const house = buildHouse(project.levels[0], scene, materials);
    house.pointLights.forEach((light) => light.setEnabled(true));
    const bodies = () => scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture');
    const assertIntersections = () => {
      assert.equal(bodies().length, 2, 'table has one merged mesh per finish');
      for (const mesh of bodies()) {
        assert.ok(mesh.material instanceof PBRMaterial);
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        const expected = house.pointLights.filter((light) => {
          const point = light.getAbsolutePosition();
          const closest = Vector3.Clamp(point, box.minimumWorld, box.maximumWorld);
          return Vector3.DistanceSquared(point, closest) <= light.range ** 2;
        });
        assert.deepEqual(
          mesh.lightSources.map((light) => light.id),
          expected.map((light) => light.id),
          mesh.name,
        );
      }
    };
    const item = createFurniture({ id: 'range-table', kind: 'table', position: [4, 3] });
    layer.setItems([item]);
    assertIntersections();
    const first = [...bodies()];
    item.width += 0.1;
    layer.setItems([item]);
    assertIntersections();
    assert.ok(first.every((mesh) => mesh.isDisposed()));
    assert.ok(
      house.pointLights.every(
        (light) => !light.includedOnlyMeshes.some((mesh) => first.includes(mesh)),
      ),
    );
    scene.activeCamera = new UniversalCamera('test', new Vector3(0, 10, 0), scene);
    let x = 4,
      z = 3;
    let dropped = false;
    layer.onDroppedInRoom = () => {
      dropped = true;
    };
    scene.createPickingRay = () => new Ray(new Vector3(x, 10, z), new Vector3(0, -1, 0));
    const pick = new PickingInfo();
    pick.hit = true;
    pick.pickedMesh = bodies()[0];
    const emit = (type: number) =>
      scene.onPointerObservable.notifyObservers(
        new PointerInfo(type, { button: 0 } as PointerEvent, pick),
      );
    emit(PointerEventTypes.POINTERDOWN);
    x = 6.3;
    emit(PointerEventTypes.POINTERMOVE);
    assertIntersections();
    assert.ok(bodies().some((mesh) => mesh.lightSources.includes(house.pointLights[1])));
    house.pointLights[1].range = 0.25;
    refreshFixtureLights(scene);
    assertIntersections();
    assert.ok(bodies().every((mesh) => !mesh.lightSources.includes(house.pointLights[1])));
    // The room-move tests cover finding this valid landing. Exercise release
    // independently, without an onChange handler rebuilding the layer afterwards.
    Object.assign(layer, {
      drag: {
        id: item.id,
        offset: [0, 0],
        start: [4, 3],
        moved: true,
        floor: 0,
        drop: {
          room: project.levels[0].rooms[7],
          target: [60, 3],
          items: [{ ...item, position: [60, 3] }],
        },
      },
    });
    emit(PointerEventTypes.POINTERUP);
    assert.equal(dropped, true);
    assertIntersections();
    assert.ok(bodies().every((mesh) => mesh.lightSources.includes(house.pointLights[7])));
    assert.ok(bodies().every((mesh) => !mesh.lightSources.includes(house.pointLights[0])));
  } finally {
    layer.dispose();
    scene.dispose();
    engine.dispose();
  }
});
