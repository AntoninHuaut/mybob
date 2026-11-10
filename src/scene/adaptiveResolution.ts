/**
 * Render scales tried, from full resolution down. Never below two thirds: under that,
 * textures turn visibly blurry.
 */
export const RENDER_SCALES = [1, 0.8, 0.67] as const;

/** Above this median frame time (under 40 fps), the next render scale is tried. */
export const FRAME_BUDGET_MS = 25;

/** Images measured before each decision: one slow image is not a slow machine. */
export const FRAME_SAMPLES = 6;

/**
 * Images ignored at the start and after each change of scale. Shaders compile and the
 * antialiasing history builds up at the start, and a resize reallocates every render
 * target: read as a slow machine, those hitches would lower the resolution of a machine
 * that holds 40 fps.
 */
export const WARMUP_FRAMES = 30;

/**
 * Dynamic resolution, the same at rest and in motion. A machine that cannot hold 40 fps
 * renders fewer pixels, one step at a time; a machine that can never leaves full
 * resolution. The scale only goes down, and is kept for the session: changing it resizes
 * every render target, which hitches, so it must not follow the camera.
 */
export class AdaptiveResolution {
  private level = 0;
  private samples: number[] = [];
  private warmup = WARMUP_FRAMES;

  /**
   * `frameMs` is the time since the previous image, when both were drawn in a row;
   * returns the render scale to use for this image (1 = full resolution).
   */
  update(frameMs?: number): number {
    if (frameMs === undefined || !Number.isFinite(frameMs)) return RENDER_SCALES[this.level];
    if (this.warmup > 0) {
      this.warmup--;
      return RENDER_SCALES[this.level];
    }
    this.samples.push(frameMs);
    if (this.samples.length >= FRAME_SAMPLES) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      this.samples = [];
      if (median > FRAME_BUDGET_MS && this.level < RENDER_SCALES.length - 1) {
        this.level++;
        this.warmup = WARMUP_FRAMES;
      }
    }
    return RENDER_SCALES[this.level];
  }

  /** The scale in use on this machine, for the diagnostic. */
  get scale(): number {
    return RENDER_SCALES[this.level];
  }
}
