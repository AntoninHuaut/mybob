import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FxLabEffect } from '../src/ui/fxLabEffect';

test('bench releases on mode exit and drops scene-owned pipelines before later toggles', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    next = new Scene(engine);
  let disposed = 0,
    resets = 0;
  const effect = new FxLabEffect(() => resets++);
  try {
    effect.sync(scene, true);
    effect.toggle(true, () => ({ dispose: () => disposed++ }));
    effect.sync(scene, false);
    assert.equal(disposed, 1, 'Plan or walk releases experiment');
    effect.sync(scene, false);
    assert.equal(disposed, 1, 'no duplicate early release');
    effect.sync(scene, true);
    effect.toggle(true, () => ({ dispose: () => disposed++ }));
    scene.dispose();
    assert.equal(disposed, 1, 'scene owns disposal of registered pipelines');
    effect.sync(next, true);
    effect.toggle(false, () => undefined);
    assert.equal(disposed, 1, 'dead scene pipeline is never disposed again');
    effect.toggle(true, () => ({ dispose: () => disposed++ }));
    effect.sync(next, false);
    assert.equal(disposed, 2);
    assert.ok(resets >= 4, 'toggles reset on scene and mode changes');
  } finally {
    scene.dispose();
    next.dispose();
    engine.dispose();
  }
});
