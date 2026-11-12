/**
 * Images still rendered after the last change: the temporal antialiasing accumulates
 * 16 jittered samples, twice over, before the still image is final.
 */
export const RENDER_SETTLE_FRAMES = 32;

/**
 * At rest, one image this often anyway. A change that forgot to ask for an image
 * (a timer, an asynchronous load) shows up within this delay instead of never.
 * Not while a temporal effect is on screen (`refreshIdle` false): every image it draws
 * jitters the camera and re-reads the depth, so the occlusion and the accumulated
 * antialiasing shift a little at each one, and a still view would change by itself.
 */
export const IDLE_REFRESH_MS = 1000;

/**
 * Page events that may change the scene: a click in a panel, a slider, a key, the
 * mouse over a piece of furniture. Listened to on the window, so no feature has to
 * remember to ask for an image; `wakesScene` keeps pointer moves and wheel turns to
 * those over the canvas.
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
  'focus',
] as const;

/**
 * Pointer moves and wheel turns change the scene only through the canvas: Babylon, the
 * cameras and the furniture listen there (a drag keeps the canvas as target through
 * pointer capture or pointer lock). Over a panel they only cost: each one restarted
 * `RENDER_SETTLE_FRAMES` images, so sweeping the mouse across the sidebar redrew the whole
 * scene at the screen's rate, every effect included, and a weak GPU starved the page it
 * was scrolling. Over the canvas, a move with no button held changes nothing either,
 * unless `hoverChangesScene`: the measure line follows the cursor, and a locked pointer
 * turns the walk camera. A camera dragged with a button is woken by the button. Every other wake event (clicks, keys, form edits)
 * stays global: those are how a panel changes what the scene shows.
 */
export function wakesScene(
  event: Event,
  canvas: EventTarget,
  hoverChangesScene: boolean = false,
): boolean {
  if (event.type === 'wheel') return event.target === canvas;
  if (event.type !== 'pointermove') return true;
  if (event.target !== canvas) return false;
  return hoverChangesScene || ((event as PointerEvent).buttons ?? 0) !== 0;
}

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
  private moved = false;

  /** Something on screen changed: render until the image is settled again. */
  request(): void {
    this.remaining = RENDER_SETTLE_FRAMES;
  }

  /**
   * `signature` describes the camera; `busy` is asked only once the scene is
   * otherwise settled, so a costly check never runs while images are drawn anyway.
   */
  shouldRender(
    now: number,
    signature: string,
    busy: () => boolean,
    refreshIdle: boolean = true,
  ): boolean {
    this.moved = signature !== this.signature;
    if (this.moved) {
      this.signature = signature;
      this.remaining = RENDER_SETTLE_FRAMES;
    }
    if (this.remaining === 0 && busy()) this.remaining = RENDER_SETTLE_FRAMES;
    if (this.remaining > 0) {
      this.remaining--;
      this.lastRender = now;
      return true;
    }
    if (refreshIdle && now - this.lastRender >= IDLE_REFRESH_MS) {
      this.lastRender = now;
      return true;
    }
    return false;
  }

  /** The camera signature changed at the last `shouldRender`. */
  get cameraMoved(): boolean {
    return this.moved;
  }

  /** True while no image is being drawn but the idle refresh. */
  get idle(): boolean {
    return this.remaining === 0;
  }
}
