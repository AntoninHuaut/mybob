/**
 * The sky behind Vue 3D and Extérieur. The canvas is transparent, so the sky is
 * the viewport's CSS background; the PNG export paints the same stops, since it
 * only copies canvas pixels. Every stop stays at or below 0.9 so the colours are
 * not mistaken for something that should bloom. Plan keeps its flat background.
 */
export const SKY_STOPS: ReadonlyArray<readonly [offset: number, color: string]> = [
  [0, '#a9c3da'],
  [0.55, '#cfdbe2'],
  [1, '#e5e1d4'],
];

/** The CSS form, for `.viewport.sky`. */
export function skyCss(): string {
  return `linear-gradient(to bottom, ${SKY_STOPS.map(([offset, color]) => `${color} ${offset * 100}%`).join(', ')})`;
}

/** The structural slice of a 2D context the export needs. */
export interface SkyContext {
  createLinearGradient(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): { addColorStop(offset: number, color: string): void };
  fillStyle: unknown;
  fillRect(x: number, y: number, width: number, height: number): void;
}

/** Paints the sky over a rectangle of an export, top to bottom like the CSS. */
export function paintSky(
  context: SkyContext,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const gradient = context.createLinearGradient(0, y, 0, y + height);
  for (const [offset, color] of SKY_STOPS) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);
}
