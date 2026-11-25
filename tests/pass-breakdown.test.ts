import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import '@babylonjs/core/Shaders/pass.fragment';
import type { FrameProfile } from '../src/scene/frameProfiler';
import { breakdownLines, passSwitches } from '../src/scene/passBreakdown';

function sceneWithChain(names: string[]) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new FreeCamera('eye', new Vector3(0, 1.6, -4), scene);
  for (const name of names) new PostProcess(name, 'pass', [], [], 1, camera);
  const chain = () => camera._postProcesses.map((pp) => pp?.name ?? null);
  return { engine, scene, camera, chain };
}

const VISIT_CHAIN = [
  'TAA',
  'TAAPass',
  'SSAOOriginalSceneColor',
  'ssao',
  'BlurH',
  'BlurV',
  'ssaoCombine',
  'imageProcessing',
  'fxaa',
];

test('each pass switches off and back on into the very slots it held', () => {
  const { engine, scene, camera, chain } = sceneWithChain(VISIT_CHAIN);
  const switches = passSwitches(scene, camera);
  assert.deepEqual(
    switches.map((pass) => pass.label),
    [
      'occlusion ambiante',
      'flou de l’occlusion',
      'ombres du soleil',
      'anticrénelage temporel',
      'halo, tons et FXAA',
    ],
  );
  const blur = switches[1];
  blur.off();
  assert.deepEqual(chain(), [
    'TAA',
    'TAAPass',
    'SSAOOriginalSceneColor',
    'ssao',
    null,
    null,
    'ssaoCombine',
    'imageProcessing',
    'fxaa',
  ]);
  blur.on();
  assert.deepEqual(chain(), VISIT_CHAIN);
  for (const pass of switches) pass.off();
  for (const pass of [...switches].reverse()) pass.on();
  assert.deepEqual(chain(), VISIT_CHAIN);
  engine.dispose();
});

test('the sun shadows switch the scene shadows off and back on', () => {
  const { engine, scene, camera } = sceneWithChain(VISIT_CHAIN);
  const shadows = passSwitches(scene, camera).find((pass) => pass.label === 'ombres du soleil');
  shadows?.off();
  assert.equal(scene.shadowsEnabled, false);
  shadows?.on();
  assert.equal(scene.shadowsEnabled, true);
  engine.dispose();
});

test('a pass absent from the view is not offered: Vue 3D has no bloom chain', () => {
  const { engine, scene, camera } = sceneWithChain([
    'TAA',
    'TAAPass',
    'SSAOOriginalSceneColor',
    'ssao',
    'BlurH',
    'BlurV',
    'ssaoCombine',
  ]);
  assert.deepEqual(
    passSwitches(scene, camera).map((pass) => pass.label),
    ['occlusion ambiante', 'flou de l’occlusion', 'ombres du soleil', 'anticrénelage temporel'],
  );
  engine.dispose();
});

function profile(gpuMs?: number): FrameProfile {
  const flat = { median: 1, p95: 1 };
  return {
    frames: 100,
    durationMs: 3000,
    cpu: flat,
    drawCalls: flat,
    selection: flat,
    gpu: gpuMs === undefined ? undefined : { median: gpuMs, p95: gpuMs, samples: 60 },
  };
}

test('each pass costs what the GPU saves without it; a part is not counted twice in the rest', () => {
  const lines = breakdownLines('visite', profile(11.5), [
    { label: 'occlusion ambiante', profile: profile(7.3) },
    { label: 'flou de l’occlusion', part: true, profile: profile(9.7) },
    { label: 'ombres du soleil', profile: profile(10.4) },
    { label: 'anticrénelage temporel', profile: profile(11.0) },
  ]);
  assert.deepEqual(lines, [
    '[passes] visite · GPU médiane 11,5 ms avec toutes les passes',
    '  occlusion ambiante        4,2 ms · 37 %',
    '    dont flou de l’occlusion 1,8 ms · 16 %',
    '  ombres du soleil          1,1 ms · 10 %',
    '  anticrénelage temporel    0,5 ms · 4 %',
    '  reste (scène, prépasse)   5,7 ms · 50 %',
  ]);
});

test('without a GPU timer the breakdown says so instead of guessing', () => {
  assert.deepEqual(
    breakdownLines('visite', profile(), [{ label: 'ombres du soleil', profile: profile() }]),
    ['[passes] visite · GPU non mesurable dans ce navigateur (pas de requête de minutage)'],
  );
});

test('a saving lost in the noise reads as zero, never as a negative cost', () => {
  const lines = breakdownLines('vue 3D', profile(10), [
    { label: 'anticrénelage temporel', profile: profile(10.2) },
  ]);
  assert.equal(lines[1], '  anticrénelage temporel    0,0 ms · 0 %');
});

test('each pass is compared with the whole view measured around it, not only at the start', () => {
  // The view drifts from 10 to 14 ms: occlusion measured at 8 ms saves 6, not 2.
  const lines = breakdownLines('vue 3D', profile(12), [
    { label: 'occlusion ambiante', profile: profile(8), baselineMs: 14 },
    { label: 'ombres du soleil', profile: profile(9), baselineMs: 10 },
  ]);
  assert.deepEqual(lines, [
    '[passes] vue 3D · GPU médiane 12,0 ms avec toutes les passes',
    '  occlusion ambiante        6,0 ms · 50 %',
    '  ombres du soleil          1,0 ms · 8 %',
    '  reste (scène, prépasse)   5,0 ms · 42 %',
  ]);
});
