import { Constants } from '@babylonjs/core/Engines/constants';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
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
 * shaders, then the frame counter, and the comfort vignette while the sticks move the visitor.
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
export function hudLines(
  fps: number,
  limitHits: number,
  seated = false,
  teleport = false,
): string[] {
  const notes = [
    ...(teleport ? ['téléportation'] : []),
    ...(seated ? ['mode assis'] : []),
    ...(limitHits > 0 ? [`limite du terrain ×${limitHits}`] : []),
  ];
  return notes.length ? [frameRateText(fps), notes.join(' · ')] : [frameRateText(fps)];
}

const TEXTURE_WIDTH = 288;
const TEXTURE_HEIGHT = 96;
const READY = '#ffffff';
const LOW = '#ff9a8a';

export class XrHud {
  private readonly plane: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture?: DynamicTexture;
  private shown = '';

  /** `camera` carries the plane: it follows the head, in the lower right of the view. */
  constructor(scene: Scene, camera: Camera) {
    this.plane = CreatePlane('xr-hud', { width: 0.12, height: 0.04 }, scene);
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
    this.plane.position.set(0.16, -0.17, -0.6);
  }

  /** Shown or hidden by hand (X); the figure keeps being counted while hidden. */
  set visible(visible: boolean) {
    this.plane.setEnabled(visible);
  }

  get visible(): boolean {
    return this.plane.isEnabled();
  }

  show(fps: number, limitHits: number, seated = false, teleport = false) {
    const lines = hudLines(fps, limitHits, seated, teleport);
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
      context.font = '24px sans-serif';
      context.fillText(lines[1], 16, 84, TEXTURE_WIDTH - 24);
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
  private percent = -1;

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
      this.draw(0);
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

  /** Share of the house ready to draw, 0 to 1: the bar under the message. */
  progress(fraction: number) {
    const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    if (percent === this.percent) return;
    this.draw(percent / 100);
  }

  private draw(fraction: number) {
    this.percent = Math.round(fraction * 100);
    if (!this.texture) return;
    const context = this.texture.getContext();
    context.clearRect(0, 0, VEIL_TEXTURE_WIDTH, VEIL_TEXTURE_HEIGHT);
    context.fillStyle = '#ffffff';
    const text = 'Préparation de la visite…';
    // The headset's font may be wider than expected: the size shrinks until the message fits.
    let size = 48;
    let width: number;
    do {
      context.font = `bold ${size}px sans-serif`;
      width = context.measureText(text).width;
    } while (width > VEIL_TEXTURE_WIDTH - 32 && --size > 20);
    context.fillText(text, (VEIL_TEXTURE_WIDTH - width) / 2, 70);
    const barWidth = 360;
    const left = (VEIL_TEXTURE_WIDTH - barWidth) / 2;
    context.fillStyle = 'rgba(255, 255, 255, 0.25)';
    context.fillRect(left, 98, barWidth, 10);
    context.fillStyle = '#ffffff';
    context.fillRect(left, 98, barWidth * fraction, 10);
    this.texture.update();
  }

  dispose() {
    this.sphere.dispose();
    this.label.dispose();
    this.texture?.dispose();
    this.sphereMaterial.dispose();
    this.labelMaterial.dispose();
  }
}

/** Distance of the vignette plane in front of the eyes, in metres. */
const VIGNETTE_DISTANCE = 0.3;
/** Half the side of the plane: at 0.3 m it reaches about 67° off axis, past a Quest's lenses. */
const VIGNETTE_HALF_SIZE = 0.7;
/** Clear inside this angle off axis, fully dark past the outer one. */
export const VIGNETTE_CLEAR_DEGREES = 28;
export const VIGNETTE_DARK_DEGREES = 50;
/** Opacity of the dark edge at full stick deflection: the room stays faintly readable. */
export const VIGNETTE_MAX_OPACITY = 0.9;
/** Time for the vignette to close fully or open fully, in seconds. */
export const VIGNETTE_FADE_SECONDS = 0.2;
const VIGNETTE_TEXTURE_SIZE = 128;

/**
 * Opacity of the vignette texture at `angle` degrees off the view axis: 0 in the clear centre,
 * 1 past the dark edge, a smoothstep between them.
 */
export function vignetteAlpha(angle: number): number {
  const t = Math.min(
    1,
    Math.max(
      0,
      (angle - VIGNETTE_CLEAR_DEGREES) / (VIGNETTE_DARK_DEGREES - VIGNETTE_CLEAR_DEGREES),
    ),
  );
  return t * t * (3 - 2 * t);
}

/**
 * The vignette strength one frame later: it follows `target` (0 to 1) at a bounded rate, so
 * starting or stopping the stick never flashes the edges dark or clear.
 */
export function approachStrength(current: number, target: number, seconds: number): number {
  const step = seconds / VIGNETTE_FADE_SECONDS;
  const goal = Math.min(1, Math.max(0, target));
  if (Math.abs(goal - current) <= step) return goal;
  return current + Math.sign(goal - current) * step;
}

/** The texture of the vignette plane: black, with the alpha of `vignetteAlpha`. */
export function vignetteTextureData(size = VIGNETTE_TEXTURE_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      // Texel centre, in metres on the plane, from its centre.
      const x = ((column + 0.5) / size - 0.5) * 2 * VIGNETTE_HALF_SIZE;
      const y = ((row + 0.5) / size - 0.5) * 2 * VIGNETTE_HALF_SIZE;
      const angle = (Math.atan2(Math.hypot(x, y), VIGNETTE_DISTANCE) * 180) / Math.PI;
      data[(row * size + column) * 4 + 3] = Math.round(vignetteAlpha(angle) * 255);
    }
  }
  return data;
}

/**
 * The comfort vignette: a plane carried by the head, clear in the middle and dark at the
 * edges, faded in while the sticks walk or turn the visitor and out when they stop. Seen
 * motion that the inner ear does not feel causes the nausea of smooth locomotion, and the
 * periphery is where most of it is seen. Drawn over the house (depth test off) like the veil.
 */
export class XrVignette {
  private readonly plane: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: RawTexture;
  private strength = 0;

  constructor(scene: Scene, camera: Camera) {
    this.material = new StandardMaterial('xr-vignette', scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = Color3.Black();
    this.material.backFaceCulling = false;
    this.material.depthFunction = Constants.ALWAYS;
    this.material.disableDepthWrite = true;
    this.texture = RawTexture.CreateRGBATexture(
      vignetteTextureData(),
      VIGNETTE_TEXTURE_SIZE,
      VIGNETTE_TEXTURE_SIZE,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
    );
    this.texture.hasAlpha = true;
    this.texture.wrapU = this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.material.diffuseTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.alpha = 0;
    const size = VIGNETTE_HALF_SIZE * 2;
    this.plane = CreatePlane('xr-vignette', { width: size, height: size }, scene);
    this.plane.material = this.material;
    this.plane.parent = camera;
    // The right-handed scene looks down -z: in front of the head is a negative z.
    this.plane.position.set(0, 0, -VIGNETTE_DISTANCE);
    // Over the house and the counter; the loading veil hides it (`hide`) while it is up.
    this.plane.renderingGroupId = 3;
    this.plane.isPickable = false;
    this.plane.alwaysSelectAsActiveMesh = true;
    this.plane.setEnabled(false);
  }

  /** `motion`: how hard the sticks move the visitor this frame, 0 to 1. */
  update(motion: number, seconds: number) {
    this.strength = approachStrength(this.strength, motion, seconds);
    this.material.alpha = this.strength * VIGNETTE_MAX_OPACITY;
    this.plane.setEnabled(this.strength > 0.001);
  }

  hide() {
    this.strength = 0;
    this.material.alpha = 0;
    this.plane.setEnabled(false);
  }

  get opacity(): number {
    return this.plane.isEnabled() ? this.material.alpha : 0;
  }

  dispose() {
    this.plane.dispose();
    this.texture.dispose();
    this.material.dispose();
  }
}

/** Time for the teleport blink to go dark, then to clear again, in seconds. */
export const BLINK_OUT_SECONDS = 0.08;
export const BLINK_IN_SECONDS = 0.12;

/**
 * The teleport blink: the view goes dark, the visitor is moved while nothing is seen, and the
 * view clears again. A cut between two still images gives the eyes no motion to read, which
 * is what makes a teleport or a snap turn comfortable. Pure: the frame time is passed in.
 */
export class BlinkFade {
  private alpha = 0;
  private closing = false;
  private pending?: () => void;

  /** Darkens the view and runs `action` once it is fully dark. */
  start(action: () => void) {
    const previous = this.pending;
    this.pending = previous
      ? () => {
          previous();
          action();
        }
      : action;
    this.closing = true;
  }

  get active(): boolean {
    return this.closing || this.alpha > 0;
  }

  /** The darkness after `seconds` more, 0 to 1. */
  tick(seconds: number): number {
    if (this.closing) {
      this.alpha = Math.min(1, this.alpha + seconds / BLINK_OUT_SECONDS);
      if (this.alpha >= 1) {
        this.closing = false;
        const action = this.pending;
        this.pending = undefined;
        action?.();
      }
    } else if (this.alpha > 0) {
      this.alpha = Math.max(0, this.alpha - seconds / BLINK_IN_SECONDS);
    }
    return this.alpha;
  }
}

/** The dark sphere of the blink, carried by the head, drawn over the house like the vignette. */
export class XrBlink {
  private readonly sphere: Mesh;
  private readonly material: StandardMaterial;
  private readonly fade = new BlinkFade();

  constructor(scene: Scene, camera: Camera) {
    this.material = new StandardMaterial('xr-blink', scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = Color3.Black();
    this.material.backFaceCulling = false;
    this.material.depthFunction = Constants.ALWAYS;
    this.material.disableDepthWrite = true;
    this.material.alpha = 0;
    this.sphere = CreateSphere('xr-blink', { diameter: 0.5, segments: 8 }, scene);
    this.sphere.material = this.material;
    this.sphere.parent = camera;
    this.sphere.renderingGroupId = 3;
    this.sphere.isPickable = false;
    this.sphere.alwaysSelectAsActiveMesh = true;
    this.sphere.setEnabled(false);
  }

  start(action: () => void) {
    this.fade.start(action);
  }

  get active(): boolean {
    return this.fade.active;
  }

  update(seconds: number) {
    if (!this.fade.active) return;
    const alpha = this.fade.tick(seconds);
    this.material.alpha = alpha;
    this.sphere.setEnabled(alpha > 0.001);
  }

  dispose() {
    this.sphere.dispose();
    this.material.dispose();
  }
}
