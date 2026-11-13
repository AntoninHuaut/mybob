import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CubeMapToSphericalPolynomialTools } from '@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { TAARenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
// Registers the `sphericalPolynomial` accessor used to feed diffuse IBL without a GPU readback.
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial';
// Replaces the `enablePrePassRenderer` stub with the real implementation.
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';

/**
 * Bounce colours of a neutral interior, in linear light. The ceiling is the
 * brightest surface a room sees, the floor the darkest, so a vertical gradient
 * alone already reads as volume on matte plaster.
 */
const CEILING_BOUNCE = linear('#e9e5db');
const HORIZON_BOUNCE = linear('#cfc7b8');
const FLOOR_BOUNCE = linear('#5c574f');

/**
 * The bay window, and the reason the environment is high dynamic range: it is
 * several times brighter than any wall, so the glass and the steel reflect a hot
 * rectangle that survives the tone mapping instead of a grey patch. Defined in
 * direction space rather than on one face, so it lands wherever the cube seam is.
 */
const WINDOW_LIGHT = linear('#dfeaf2').scale(7);
const WINDOW_HALF_AZIMUTH = 0.42;
const WINDOW_BOTTOM = -0.06;
const WINDOW_TOP = 0.34;

/** The ceiling fixture: warm, small, and the only hot spot above the horizon. */
const LAMP_LIGHT = linear('#ffe9c3').scale(3.5);
const LAMP_ELEVATION = 1.15;
const LAMP_HALF_AZIMUTH = 0.3;

/**
 * 128 px faces. The environment is only ever seen blurred by a roughness, and
 * the faces are generated on the CPU when the visit starts: 256 px would triple
 * that cost for detail no reflection resolves.
 */
const FACE_SIZE = 128;

/** The six faces, in the order and naming Babylon's cube map tooling expects. */
export type BounceFace = 'right' | 'left' | 'up' | 'down' | 'front' | 'back';
export type BounceFaces = Record<BounceFace, Float32Array>;

/**
 * How strongly the generated environment lights the interior. Lower than the
 * flat gradient it replaces: the window and the fixture add diffuse energy, and
 * this keeps the room at the brightness that was validated before them.
 */
export const INTERIOR_ENVIRONMENT_INTENSITY = 0.42;

/** The ceiling blocks the sun in visit, so the fixtures have to carry the room. */
export const INTERIOR_FIXTURE_INTENSITY = 0.55;
export const INTERIOR_FIXTURE_RANGE = 7;

/** Darker ground bounce in visit, so the hemispheric light reads top-to-bottom. */
export const INTERIOR_GROUND_COLOR = Color3.FromHexString('#6d6a5f');

/**
 * Walk bloom, calibrated by eye on the test house. The threshold is a
 * displayed value (materials already apply tone mapping) and lit white
 * walls sit between 0.6 and 0.9: a threshold at 0.6 made the whole room
 * bloom, which read as a milky sheen. At 0.9, only the lamp and
 * the view through the bay window exceed the ceiling.
 */
export const INTERIOR_BLOOM_THRESHOLD = 0.9;
export const INTERIOR_BLOOM_WEIGHT = 0.2;

/**
 * Orbit bloom, one notch above the walk: the sky background of the 3D view
 * and the Exterior is flat at ~0.92 — at the walk threshold, the whole sky
 * bloomed and would veil the scene. At 0.95, only surfaces truly dazzled by
 * the sun and specular highlights exceed it: the intended halo.
 */
export const ORBIT_BLOOM_THRESHOLD = 0.95;

/** sRGB hex to linear light: the environment is authored in linear, not gamma. */
function linear(hex: string): Color3 {
  const srgb = Color3.FromHexString(hex);
  const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return new Color3(channel(srgb.r), channel(srgb.g), channel(srgb.b));
}

function verticalBounce(t: number) {
  return t < 0.5
    ? Color3.Lerp(CEILING_BOUNCE, HORIZON_BOUNCE, t * 2)
    : Color3.Lerp(HORIZON_BOUNCE, FLOOR_BOUNCE, (t - 0.5) * 2);
}

/**
 * Radiance arriving from one direction, in linear light. Above 1 wherever the
 * window or the fixture is: that is what makes the environment high dynamic
 * range rather than a bright grey box.
 */
export function interiorRadiance(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  const ny = y / length;
  const elevation = Math.asin(Math.max(-1, Math.min(1, ny)));
  const azimuth = Math.atan2(x / length, z / length);
  const base = verticalBounce((1 - ny) / 2);
  let r = base.r,
    g = base.g,
    b = base.b;
  if (
    Math.abs(azimuth) < WINDOW_HALF_AZIMUTH &&
    elevation > WINDOW_BOTTOM &&
    elevation < WINDOW_TOP
  ) {
    r += WINDOW_LIGHT.r;
    g += WINDOW_LIGHT.g;
    b += WINDOW_LIGHT.b;
  }
  if (elevation > LAMP_ELEVATION && Math.abs(azimuth) < LAMP_HALF_AZIMUTH) {
    r += LAMP_LIGHT.r;
    g += LAMP_LIGHT.g;
    b += LAMP_LIGHT.b;
  }
  return [r, g, b];
}

/**
 * Direction of a cube-map texel, row 0 at the top, in the plan frame. `u` and `v`
 * run from 0 to 1 across the face.
 */
export function faceDirection(face: BounceFace, u: number, v: number): [number, number, number] {
  const s = u * 2 - 1;
  const t = 1 - v * 2;
  switch (face) {
    case 'right':
      return [1, t, s];
    case 'left':
      return [-1, t, -s];
    case 'up':
      return [s, 1, -t];
    case 'down':
      return [s, -1, t];
    case 'front':
      return [s, t, 1];
    case 'back':
      return [-s, t, -1];
  }
}

/**
 * Half-float bits of a value. WebGL 2 filters half-float textures without an
 * extension, so the environment can carry values above 1 on every backend the
 * app supports; a float texture would need a capability check and a fallback.
 */
export function toHalfFloat(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 0x7c00 : value < 0 ? 0xfc00 : 0x7e00;
  const clamped = Math.max(-65504, Math.min(65504, value));
  const sign = clamped < 0 ? 0x8000 : 0;
  const magnitude = Math.abs(clamped);
  if (magnitude < 2 ** -24) return sign;
  if (magnitude >= 2 ** -14) {
    const exponent = Math.floor(Math.log2(magnitude));
    const mantissa = Math.round((magnitude / 2 ** exponent - 1) * 1024);
    // Rounding the mantissa up can carry into the exponent, which is correct.
    return sign | ((exponent + 15) << 10) | (mantissa & 0x3ff);
  }
  // Subnormal: no implicit leading one, fixed exponent -14.
  return sign | Math.round(magnitude / 2 ** -24);
}

/** One face in linear light, as floats, ready for the irradiance integration. */
function faceFloats(face: BounceFace, radiance = interiorRadiance): Float32Array {
  const data = new Float32Array(FACE_SIZE * FACE_SIZE * 4);
  for (let y = 0; y < FACE_SIZE; y++) {
    for (let x = 0; x < FACE_SIZE; x++) {
      const [dx, dy, dz] = faceDirection(face, (x + 0.5) / FACE_SIZE, (y + 0.5) / FACE_SIZE);
      const [r, g, b] = radiance(dx, dy, dz);
      const offset = (y * FACE_SIZE + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 1;
    }
  }
  return data;
}

/** The six generated faces in linear light, named as Babylon's tooling expects them. */
export function bounceFaces(radiance = interiorRadiance): BounceFaces {
  return {
    right: faceFloats('right', radiance),
    left: faceFloats('left', radiance),
    up: faceFloats('up', radiance),
    down: faceFloats('down', radiance),
    front: faceFloats('front', radiance),
    back: faceFloats('back', radiance),
  };
}

/**
 * Diffuse irradiance of the generated faces, integrated by Babylon's own cube
 * map tooling instead of read back from the GPU: a readback is asynchronous,
 * which would leave the PBR materials without any ambient term on the frame the
 * visit starts. The integration runs on a downsampled copy — the first three
 * spherical harmonics cannot resolve more than that.
 */
export function bouncePolynomial(faces: BounceFaces) {
  return CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial(
    {
      ...faces,
      size: FACE_SIZE,
      format: Constants.TEXTUREFORMAT_RGBA,
      type: Constants.TEXTURETYPE_FLOAT,
      gammaSpace: false,
    },
    32,
  );
}

/** The same faces as half floats, which is what the GPU upload takes. */
export function encodeHalfFloat(faces: BounceFaces): Record<BounceFace, Uint16Array> {
  const encode = (face: Float32Array) => {
    const data = new Uint16Array(face.length);
    for (let i = 0; i < face.length; i++) data[i] = toHalfFloat(face[i]);
    return data;
  };
  return {
    right: encode(faces.right),
    left: encode(faces.left),
    up: encode(faces.up),
    down: encode(faces.down),
    front: encode(faces.front),
    back: encode(faces.back),
  };
}

/**
 * Locally generated environment cube: no remote asset, so the public build stays
 * self-contained. Returns undefined when the engine cannot create raw textures
 * (NullEngine in tests), leaving the previous lighting untouched.
 */
export function createInteriorEnvironment(
  scene: Scene,
  radiance = interiorRadiance,
): RawCubeTexture | undefined {
  try {
    const faces = bounceFaces(radiance);
    const half = encodeHalfFloat(faces);
    // Babylon uploads raw cube faces as +X, +Y, +Z, -X, -Y, -Z.
    const texture = new RawCubeTexture(
      scene,
      [half.right, half.up, half.front, half.left, half.down, half.back],
      FACE_SIZE,
      Constants.TEXTUREFORMAT_RGBA,
      Constants.TEXTURETYPE_HALF_FLOAT,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.name = 'interior-bounce';
    // The faces are authored in linear light, so no gamma conversion on sample.
    texture.gammaSpace = false;
    texture.sphericalPolynomial = bouncePolynomial(faces);
    return texture;
  } catch (error) {
    console.info(
      `[visite] environnement local indisponible : ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Temporal antialiasing for the visit camera. It has to be built before the
 * occlusion: Babylon appends each pipeline to the end of the camera's post-process
 * chain, so a TAA created afterwards runs on the AO output and smears its noise into
 * trails. Built first, it smooths the scene and the occlusion is composited on top,
 * which is the order the effect expects.
 *
 * It also has to be built once the engine has rendered a frame: `isSupported` reads
 * `caps.texelFetch`, which is not populated at construction time, and the pipeline
 * then silently builds nothing at all.
 */
export function createInteriorTaa(scene: Scene, camera: Camera): TAARenderingPipeline | undefined {
  try {
    const pipeline = new TAARenderingPipeline('interior-taa', scene, [camera]);
    // The constructor still returns an object on a backend that cannot run it, and
    // `dispose()` then throws on the textures it never created. Drop it here instead.
    if (!pipeline.isSupported) return undefined;
    // Babylon switches TAA off while the camera moves, which is the opposite of what a
    // walkthrough needs. Reprojection and history clamping keep it usable in motion.
    pipeline.disableOnCameraMove = false;
    pipeline.reprojectHistory = true;
    pipeline.clampHistory = true;
    pipeline.samples = 16;
    return pipeline;
  } catch (error) {
    console.info(
      `[visite] antialiasing temporel indisponible : ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/** Orbit refinement keeps MSAA in motion and uses projection jitter only at rest. */
export function createOrbitTaa(scene: Scene, camera: Camera): TAARenderingPipeline | undefined {
  if (!scene.getEngine().getCaps().texelFetch) return undefined;
  try {
    const pipeline = new TAARenderingPipeline('orbit-taa', scene, [camera]);
    pipeline.samples = 16;
    pipeline.msaaSamples = 4;
    // Defaults deliberately retained: disableOnCameraMove=true, no velocity pre-pass.
    return pipeline;
  } catch (error) {
    console.info(`[orbit] temporal antialiasing unavailable: ${String(error)}`);
    return undefined;
  }
}

/**
 * Screen-space ambient occlusion for the visit camera only. In Babylon 9.35 the
 * 16-sample pass runs at full resolution; `ssaoRatio` sizes the horizontal blur and
 * `blurRatio` both the vertical blur and the combine, which writes the scene image, so
 * it stays at 1. It reads the PrePass rather than the legacy geometry buffer, so it
 * shares a single auxiliary pass with the temporal antialiasing.
 */
/** Scale of an occlusion pipeline: the walk sees a room, the overview a whole house. */
export interface OcclusionSettings {
  name: string;
  radius: number;
  maxZ: number;
}

/**
 * Taps of the bilateral blur, per direction, each one a depth and an occlusion read. The
 * kernel spans as many texels, so fewer taps is a narrower blur. With Babylon's default of
 * 16, the blur cost 0.67 of the 3.0 ms visit on the owner's house (desktop GPU), mostly
 * the full-resolution vertical pass. 8 halves both passes (#246/#248 rejected a grainier
 * 8-sample occlusion pass itself, not this blur).
 */
export const OCCLUSION_BLUR_SAMPLES = 8;

export const WALK_OCCLUSION: OcclusionSettings = {
  name: 'interior-occlusion',
  radius: 0.35,
  maxZ: 14,
};

/**
 * Vue 3D stands about twice the house size away (`fitOverview`), so it needs a far
 * depth range and a radius around half a metre to darken wall/floor junctions and
 * furniture bases. Judged on the bench and kept by the owner (#205).
 */
export const ORBIT_OCCLUSION: OcclusionSettings = {
  name: 'orbit-occlusion',
  radius: 0.5,
  maxZ: 100,
};

export function createInteriorOcclusion(
  scene: Scene,
  camera: Camera,
  settings: OcclusionSettings = WALK_OCCLUSION,
): SSAO2RenderingPipeline | undefined {
  try {
    // SSAO2 reads depth and normals from either the legacy geometry buffer or the
    // PrePass. The PrePass is the one TAA reprojects against, so sharing it keeps a
    // single auxiliary pass instead of two that fight over the scene render.
    const prePass = scene.enablePrePassRenderer();
    if (!prePass) return undefined;
    const pipeline = new SSAO2RenderingPipeline(
      settings.name,
      scene,
      { ssaoRatio: 0.5, blurRatio: 1 },
      [camera],
      false,
    );
    pipeline.totalStrength = 0.6;
    pipeline.radius = settings.radius;
    // Eight samples, halved from sixteen on trial (owner, 2026-11-13): the bilateral
    // blur below keeps the result smooth, at half the occlusion's sampling cost.
    pipeline.samples = 8;
    pipeline.maxZ = settings.maxZ;
    // `samples` above is the SSAO sample count, not antialiasing. The pipeline renders
    // the scene into its own single-sample texture, so the engine's `antialias: true`
    // never reaches the visit; the temporal antialiasing smooths those edges instead.
    // Multisampling that texture as well (`textureSamples = 4`, from before the TAA)
    // doubled the antialiasing for the price of more than half the visit's frame time
    // on a software or integrated GPU, with no visible difference at rest or in motion.
    pipeline.textureSamples = 1;
    // The bilateral blur is what keeps half-resolution AO from looking grainy on plaster.
    pipeline.expensiveBlur = true;
    pipeline.bilateralSamples = OCCLUSION_BLUR_SAMPLES;
    return pipeline;
  } catch (error) {
    scene.disablePrePassRenderer();
    console.info(
      `[visite] occlusion ambiante indisponible : ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/** The overview's occlusion: the walk's pipeline at the overview's scale. */
export function createOrbitOcclusion(
  scene: Scene,
  camera: Camera,
): SSAO2RenderingPipeline | undefined {
  return createInteriorOcclusion(scene, camera, ORBIT_OCCLUSION);
}

/**
 * The slice of `DefaultRenderingPipeline` the visit configures. Narrowed to a
 * structural type so the ordering rule below is testable without a GPU.
 */
export interface BloomPipeline {
  imageProcessing: { toneMappingEnabled: boolean; vignetteEnabled: boolean } | null;
  imageProcessingEnabled: boolean;
  bloomEnabled: boolean;
  bloomThreshold: number;
  bloomWeight: number;
}

/**
 * Applies the validated bloom to a pipeline. The threshold is a parameter
 * because the two cameras read different ceilings: the visit sits at
 * `INTERIOR_BLOOM_THRESHOLD`, the orbit above its flat sky at
 * `ORBIT_BLOOM_THRESHOLD`. The weight is shared.
 *
 * The app tone-maps in the material shaders, so the pipeline's own image
 * processing would tone-map a second time. It has to be configured *before* the
 * pass is switched off: disabling it disposes the post-process and nulls
 * `imageProcessing`, leaving the sub-effects unreachable.
 */
export function configureInteriorBloom(
  pipeline: BloomPipeline,
  threshold: number = INTERIOR_BLOOM_THRESHOLD,
): void {
  if (pipeline.imageProcessing) {
    pipeline.imageProcessing.toneMappingEnabled = false;
    pipeline.imageProcessing.vignetteEnabled = false;
  }
  pipeline.imageProcessingEnabled = false;
  pipeline.bloomThreshold = threshold;
  pipeline.bloomWeight = INTERIOR_BLOOM_WEIGHT;
  pipeline.bloomEnabled = true;
}

/**
 * Bloom for the visit camera. Built after the occlusion on purpose: Babylon
 * appends each pipeline to the end of the camera's chain, so the glow is
 * composited on the finished image instead of being fed back into the AO.
 *
 * `hdr` stays false. The materials already tone-map in their shaders, so the
 * values reaching the pipeline are display-referred: a half-float buffer would
 * cost a second scene render and bandwidth without widening the range the
 * threshold reads.
 */
export function createInteriorBloom(
  scene: Scene,
  camera: Camera,
): DefaultRenderingPipeline | undefined {
  try {
    const pipeline = new DefaultRenderingPipeline('interior-bloom', false, scene, [camera]);
    configureInteriorBloom(pipeline);
    pipeline.fxaaEnabled = true;
    return pipeline;
  } catch (error) {
    console.info(
      `[visite] bloom indisponible : ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Bloom of the orbit camera, hence of the 3D view and the Exterior. Same weight
 * value as the walk, threshold above the flat sky (see
 * `ORBIT_BLOOM_THRESHOLD`). Plan reuses the same camera in orthographic mode:
 * `ViewEffects` detaches the pipeline in that mode and reattaches it in overview,
 * preserving its post-processes across switches.
 */
export function createOrbitBloom(
  scene: Scene,
  camera: Camera,
): DefaultRenderingPipeline | undefined {
  try {
    const pipeline = new DefaultRenderingPipeline('orbit-bloom', false, scene, [camera]);
    configureInteriorBloom(pipeline, ORBIT_BLOOM_THRESHOLD);
    pipeline.samples = 4;
    return pipeline;
  } catch (error) {
    console.info(
      `[vue 3d] bloom indisponible : ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
