/**
 * Full resolution is one rendered pixel per CSS pixel, never the screen's own ratio: on a
 * display scaled to 150 % that would draw 2.25 times the pixels for a sharpness the owner
 * does not see (2026-11-13).
 */
export const MAX_PIXEL_RATIO = 1;

/**
 * Render scales tried, from full resolution down. Never below two thirds: under that,
 * textures turn visibly blurry.
 */
export const RENDER_SCALES = [1, 0.9, 0.8, 0.67] as const;

/**
 * The visit's fixed floor, whatever the pixel ratio, once its occlusion is gone: every
 * step down to 67 %, one at a time. What the owner disliked (2026-11-13) was the jump
 * from a 150 % render straight to 67 %, not 67 % reached step by step. Plan, Vue 3D and
 * Extérieur keep the one-rendered-pixel-per-CSS-pixel floor instead.
 */
export const VISIT_SCALE_FLOOR = 0.67;

/**
 * Effect tiers, dropped **before** the resolution (owner, 2026-11-13: when the frame rate is
 * low, rather lose the occlusion than sharpness): 1 no occlusion. Only the views that have
 * one (the visit, Vue 3D) have a tier to drop. The occlusion is never degraded on the way:
 * a grainy cheap-blur version is the ugliest of the states, and a look that changes by
 * itself reads as a bug. Fewer temporal antialiasing samples is no tier: the count only
 * sets the length of the jitter sequence, each image costs the same.
 */
export const EFFECT_TIERS = 1;

/**
 * Scales above full resolution, tried one at a time on a machine with headroom (owner,
 * 2026-11-13): at 150 % a display scaled to 150 % gets one rendered pixel per screen pixel.
 */
export const UPSCALES = [1.1, 1.2, 1.3, 1.4, 1.5] as const;

/** The whole ladder, sharpest first: up-scales, then full resolution and the steps down. */
const LADDER: readonly number[] = [...[...UPSCALES].reverse(), ...RENDER_SCALES];
const FULL = UPSCALES.length;

/** Every scale a user may pin in the Navigation panel, lowest first. */
export const PINNABLE_SCALES: readonly number[] = [...LADDER].reverse();

/** Above this median frame time (under 40 fps), the next render scale is tried. */
export const FRAME_BUDGET_MS = 25;

/** Under this median frame time (over 100 fps), the next sharper scale is tried. */
export const UPSCALE_FRAME_MS = 10;

/** How a view's scale is chosen: measured and adapted, or pinned by the user. */
export interface ScalePolicy {
  /** A pinned scale: never adapted, in either direction. */
  fixed?: number;
  /** Where an adapted view starts: the scale this machine reached last time. */
  start?: number;
}

/** The ladder step nearest to `scale`, full resolution when absent. */
function stepOf(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return FULL;
  let best: number = FULL;
  LADDER.forEach((value, index) => {
    if (Math.abs(value - scale) < Math.abs(LADDER[best] - scale)) best = index;
  });
  return best;
}

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
 * Dynamic resolution of one view, the same at rest and in motion. A machine that cannot
 * hold 40 fps renders fewer pixels, one step at a time. A machine over 100 fps renders
 * more, 10 % at a time up to 150 %, until it falls under 100 fps. Once a view has stepped
 * down it never climbs again in the session: changing scale resizes every render target,
 * which hitches, so the scale must not swing with the camera. Between 40 and 100 fps it
 * stays where it is.
 */
export class AdaptiveResolution {
  private level: number;
  private steppedDown = false;
  private effectLevel = 0;
  private forcedTier?: number;
  private samples: number[] = [];
  private warmup = WARMUP_FRAMES;

  /**
   * `floor`: under 1, a fixed floor whatever the pixel ratio; 1 means each step must keep
   * at least one rendered pixel per CSS pixel.
   * `tiers`: effect tiers this view can drop, first (0 for a view without occlusion).
   */
  constructor(
    private readonly pixelRatio: number,
    private readonly floor = 1,
    private readonly tiers = 0,
    private readonly policy: ScalePolicy = {},
  ) {
    this.level = stepOf(policy.fixed ?? policy.start);
  }

  /**
   * `frameMs` is the time since the previous image, when both were drawn in a row;
   * returns the render scale to use for this image (1 = full resolution).
   */
  update(frameMs?: number): number {
    if (frameMs === undefined || !Number.isFinite(frameMs) || frameMs > STALL_MS)
      return LADDER[this.level];
    if (this.warmup > 0) {
      this.warmup--;
      return LADDER[this.level];
    }
    this.samples.push(frameMs);
    if (this.samples.length >= FRAME_SAMPLES) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      this.samples = [];
      const pinned = this.policy.fixed !== undefined;
      if (median > FRAME_BUDGET_MS) {
        const next = LADDER[this.level + 1];
        // Sharpness above 100 % is a bonus: it goes before the occlusion does.
        if (!pinned && LADDER[this.level] > 1) {
          this.level++;
          this.steppedDown = true;
          this.warmup = WARMUP_FRAMES;
        } else if (this.effectLevel < this.tiers) {
          this.effectLevel++;
          this.warmup = WARMUP_FRAMES;
        } else if (
          !pinned &&
          next !== undefined &&
          (next >= 1 || (this.floor < 1 ? next >= this.floor : next * this.pixelRatio >= 1))
        ) {
          this.level++;
          this.steppedDown = true;
          this.warmup = WARMUP_FRAMES;
        }
      } else if (
        median < UPSCALE_FRAME_MS &&
        !pinned &&
        !this.steppedDown &&
        this.effectLevel === 0 &&
        this.level > 0
      ) {
        this.level--;
        this.warmup = WARMUP_FRAMES;
      }
    }
    return LADDER[this.level];
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
    return LADDER[this.level];
  }
}

/**
 * One dynamic resolution per view (`viewKey`): the visit costs several times the plan, and
 * a scale or a tier the visit needed must not soften the plan or take the occlusion out
 * of a Vue 3D that holds 40 fps. Switching view already rebuilds that view's effects, so
 * the resize it may bring costs no extra hitch. A view entered again starts with a
 * warm-up: the images around a switch (shader links, pipeline rebuilds) are not its speed.
 */
export class ViewResolutions {
  private readonly views = new Map<string, AdaptiveResolution>();
  private current?: string;
  private forcedTier?: number;
  private fixed?: number;
  private starts: Record<string, number> = {};

  constructor(private readonly pixelRatio: number) {}

  /**
   * A pinned scale for every view, or adapted views starting where this machine left them.
   * Views already measured are dropped and start over under the new policy.
   */
  configure(fixed: number | undefined, starts: Record<string, number>): void {
    this.fixed = fixed;
    this.starts = { ...starts };
    this.views.clear();
    this.current = undefined;
  }

  /** The resolution of `view`, created on first use; entering it restarts its warm-up. */
  for(view: string): AdaptiveResolution {
    let resolution = this.views.get(view);
    if (!resolution) {
      resolution = new AdaptiveResolution(
        this.pixelRatio,
        view === 'walk' ? VISIT_SCALE_FLOOR : 1,
        // Only the visit and Vue 3D carry an occlusion to drop.
        view === 'walk' || view === 'overview' ? EFFECT_TIERS : 0,
        { fixed: this.fixed, start: this.starts[view] },
      );
      resolution.force(this.forcedTier);
      this.views.set(view, resolution);
    }
    if (view !== this.current) {
      this.current = view;
      resolution.resume();
    }
    return resolution;
  }

  /** The page was hidden or lost the focus: no view measures the images that follow. */
  resume(): void {
    for (const resolution of this.views.values()) resolution.resume();
  }

  /** Development bench only: pins the tier of every view (or hands it back). */
  force(tier?: number): void {
    this.forcedTier = tier;
    for (const resolution of this.views.values()) resolution.force(tier);
  }
}
