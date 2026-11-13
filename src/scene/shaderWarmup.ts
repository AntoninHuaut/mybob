import type { ViewMode } from './viewer';

/**
 * Frames drawn to link a view's shaders. The first links the materials; the next
 * ones let the sun shadow map and the temporal pass settle, which changes the
 * materials' defines once more (every receiver relinks with its shadow). After the
 * minimum, drawing goes on until the host reports everything ready three frames in
 * a row; the time budget keeps a stuck compile from hanging.
 */
export const WARM_UP_MIN_FRAMES = 4;
/**
 * Babylon builds a program through an asynchronous chain (shader modules, then the
 * link), so the number of frames drawn says nothing about when it is done: wait for
 * readiness, and only give up after this long.
 */
export const WARM_UP_MAX_MS = 20_000;
export const READY_IN_A_ROW = 3;

/**
 * Paces the warm-up like the normal loop: one image per browser frame. Chained timers
 * left the page almost no chance to render or answer an event for as long as the
 * links lasted (seconds on a software renderer); the timer only covers a hidden tab.
 */
export const nextFrame = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      resolve();
    });
  });

/** Resolves after the browser painted, or soon anyway in a tab that does not paint. */
export const nextPaint = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 120);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        resolve();
      }),
    );
  });

/** The drawing surface the warm-up needs: one image, and whether the view is settled. */
export interface WarmTarget {
  renderFrame(): void;
  effectsReady(): boolean;
  /** Select the next state to prepare; false once the visible state is settled. */
  nextVariant?(): boolean;
}

/**
 * Links, by drawing, the shader variants the current view needs. Babylon compiles a
 * material the first time it is drawn with a given set of defines, and a view change
 * alters them (sky environment, lights and shadows, prepass outputs, temporal pass):
 * on ANGLE/D3D11 each program blocks the frame about 90 ms, so a first switch to a
 * view froze the page for seconds. Done behind an overlay, the same wait is explained.
 * Each variant settles in turn under the same time budget. Returns the total frames drawn.
 */
export async function warmFrames(
  target: WarmTarget,
  yieldToBrowser: () => Promise<void> = nextFrame,
  now: () => number = () => performance.now(),
): Promise<number> {
  const deadline = now() + WARM_UP_MAX_MS;
  let ready = 0;
  let frames = 0;
  let variantFrames = 0;
  while (now() < deadline) {
    target.renderFrame();
    frames++;
    variantFrames++;
    await yieldToBrowser();
    ready = target.effectsReady() ? ready + 1 : 0;
    if (variantFrames >= WARM_UP_MIN_FRAMES && ready >= READY_IN_A_ROW) {
      if (!target.nextVariant?.()) break;
      ready = 0;
      variantFrames = 0;
    }
  }
  return frames;
}

/**
 * A CPU renderer (SwiftShader, llvmpipe, WARP) links programs slowly and has no GPU
 * driver stalling the page in the way this warm-up hides: front-loading every view
 * there only multiplies the total work, since a view is otherwise linked in the state
 * the user actually reaches. The warm-up is for hardware renderers.
 */
export function isSoftwareRenderer(renderer: string | undefined): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(renderer ?? '');
}

/** One entry per view whose shaders are linked for the current scene. */
export function viewKey(mode: ViewMode, exterior: boolean): string {
  return exterior && mode === 'overview' ? 'overview+exterior' : mode;
}

/** Which views of the current scene have their shaders linked. */
export class ViewWarmth {
  private readonly warm = new Set<string>();

  isCold(key: string): boolean {
    return !this.warm.has(key);
  }

  /** True until the first view of a scene is linked: the start-up, not a later switch. */
  get untouched(): boolean {
    return this.warm.size === 0;
  }

  markWarm(key: string): void {
    this.warm.add(key);
  }

  /** A new scene releases the cached effects: every view is cold again. */
  reset(): void {
    this.warm.clear();
  }
}
