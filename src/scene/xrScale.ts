/**
 * Headset render resolution (the XR layer's `framebufferScaleFactor`). A headset streamed
 * from a PC (Chrome + Quest Link, SteamVR) is drawn by the PC's GPU, which often has room
 * for more pixels than the runtime's default; a standalone headset (Quest Browser) does
 * not, and stays at 1. The layer's scale is fixed for a session (changing it means a new
 * layer, which hitches), so each session's frame rate decides the next session's scale.
 */
export const XR_SCALE_STORAGE = 'maison-atelier:xr-scale:v1';
export const XR_SCALE_MIN = 1;
export const XR_SCALE_MAX = 1.5;
export const XR_SCALE_STEP = 0.1;
/** Where a PC-driven headset starts before any session was measured. */
export const XR_SCALE_TETHERED_START = 1.2;
/** Frame-rate windows (about a second each) a session must hold before the next one sharpens. */
export const XR_SCALE_HOLD_WINDOWS = 10;
/** A window at or above this share of the display rate keeps up with the headset. */
export const XR_SCALE_HOLD = 0.97;
/** Windows in a row under this share mean the scale was too much: the next session lowers it. */
export const XR_SCALE_SLOW = 0.9;
export const XR_SCALE_SLOW_WINDOWS = 3;

/** A headset driven by a PC browser: anything but a standalone headset's own browser. */
export function isTetheredHeadset(userAgent: string): boolean {
  return !/OculusBrowser|Quest|Pico|Android|Mobile/i.test(userAgent);
}

const clamp = (scale: number) =>
  Math.round(Math.max(XR_SCALE_MIN, Math.min(XR_SCALE_MAX, scale)) * 10) / 10;

/** The scale to open a session with: the remembered one on a PC, 1 on a standalone headset. */
export function startScale(saved: number | undefined, tethered: boolean): number {
  if (!tethered) return 1;
  return clamp(saved !== undefined && Number.isFinite(saved) ? saved : XR_SCALE_TETHERED_START);
}

/** Tolerant read of the remembered scale. */
export function parseXrScale(raw: string | null): number | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    const scale = (value as { scale?: unknown } | null)?.scale;
    return typeof scale === 'number' && Number.isFinite(scale) ? clamp(scale) : undefined;
  } catch {
    return undefined;
  }
}

/** Watches one session's frame rate and names the scale for the next one. */
export class XrScaleTuner {
  private held = 0;
  private slowRun = 0;
  private tooMuch = false;
  private fastest = 0;

  constructor(readonly scale: number) {}

  /** One frame-rate window; `rate` is the display rate asked, when the browser tells it. */
  observe(fps: number, rate?: number): void {
    this.fastest = Math.max(this.fastest, fps);
    // Without a known rate, the fastest window seen is the display's: the browser waits for it.
    const target = rate ?? Math.round(this.fastest);
    if (fps >= target * XR_SCALE_HOLD) this.held++;
    this.slowRun = fps < target * XR_SCALE_SLOW ? this.slowRun + 1 : 0;
    if (this.slowRun >= XR_SCALE_SLOW_WINDOWS) this.tooMuch = true;
  }

  /** The display rate had to be lowered: the scale was too much for this machine. */
  markTooMuch(): void {
    this.tooMuch = true;
  }

  /** The scale for the next session. */
  get next(): number {
    if (this.tooMuch) return clamp(this.scale - XR_SCALE_STEP);
    if (this.held >= XR_SCALE_HOLD_WINDOWS) return clamp(this.scale + XR_SCALE_STEP);
    return this.scale;
  }
}
