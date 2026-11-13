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
 * How sharp a screen may be rendered (owner, 2026-11-13): 150 % on a 4K screen, 125 % on
 * a 2K one, never above 100 % under 2K. Measured on the screen's device pixels, so a 4K
 * screen scaled to 150 % (2560 CSS pixels wide) still counts as 4K.
 */
export function upscaleCap(width: number, height: number, pixelRatio: number): number {
  const pixels = Math.max(width, height) * (pixelRatio || 1);
  if (!Number.isFinite(pixels)) return 1;
  if (pixels >= 3800) return 1.5;
  if (pixels >= 2500) return 1.25;
  return 1;
}

/** Scales above full resolution up to `cap`, 10 % apart, the cap itself last. */
export function upscales(cap: number): number[] {
  return [1.1, 1.2, 1.3, 1.4, 1.5]
    .filter((scale) => scale < cap - 1e-6)
    .concat(cap > 1 ? [cap] : []);
}

/** The whole ladder for a cap, sharpest first: up-scales, full resolution, the steps down. */
function ladder(cap: number): number[] {
  return [...upscales(cap).reverse(), ...RENDER_SCALES];
}

/** Every scale a user may pin in the Navigation panel on this screen, lowest first. */
export function pinnableScales(cap: number): number[] {
  return ladder(cap).reverse();
}

/** Above this median frame time (under 40 fps), the next render scale is tried. */
export const FRAME_BUDGET_MS = 25;

/**
 * Refresh rates a display runs at. A median frame time within `VSYNC_TOLERANCE` of one
 * of them is the browser waiting for the screen: the machine keeps up, with room to spare.
 */
export const REFRESH_RATES_HZ = [60, 75, 90, 100, 120, 144, 165, 240] as const;
export const VSYNC_TOLERANCE = 0.05;

/**
 * Over the refresh interval by this much at an up-scale, the machine no longer keeps up:
 * the scale goes back one step and stays there for the session.
 */
export const UPSCALE_SLIP = 0.15;

/** The refresh interval a median frame time sits on, or undefined if it sits on none. */
export function refreshIntervalOf(medianMs: number): number | undefined {
  for (const hz of REFRESH_RATES_HZ) {
    const interval = 1000 / hz;
    if (Math.abs(medianMs - interval) <= interval * VSYNC_TOLERANCE) return interval;
  }
  return undefined;
}

/** How a view's scale is chosen: measured and adapted, or pinned by the user. */
export interface ScalePolicy {
  /** A pinned scale: never adapted, in either direction. */
  fixed?: number;
  /** Where an adapted view starts: the scale this machine reached last time. */
  start?: number;
  /** The sharpest scale this screen allows (`upscaleCap`); 1 means no up-scaling. */
  cap?: number;
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
 * hold 40 fps renders fewer pixels, one step at a time. A machine that keeps up with the
 * screen's refresh rate (60, 90, 120, 144 Hz…) renders more, one step at a time up to the
 * screen's cap; when it falls behind the refresh, the scale goes back one step. Once a view
 * has stepped down it never climbs again in the session: changing scale resizes every
 * render target, which hitches, so the scale must not swing with the camera.
 */
export class AdaptiveResolution {
  private readonly ladder: number[];
  private readonly full: number;
  private level: number;
  /** The screen's refresh interval, once a series sat on one. */
  private refreshMs?: number;
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
    this.ladder = ladder(policy.cap ?? 1);
    this.full = this.ladder.indexOf(1);
    const wanted = policy.fixed ?? policy.start;
    let best = this.full;
    if (wanted !== undefined && Number.isFinite(wanted))
      this.ladder.forEach((value, index) => {
        if (Math.abs(value - wanted) < Math.abs(this.ladder[best] - wanted)) best = index;
      });
    this.level = best;
  }

  /**
   * `frameMs` is the time since the previous image, when both were drawn in a row;
   * returns the render scale to use for this image (1 = full resolution).
   */
  update(frameMs?: number): number {
    if (frameMs === undefined || !Number.isFinite(frameMs) || frameMs > STALL_MS)
      return this.ladder[this.level];
    if (this.warmup > 0) {
      this.warmup--;
      return this.ladder[this.level];
    }
    this.samples.push(frameMs);
    if (this.samples.length >= FRAME_SAMPLES) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      this.samples = [];
      const pinned = this.policy.fixed !== undefined;
      const vsync = refreshIntervalOf(median);
      if (vsync !== undefined) this.refreshMs = Math.min(this.refreshMs ?? Infinity, vsync);
      const scale = this.ladder[this.level];
      if (
        !pinned &&
        scale > 1 &&
        (this.refreshMs === undefined
          ? vsync === undefined
          : median > this.refreshMs * (1 + UPSCALE_SLIP))
      ) {
        // Behind the screen at an up-scale (or, started there from a saved scale, not yet
        // seen keeping up with any refresh rate): back one step, and no more climbing.
        this.level++;
        this.steppedDown = true;
        this.warmup = WARMUP_FRAMES;
      } else if (median > FRAME_BUDGET_MS) {
        const next = this.ladder[this.level + 1];
        // Sharpness above 100 % is a bonus: it goes before the occlusion does.
        if (!pinned && this.ladder[this.level] > 1) {
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
        vsync !== undefined &&
        vsync === this.refreshMs &&
        !pinned &&
        !this.steppedDown &&
        this.effectLevel === 0 &&
        this.level > 0
      ) {
        this.level--;
        this.warmup = WARMUP_FRAMES;
      }
    }
    return this.ladder[this.level];
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
    return this.ladder[this.level];
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

  /** `cap`: the sharpest scale this screen allows (`upscaleCap`). */
  constructor(
    private readonly pixelRatio: number,
    private readonly cap = 1,
  ) {}

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
        { fixed: this.fixed, start: this.starts[view], cap: this.cap },
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
