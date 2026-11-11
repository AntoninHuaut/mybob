import { CreateGreasedLine } from '@babylonjs/core/Meshes/Builders/greasedLineBuilder';
import type { GreasedLineMesh } from '@babylonjs/core/Meshes/GreasedLine/greasedLineMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector2, type Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

export const SCREEN_LINE_CSS_WIDTH = 1.5;
export function screenLinePixelWidth(
  cssWidth: number,
  renderHeight: number,
  cssHeight: number,
): number {
  // Babylon 9.35's camera-facing plugin offsets each side by 0.5 * width /
  // resolution in NDC; NDC-to-pixel conversion halves that again. Its material
  // width therefore needs a factor of two to produce the requested raster width.
  return (2 * cssWidth * renderHeight) / Math.max(1, cssHeight);
}

/** Unlit StandardMaterial retains Babylon's scene clip planes; the line owns its material. */
export function createScreenLines(
  name: string,
  lines: Vector3[][],
  scene: Scene,
  color: Color3,
): GreasedLineMesh {
  const engine = scene.getEngine();
  const mesh = CreateGreasedLine(
    name,
    { points: lines, updatable: true },
    {
      color,
      sizeAttenuation: true,
      width: SCREEN_LINE_CSS_WIDTH,
    },
    scene,
  ) as GreasedLineMesh;
  const material = mesh.material as StandardMaterial;
  material.disableLighting = true;
  material.backFaceCulling = false;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  const resize = () => {
    const plugin = mesh.greasedLineMaterial!;
    const width = engine.getRenderWidth(),
      height = engine.getRenderHeight();
    const cssHeight =
      engine.getRenderingCanvas()?.clientHeight || height * engine.getHardwareScalingLevel();
    plugin.resolution = new Vector2(width, height);
    plugin.width = screenLinePixelWidth(SCREEN_LINE_CSS_WIDTH, height, cssHeight);
  };
  resize();
  const observer = engine.onResizeObservable.add(resize);
  let materialAlive = true;
  material.onDisposeObservable.addOnce(() => {
    materialAlive = false;
  });
  mesh.onDisposeObservable.addOnce(() => {
    engine.onResizeObservable.remove(observer);
    if (materialAlive) material.dispose();
  });
  return mesh;
}
