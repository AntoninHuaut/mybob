import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPlanPhotoAdjustments, planPhotoPlacement } from '../src/scene/planPhoto';
import { planPhotoKey } from '../src/scene/planPhotoStore';

test('le calque couvre la largeur du niveau et respecte le rapport de l\u2019image', () => {
  const placement = planPhotoPlacement({ width: 10, depth: 8 }, 2, defaultPlanPhotoAdjustments);
  assert.ok(Math.abs(placement.width - 10) < 1e-9);
  assert.ok(Math.abs(placement.depth - 5) < 1e-9);
  assert.ok(Math.abs(placement.position[0]) < 1e-9);
  assert.ok(Math.abs(placement.rotationY) < 1e-9);
});

test('échelle, rotation et décalages composent sans clamp implicite', () => {
  const placement = planPhotoPlacement({ width: 10, depth: 8 }, 1.5, {
    opacity: 1,
    scale: 1.2,
    rotation: 90,
    offsetX: 1.5,
    offsetZ: -0.5,
  });
  assert.ok(Math.abs(placement.width - 12) < 1e-9);
  assert.ok(Math.abs(placement.depth - 8) < 1e-9);
  assert.ok(Math.abs(placement.position[0] - 1.5) < 1e-9);
  assert.ok(Math.abs(placement.position[1] + 0.5) < 1e-9);
  assert.ok(Math.abs(placement.rotationY - Math.PI / 2) < 1e-9);
});

test('un aspect invalide retombe sur un plan carré plutôt qu\u2019une division par zéro', () => {
  const placement = planPhotoPlacement({ width: 6, depth: 4 }, 0, defaultPlanPhotoAdjustments);
  assert.ok(Number.isFinite(placement.depth));
  assert.ok(Math.abs(placement.depth - placement.width) < 1e-9);
});

test('la clé de stockage sépare projet et niveau', () => {
  assert.equal(planPhotoKey('demo', 'rdc'), 'demo::rdc');
  assert.notEqual(planPhotoKey('demo', 'rdc'), planPhotoKey('demo', 'etage'));
});
