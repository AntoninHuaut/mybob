/**
 * Candidate for a cheaper ambient occlusion, judged on the development bench only.
 *
 * Babylon's SSAO2 rotates its sample kernel per pixel with one fixed 128² noise texture,
 * so every image repeats the same noise and the temporal antialiasing has nothing to
 * average: the blur alone has to hide it, hence 16 samples. Current practice (Activision's
 * GTAO, Intel's XeGTAO) changes the noise every image and lets the temporal accumulation
 * integrate it, with fewer samples per image. This module does that to an existing
 * pipeline: `samples` lowered, and the noise texture swapped every image among
 * `NOISE_FRAMES` patterns while the temporal antialiasing accumulates.
 *
 * Its risk is the one XeGTAO warns about: the history clamping may read moving noise as
 * detail and shimmer in motion. Hence the bench, and Visite judged while walking.
 *
 * It reaches two private fields of Babylon's pipeline (`ssaoPostProcessOf`); a Babylon
 * update that renames them makes `apply` return false, and the bench says so.
 */
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';

/** Noise patterns cycled; the orbit and walk temporal antialiasing average 16 images. */
export const NOISE_FRAMES = 8;
/** Samples per image of the candidate, against 16 in production. */
export const ECONOMY_SAMPLES = 8;
const NOISE_SIZE = 128;

interface SsaoPostProcess {
  _randomTexture: Texture;
  _sampleSphere?: number[];
  samples: number;
}

/**
 * The hemisphere kernel Babylon builds for 16 samples or more (Hammersley points, the
 * tangent band rejected), for any count. Below 16 Babylon draws it with `Math.random()`,
 * a different kernel every session: two measures would not compare, and an unlucky draw
 * clusters the samples.
 */
export function hammersleyKernel(count: number): number[] {
  const result: number[] = [];
  for (let index = 0; index < count; index++) {
    let bits = index;
    bits = ((bits << 16) | (bits >>> 16)) >>> 0;
    bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
    bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
    bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
    bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
    const u = index / count;
    const v = bits / 0x100000000;
    const phi = v * 2 * Math.PI;
    const cosTheta = 1 - u * 0.85;
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    result.push(Math.cos(phi) * sinTheta, Math.sin(phi) * sinTheta, cosTheta);
  }
  return result;
}

/** The pass that owns the noise texture, or undefined when Babylon's internals moved. */
export function ssaoPostProcessOf(pipeline: SSAO2RenderingPipeline): SsaoPostProcess | undefined {
  const thin = (pipeline as unknown as { _thinSSAORenderingPipeline?: unknown })
    ._thinSSAORenderingPipeline as { _ssaoPostProcess?: SsaoPostProcess } | undefined;
  const pass = thin?._ssaoPostProcess;
  return pass && pass._randomTexture ? pass : undefined;
}

/**
 * The same distribution as Babylon's own noise (unit 2D vectors in red and green), from a
 * seeded generator: the patterns are the same on every run, so two measures compare.
 */
export function noisePattern(seed: number, size = NOISE_SIZE): Uint8Array {
  let state = (seed * 0x9e3779b1) >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const data = new Uint8Array(size * size * 4);
  for (let index = 0; index < data.length; index += 4) {
    let x = random();
    let y = random();
    const length = Math.hypot(x, y) || 1;
    x = (x / length) * 255;
    y = (y / length) * 255;
    data[index] = Math.floor(x);
    data[index + 1] = Math.floor(y);
    data[index + 2] = 0;
    data[index + 3] = 255;
  }
  return data;
}

/**
 * Applied to one pipeline until `dispose`, which puts back its samples and noise.
 * `accumulating` says whether the temporal antialiasing averages this image: the orbit's
 * is bypassed while the camera moves, and a noise changing then would only flicker.
 */
export class RotatingOcclusionNoise {
  private readonly textures: Texture[] = [];
  private readonly original: Texture;
  private readonly originalSamples: number;
  private readonly observer: Observer<Scene> | null;
  private index = 0;

  private constructor(
    private readonly pass: SsaoPostProcess,
    scene: Scene,
    accumulating: () => boolean,
  ) {
    this.original = pass._randomTexture;
    this.originalSamples = pass.samples;
    for (let frame = 0; frame < NOISE_FRAMES; frame++) {
      const texture = RawTexture.CreateRGBATexture(
        noisePattern(frame + 1),
        NOISE_SIZE,
        NOISE_SIZE,
        scene,
        false,
        false,
        Texture.NEAREST_SAMPLINGMODE,
      );
      texture.name = `occlusion-noise-${frame}`;
      texture.wrapU = Texture.WRAP_ADDRESSMODE;
      texture.wrapV = Texture.WRAP_ADDRESSMODE;
      this.textures.push(texture);
    }
    pass.samples = ECONOMY_SAMPLES;
    // Setting `samples` regenerated the kernel: replace it with a deterministic one.
    if (pass._sampleSphere) pass._sampleSphere = hammersleyKernel(ECONOMY_SAMPLES);
    this.observer = scene.onBeforeRenderObservable.add(() => {
      if (accumulating()) this.index = (this.index + 1) % NOISE_FRAMES;
      this.pass._randomTexture = this.textures[this.index];
    });
  }

  static apply(
    pipeline: SSAO2RenderingPipeline,
    scene: Scene,
    accumulating: () => boolean,
  ): RotatingOcclusionNoise | undefined {
    const pass = ssaoPostProcessOf(pipeline);
    return pass ? new RotatingOcclusionNoise(pass, scene, accumulating) : undefined;
  }

  get noiseIndex(): number {
    return this.index;
  }

  dispose(scene: Scene): void {
    scene.onBeforeRenderObservable.remove(this.observer);
    // A pipeline already disposed has disposed its own texture; putting it back is harmless.
    this.pass._randomTexture = this.original;
    // The setter rebuilds production's own kernel (Hammersley at 16).
    this.pass.samples = this.originalSamples;
    for (const texture of this.textures) texture.dispose();
  }
}

/**
 * True when the camera did not move since the previous call: what the orbit's temporal
 * antialiasing needs to accumulate (`disableOnCameraMove`). The walk's reprojects in
 * motion, so it accumulates always.
 */
export function stillCamera(camera: Camera): () => boolean {
  let previous = '';
  return () => {
    const key = camera.getViewMatrix().asArray().join(',');
    const still = key === previous;
    previous = key;
    return still;
  };
}
