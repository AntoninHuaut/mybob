/**
 * The visit drops ambient occlusion below this frame rate. The counter marks the
 * reading so the fallback is observable instead of mysterious.
 */
export const FRAME_RATE_FLOOR = 24;

/** A diagnostic, not an animation: four DOM writes a second is already generous. */
export const FRAME_RATE_REFRESH_MS = 250;

/** Rounded, never negative: a stalled loop still reads as a cadence. */
export function frameRateText(fps: number): string {
  return `${Math.max(0, Math.round(fps))} fps`;
}

export function frameRateIsLow(fps: number): boolean {
  return fps < FRAME_RATE_FLOOR;
}

/**
 * Writes the frame rate into one small element, at most four times a second.
 * Reading the engine every frame and writing the DOM every frame would make the
 * counter part of the problem it is meant to measure.
 */
export class FrameRateMeter {
  private nextAt = 0;
  private shown = '';
  private visible = false;

  constructor(private readonly element: HTMLElement) {}

  update(now: number, fps: number): void {
    if (now < this.nextAt) return;
    this.nextAt = now + FRAME_RATE_REFRESH_MS;
    const text = frameRateText(fps);
    if (text !== this.shown) {
      this.shown = text;
      this.element.textContent = text;
    }
    this.element.classList.toggle('low', frameRateIsLow(fps));
    if (!this.visible) {
      this.visible = true;
      this.element.hidden = false;
    }
  }
}
