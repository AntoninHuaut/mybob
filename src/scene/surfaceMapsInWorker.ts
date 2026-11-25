import { adoptMaps, type FurnitureMaps, type SurfaceMaps } from './surfaceMaps';

type Maps = { surface: SurfaceMaps; furniture: FurnitureMaps };

/**
 * Generates the procedural maps off the main thread while the page starts, then adopts them
 * as the session's cache (#321). Resolves either way: without a worker, or if it fails, the
 * maps are generated on first use as before.
 */
export function generateMapsInWorker(
  createWorker: () => Worker = () =>
    new Worker(new URL('./surfaceMaps.worker.ts', import.meta.url), { type: 'module' }),
  adopt: (maps: Maps) => void = adoptMaps,
): Promise<void> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = createWorker();
    } catch {
      resolve();
      return;
    }
    worker.onmessage = (event: MessageEvent<Maps>) => {
      adopt(event.data);
      worker.terminate();
      resolve();
    };
    worker.onerror = () => {
      worker.terminate();
      resolve();
    };
  });
}
