/**
 * Render scales tried, from full resolution down. Never below two thirds: under that,
 * textures turn visibly blurry.
 */
export const RENDER_SCALES = [1, 0.8, 0.67] as const;

/**
 * Effect tiers, tried once the resolution is at its floor (it costs the least to the eye):
 * 1 no occlusion. The occlusion is never degraded on the way: a grainy cheap-blur version
 * is the ugliest of the states, and a look that changes by itself reads as a bug. Fewer
 * temporal antialiasing samples is no tier: the count only sets the length of the jitter
 * sequence, each image costs the same.
 */
export const EFFECT_TIERS = 1;

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
 * A gap this long between two images is a stall (tab in the background, window
 * switch, debugger), not the speed of the machine: it is not measured.
 */
export const STALL_MS = 5000;

/**
 * Dynamic resolution, the same at rest and in motion. A machine that cannot hold 40 fps
 * renders fewer pixels, one step at a time; a machine that can never leaves full
 * resolution. The scale only goes down, and is kept for the session: changing it resizes
 * every render target, which hitches, so it must not follow the camera.
 */
export class AdaptiveResolution {
  private level = 0;
  private effectLevel = 0;
  private forcedTier?: number;
  private samples: number[] = [];
  private warmup = WARMUP_FRAMES;

  constructor(private readonly pixelRatio: number) {}

  /**
   * `frameMs` is the time since the previous image, when both were drawn in a row;
   * returns the render scale to use for this image (1 = full resolution).
   */
  update(frameMs?: number): number {
    if (frameMs === undefined || !Number.isFinite(frameMs) || frameMs > STALL_MS)
      return RENDER_SCALES[this.level];
    if (this.warmup > 0) {
      this.warmup--;
      return RENDER_SCALES[this.level];
    }
    this.samples.push(frameMs);
    if (this.samples.length >= FRAME_SAMPLES) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      this.samples = [];
      if (median > FRAME_BUDGET_MS) {
        if (
          this.level < RENDER_SCALES.length - 1 &&
          RENDER_SCALES[this.level + 1] * this.pixelRatio >= 1
        ) {
          this.level++;
          this.warmup = WARMUP_FRAMES;
        } else if (this.effectLevel < EFFECT_TIERS) {
          this.effectLevel++;
          this.warmup = WARMUP_FRAMES;
        }
      }
    }
    return RENDER_SCALES[this.level];
  }

  /**
   * The page was hidden or lost the focus. The GPU is shared and clocked down, the
   * browser throttled the tab: the first images after the return are not the speed of
   * the machine, and a tier taken for them would never be given back.
   */
  resume(): void {
    this.samples = [];
    this.warmup = WARMUP_FRAMES;
  }

  /** Effect tier in use (0 = every effect at full quality), for the diagnostic. */
  get effectTier(): number {
    return this.forcedTier ?? this.effectLevel;
  }

  /** Development bench only: pins the tier (or hands it back with undefined). */
  force(tier?: number): void {
    this.forcedTier =
      tier === undefined ? undefined : Math.max(0, Math.min(EFFECT_TIERS, Math.round(tier)));
  }

  /** The scale in use on this machine, for the diagnostic. */
  get scale(): number {
    return RENDER_SCALES[this.level];
  }
}
