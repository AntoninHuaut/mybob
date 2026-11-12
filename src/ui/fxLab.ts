import { EFFECT_TIERS } from '../scene/adaptiveResolution';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { HouseViewer } from '../scene/viewer';
import { cornerBeadMesh, roomCorners } from '../scene/cornerBead';
import { profileLines, profileView } from '../scene/frameProfiler';

/**
 * Development-only bench for the visit's open rendering questions.
 * `main.ts` imports it behind `import.meta.env.DEV`, so Vite drops the whole
 * module from a build.
 *
 * The bench exists to try a rendering idea on the real house before deciding
 * whether it ships. Dust motes were tried here and removed: a real mote is
 * tens of microns — under a pixel at any distance — and a sprite big enough to
 * be seen reads as snow. What is left:
 *
 * - the visit's effect tier, pinned by hand (0 = full, 1 = no occlusion) to judge each state without waiting for a slow machine;
 * - a chamfer on the concave vertical corner between two walls, the one place
 *   the wall bevel cannot reach;
 * - a benchmark: `mybob.profile()` run in each view in turn, Vue 3D still and turning,
 *   so a rendering change is judged on numbers from the same path every time.
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

export function mountFxLab(viewer: HouseViewer): void {
  const box = panel('Banc d’essai — visite');
  // Seeded with the live scene: an undefined start would make the first `sync`
  // look like a project change and throw away whatever was already built.
  let scene: Scene | undefined = viewer.scene;
  let beads: Mesh | undefined;
  let cornerOn = false;
  let beadSize = 0.004;

  // `load` disposes the scene, which takes its meshes with it: nothing to
  // dispose here, only dead references to drop. Sealed on the first toggle,
  // what was ticked is simply rebuilt on the new scene.
  const forget = () => {
    beads = undefined;
    scene = viewer.scene;
    cornerOn = false;
    cornerToggle.checked = false;
  };

  const sync = () => {
    if (scene !== viewer.scene) forget();
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

  const cornerToggle = checkbox(box, 'Chanfrein d’angle', (on) => {
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

  const tierRow = document.createElement('label');
  tierRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:4px';
  const tierSelect = document.createElement('select');
  for (const [value, text] of [
    ['auto', 'auto'],
    ...Array.from({ length: EFFECT_TIERS + 1 }, (_, tier) => [
      String(tier),
      `palier ${tier}/${EFFECT_TIERS}`,
    ]),
  ])
    tierSelect.append(new Option(text, value));
  const setTier = (tier?: number) => {
    viewer.forceEffectTier(tier);
    tierSelect.value = tier === undefined ? 'auto' : String(tier);
  };
  tierSelect.addEventListener('change', () =>
    setTier(tierSelect.value === 'auto' ? undefined : Number(tierSelect.value)),
  );
  tierRow.append('Effets de la visite', tierSelect);
  box.append(tierRow);

  const benchButton = document.createElement('button');
  benchButton.type = 'button';
  benchButton.textContent = 'Mesurer chaque vue (4 s)';
  benchButton.style.cssText = 'margin-top:6px;font:inherit';
  benchButton.addEventListener('click', () => {
    benchButton.disabled = true;
    void benchmark().finally(() => (benchButton.disabled = false));
  });
  box.append(benchButton);

  const note = document.createElement('div');
  note.textContent = 'Entrez en visite pour juger.';
  note.style.cssText = 'margin-top:8px;color:#9aa79a';
  box.append(note);

  /**
   * Same path every run: each view prepared, then profiled for four seconds. Vue 3D is
   * measured twice, still (temporal antialiasing and occlusion settle) and turning
   * (the antialiasing is bypassed, multisampling takes over). Lines go to the console.
   */
  const benchmark = async (seconds = 4) => {
    const start = { mode: viewer.mode, exterior: viewer.exteriorView };
    const runs: Array<{
      label: string;
      mode: 'plan' | 'overview' | 'walk';
      exterior?: boolean;
      turn?: boolean;
    }> = [
      { label: 'plan', mode: 'plan' },
      { label: 'vue 3D, immobile', mode: 'overview' },
      { label: 'vue 3D, en rotation', mode: 'overview', turn: true },
      { label: 'extérieur', mode: 'overview', exterior: true },
      { label: 'visite', mode: 'walk' },
    ];
    const lines: string[] = [];
    try {
      for (const run of runs) {
        if (!viewer.setMode(run.mode, run.exterior ?? false) && viewer.mode !== run.mode) {
          lines.push(`[profil] ${run.label} · vue refusée`);
          continue;
        }
        await viewer.whenReady();
        if (run.turn) viewer.tourOrbit(Math.PI * 2, seconds * 1000 + 500);
        lines.push(...profileLines(await profileView(viewer, seconds * 1000), run.label));
      }
    } finally {
      viewer.setMode(start.mode, start.exterior);
    }
    console.info(lines.join('\n'));
    return lines;
  };

  const previousViewChange = viewer.onViewChange;
  viewer.onViewChange = (mode) => {
    sync();
    previousViewChange?.(mode);
  };
  sync();

  // Dev-only handle so a script can drive the bench without clicking through it.
  (window as unknown as { __fxLab?: unknown }).__fxLab = {
    viewer,
    sync,
    forceTier: setTier,
    benchmark,
    corners: () => roomCorners(viewer.level),
    setCorner: (on: boolean, size = beadSize) => {
      cornerOn = on;
      beadSize = size;
      beads?.dispose();
      beads = undefined;
      sync();
    },
  };
}
