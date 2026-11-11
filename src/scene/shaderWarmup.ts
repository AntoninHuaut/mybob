import type { ViewMode } from './viewer';

/**
 * Frames drawn to link a view's shaders. The first links the materials; the next
 * ones let the sun shadow map and the temporal pass settle, which changes the
 * materials' defines once more (every receiver relinks with its shadow). After the
 * minimum, drawing goes on until the host reports everything ready three frames in
 * a row; the cap keeps a stuck compile from hanging.
 */
export const WARM_UP_MIN_FRAMES = 4;
export const WARM_UP_MAX_FRAMES = 24;
export const READY_IN_A_ROW = 3;

export const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
}

/**
 * Links, by drawing, the shader variants the current view needs. Babylon compiles a
 * material the first time it is drawn with a given set of defines, and a view change
 * alters them (sky environment, lights and shadows, prepass outputs, temporal pass):
 * on ANGLE/D3D11 each program blocks the frame about 90 ms, so a first switch to a
 * view froze the page for seconds. Done behind an overlay, the same wait is explained.
 * Returns the number of frames drawn.
 */
export async function warmFrames(
  target: WarmTarget,
  yieldToBrowser: () => Promise<void> = nextTask,
): Promise<number> {
  let ready = 0;
  let frames = 0;
  while (frames < WARM_UP_MAX_FRAMES) {
    target.renderFrame();
    frames++;
    await yieldToBrowser();
    ready = target.effectsReady() ? ready + 1 : 0;
    if (frames >= WARM_UP_MIN_FRAMES && ready >= READY_IN_A_ROW) break;
  }
  return frames;
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
