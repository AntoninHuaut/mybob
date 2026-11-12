import { Layer } from '@babylonjs/core/Layers/layer';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/**
 * The sky behind Vue 3D, Extérieur and the windows of Visite, drawn inside the
 * canvas as a background layer. It is a screen-space gradient, so it stays out
 * of a headset, where it would turn with the head, and out of the plan. It cannot be a CSS background: the canvas clears to a light grey with a
 * zero alpha, which the browser composites as premultiplied, so it adds that
 * grey to whatever is behind it and washes it out. Inside the canvas, the PNG
 * export captures it like the rest of the scene. Every stop stays at or below
 * 0.9, under the orbit bloom threshold, so the sky never blooms. Layers skip the
 * materials' tone mapping, so the stops are the sRGB colours shown.
 */
export const SKY_STOPS: ReadonlyArray<readonly [offset: number, color: string]> = [
  [0, '#a9c3da'],
  [0.55, '#cfdbe2'],
  [1, '#e5e1d4'],
];

/**
 * Brightness of the sky seen through the windows in Visite. The visit blooms
 * above 0.9 so that its view through the bay window glows; the sky's horizon
 * (luminance 0.88) crosses that at 1.06, its blue zenith (about 0.75) does not.
 */
export const WALK_SKY_GAIN = 1.06;

/** Rows of the gradient texture; linear filtering smooths between them. */
const SKY_ROWS = 64;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * The gradient as an opaque one-column RGBA texture, in GL row order: row 0 is
 * the bottom of the screen (the horizon stop, offset 1), the last row its top
 * (the zenith stop, offset 0). The layer samples v = 0 at the bottom, and no
 * flip is asked for on upload.
 */
export function skyPixels(rows = SKY_ROWS): Uint8Array {
  const data = new Uint8Array(rows * 4);
  for (let row = 0; row < rows; row++) {
    const t = rows === 1 ? 0 : 1 - row / (rows - 1);
    const next = SKY_STOPS.findIndex(([offset]) => offset >= t);
    const [from, to] =
      next <= 0 ? [SKY_STOPS[0], SKY_STOPS[0]] : [SKY_STOPS[next - 1], SKY_STOPS[next]];
    const span = to[0] - from[0];
    const k = span > 0 ? (t - from[0]) / span : 0;
    const a = rgb(from[1]);
    const b = rgb(to[1]);
    for (let c = 0; c < 3; c++) data[row * 4 + c] = Math.round(a[c] + (b[c] - a[c]) * k);
    data[row * 4 + 3] = 255;
  }
  return data;
}

/**
 * A full-screen background layer showing the sky, disabled until the viewer
 * turns it on. Belongs to the scene and goes with it.
 */
export function createSkyLayer(scene: Scene): Layer {
  const texture = RawTexture.CreateRGBATexture(
    skyPixels(),
    1,
    SKY_ROWS,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  texture.name = 'sky-gradient';
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const layer = new Layer('sky', null, scene, true);
  layer.texture = texture;
  layer.isEnabled = false;
  return layer;
}
