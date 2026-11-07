import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Procedural relief and roughness for the four surfaces the visit is made of.
 *
 * Everything here is generated, never loaded: the public build stays
 * self-contained, and a texture that is a function of a seed cannot drift from
 * the material it belongs to. The pixel data is computed once per session and
 * cached — a project switch rebuilds the scene and the materials, but the noise
 * is the same, so only the GPU upload is repeated.
 */

/** Plaster is a millimetre of relief, not a centimetre: 1 m per tile is plenty. */
const PLASTER_SIZE = 256;
/** The parquet tile is 4.8 × 3.2 m, so it needs the resolution to show its joints. */
const WOOD_SIZE = 512;
const CONCRETE_SIZE = 256;
const METAL_SIZE = 256;

/** Plank layout of the parquet albedo, in texels of a 512 px tile. */
const WOOD_PLANK_WIDTH = 128;
const WOOD_PLANK_HEIGHT = 32;

/** A deterministic hash on the integer lattice, in [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Value noise on a lattice that wraps every `periodX` × `periodY` cells, so the
 * tile is seamless: a visible seam on a wall is worse than no relief at all.
 */
function noise(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  // Callers only ever pass 0 <= x < periodX, so the low cell needs no wrap and
  // the high one only wraps on the last cell. Two modulos per texel, not four.
  const xi = x | 0;
  const yi = y | 0;
  const xf = x - xi;
  const yf = y - yi;
  const x0 = xi;
  const x1 = xi + 1 === periodX ? 0 : xi + 1;
  const y0 = yi;
  const y1 = yi + 1 === periodY ? 0 : yi + 1;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const top = hash(x0, y0, seed) * (1 - u) + hash(x1, y0, seed) * u;
  const bottom = hash(x0, y1, seed) * (1 - u) + hash(x1, y1, seed) * u;
  return top * (1 - v) + bottom * v;
}

/**
 * Fractal sum of `noise`. Every octave doubles both periods, so the sum tiles
 * exactly like its first octave. The two periods are separate because wood grain
 * and brushed steel are stretched along one axis.
 */
function fbm(
  x: number,
  y: number,
  periodX: number,
  periodY: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let px = periodX;
  let py = periodY;
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise(x * px, y * py, px, py, seed + octave * 131) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    px *= 2;
    py *= 2;
  }
  return sum / total;
}

/**
 * Tangent-space normal map from a height field, as RGBA bytes. The gradient is
 * central and wraps, so the map tiles with the height it came from.
 */
export function normalFromHeight(height: Float32Array, size: number, strength: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round((-dx / length / 2 + 0.5) * 255);
      data[offset + 1] = Math.round((-dy / length / 2 + 0.5) * 255);
      data[offset + 2] = Math.round((1 / length / 2 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }
  return data;
}

/** A single-channel field as RGBA bytes: the red channel is what the shader reads. */
export function greyFromField(field: Float32Array, size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const value = Math.round(Math.max(0, Math.min(1, field[i])) * 255);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function plasterHeight(size: number): Float32Array {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      height[y * size + x] = fbm(u, v, 24, 24, 3, 11) * 0.7 + fbm(u, v, 96, 96, 2, 29) * 0.3;
    }
  }
  return height;
}

function plasterRoughness(size: number): Float32Array {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Paint is never uniformly matte: a faint drift is enough to break the flatness.
      field[y * size + x] = 0.9 + fbm(x / size, y / size, 8, 8, 3, 41) * 0.1;
    }
  }
  return field;
}

/**
 * Parquet: a chamfered joint at every plank edge, and grain stretched along the
 * plank. The joint is four texels wide, which is a three-centimetre bevel — a
 * hairline would disappear at any distance.
 */
function woodHeight(size: number): Float32Array {
  const height = new Float32Array(size * size);
  const scale = size / 512;
  const plankWidth = WOOD_PLANK_WIDTH * scale;
  const plankHeight = WOOD_PLANK_HEIGHT * scale;
  const bevel = 4 * scale;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / plankHeight);
    const stagger = row % 2 ? plankWidth / 2 : 0;
    for (let x = 0; x < size; x++) {
      const acrossJoint = Math.min(y % plankHeight, plankHeight - (y % plankHeight));
      const along = (x - stagger + size * 2) % plankWidth;
      const alongJoint = Math.min(along, plankWidth - along);
      const joint = Math.min(acrossJoint, alongJoint);
      const groove = Math.min(1, joint / bevel);
      const grain =
        fbm(x / size, y / size, 2, 48, 3, 7) * 0.7 + fbm(x / size, y / size, 1, 12, 2, 19) * 0.3;
      height[y * size + x] = grain * groove;
    }
  }
  return height;
}

/**
 * Roughness of the parquet, plank by plank: a varnished board and a worn one do
 * not reflect the same way, and that variation is what stops the floor reading
 * as one uniform matte sheet.
 */
function woodRoughness(size: number): Float32Array {
  const field = new Float32Array(size * size);
  const scale = size / 512;
  const plankWidth = WOOD_PLANK_WIDTH * scale;
  const plankHeight = WOOD_PLANK_HEIGHT * scale;
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / plankHeight);
    const stagger = row % 2 ? plankWidth / 2 : 0;
    for (let x = 0; x < size; x++) {
      const column = Math.floor((x - stagger + size * 2) / plankWidth);
      const plank = hash(row, column, 53);
      const grain = fbm(x / size, y / size, 2, 48, 2, 61);
      field[y * size + x] = 0.68 + plank * 0.24 + grain * 0.08;
    }
  }
  return field;
}

function concreteHeight(size: number): Float32Array {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      height[y * size + x] = fbm(u, v, 16, 16, 4, 71) * 0.8 + fbm(u, v, 64, 64, 2, 83) * 0.2;
    }
  }
  return height;
}

function concreteRoughness(size: number): Float32Array {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      field[y * size + x] = 0.88 + fbm(x / size, y / size, 16, 16, 3, 97) * 0.12;
    }
  }
  return field;
}

/** Brushed steel: the grain runs one way only, which is what makes it read as brushed. */
function metalHeight(size: number): Float32Array {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      height[y * size + x] = fbm(x / size, y / size, 2, 128, 3, 101);
    }
  }
  return height;
}

function metalRoughness(size: number): Float32Array {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      field[y * size + x] = 0.62 + fbm(x / size, y / size, 2, 128, 3, 113) * 0.38;
    }
  }
  return field;
}

export interface SurfaceMapData {
  size: number;
  data: Uint8Array;
}

export interface SurfaceMaps {
  plasterNormal: SurfaceMapData;
  plasterRoughness: SurfaceMapData;
  woodNormal: SurfaceMapData;
  woodRoughness: SurfaceMapData;
  concreteNormal: SurfaceMapData;
  concreteRoughness: SurfaceMapData;
  metalNormal: SurfaceMapData;
  metalRoughness: SurfaceMapData;
}

let cached: SurfaceMaps | undefined;

/**
 * The pixel data, computed once. Generating it costs a few hundred milliseconds
 * of noise, which a project switch must not pay again.
 */
export function surfaceMapData(): SurfaceMaps {
  if (cached) return cached;
  cached = {
    plasterNormal: {
      size: PLASTER_SIZE,
      data: normalFromHeight(plasterHeight(PLASTER_SIZE), PLASTER_SIZE, 1.2),
    },
    plasterRoughness: {
      size: PLASTER_SIZE,
      data: greyFromField(plasterRoughness(PLASTER_SIZE), PLASTER_SIZE),
    },
    woodNormal: {
      size: WOOD_SIZE,
      data: normalFromHeight(woodHeight(WOOD_SIZE), WOOD_SIZE, 6),
    },
    woodRoughness: {
      size: WOOD_SIZE,
      data: greyFromField(woodRoughness(WOOD_SIZE), WOOD_SIZE),
    },
    concreteNormal: {
      size: CONCRETE_SIZE,
      data: normalFromHeight(concreteHeight(CONCRETE_SIZE), CONCRETE_SIZE, 4),
    },
    concreteRoughness: {
      size: CONCRETE_SIZE,
      data: greyFromField(concreteRoughness(CONCRETE_SIZE), CONCRETE_SIZE),
    },
    metalNormal: {
      size: METAL_SIZE,
      data: normalFromHeight(metalHeight(METAL_SIZE), METAL_SIZE, 3),
    },
    metalRoughness: {
      size: METAL_SIZE,
      data: greyFromField(metalRoughness(METAL_SIZE), METAL_SIZE),
    },
  };
  return cached;
}

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
