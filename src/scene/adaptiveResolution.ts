import type { GpuClass } from './deviceProfile';

/**
 * Full resolution is one rendered pixel per CSS pixel, never the screen's own ratio: on a
 * display scaled to 150 % that would draw 2.25 times the pixels for a sharpness the owner
 * does not see (2026-11-13).
 */
export const MAX_PIXEL_RATIO = 1;

/**
 * Render scales tried, from full resolution down, one step at a time in every view. Never
 * below two thirds: under that, textures turn visibly blurry.
 */
export const RENDER_SCALES = [1, 0.9, 0.8, 0.67] as const;
export const SCALE_FLOOR = 0.67;

/** Effect tiers, dropped in this order once the resolution is at its floor; each is whole or gone. */
export const OCCLUSION_TIER = 1;
export const SHADOW_TIER = 2;
export const BLOOM_TIER = 3;
export const EFFECT_TIERS = BLOOM_TIER;

/**
 * The « Qualité » select. `high` is the full look, sharper than 100 % where the screen allows
 * and the machine keeps up; `medium` is 67 % with every effect; `low` adds every effect tier;
 * `auto` walks the whole ladder, resolution first.
 */
export type Quality = 'auto' | 'high' | 'medium' | 'low';
export const QUALITIES: readonly Quality[] = ['auto', 'high', 'medium', 'low'];

/** Where a view stands on the ladder: its render scale and its effect tier. */
export interface QualityStart {
  scale: number;
  tier: number;
}

/** Where automatic starts on a machine never measured: integrated at « Moyenne », software at « Basse ». */
export function qualitySeed(gpu: GpuClass): QualityStart | undefined {
  if (gpu === 'integrated') return { scale: SCALE_FLOOR, tier: 0 };
  if (gpu === 'software') return { scale: SCALE_FLOOR, tier: EFFECT_TIERS };
  return undefined;
}

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

/** How a view's scale and tier are chosen. */
export interface ScalePolicy {
  quality?: Quality;
  /** Where an automatic view starts: where this machine left it last time, or its seed. */
  start?: QualityStart;
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
 * hold 40 fps renders fewer pixels, one step at a time, then drops effect tiers. A machine
 * that keeps up with the screen's refresh rate (60, 90, 120, 144 Hz…) renders more, one
 * step at a time up to the screen's cap; when it falls behind the refresh, the scale goes
 * back one step. Once a view has stepped down it never climbs again in the session:
 * changing scale resizes every render target, which hitches, so the scale must not swing
 * with the camera.
 */
export class AdaptiveResolution {
  private readonly ladder: number[];
  /** « Moyenne » and « Basse »: neither the scale nor the tier ever moves. */
  private readonly pinned: boolean;
  /** Tiers this view may drop by itself: none outside automatic. */
  private readonly droppable: number;
  private level: number;
  /** The screen's refresh interval, once a series sat on one. */
  private refreshMs?: number;
  private steppedDown = false;
  private effectLevel: number;
  private forcedTier?: number;
  private samples: number[] = [];
  private warmup = WARMUP_FRAMES;

  /** `tiers`: effect tiers this view has, dropped once at the floor (0 for the plan). */
  constructor(tiers = 0, policy: ScalePolicy = {}) {
    const quality = policy.quality ?? 'auto';
    const all = ladder(policy.cap ?? 1);
    this.ladder = quality === 'high' ? all.filter((scale) => scale >= 1) : all;
    this.pinned = quality === 'medium' || quality === 'low';
    this.droppable = quality === 'auto' ? tiers : 0;
    const wanted = this.pinned ? SCALE_FLOOR : (policy.start?.scale ?? 1);
    let best = this.ladder.indexOf(1);
    if (Number.isFinite(wanted))
      this.ladder.forEach((value, index) => {
        if (Math.abs(value - wanted) < Math.abs(this.ladder[best] - wanted)) best = index;
      });
    this.level = best;
    const tier = quality === 'low' ? tiers : quality === 'auto' ? (policy.start?.tier ?? 0) : 0;
    this.effectLevel = Number.isFinite(tier) ? Math.max(0, Math.min(tiers, Math.round(tier))) : 0;
  }

  /**
   * `frameMs` is the time since the previous image, when both were drawn in a row;
   * `displayHz` the screen's measured refresh rate, when known (`RefreshRateEstimator`).
   * Returns the render scale to use for this image (1 = full resolution).
   */
  update(frameMs?: number, displayHz?: number): number {
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
      // A measured screen rate wins over guessing it: 60 fps sits on a 60 Hz interval, but on
      // a 120 Hz screen it is half the rate, not keeping up.
      const measured = displayHz && displayHz > 0 ? 1000 / displayHz : undefined;
      const vsync =
        measured === undefined
          ? refreshIntervalOf(median)
          : Math.abs(median - measured) <= measured * VSYNC_TOLERANCE
            ? measured
            : undefined;
      if (measured !== undefined) this.refreshMs = measured;
      else if (vsync !== undefined) this.refreshMs = Math.min(this.refreshMs ?? Infinity, vsync);
      const scale = this.ladder[this.level];
      if (
        !this.pinned &&
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
        if (!this.pinned && this.level < this.ladder.length - 1) {
          this.level++;
          this.steppedDown = true;
          this.warmup = WARMUP_FRAMES;
        } else if (this.effectLevel < this.droppable) {
          this.effectLevel++;
          this.steppedDown = true;
          this.warmup = WARMUP_FRAMES;
        }
      } else if (
        vsync !== undefined &&
        vsync === this.refreshMs &&
        !this.pinned &&
        !this.steppedDown &&
        (this.effectLevel > 0 || this.level > 0)
      ) {
        // Started low (a saved start or the GPU seed) and keeping up: effects come back first.
        if (this.effectLevel > 0) this.effectLevel--;
        else this.level--;
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

  /** Effect tier in use (0 = every effect at full quality). */
  get effectTier(): number {
    return this.forcedTier ?? this.effectLevel;
  }

  /** Development bench only: pins the tier (or hands it back with undefined). */
  force(tier?: number): void {
    this.forcedTier =
      tier === undefined ? undefined : Math.max(0, Math.min(EFFECT_TIERS, Math.round(tier)));
  }

  /** The scale in use on this machine. */
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
  private quality: Quality = 'auto';
  private starts: Record<string, QualityStart> = {};
  private seed?: QualityStart;

  /** `cap`: the sharpest scale this screen allows (`upscaleCap`). */
  constructor(private cap = 1) {}

  /**
   * The window moved to a screen with another cap: every view starts over under it (its
   * refresh rate may differ too). Returns whether anything changed.
   */
  setCap(cap: number): boolean {
    if (cap === this.cap) return false;
    this.cap = cap;
    this.views.clear();
    this.current = undefined;
    return true;
  }

  /**
   * The « Qualité » for every view; automatic views start where this machine left them, or
   * at `seed` (`qualitySeed`). Views already measured start over under the new policy.
   */
  configure(quality: Quality, starts: Record<string, QualityStart>, seed?: QualityStart): void {
    this.quality = quality;
    this.starts = { ...starts };
    this.seed = seed;
    this.views.clear();
    this.current = undefined;
  }

  /** The resolution of `view`, created on first use; entering it restarts its warm-up. */
  for(view: string): AdaptiveResolution {
    let resolution = this.views.get(view);
    if (!resolution) {
      // The plan draws no occlusion, sun shadow or bloom: it has no tier to drop.
      resolution = new AdaptiveResolution(view === 'plan' ? 0 : EFFECT_TIERS, {
        quality: this.quality,
        start: this.starts[view] ?? this.seed,
        cap: this.cap,
      });
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
