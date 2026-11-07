import { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Engine } from '@babylonjs/core/Engines/engine';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

/** A silent downgrade is undiagnosable; every WebGPU refusal states its reason. */
function webglFallback(reason: string): void {
  console.info(`[moteur] WebGPU écarté : ${reason}. Rendu en WebGL.`);
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
 * Rodage WebGPU : 250 ms d'écoute des erreurs non capturées du device.
 * Babylon v9 n'expose pas d'observable public ; le device brut reste la source.
 */
async function failsUnderWatchdog(engine: AbstractEngine): Promise<boolean> {
  const device = (engine as unknown as { _device?: { onuncapturederror: unknown } })._device;
  if (!device || typeof device.onuncapturederror === 'undefined') return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const onerror = () => {
      if (settled) return;
      settled = true;
      device.onuncapturederror = null;
      resolve(true);
    };
    device.onuncapturederror = onerror;
    setTimeout(() => {
      if (settled) return;
      settled = true;
      device.onuncapturederror = null;
      resolve(false);
    }, 250);
  });
}

/**
 * WebGPU by default when a real hardware adapter answers quickly; WebGL otherwise.
 * A software adapter, an automated browser (`navigator.webdriver`, used by the E2E
 * suite) or a slow startup falls back to WebGL; `?webgl=1` forces WebGL.
 * Every fallback logs its reason, otherwise a silent downgrade is undiagnosable.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  const gpu = typeof navigator !== 'undefined' ? (navigator as { gpu?: unknown }).gpu : undefined;
  const forcedWebGL = new URLSearchParams(window.location.search).get('webgl') === '1';
  const automated = typeof navigator !== 'undefined' && navigator.webdriver === true;
  if (!gpu) webglFallback('navigator.gpu absent');
  else if (forcedWebGL) webglFallback('?webgl=1 demandé');
  else if (automated) webglFallback('navigateur piloté (navigator.webdriver)');
  if (gpu && !forcedWebGL && !automated) {
    try {
      const adapter = await withTimeout(
        (gpu as { requestAdapter(options?: unknown): Promise<unknown> }).requestAdapter({
          powerPreference: 'high-performance',
        }),
        3000,
      );
      if (!adapter) webglFallback('aucun adaptateur GPU');
      else if (await adapterIsSoftware(adapter)) webglFallback('adaptateur logiciel');
      else {
        const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine');
        const engine = new WebGPUEngine(canvas, {
          antialias: true,
          stencil: true,
          powerPreference: 'high-performance',
        });
        const initialised = await withTimeout(engine.initAsync(), 4000);
        // Un driver peut répondre à l'init puis échouer à la première écriture
        // (validation WebGPU : clearQuad/write_buffer). On observe le device
        // pendant un court rodage : la moindre erreur disqualifie le WebGPU.
        if (!initialised) {
          engine.dispose();
          webglFallback('initialisation WebGPU trop lente');
        } else if (await failsUnderWatchdog(engine)) {
          engine.dispose();
          webglFallback('erreur du device WebGPU au démarrage');
        } else return engine;
      }
    } catch (error) {
      webglFallback(error instanceof Error ? error.message : 'échec WebGPU inconnu');
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
