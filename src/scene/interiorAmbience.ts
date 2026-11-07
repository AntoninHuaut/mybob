import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CubeMapToSphericalPolynomialTools } from '@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
// Registers the `sphericalPolynomial` accessor used to feed diffuse IBL without a GPU readback.
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial';
// Replaces the `enableGeometryBufferRenderer` stub with the real implementation.
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';

/**
 * Bounce colours of a neutral interior. The ceiling is the brightest surface a
 * room sees, the floor the darkest, so a vertical gradient alone already reads
 * as volume on matte plaster.
 */
const CEILING_BOUNCE = Color3.FromHexString('#e9e5db');
const HORIZON_BOUNCE = Color3.FromHexString('#cfc7b8');
const FLOOR_BOUNCE = Color3.FromHexString('#5c574f');

/** A 32 px face is enough for a smooth gradient once mipmapped. */
const FACE_SIZE = 32;

/** How strongly the generated environment lights the interior. */
export const INTERIOR_ENVIRONMENT_INTENSITY = 0.55;

/** The ceiling blocks the sun in visit, so the fixtures have to carry the room. */
export const INTERIOR_FIXTURE_INTENSITY = 0.55;
export const INTERIOR_FIXTURE_RANGE = 7;

/** Darker ground bounce in visit, so the hemispheric light reads top-to-bottom. */
export const INTERIOR_GROUND_COLOR = Color3.FromHexString('#6d6a5f');

/**
 * Ambient occlusion is the expensive part of the visit. Below this frame rate the
 * pipeline is dropped: a weak GPU keeps a usable visit, losing corner hollows
 * rather than the ability to walk. This is a playability floor, not a measurement
 * of what occlusion itself costs.
 */
export const INTERIOR_OCCLUSION_MIN_FPS = 24;

/** Let the visit settle before judging it: shaders compile on the first frames. */
export const INTERIOR_OCCLUSION_WARMUP_MS = 2500;

/** Interval between two frame-rate samples once the visit has warmed up. */
export const INTERIOR_OCCLUSION_SAMPLE_MS = 500;

/** Consecutive low samples required before dropping occlusion. */
export const INTERIOR_OCCLUSION_LOW_SAMPLES = 3;

export interface OcclusionProbe {
  /** When the next frame-rate sample is due. */
  nextAt: number;
  /** Consecutive samples below the floor. */
  low: number;
}

export function startOcclusionProbe(now: number): OcclusionProbe {
  return { nextAt: now + INTERIOR_OCCLUSION_WARMUP_MS, low: 0 };
}

/**
 * Decides whether ambient occlusion must be dropped.
 *
 * A hidden tab freezes the frame loop, so the first frame back carries a delta of
 * several seconds and collapses the engine's 30-frame average. Judging on that
 * single frame would drop occlusion for the rest of the session after one
 * alt-tab, so a hidden document restarts the window instead. A single low sample
 * is never enough either: a garbage collection or a shader compile can produce
 * one, hence the consecutive-sample requirement.
 */
export function nextOcclusionProbe(
  probe: OcclusionProbe,
  now: number,
  fps: number,
  visible: boolean,
): { probe: OcclusionProbe; refuse: boolean } {
  if (!visible) return { probe: startOcclusionProbe(now), refuse: false };
  if (now < probe.nextAt) return { probe, refuse: false };
  if (fps >= INTERIOR_OCCLUSION_MIN_FPS) {
    return { probe: { nextAt: now + INTERIOR_OCCLUSION_SAMPLE_MS, low: 0 }, refuse: false };
  }
  const low = probe.low + 1;
  return {
    probe: { nextAt: now + INTERIOR_OCCLUSION_SAMPLE_MS, low },
    refuse: low >= INTERIOR_OCCLUSION_LOW_SAMPLES,
  };
}

function verticalBounce(t: number) {
  return t < 0.5
    ? Color3.Lerp(CEILING_BOUNCE, HORIZON_BOUNCE, t * 2)
    : Color3.Lerp(HORIZON_BOUNCE, FLOOR_BOUNCE, (t - 0.5) * 2);
}

/** One cube face, row 0 at the top, as RGBA bytes. */
function faceData(colourAt: (t: number) => Color3) {
  const data = new Uint8Array(FACE_SIZE * FACE_SIZE * 4);
  for (let y = 0; y < FACE_SIZE; y++) {
    const colour = colourAt(y / (FACE_SIZE - 1));
    for (let x = 0; x < FACE_SIZE; x++) {
      const offset = (y * FACE_SIZE + x) * 4;
      data[offset] = Math.round(colour.r * 255);
      data[offset + 1] = Math.round(colour.g * 255);
      data[offset + 2] = Math.round(colour.b * 255);
      data[offset + 3] = 255;
    }
  }
  return data;
}

/**
 * Diffuse irradiance of the generated faces, integrated by Babylon's own cube
 * map tooling instead of read back from the GPU: a readback is asynchronous and
 * unsupported on some WebGPU backends, which would leave the PBR materials
 * without any ambient term.
 */
export function bouncePolynomial(faces: {
  right: Uint8Array;
  left: Uint8Array;
  up: Uint8Array;
  down: Uint8Array;
  front: Uint8Array;
  back: Uint8Array;
}) {
  return CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
    ...faces,
    size: FACE_SIZE,
    format: Constants.TEXTUREFORMAT_RGBA,
    type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
    gammaSpace: true,
  });
}

/** The six generated faces, named as Babylon's cube map tooling expects them. */
export function bounceFaces() {
  return {
    right: faceData(verticalBounce),
    left: faceData(verticalBounce),
    up: faceData(() => CEILING_BOUNCE),
    down: faceData(() => FLOOR_BOUNCE),
    front: faceData(verticalBounce),
    back: faceData(verticalBounce),
  };
}

/**
 * Locally generated environment cube: no remote asset, so the public build stays
 * self-contained. Returns undefined when the engine cannot create raw textures
 * (NullEngine in tests), leaving the previous lighting untouched.
 */
export function createInteriorEnvironment(scene: Scene): RawCubeTexture | undefined {
  try {
    const faces = bounceFaces();
    // Babylon uploads raw cube faces as +X, +Y, +Z, -X, -Y, -Z.
    const texture = new RawCubeTexture(
      scene,
      [faces.right, faces.up, faces.front, faces.left, faces.down, faces.back],
      FACE_SIZE,
      Constants.TEXTUREFORMAT_RGBA,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.name = 'interior-bounce';
    texture.gammaSpace = true;
    texture.sphericalPolynomial = bouncePolynomial(faces);
    return texture;
  } catch (error) {
    console.info(
      `[visite] environnement local indisponible : ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Screen-space ambient occlusion for the visit camera only. Half-resolution AO
 * keeps the cost down; the geometry buffer is released with the pipeline so the
 * plan and overview modes never pay for it.
 */
export function createInteriorOcclusion(
  scene: Scene,
  camera: Camera,
): SSAO2RenderingPipeline | undefined {
  const buffer = scene.enableGeometryBufferRenderer();
  if (!buffer || !buffer.isSupported) {
    scene.disableGeometryBufferRenderer();
    return undefined;
  }
  try {
    const pipeline = new SSAO2RenderingPipeline(
      'interior-occlusion',
      scene,
      { ssaoRatio: 0.5, blurRatio: 1 },
      [camera],
      // A boolean, not the instance: passing the buffer would mark it as forced and
      // `dispose(true)` would then leave it rendering the G-buffer every frame.
      true,
    );
    pipeline.totalStrength = 0.6;
    pipeline.radius = 0.35;
    pipeline.samples = 16;
    pipeline.maxZ = 14;
    // The bilateral blur is what keeps half-resolution AO from looking grainy on plaster.
    pipeline.expensiveBlur = true;
    return pipeline;
  } catch (error) {
    scene.disableGeometryBufferRenderer();
    console.info(
      `[visite] occlusion ambiante indisponible : ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
