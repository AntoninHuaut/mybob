/**
 * Render scales tried, from full resolution down. Never below two thirds: under that,
 * textures turn visibly blurry.
 */
export const RENDER_SCALES = [1, 0.8, 0.67] as const;

/**
 * Lowest scale the visit may take even below one rendered pixel per CSS pixel. Elsewhere a
 * screen at pixel ratio 1 stays at 100 %, and its only lever was dropping the occlusion; in
 * the visit, slightly softer pixels at 80 % (0.64 of the pixel work) cost the eye less than
 * losing the corner hollows. Plan, Vue 3D and Extérieur keep the one-pixel floor.
 */
export const VISIT_SCALE_FLOOR = 0.8;

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
 * Dynamic resolution of one view, the same at rest and in motion. A machine that cannot
 * hold 40 fps renders fewer pixels, one step at a time; a machine that can never leaves
 * full resolution. The scale only goes down, and is kept for the session: changing it
 * resizes every render target, which hitches, so it must not follow the camera.
 */
export class AdaptiveResolution {
  private level = 0;
  private effectLevel = 0;
  private forcedTier?: number;
  private samples: number[] = [];
  private warmup = WARMUP_FRAMES;

  /**
   * `floor`: scales at or above it are allowed whatever the pixel ratio; below it, a step
   * must keep at least one rendered pixel per CSS pixel. 1 keeps only that rule.
   */
  constructor(
    private readonly pixelRatio: number,
    private readonly floor = 1,
  ) {}

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
        const next = RENDER_SCALES[this.level + 1];
        if (next !== undefined && (next * this.pixelRatio >= 1 || next >= this.floor)) {
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

  constructor(private readonly pixelRatio: number) {}

  /** The resolution of `view`, created on first use; entering it restarts its warm-up. */
  for(view: string): AdaptiveResolution {
    let resolution = this.views.get(view);
    if (!resolution) {
      resolution = new AdaptiveResolution(this.pixelRatio, view === 'walk' ? VISIT_SCALE_FLOOR : 1);
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
