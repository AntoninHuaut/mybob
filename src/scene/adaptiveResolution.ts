/**
 * Render scales tried while the camera moves, from full resolution down. Each step
 * draws roughly a third fewer pixels than the previous one.
 */
export const MOTION_SCALES = [1, 0.8, 0.67, 0.5] as const;

/** Above this median frame time (under 40 fps), the next motion scale is tried. */
export const FRAME_BUDGET_MS = 25;

/** Under this median frame time, there is room for one step more of resolution. */
export const FRAME_COMFORT_MS = 14;

/** Images measured before each decision: one slow image is not a slow machine. */
export const FRAME_SAMPLES = 6;

/** Without camera motion for this long, the camera is at rest again. */
export const REST_DELAY_MS = 150;

/**
 * Dynamic resolution, in motion only. At rest the scene is always rendered at full
 * resolution, and the temporal antialiasing then settles the still image exactly as
 * before: a still view never loses quality. While the camera moves, a machine that
 * cannot hold 40 fps renders fewer pixels instead of stuttering; a machine that can
 * never leaves full resolution. The level learnt is kept for the next motion.
 */
export class AdaptiveResolution {
  private level = 0;
  private samples: number[] = [];
  private lastMotion = Number.NEGATIVE_INFINITY;

  /**
   * `frameMs` is the time since the previous image, when both were drawn in a row;
   * returns the render scale to use for this image (1 = full resolution).
   */
  update(now: number, moving: boolean, frameMs?: number): number {
    if (moving) this.lastMotion = now;
    if (now - this.lastMotion >= REST_DELAY_MS) {
      this.samples = [];
      return 1;
    }
    if (frameMs !== undefined && Number.isFinite(frameMs)) {
      this.samples.push(frameMs);
      if (this.samples.length >= FRAME_SAMPLES) {
        const sorted = [...this.samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        // Far over budget (under 13 fps): skip a step instead of waiting for the next series.
        const step = median > 3 * FRAME_BUDGET_MS ? 2 : 1;
        if (median > FRAME_BUDGET_MS && this.level < MOTION_SCALES.length - 1)
          this.level = Math.min(this.level + step, MOTION_SCALES.length - 1);
        else if (median < FRAME_COMFORT_MS && this.level > 0) this.level--;
        this.samples = [];
      }
    }
    return MOTION_SCALES[this.level];
  }

  /** The scale used in motion on this machine, for the diagnostic. */
  get motionScale(): number {
    return MOTION_SCALES[this.level];
  }
}
