import { Constants } from '@babylonjs/core/Engines/constants';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { frameRateIsLow, frameRateText } from '../ui/frameRate';

/**
 * What the headset shows on top of the house: the loading veil while the session links its
 * shaders, then the frame counter.
 *
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
    this.plane = CreatePlane('xr-hud', { width: 0.16, height: 0.06 }, scene);
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

/** Layer of the loading veil, outside Babylon's default mesh layers (0x0fffffff). */
export const XR_VEIL_LAYER = 0x10000000;
export const XR_DEFAULT_LAYERS = 0x0fffffff;
/** Images drawn with the veil alone, so it is on screen before the house links anything. */
export const XR_VEIL_ONLY_FRAMES = 2;
/** Consecutive ready images before the veil lifts: a receiver may relink one image later. */
export const XR_LOADING_STEADY_FRAMES = 3;
/** The veil lifts after this long even if a shader is still linking. */
export const XR_LOADING_TIMEOUT_MS = 20000;

export type LoadingPhase = 'veil' | 'compiling' | 'done';

/**
 * When the headset loading veil lifts. Pure: the clock and the readiness are passed in, and
 * `ready` is only asked once the house is drawn, since asking starts the shader links.
 */
export class LoadingGate {
  private frames = 0;
  private steady = 0;
  private since: number | undefined;
  private finished = false;

  tick(now: number, ready: () => boolean): LoadingPhase {
    if (this.finished) return 'done';
    this.since ??= now;
    if (++this.frames <= XR_VEIL_ONLY_FRAMES) return 'veil';
    this.steady = ready() ? this.steady + 1 : 0;
    if (this.steady >= XR_LOADING_STEADY_FRAMES || now - this.since >= XR_LOADING_TIMEOUT_MS)
      this.finished = true;
    return this.finished ? 'done' : 'compiling';
  }
}

const VEIL_TEXTURE_WIDTH = 512;
const VEIL_TEXTURE_HEIGHT = 128;

/**
 * The headset's loading screen, like the page's overlay for the other views: a dark sphere
 * around the head with a message, drawn over the house (last rendering group, depth test off)
 * while the house is drawn behind it, so its shaders link out of sight. The house only enters
 * the camera's layers once the veil itself is on screen.
 */
export class XrVeil {
  private readonly sphere: Mesh;
  private readonly label: Mesh;
  private readonly sphereMaterial: StandardMaterial;
  private readonly labelMaterial: StandardMaterial;
  private readonly texture?: DynamicTexture;

  constructor(scene: Scene, camera: Camera) {
    this.sphereMaterial = new StandardMaterial('xr-veil', scene);
    this.sphereMaterial.disableLighting = true;
    this.sphereMaterial.emissiveColor = new Color3(0.07, 0.08, 0.08);
    this.sphereMaterial.backFaceCulling = false;
    this.sphereMaterial.depthFunction = Constants.ALWAYS;
    this.sphereMaterial.disableDepthWrite = true;
    this.sphere = CreateSphere('xr-veil', { diameter: 2, segments: 8 }, scene);
    this.sphere.material = this.sphereMaterial;

    this.labelMaterial = new StandardMaterial('xr-veil-label', scene);
    this.labelMaterial.disableLighting = true;
    this.labelMaterial.emissiveColor = Color3.White();
    this.labelMaterial.backFaceCulling = false;
    this.labelMaterial.depthFunction = Constants.ALWAYS;
    this.labelMaterial.disableDepthWrite = true;
    if (typeof document !== 'undefined') {
      this.texture = new DynamicTexture(
        'xr-veil-label',
        { width: VEIL_TEXTURE_WIDTH, height: VEIL_TEXTURE_HEIGHT },
        scene,
        false,
      );
      this.texture.hasAlpha = true;
      const context = this.texture.getContext();
      context.clearRect(0, 0, VEIL_TEXTURE_WIDTH, VEIL_TEXTURE_HEIGHT);
      context.fillStyle = '#ffffff';
      context.font = 'bold 48px sans-serif';
      const text = 'Préparation de la visite…';
      const width = context.measureText(text).width;
      context.fillText(text, (VEIL_TEXTURE_WIDTH - width) / 2, 78);
      this.texture.update();
      this.labelMaterial.diffuseTexture = this.texture;
      this.labelMaterial.useAlphaFromDiffuseTexture = true;
    }
    // Transparent: drawn after the opaque sphere of the same group.
    this.labelMaterial.alpha = 0.999;
    this.label = CreatePlane('xr-veil-label', { width: 0.6, height: 0.15 }, scene);
    this.label.material = this.labelMaterial;
    this.label.position.set(0, 0, -0.8);

    for (const mesh of [this.sphere, this.label]) {
      mesh.parent = camera;
      mesh.layerMask = XR_VEIL_LAYER;
      mesh.renderingGroupId = 3;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
    }
  }

  dispose() {
    this.sphere.dispose();
    this.label.dispose();
    this.texture?.dispose();
    this.sphereMaterial.dispose();
    this.labelMaterial.dispose();
  }
}
