import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { PointerEventTypes, PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { FurnitureLayer } from '../src/furniture/layer';
import { furnitureViewState } from '../src/furniture/viewState';
import type { FurnitureItem } from '../src/furniture/model';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'test',
  name: 'Test',
  elevation: 2,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  walls: [{ id: 'wall', start: [0, 0], end: [10, 0], thickness: 0.2 }],
  rooms: [
    {
      id: 'lower',
      name: 'Lower',
      kind: 'garage',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      label: [2, 2],
      viewpoint: [2, 2],
      floorOffset: -0.12,
    },
  ],
  lights: [],
  spawn: { position: [6, 6], yaw: 0 },
};
const item = (kind: FurnitureItem['kind'] = 'sofa'): FurnitureItem => ({
  id: 'f',
  name: 'Furniture',
  kind,
  width: 2,
  depth: 1,
  height: 0.9,
  position: [2, 2],
  rotation: 0,
  locked: false,
  color: '#aabbcc',
});
function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const layer = new FurnitureLayer(scene, level);
  return {
    engine,
    scene,
    layer,
    cleanup: () => {
      layer.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

test('all parametric furniture stays inside its real dimensions and follows finished floor', () => {
  const { scene, layer, cleanup } = setup();
  const kinds: FurnitureItem['kind'][] = [
    'sofa',
    'table',
    'chair',
    'bed',
    'wardrobe',
    'desk',
    'cabinet',
    'custom',
    'tv-stand',
    'tv',
    'coffee-table',
    'bookcase',
    'ottoman',
    'side-table',
  ];
  for (const kind of kinds) {
    layer.setItems([item(kind)]);
    const parts = scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture');
    assert.ok(parts.length > 0);
    for (const part of parts) {
      part.computeWorldMatrix(true);
      const box = part.getBoundingInfo().boundingBox;
      assert.ok(box.minimumWorld.x >= 1 - 1e-6 && box.maximumWorld.x <= 3 + 1e-6, kind);
      assert.ok(box.minimumWorld.z >= 1.5 - 1e-6 && box.maximumWorld.z <= 2.5 + 1e-6, kind);
      assert.ok(box.minimumWorld.y >= 1.88 - 1e-6 && box.maximumWorld.y <= 2.78 + 1e-6, kind);
      assert.equal(part.checkCollisions, true);
      assert.equal(part.metadata.id, 'f');
    }
  }
  layer.setItems([{ ...item(), position: [6, 6], rotation: Math.PI / 2 }]);
  const root = scene.getTransformNodeByName('furniture:f')!;
  assert.equal(root.position.y, 2);
  assert.equal(root.rotation.y, Math.PI / 2);
  cleanup();
});

test('overlays are non-pickable, do not allocate a canvas headlessly, and dispose fully', () => {
  const { scene, layer, cleanup } = setup();
  layer.setItems([
    {
      ...item(),
      clearances: { front: 0.8, back: 0.1, left: 0.2, right: 0.2 },
      opening: { kind: 'hinged', reach: 0.6 },
    },
  ]);
  layer.select('f');
  layer.setOverlays({ distances: true, clearances: true, openings: true });
  assert.ok(scene.getMeshByName('furniture:clearance'));
  assert.ok(scene.getMeshByName('furniture:opening'));
  assert.ok(scene.meshes.some((mesh) => mesh.metadata?.measurementKind === 'gap'));
  assert.equal(scene.getMeshByName('furniture:width'), null);
  assert.ok(
    scene.meshes
      .filter((mesh) => mesh.metadata?.kind === 'furniture-overlay')
      .every((mesh) => !mesh.isPickable),
  );
  const count = scene.materials.length;
  for (let i = 0; i < 5; i++) layer.setItems([item()]);
  assert.ok(scene.materials.length <= count);
  layer.setView({ mode: 'walk', interactive: false });
  assert.equal(scene.getMeshByName('furniture:selection'), null);
  layer.dispose();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.transformNodes.length, 0);
  assert.equal(scene.materials.length, 0);
  cleanup();
});

test('clicking outside furniture clears the selected footprint without changing furniture', () => {
  const { scene, layer, cleanup } = setup();
  layer.setItems([item()]);
  layer.select('f');
  assert.ok(scene.getMeshByName('furniture:selection'));
  const selected: (string | undefined)[] = [];
  layer.onSelect = (id) => selected.push(id);
  const pick = new PickingInfo();
  scene.onPointerObservable.notifyObservers(
    new PointerInfo(PointerEventTypes.POINTERDOWN, { button: 0 } as PointerEvent, pick),
  );
  assert.equal(scene.getMeshByName('furniture:selection'), null);
  assert.deepEqual(selected, [undefined]);
  assert.ok(scene.meshes.some((mesh) => mesh.metadata?.kind === 'furniture'));
  cleanup();
});

test('drag emits live positions and exactly one final commit, respecting lock and walk mode', () => {
  const { scene, layer, cleanup } = setup();
  scene.activeCamera = new UniversalCamera('test', new Vector3(0, 10, 0), scene);
  let x = 2,
    z = 2;
  scene.createPickingRay = () => new Ray(new Vector3(x, 10, z), new Vector3(0, -1, 0));
  layer.setItems([item()]);
  const pick = new PickingInfo();
  pick.pickedMesh = scene.meshes.find((mesh) => mesh.metadata?.kind === 'furniture')!;
  pick.hit = true;
  const emit = (type: number) =>
    scene.onPointerObservable.notifyObservers(
      new PointerInfo(type, { button: 0 } as PointerEvent, pick),
    );
  const changes: { position: number[]; final: boolean }[] = [];
  const states: boolean[] = [];
  layer.onChange = (items, final) => changes.push({ position: items[0].position, final });
  layer.onDragState = (state) => states.push(state);
  emit(PointerEventTypes.POINTERDOWN);
  x = 3;
  z = 4;
  emit(PointerEventTypes.POINTERMOVE);
  x = 4;
  emit(PointerEventTypes.POINTERMOVE);
  emit(PointerEventTypes.POINTERUP);
  emit(PointerEventTypes.POINTERUP);
  assert.deepEqual(
    changes.map((change) => change.final),
    [false, false, true],
  );
  assert.deepEqual(changes[2].position, [4, 4]);
  assert.deepEqual(states, [true, false]);
  layer.setItems([{ ...item(), locked: true }]);
  emit(PointerEventTypes.POINTERDOWN);
  emit(PointerEventTypes.POINTERMOVE);
  emit(PointerEventTypes.POINTERUP);
  layer.setItems([item()]);
  layer.setView({ mode: 'walk', interactive: false });
  emit(PointerEventTypes.POINTERDOWN);
  emit(PointerEventTypes.POINTERMOVE);
  emit(PointerEventTypes.POINTERUP);
  assert.equal(changes.length, 3);
  cleanup();
});

test('drag stops a sofa at a thin wall in plan and overview even after a large pointer jump', () => {
  for (const mode of ['plan', 'overview'] as const) {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const divided: Level = {
      ...level,
      walls: [...level.walls, { id: 'partition', start: [5, 0], end: [5, 10], thickness: 0.07 }],
    };
    const layer = new FurnitureLayer(scene, divided);
    scene.activeCamera = new UniversalCamera('test', new Vector3(0, 10, 0), scene);
    let x = 2;
    scene.createPickingRay = () => new Ray(new Vector3(x, 10, 5), new Vector3(0, -1, 0));
    layer.setItems([{ ...item(), position: [2, 5] }]);
    layer.setView({ mode, interactive: true });
    const pick = new PickingInfo();
    pick.pickedMesh = scene.meshes.find((mesh) => mesh.metadata?.kind === 'furniture')!;
    pick.hit = true;
    const emit = (type: number) =>
      scene.onPointerObservable.notifyObservers(
        new PointerInfo(type, { button: 0 } as PointerEvent, pick),
      );
    const changes: { position: number[]; final: boolean }[] = [];
    layer.onChange = (items, final) => changes.push({ position: items[0].position, final });
    emit(PointerEventTypes.POINTERDOWN);
    x = 8;
    emit(PointerEventTypes.POINTERMOVE);
    assert.ok(changes.length > 0);
    const stopped = changes.at(-1)!.position;
    assert.ok(
      stopped[0] > 3.9 && stopped[0] <= 3.968,
      `${mode}: sofa must touch the partition without crossing it: ${stopped[0]}`,
    );
    for (const mesh of scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture')) {
      mesh.computeWorldMatrix(true);
      assert.ok(mesh.getBoundingInfo().boundingBox.maximumWorld.x <= 4.968);
    }
    emit(PointerEventTypes.POINTERUP);
    assert.equal(changes.filter((change) => change.final).length, 1);
    assert.deepEqual(changes.at(-1)!.position, stopped);
    layer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

test('double-click on a furniture item requests its editor in plan and overview', () => {
  const { scene, layer, cleanup } = setup();
  layer.setItems([item()]);
  const pick = new PickingInfo();
  pick.pickedMesh = scene.meshes.find((mesh) => mesh.metadata?.kind === 'furniture')!;
  const edited: string[] = [];
  layer.onEdit = (id) => edited.push(id);
  for (const mode of ['plan', 'overview', 'walk'] as const) {
    layer.setView({ mode, interactive: mode !== 'walk' });
    scene.onPointerObservable.notifyObservers(
      new PointerInfo(PointerEventTypes.POINTERDOUBLETAP, { button: 0 } as PointerEvent, pick),
    );
  }
  assert.deepEqual(edited, ['f', 'f']);
  cleanup();
});

test('plan wall cut keeps the tops of tall furniture visible and restores section clipping in 3D', () => {
  const { scene, layer, cleanup } = setup();
  layer.setItems([{ ...item('wardrobe'), height: 2 }]);
  layer.setView({ mode: 'plan', interactive: true });
  for (const mesh of scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture')) {
    const mat = mesh.material!;
    assert.ok(mat.clipPlane);
    assert.ok(mat.clipPlane.signedDistanceTo(new Vector3(2, 4, 2)) < 0);
  }
  layer.setView({ mode: 'overview', interactive: true });
  assert.ok(
    scene.meshes
      .filter((mesh) => mesh.metadata?.kind === 'furniture')
      .every((mesh) => mesh.material!.clipPlane === null),
  );
  cleanup();
});

test('editing restrictions block pointer actions while preserving the actual view clipping', () => {
  const enabled = {
    exterior: false,
    readOnly: false,
    measuring: false,
    pickingDestination: false,
  };
  for (const mode of ['plan', 'overview'] as const) {
    for (const restriction of Object.keys(enabled) as (keyof typeof enabled)[]) {
      const { scene, layer, cleanup } = setup();
      try {
        scene.activeCamera = new UniversalCamera('test', new Vector3(0, 10, 0), scene);
        let x = 2;
        scene.createPickingRay = () => new Ray(new Vector3(x, 10, 2), new Vector3(0, -1, 0));
        layer.setItems([item()]);
        layer.select('f');
        layer.setCirculation(true);
        const pick = new PickingInfo();
        pick.pickedMesh = scene.meshes.find((mesh) => mesh.metadata?.kind === 'furniture')!;
        const actions: string[] = [];
        layer.onSelect = () => actions.push('select');
        layer.onEdit = () => actions.push('edit');
        layer.onChange = () => actions.push('change');
        const emit = (type: number) =>
          scene.onPointerObservable.notifyObservers(
            new PointerInfo(type, { button: 0 } as PointerEvent, pick),
          );
        layer.setView(furnitureViewState({ mode, ...enabled, [restriction]: true }));
        emit(PointerEventTypes.POINTERDOWN);
        x = 3;
        emit(PointerEventTypes.POINTERMOVE);
        emit(PointerEventTypes.POINTERUP);
        emit(PointerEventTypes.POINTERDOUBLETAP);
        assert.deepEqual(actions, [], `${mode}/${restriction}: editing stays disabled`);
        assert.equal(scene.getMeshByName('furniture:selection'), null);
        assert.equal(scene.getTransformNodeByName('furniture:circulation'), null);
        for (const mesh of scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture'))
          assert.equal(Boolean(mesh.material!.clipPlane), mode === 'plan');
        // Rebuilding a mesh must also keep the real mode, independent of permission.
        layer.setItems([{ ...item(), width: 2.1 }]);
        for (const mesh of scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture'))
          assert.equal(Boolean(mesh.material!.clipPlane), mode === 'plan');
        pick.pickedMesh = scene.meshes.find((mesh) => mesh.metadata?.kind === 'furniture')!;
        layer.setView(furnitureViewState({ mode, ...enabled }));
        assert.ok(scene.getMeshByName('furniture:selection'));
        emit(PointerEventTypes.POINTERDOUBLETAP);
        assert.deepEqual(actions, ['edit']);
      } finally {
        cleanup();
      }
    }
  }
});
