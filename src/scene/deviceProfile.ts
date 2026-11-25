import { isSoftwareRenderer } from './shaderWarmup';

/**
 * What kind of machine draws the page, for the performance reports: read from the WebGL
 * renderer string and the browser's user agent.
 */
export type GpuClass = 'software' | 'integrated' | 'discrete' | 'headset' | 'unknown';

export const GPU_CLASS_LABELS: Record<GpuClass, string> = {
  software: 'logicielle (sans carte graphique)',
  integrated: 'intégrée',
  discrete: 'dédiée',
  headset: 'casque autonome',
  unknown: 'inconnue',
};

/** A headset's own browser, not a PC streaming to a headset. */
const STANDALONE_HEADSET = /OculusBrowser|Quest|Pico/i;
// Intel Arc with a model number (A770, B580) is a card; plain "Arc Graphics" is Meteor Lake's iGPU.
// AMD's processor graphics borrow card names ("RX Vega 11 Graphics", "R7 Graphics"): checked first.
const AMD_INTEGRATED =
  /Radeon[^,]*?(Vega \d+ Graphics|R[57] Graphics|\d{3}M\b|\d{4}S\b)|Radeon\s*(\(TM\)\s*)?Graphics/i;
const DISCRETE =
  /NVIDIA|GeForce|Quadro|Radeon\s*(\(TM\)\s*)?(RX|Pro|R9|R7|HD)\b|Arc\(TM\)\s*[AB]\d/i;
const INTEGRATED =
  /Intel|Radeon\s*(\(TM\)\s*)?(Graphics|Vega|\d{3}M)\b|Apple|Adreno|Mali|PowerVR|Iris|UHD/i;

export function gpuClass(renderer: string | undefined, userAgent: string): GpuClass {
  if (STANDALONE_HEADSET.test(userAgent)) return 'headset';
  if (!renderer) return 'unknown';
  if (isSoftwareRenderer(renderer)) return 'software';
  if (AMD_INTEGRATED.test(renderer)) return 'integrated';
  if (DISCRETE.test(renderer)) return 'discrete';
  if (INTEGRATED.test(renderer)) return 'integrated';
  return 'unknown';
}

/** Idle intervals kept: about half a second at 120 Hz. */
const REFRESH_SAMPLES = 64;
const REFRESH_MIN_SAMPLES = 8;

/**
 * The display refresh rate, from the render loop's own ticks. Only an interval following a
 * tick that drew nothing counts: after a drawn image the browser waited for the GPU, so a
 * slow machine would read as a slow screen. The lower quartile ignores the remaining stalls.
 */
export class RefreshRateEstimator {
  private readonly intervals = new Float64Array(REFRESH_SAMPLES);
  private count = 0;
  private last?: number;
  private lastRendered = true;

  /** Once per render-loop tick; `rendered` tells whether this tick drew an image. */
  tick(now: number, rendered: boolean): void {
    if (this.last !== undefined && !this.lastRendered) {
      this.intervals[this.count % REFRESH_SAMPLES] = now - this.last;
      this.count++;
    }
    this.last = now;
    this.lastRendered = rendered;
  }

  /** Rounded to the hertz; undefined until the view has been still for a few frames. */
  get hz(): number | undefined {
    const size = Math.min(this.count, REFRESH_SAMPLES);
    if (size < REFRESH_MIN_SAMPLES) return undefined;
    return steadyRateHz(Array.from(this.intervals.subarray(0, size)));
  }
}

/** The rate of the lower-quartile frame interval, in whole hertz: stalls only lengthen intervals. */
export function steadyRateHz(intervalsMs: readonly number[]): number | undefined {
  if (!intervalsMs.length) return undefined;
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  const quartile = sorted[Math.floor((sorted.length - 1) / 4)];
  return quartile > 0 ? Math.round(1000 / quartile) : undefined;
}
