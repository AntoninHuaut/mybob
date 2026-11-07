import { Color4 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import type { HouseViewer } from '../scene/viewer';
import type { Level } from '../model/types';
import { bounds } from '../model/geometry';
import { cornerBeadMesh, roomCorners } from '../scene/cornerBead';
import { createInteriorOcclusion } from '../scene/interiorAmbience';

/**
 * Development-only bench for the visit's remaining rendering questions.
 * `main.ts` imports it behind `import.meta.env.DEV`, so Vite drops the whole
 * module from a build.
 *
 * Two experiments live here, both of which the issue asks to judge on the real
 * house before deciding anything:
 *
 * - dust motes drifting in the room, which the issue proposes as atmosphere and
 *   which costs transparent overdraw on a GPU that already drops the occlusion;
 * - a chamfer on the concave vertical corner between two walls, which is the one
 *   place the wall bevel cannot reach.
 *
 * Nothing here is a product decision, and none of it touches the shipped scene.
 */

function panel(title: string): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed',
    'left:8px',
    'bottom:8px',
    'z-index:99999',
    'background:rgba(20,24,20,.92)',
    'color:#e8efe6',
    'font:12px/1.5 ui-monospace,monospace',
    'padding:10px 12px',
    'border-radius:8px',
    'max-height:70vh',
    'overflow:auto',
    'box-shadow:0 6px 24px rgba(0,0,0,.4)',
  ].join(';');
  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = 'font-weight:700;margin-bottom:6px;color:#b9d8a8';
  box.append(heading);
  document.body.append(box);
  return box;
}

function section(box: HTMLElement, title: string): void {
  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = 'margin-top:10px;font-weight:700;color:#d8cfa8';
  box.append(heading);
}

function checkbox(
  box: HTMLElement,
  label: string,
  onChange: (on: boolean) => void,
): HTMLInputElement {
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.textContent = label;
  row.append(input, text);
  box.append(row);
  return input;
}

function slider(
  box: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onChange: (value: number) => void,
): void {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:4px';
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.width = '110px';
  const readout = document.createElement('span');
  readout.textContent = String(value);
  input.addEventListener('input', () => {
    readout.textContent = input.value;
    onChange(Number(input.value));
  });
  row.append(text, input, readout);
  box.append(row);
}

/** A soft round dot, generated rather than shipped: the bench has no assets. */
function dustTexture(scene: Scene) {
  const texture = new DynamicTexture('fx-dust-dot', { width: 64, height: 64 }, scene, false);
  const context = texture.getContext() as CanvasRenderingContext2D;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

/**
 * Motes filling the level, not a beam: confining them to the sun's shaft needs the
 * shadow map read back, and the point of the bench is to judge the look first.
 * Additive blending is what makes them read as lit dust rather than grey specks.
 *
 * The size is the whole question. A real mote is a few tens of microns, which is
 * under a pixel at any distance, so the sprite has to be centimetre-scale to be
 * seen at all — and at that size it reads as snow. The slider is there to find
 * out whether any setting escapes that trade-off.
 */
function createDust(scene: Scene, level: Level) {
  const extent = bounds(level.outline);
  const system = new ParticleSystem('fx-dust', 4000, scene);
  system.particleTexture = dustTexture(scene);
  system.emitter = new Vector3(
    extent.center[0],
    level.elevation + level.ceilingHeight / 2,
    extent.center[1],
  );
  system.minEmitBox = new Vector3(-extent.width / 2, -level.ceilingHeight / 2, -extent.depth / 2);
  system.maxEmitBox = new Vector3(extent.width / 2, level.ceilingHeight / 2, extent.depth / 2);
  system.color1 = new Color4(1, 0.96, 0.88, 0.7);
  system.color2 = new Color4(1, 0.93, 0.8, 0.4);
  system.colorDead = new Color4(1, 0.95, 0.85, 0);
  system.minSize = 0.004;
  system.maxSize = 0.012;
  system.minLifeTime = 8;
  system.maxLifeTime = 20;
  system.emitRate = 120;
  system.blendMode = ParticleSystem.BLENDMODE_ADD;
  // Barely falling: dust drifts, it does not rain.
  system.gravity = new Vector3(0, -0.004, 0);
  system.direction1 = new Vector3(-0.02, -0.01, -0.02);
  system.direction2 = new Vector3(0.02, 0.01, 0.02);
  system.minEmitPower = 0.01;
  system.maxEmitPower = 0.03;
  system.updateSpeed = 0.01;
  system.isBillboardBased = true;
  system.start();
  return system;
}

export function mountFxLab(viewer: HouseViewer): void {
  const box = panel('Banc d’essai — visite');
  // Seeded with the live scene: an undefined start would make the first `sync`
  // look like a project change and throw away whatever was already built.
  let scene: Scene | undefined = viewer.scene;
  let dust: ParticleSystem | undefined;
  let beads: Mesh | undefined;
  let occlusion: SSAO2RenderingPipeline | undefined;
  let dustOn = false;
  let cornerOn = false;
  let beadSize = 0.004;

  // `load` disposes the scene, so a project change leaves every experiment
  // pointing at a dead scene. Rebuilding on the next toggle is enough for a bench.
  const forget = () => {
    dust?.dispose();
    dust = undefined;
    beads?.dispose();
    beads = undefined;
    occlusion?.dispose(true);
    occlusion = undefined;
    scene = viewer.scene;
  };

  const sync = () => {
    if (scene !== viewer.scene) forget();
    if (dustOn && !dust) dust = createDust(viewer.scene, viewer.level);
    if (!dustOn && dust) {
      dust.dispose();
      dust = undefined;
    }
    if (cornerOn && !beads)
      beads = cornerBeadMesh(
        viewer.scene,
        viewer.level,
        beadSize,
        viewer.scene.getMaterialByName('white-plaster'),
      );
    if (!cornerOn && beads) {
      beads.dispose();
      beads = undefined;
    }
  };

  // The viewer drops the occlusion below 24 fps, and software WebGL never gets
  // there. Without this the corner is judged with no ambient occlusion at all,
  // which is not the case the effect has to survive.
  //
  // The viewer builds its own pipeline on visit entry and disposes it a few
  // seconds later; creating a second one under the same name in that window
  // leaves two pipelines fighting over the PrePass. So this only builds one when
  // none is attached.
  const attached = () =>
    Boolean(
      (
        viewer.scene.postProcessRenderPipelineManager as unknown as {
          _renderPipelines?: Record<string, unknown>;
        }
      )._renderPipelines?.['interior-occlusion'],
    );
  const forceOcclusion = (on: boolean) => {
    if (on) {
      if (!occlusion && !attached()) occlusion = createInteriorOcclusion(viewer.scene, viewer.walk);
      return;
    }
    occlusion?.dispose(true);
    occlusion = undefined;
  };

  section(box, 'Occlusion');
  checkbox(box, 'Forcer le SSAO', forceOcclusion);

  section(box, 'Poussière');
  checkbox(box, 'Particules dans la pièce', (on) => {
    dustOn = on;
    sync();
  });
  slider(box, 'Densité', 0, 2000, 20, 120, (value) => {
    if (dust) dust.emitRate = value;
  });
  slider(box, 'Taille (mm)', 2, 30, 1, 12, (value) => {
    if (dust) dust.maxSize = value / 1000;
  });
  slider(box, 'Vitesse', 0.005, 0.05, 0.005, 0.01, (value) => {
    if (dust) dust.updateSpeed = value;
  });

  section(box, 'Angles verticaux');
  checkbox(box, 'Chanfrein d’angle', (on) => {
    cornerOn = on;
    sync();
  });
  slider(box, 'Chanfrein (mm)', 0, 12, 1, 4, (value) => {
    beadSize = value / 1000;
    if (beads) {
      beads.dispose();
      beads = undefined;
      sync();
    }
  });

  const note = document.createElement('div');
  note.textContent = 'Entrez en visite pour juger.';
  note.style.cssText = 'margin-top:8px;color:#9aa79a';
  box.append(note);

  // Dev-only handle so a script can drive the bench without clicking through it.
  (window as unknown as { __fxLab?: unknown }).__fxLab = {
    viewer,
    sync,
    corners: () => roomCorners(viewer.level),
    setDust: (on: boolean) => {
      dustOn = on;
      sync();
    },
    setCorner: (on: boolean, size = beadSize) => {
      cornerOn = on;
      beadSize = size;
      beads?.dispose();
      beads = undefined;
      sync();
    },
    setOcclusion: forceOcclusion,
  };
}
