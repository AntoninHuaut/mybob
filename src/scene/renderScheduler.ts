/**
 * Images still rendered after the last change: the temporal antialiasing accumulates
 * 16 jittered samples, twice over, before the still image is final.
 */
export const RENDER_SETTLE_FRAMES = 32;

/**
 * At rest, one image this often anyway. A change that forgot to ask for an image
 * (a timer, an asynchronous load) shows up within this delay instead of never.
 */
export const IDLE_REFRESH_MS = 1000;

/**
 * Page events that may change the scene: a click in a panel, a slider, a key, the
 * mouse over a piece of furniture. Listened to on the window, so no feature has to
 * remember to ask for an image.
 */
export const WAKE_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'wheel',
  'keydown',
  'keyup',
  'input',
  'change',
  'click',
  'pointerlockchange',
] as const;

/**
 * Decides whether the render loop draws this image. A still scene is not redrawn:
 * the browser keeps showing the last image, and the GPU rests. Anything that changes
 * what is on screen either moves the camera (seen through `signature`), keeps the
 * scene busy (keys held, doors swinging, shaders compiling) or calls `request()`.
 */
export class RenderScheduler {
  private remaining = RENDER_SETTLE_FRAMES;
  private signature = '';
  private lastRender = Number.NEGATIVE_INFINITY;

  /** Something on screen changed: render until the image is settled again. */
  request(): void {
    this.remaining = RENDER_SETTLE_FRAMES;
  }

  /**
   * `signature` describes the camera; `busy` is asked only once the scene is
   * otherwise settled, so a costly check never runs while images are drawn anyway.
   */
  shouldRender(now: number, signature: string, busy: () => boolean): boolean {
    if (signature !== this.signature) {
      this.signature = signature;
      this.remaining = RENDER_SETTLE_FRAMES;
    }
    if (this.remaining === 0 && busy()) this.remaining = RENDER_SETTLE_FRAMES;
    if (this.remaining > 0) {
      this.remaining--;
      this.lastRender = now;
      return true;
    }
    if (now - this.lastRender >= IDLE_REFRESH_MS) {
      this.lastRender = now;
      return true;
    }
    return false;
  }

  /** True while no image is being drawn but the idle refresh. */
  get idle(): boolean {
    return this.remaining === 0;
  }
}
