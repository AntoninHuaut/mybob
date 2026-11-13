import assert from 'node:assert/strict';
import test from 'node:test';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Scene } from '@babylonjs/core/scene';
import { lightFragment } from '@babylonjs/core/Shaders/ShadersInclude/lightFragment';
import {
  installSunShadowSkip,
  patchLightFragment,
  SUN_SHADOW_SKIP_MARK,
} from '../src/scene/sunShadowSkip';

const count = (text: string, part: string) => text.split(part).length - 1;

/**
 * Pinned to Babylon's text: if an upgrade reshapes the include, this fails and the
 * guard's reasoning (see sunShadowSkip.ts) must be checked against the new include.
 */
test("the guard wraps the whole shadow lookup of Babylon's include, once", () => {
  const patched = patchLightFragment(lightFragment.shader);
  assert.equal(count(patched, SUN_SHADOW_SKIP_MARK), 1);
  assert.equal(patchLightFragment(patched), patched, 'patching twice changes nothing');
  const guard = patched.indexOf(SUN_SHADOW_SKIP_MARK);
  assert.ok(guard > patched.indexOf('#ifdef SHADOW{X}\n'), 'inside the light shadow block');
  for (const lookup of ['computeShadowWithPCF3(', 'computeShadowCSM(', 'computeShadow(']) {
    assert.ok(patched.indexOf(lookup) > guard, `${lookup} comes after the guard`);
  }
  // The skipped block ends before the shadow-only bookkeeping and the unshadowed branch.
  const close = patched.indexOf('}\n#ifdef SHADOWONLY\n#ifndef SHADOWINUSE');
  assert.ok(close > patched.lastIndexOf('computeShadow('));
  assert.ok(patched.indexOf('#else\nshadow=1.;\n#endif\naggShadow') > close);
  // Code braces only: `{X}` is the light index placeholder. The guard's `{shadow=1.;}` plus
  // the block around the lookup add two of each.
  const braces = (text: string, brace: string) => count(text.replaceAll('{X}', ''), brace);
  assert.equal(braces(patched, '{'), braces(lightFragment.shader, '{') + 2);
  assert.equal(braces(patched, '}'), braces(lightFragment.shader, '}') + 2);
});

test('the guard only covers PBR materials and directional lights', () => {
  const patched = patchLightFragment(lightFragment.shader);
  const condition = patched.slice(
    patched.lastIndexOf('#if ', patched.indexOf(SUN_SHADOW_SKIP_MARK)),
    patched.indexOf(SUN_SHADOW_SKIP_MARK),
  );
  for (const required of ['defined(PBR)', 'defined(DIRLIGHT{X})']) {
    assert.ok(condition.includes(required), required);
  }
  for (const excluded of [
    'SHADOWONLY',
    'SS_TRANSLUCENCY',
    'CLEARCOAT',
    'SHEEN',
    'LIGHTMAP',
    'CUSTOMUSERLIGHTING',
    'SHADOWCSMDEBUG{X}',
  ]) {
    assert.ok(condition.includes(`!defined(${excluded})`), excluded);
  }
});

test('an include of another shape is refused rather than patched blindly', () => {
  assert.throws(
    () => patchLightFragment('#ifdef LIGHT{X}\n#endif\n'),
    /unexpected Babylon include/,
  );
  const twice = lightFragment.shader.replace(
    '#ifdef SHADOW{X}\n',
    '#ifdef SHADOW{X}\n#ifdef SHADOW{X}\n#endif\n',
  );
  assert.throws(() => patchLightFragment(twice), /unexpected Babylon include/);
});

/**
 * NullEngine links nothing, but Babylon still inlines the includes and writes the
 * `#define` lines: the text it hands the driver is the one a browser would compile. On
 * WebGL the `#if` blocks are left to the driver, so the guard's text is in every program
 * that includes `lightFragment`; the defines decide where the driver keeps it.
 */
test('the driver keeps the guard for a shadowed PBR surface, not for a standard material', async () => {
  installSunShadowSkip();
  installSunShadowSkip();
  assert.equal(
    count(ShaderStore.IncludesShadersStore[lightFragment.name], SUN_SHADOW_SKIP_MARK),
    1,
  );
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const sun = new DirectionalLight('sun', new Vector3(0.5, -1, -0.45), scene);
    const shadow = new ShadowGenerator(512, sun);
    shadow.usePercentageCloserFiltering = true;
    const wall = CreateBox('wall', { size: 1 }, scene);
    wall.material = new PBRMaterial('plaster', scene);
    wall.receiveShadows = true;
    const label = CreateBox('label', { size: 1 }, scene);
    label.material = new StandardMaterial('label', scene);
    label.receiveShadows = true;
    shadow.addShadowCaster(wall);
    new FreeCamera('eye', new Vector3(0, 0, -5), scene);
    const fragment = (mesh: typeof wall) => mesh.subMeshes[0]?.effect?.fragmentSourceCode ?? '';
    for (let frame = 0; frame < 400; frame++) {
      scene.render();
      if (fragment(wall) && fragment(label)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // The defines the material compiles its program with (Babylon writes them as `#define`
    // lines at link time): truthy means defined for the driver.
    const defines = (mesh: typeof wall, name: string) =>
      Boolean((mesh.subMeshes[0]?.materialDefines as Record<string, unknown> | null)?.[name]);
    const pbr = fragment(wall);
    assert.ok(pbr.includes('NdotLUnclamped<=0.)'), 'the PBR program carries the guard');
    assert.ok(
      pbr.indexOf('NdotLUnclamped<=0.)') < pbr.lastIndexOf('computeShadow'),
      'before the lookup',
    );
    // The driver keeps the guard: the shadowed sun of a plain PBR surface meets its condition.
    for (const name of ['PBR', 'DIRLIGHT0', 'SHADOW0']) assert.ok(defines(wall, name), name);
    for (const name of ['SHADOWONLY', 'SS_TRANSLUCENCY', 'CLEARCOAT', 'SHEEN', 'LIGHTMAP']) {
      assert.ok(!defines(wall, name), `no ${name}`);
    }
    // The patched region, from the guard to the light's bookkeeping, closes what it opens.
    const guardLine = pbr.lastIndexOf('\n', pbr.indexOf('NdotLUnclamped<=0.)'));
    const region = pbr.slice(guardLine, pbr.indexOf('aggShadow+=shadow', guardLine));
    assert.ok(region.includes('computeShadow'), 'the lookup sits inside the region');
    assert.equal(count(region, '{'), count(region, '}'));
    // A standard material shares the include, but never defines PBR: the driver drops the guard.
    assert.ok(fragment(label).length > 0);
    assert.ok(defines(label, 'SHADOW0'), 'the standard surface is shadowed too');
    assert.ok(!defines(label, 'PBR'), 'standard materials never take the guard');
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
