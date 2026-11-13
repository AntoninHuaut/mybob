import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
// Registers Babylon's include now, so the patched text is in the store before
// PBRMaterial lazily loads its shaders: that loader only fills an empty entry.
import { lightFragment } from '@babylonjs/core/Shaders/ShadersInclude/lightFragment';

/**
 * Babylon samples the sun's shadow map on every lit pixel, including where the
 * surface faces away from the sun: ceilings, the walls on the far side, the under
 * side of furniture. There, the PBR diffuse and specular terms are multiplied by
 * `NdotL = saturateEps(NdotLUnclamped)`, which is 1e-7. The shadow factor (between the
 * generator's darkness and 1) only scales those terms, so its value cannot change the
 * 8-bit pixel: the lookup is skipped, and `shadow` is 1 there.
 *
 * Limited to what that argument covers: PBR materials and directional lights, without
 * the terms that read their own normal or a light-facing-away contribution — clear
 * coat, sheen, subsurface translucency — nor lightmaps, custom lighting, shadow-only
 * materials or the cascade debug colours. `aggShadow`, which also receives `shadow`,
 * is unused by Babylon's PBR shader.
 *
 * WebGL 2 reads the shadow map with an explicit level (`texture2DLodEXT`), so the
 * branch holds no implicit-derivative fetch: drivers keep it as a real branch, and a
 * ceiling or a wall facing away is one coherent region that skips the whole lookup.
 */
const SHADOW_START = '#ifdef SHADOW{X}\n';
const SHADOW_END = '#ifdef SHADOWONLY\n#ifndef SHADOWINUSE';
const GUARD =
  '#if defined(PBR) && defined(DIRLIGHT{X}) && !defined(SHADOWONLY) && !defined(SS_TRANSLUCENCY)' +
  ' && !defined(CLEARCOAT) && !defined(SHEEN) && !defined(LIGHTMAP)' +
  ' && !defined(CUSTOMUSERLIGHTING) && !defined(SHADOWCSMDEBUG{X})\n' +
  'if (preInfo.NdotLUnclamped<=0.) {shadow=1.;} else\n' +
  '#endif\n';
export const SUN_SHADOW_SKIP_MARK = 'preInfo.NdotLUnclamped<=0.) {shadow=1.;}';

/**
 * Wraps the shadow lookup of Babylon's `lightFragment` include in the guard. Throws
 * when the include no longer has the expected shape: a Babylon upgrade must be
 * re-read, not silently left unpatched or patched in the wrong place.
 */
export function patchLightFragment(source: string): string {
  if (source.includes(SUN_SHADOW_SKIP_MARK)) return source;
  const start = source.indexOf(SHADOW_START);
  const end = source.indexOf(SHADOW_END);
  if (
    start < 0 ||
    end < start ||
    source.indexOf(SHADOW_START, start + 1) >= 0 ||
    source.indexOf(SHADOW_END, end + 1) >= 0
  ) {
    throw new Error('lightFragment: unexpected Babylon include, sun shadow skip not applied');
  }
  const body = start + SHADOW_START.length;
  return (
    source.slice(0, body) + GUARD + '{\n' + source.slice(body, end) + '}\n' + source.slice(end)
  );
}

let installed = false;

/**
 * Installs the patched include once, before the first PBR program is built. An include
 * of another shape leaves Babylon's own in place, with a warning: the scene still draws,
 * and `tests/sun-shadow-skip.test.ts` fails on the upgrade that caused it.
 */
export function installSunShadowSkip(): void {
  if (installed) return;
  installed = true;
  const store = ShaderStore.IncludesShadersStore;
  try {
    store[lightFragment.name] = patchLightFragment(
      store[lightFragment.name] ?? lightFragment.shader,
    );
  } catch (error) {
    console.warn(`[ombres] ${error instanceof Error ? error.message : String(error)}`);
  }
}
