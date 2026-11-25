import { furnitureMapData, surfaceMapData } from './surfaceMaps';

// The same generators as the main thread: the pixels are identical, only the thread changes.
const maps = { surface: surfaceMapData(), furniture: furnitureMapData() };
const buffers = [...Object.values(maps.surface), ...Object.values(maps.furniture)].map(
  (map) => map.data.buffer,
);
(self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage(
  maps,
  buffers,
);
