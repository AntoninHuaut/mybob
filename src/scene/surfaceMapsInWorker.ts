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
  // A worker whose script never loads (a request interceptor, a stalled fetch) must not hold
  // the start-up: past this, the main thread generates the maps as before.
  timeoutMs = 2000,
): Promise<void> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = createWorker();
    } catch {
      resolve();
      return;
    }
    let settled = false;
    const finish = (maps?: Maps) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (maps) adopt(maps);
      worker.terminate();
      resolve();
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    worker.onmessage = (event: MessageEvent<Maps>) => finish(event.data);
    worker.onerror = () => finish();
  });
}
