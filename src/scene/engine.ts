import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Engine } from '@babylonjs/core/Engines/engine';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/** Software rasterizers (CI, machines sans GPU) hang instead of failing; skip them. */
async function adapterIsSoftware(adapter: unknown): Promise<boolean> {
  const info =
    (adapter as {
      info?: { vendor?: string; architecture?: string };
      requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string }>;
    }) ?? {};
  try {
    const details =
      info.info ??
      (info.requestAdapterInfo ? await info.requestAdapterInfo.call(adapter) : undefined);
    const vendor = (details?.vendor ?? '').toLowerCase();
    const architecture = (details?.architecture ?? '').toLowerCase();
    return vendor.includes('swiftshader') || architecture.includes('swiftshader');
  } catch {
    return true;
  }
}

/**
 * WebGPU by default when a real hardware adapter answers quickly; WebGL otherwise.
 * A software adapter, an automated browser (`navigator.webdriver`, used by the E2E
 * suite) or a slow startup falls back silently; `?webgl=1` forces WebGL.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  const gpu = typeof navigator !== 'undefined' ? (navigator as { gpu?: unknown }).gpu : undefined;
  const forcedWebGL = new URLSearchParams(window.location.search).get('webgl') === '1';
  const automated = typeof navigator !== 'undefined' && navigator.webdriver === true;
  if (gpu && !forcedWebGL && !automated) {
    try {
      const adapter = await withTimeout(
        (gpu as { requestAdapter(options?: unknown): Promise<unknown> }).requestAdapter({
          powerPreference: 'high-performance',
        }),
        3000,
      );
      if (adapter && !(await adapterIsSoftware(adapter))) {
        const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine');
        const engine = new WebGPUEngine(canvas, {
          antialias: true,
          stencil: true,
          powerPreference: 'high-performance',
        });
        if (await withTimeout(engine.initAsync(), 4000)) return engine;
        engine.dispose();
      }
    } catch {
      /* Any WebGPU failure falls back to the proven WebGL engine below. */
    }
    // Le canvas vient de réclamer son contexte (webgpu) : un élément HTML ne peut
    // pas en changer de type, le repli WebGL doit donc repartir d'un canvas neuf.
    const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
  try {
    return new Engine(
      canvas,
      true,
      { alpha: true, stencil: true, powerPreference: 'high-performance' },
      false,
    );
  } catch (error) {
    console.error(error);
    throw new Error(
      'WebGL est indisponible dans ce navigateur. Activez l’accélération graphique (Edge/Chrome : Paramètres → Système) puis rechargez la page.',
    );
  }
}
