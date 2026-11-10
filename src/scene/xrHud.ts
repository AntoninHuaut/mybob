import { Constants } from '@babylonjs/core/Engines/constants';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { frameRateIsLow, frameRateText } from '../ui/frameRate';

/**
 * The frame counter of the headset. The page's own counter is a DOM element, which a headset
 * never shows: a small plane carried by the head draws the same figure, so a frame rate can
 * be read on the Quest, or in the emulator, while walking.
 */

/** The figure is read over this window: long enough to be steady, short enough to follow a stall. */
export const XR_HUD_WINDOW_MS = 500;

/** Counts frames and gives the rate once per window. Pure: the clock is passed in. */
export class FrameCounter {
  private frames = 0;
  private since: number | undefined;

  /** Counts one frame; returns the rate (frames per second) when a window just closed. */
  tick(now: number): number | undefined {
    if (this.since === undefined) {
      this.since = now;
      return undefined;
    }
    this.frames++;
    const elapsed = now - this.since;
    if (elapsed < XR_HUD_WINDOW_MS) return undefined;
    const fps = (this.frames * 1000) / elapsed;
    this.frames = 0;
    this.since = now;
    return fps;
  }
}

/**
 * Text lines of the counter. The second line only exists once the visit has been sent back
 * inside the modelled ground, so a wall of the terrain that pushes the visitor back is named.
 */
export function hudLines(fps: number, limitHits: number): string[] {
  const lines = [frameRateText(fps)];
  if (limitHits > 0) lines.push(`limite du terrain ×${limitHits}`);
  return lines;
}

const TEXTURE_WIDTH = 256;
const TEXTURE_HEIGHT = 96;
const READY = '#ffffff';
const LOW = '#ff9a8a';

export class XrHud {
  private readonly plane: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture?: DynamicTexture;
  private shown = '';

  /** `camera` carries the plane: it follows the head, in the lower left of the view. */
  constructor(scene: Scene, camera: Camera) {
    this.plane = MeshBuilder.CreatePlane('xr-hud', { width: 0.16, height: 0.06 }, scene);
    this.material = new StandardMaterial('xr-hud', scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = Color3.White();
    this.material.backFaceCulling = false;
    // Always drawn over the house, in its own group: a wall at arm's length must not hide it.
    this.material.depthFunction = Constants.ALWAYS;
    this.material.disableDepthWrite = true;
    // No canvas outside a browser (unit tests): the plane exists, empty.
    if (typeof document !== 'undefined') {
      this.texture = new DynamicTexture(
        'xr-hud',
        { width: TEXTURE_WIDTH, height: TEXTURE_HEIGHT },
        scene,
        false,
      );
      this.texture.hasAlpha = true;
      this.material.diffuseTexture = this.texture;
      this.material.useAlphaFromDiffuseTexture = true;
    }
    this.plane.material = this.material;
    this.plane.renderingGroupId = 1;
    this.plane.isPickable = false;
    this.plane.alwaysSelectAsActiveMesh = true;
    this.plane.parent = camera;
    // The right-handed scene looks down -z: in front of the head is a negative z.
    this.plane.position.set(-0.14, -0.17, -0.6);
  }

  show(fps: number, limitHits: number) {
    const lines = hudLines(fps, limitHits);
    const key = `${lines.join('|')}${frameRateIsLow(fps)}`;
    if (key === this.shown || !this.texture) return;
    this.shown = key;
    const context = this.texture.getContext();
    context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    context.fillStyle = 'rgba(16, 16, 16, 0.72)';
    context.fillRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
    context.fillStyle = frameRateIsLow(fps) ? LOW : READY;
    context.font = 'bold 44px sans-serif';
    context.fillText(lines[0], 16, 52);
    if (lines[1]) {
      context.fillStyle = READY;
      context.font = '22px sans-serif';
      context.fillText(lines[1], 16, 82);
    }
    this.texture.update();
  }

  dispose() {
    this.plane.dispose();
    this.texture?.dispose();
    this.material.dispose();
  }
}
