import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { measurementEndpoint } from '../src/scene/measurement';
import { HouseViewer, type Measurement } from '../src/scene/viewer';
import type { Level, Point2 } from '../src/model/types';

test('measurement snapping keeps free diagonals and snaps near either plan axis in both directions', () => {
  assert.deepEqual(measurementEndpoint([2, 3], [5, 3.2]), { point: [5, 3], aligned: true });
  assert.deepEqual(measurementEndpoint([2, 3], [1.9, -1]), { point: [2, -1], aligned: true });
  assert.deepEqual(measurementEndpoint([2, 3], [4, 5]), { point: [4, 5], aligned: false });
  assert.deepEqual(measurementEndpoint([2, 3], [4, 5], true), { point: [4, 3], aligned: true });
  assert.deepEqual(measurementEndpoint([2, 3], [5, 3.2], true, true), {
    point: [5, 3.2],
    aligned: false,
  });
  assert.deepEqual(measurementEndpoint([2, 3], [2, 3]), { point: [2, 3], aligned: false });
});

test('measurement preview updates one line, commits the snapped end and resets cleanly', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const level: Level = {
    id: 'test',
    name: 'Test',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    walls: [],
    rooms: [],
    lights: [],
    spawn: { position: [2, 2], yaw: 0 },
  };
  const changes: (Measurement | undefined)[] = [];
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    scene,
    level,
    measureMeshes: [],
    pinnedMeasurements: [],
    measureMode: true,
    house: { highlights: new Map() },
    canvas: { classList: { toggle() {} } },
    onMeasure: (value?: Measurement) => changes.push(value ? structuredClone(value) : undefined),
  }) as HouseViewer;
  const input = viewer as unknown as {
    addMeasurement(point: Point2, force?: boolean, free?: boolean): void;
    previewMeasurement(point: Point2, force?: boolean, free?: boolean): void;
  };
  input.addMeasurement([1, 1]);
  assert.equal(viewer.measurement?.preview, true);
  assert.equal(viewer.measurement?.b, undefined);
  for (let i = 0; i < 50; i++) input.previewMeasurement([3, 1.1]);
  assert.deepEqual(viewer.measurement?.b, [3, 1]);
  assert.equal(viewer.measurement?.distance, 2);
  assert.equal(scene.meshes.filter((m) => m.name === 'measurement').length, 1);
  assert.equal(scene.meshes.length, 2);
  input.previewMeasurement([3, 1.1], false, true);
  assert.deepEqual(viewer.measurement?.b, [3, 1.1]);
  input.addMeasurement([3, 1.1]);
  assert.equal(viewer.measurement?.preview, false);
  assert.deepEqual(viewer.measurement?.b, [3, 1]);
  input.previewMeasurement([7, 5]);
  assert.deepEqual(viewer.measurement?.b, [3, 1]);
  input.addMeasurement([4, 4]);
  assert.deepEqual(viewer.measurement?.a, [4, 4]);
  assert.equal(scene.meshes.length, 4);
  viewer.setMeasureMode(false);
  assert.equal(viewer.measurement, undefined);
  assert.equal(scene.meshes.length, 3);
  assert.equal(changes.at(-1), undefined);
  assert.equal(viewer.clearPinnedMeasurements(), true);
  assert.equal(scene.meshes.length, 0);
  assert.equal(viewer.clearPinnedMeasurements(), false);
  engine.dispose();
});
