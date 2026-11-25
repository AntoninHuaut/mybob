import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import {
  fbm,
  normalFromHeight,
  smoothstep,
  surfaceMapData,
  type SurfaceMapData,
} from './surfaceMaps';

// The pixel generators live in `surfaceMaps.ts`, free of Babylon so a worker can run them.
export * from './surfaceMaps';

function upload(scene: Scene, name: string, map: SurfaceMapData): RawTexture {
  const texture = RawTexture.CreateRGBATexture(
    map.data,
    map.size,
    map.size,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.name = name;
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  return texture;
}

export interface SurfaceTextures {
  plasterNormal: RawTexture;
  plasterRoughness: RawTexture;
  woodNormal: RawTexture;
  woodRoughness: RawTexture;
  concreteNormal: RawTexture;
  concreteRoughness: RawTexture;
  metalNormal: RawTexture;
  metalRoughness: RawTexture;
}

/** The GPU side of the maps, one set per scene. */
export function createSurfaceTextures(scene: Scene): SurfaceTextures {
  const maps = surfaceMapData();
  return {
    plasterNormal: upload(scene, 'plaster-normal', maps.plasterNormal),
    plasterRoughness: upload(scene, 'plaster-roughness', maps.plasterRoughness),
    woodNormal: upload(scene, 'wood-normal', maps.woodNormal),
    woodRoughness: upload(scene, 'wood-roughness', maps.woodRoughness),
    concreteNormal: upload(scene, 'concrete-normal', maps.concreteNormal),
    concreteRoughness: upload(scene, 'concrete-roughness', maps.concreteRoughness),
    metalNormal: upload(scene, 'metal-normal', maps.metalNormal),
    metalRoughness: upload(scene, 'metal-roughness', maps.metalRoughness),
  };
}

export interface ExteriorTextures {
  lawnAlbedo: RawTexture;
  lawnDetail: RawTexture;
  slateNormal: RawTexture;
  slateRoughness: RawTexture;
  renderNormal: RawTexture;
}

/**
 * The exterior's own uploads. The exterior disposes its materials with their
 * textures, so it must not share the interior's set.
 */
export function createExteriorTextures(scene: Scene): ExteriorTextures {
  const maps = surfaceMapData();
  return {
    lawnAlbedo: upload(scene, 'lawn-albedo', maps.lawnAlbedo),
    lawnDetail: upload(scene, 'lawn-detail', maps.lawnDetail),
    slateNormal: upload(scene, 'slate-normal', maps.slateNormal),
    slateRoughness: upload(scene, 'slate-roughness', maps.slateRoughness),
    renderNormal: upload(scene, 'render-normal', maps.plasterNormal),
  };
}

/** Metres covered by one tile of the fence mesh texture. */
export const FENCE_MESH_TILE = 0.2;

/**
 * A welded wire panel: vertical wires every 5 cm, horizontal ones every 20 cm,
 * opaque in alpha where a wire runs and clear between them. The fence is
 * alpha-tested, so the garden shows through it as through a real mesh.
 */
export function fenceMeshData(size = 64): SurfaceMapData {
  const data = new Uint8Array(size * size * 4);
  const vertical = size / 4; // 5 cm in a 20 cm tile
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const wire = x % vertical < 2 || y < 3;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = wire ? 255 : 0;
    }
  return { size, data };
}

/** Metres covered by one tile of the slatted infill: a 12 cm slat and a 2 cm gap. */
export const FENCE_SLATS_TILE = 0.14;

/**
 * Horizontal slats (PVC or wood) with a gap between them, opaque in alpha on the
 * slat, with a slightly darker groove along each edge so the slats read apart.
 */
export function fenceSlatsData(size = 64): SurfaceMapData {
  const data = new Uint8Array(size * size * 4);
  const gap = Math.round(size / 7); // 2 cm of 14
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const edge = y === gap || y === size - 1;
      data[i] = data[i + 1] = data[i + 2] = edge ? 200 : 255;
      data[i + 3] = y < gap ? 0 : 255;
    }
  return { size, data };
}

/** The slatted infill texture, uploaded only for a plot with slatted fences. */
export function createFenceSlats(scene: Scene): RawTexture {
  return upload(scene, 'fence-slats', fenceSlatsData());
}

/** The fence mesh texture, uploaded only for a plot with a fence. */
export function createFenceMesh(scene: Scene): RawTexture {
  return upload(scene, 'fence-mesh', fenceMeshData());
}

/**
 * The hedge takes the lawn's two scales: colour and density patches over a
 * `HEDGE_TILE` tile, leaves in a detail map every `HEDGE_DETAIL_TILE`. The two
 * never line up, so a long hedge shows no repeat.
 */
export const HEDGE_TILE = 4.7;
export const HEDGE_DETAIL_TILE = 0.43;
const HEDGE_SIZE = 512;
const HEDGE_DETAIL_SIZE = 256;

/**
 * Hedge colour, sRGB bytes: clumps from half a metre down to a few centimetres,
 * denser and sparser stretches over metres, some more yellow, some bluer.
 */
function hedgeAlbedo(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const clumps = fbm(u, v, 10, 10, 4, 211);
      const broad = fbm(u, v, 2, 2, 2, 217);
      const light = 0.5 + 0.8 * smoothstep(0.3, 0.72, clumps * 0.7 + broad * 0.3);
      const tint = fbm(u, v, 4, 4, 2, 229) - 0.5;
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(Math.min(255, Math.max(0, (72 + tint * 50) * light)));
      data[offset + 1] = Math.round(Math.min(255, (112 + tint * 22) * light));
      data[offset + 2] = Math.round(Math.min(255, Math.max(0, (52 - tint * 20) * light)));
      data[offset + 3] = 255;
    }
  return data;
}

/**
 * Leaves as a Babylon detail map (red albedo offset, green/alpha normal, blue
 * roughness offset, neutral at 0.5): the gaps between leaves darker and rougher.
 */
function hedgeDetail(size: number): Uint8Array {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      height[y * size + x] = fbm(u, v, 8, 8, 2, 223) * 0.6 + fbm(u, v, 24, 24, 2, 227) * 0.4;
    }
  const normal = normalFromHeight(height, size, 4);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const relief = height[i] - 0.5;
    data[i * 4] = Math.round(Math.max(0, Math.min(255, 128 + relief * 140)));
    data[i * 4 + 1] = normal[i * 4 + 1];
    data[i * 4 + 2] = Math.round(128 - relief * 60);
    data[i * 4 + 3] = normal[i * 4];
  }
  return data;
}

let hedgeCache: { albedo: SurfaceMapData; detail: SurfaceMapData } | undefined;

/** The hedge's colour and leaf detail, computed once. */
export function hedgeMapData() {
  hedgeCache ??= {
    albedo: { size: HEDGE_SIZE, data: hedgeAlbedo(HEDGE_SIZE) },
    detail: { size: HEDGE_DETAIL_SIZE, data: hedgeDetail(HEDGE_DETAIL_SIZE) },
  };
  return hedgeCache;
}

/** The hedge maps, uploaded only for a plot with a hedge. */
export function createHedgeTextures(scene: Scene): { albedo: RawTexture; detail: RawTexture } {
  const maps = hedgeMapData();
  return {
    albedo: upload(scene, 'hedge-albedo', maps.albedo),
    detail: upload(scene, 'hedge-detail', maps.detail),
  };
}
