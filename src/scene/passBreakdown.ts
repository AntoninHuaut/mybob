/**
 * `?diagnostic=passes`: what each pass of a view costs on this GPU, measured by drawing the
 * view with that pass switched off and comparing the GPU time. WebGL has no per-pass timer,
 * so a difference of whole images is the only honest split (#319).
 */
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import type { Scene } from '@babylonjs/core/scene';
import { profileView, type BenchmarkViewer, type FrameProfile } from './frameProfiler';

export interface PassSwitch {
  label: string;
  /** Already counted in the switch before it: left out of the rest. */
  part?: boolean;
  off(): void;
  on(): void;
}

// Babylon's post-process names (SSAO2, TAA and default rendering pipelines).
const OCCLUSION = ['SSAOOriginalSceneColor', 'ssao', 'BlurH', 'BlurV', 'ssaoCombine'];
const OCCLUSION_BLUR = ['BlurH', 'BlurV'];
const TEMPORAL = ['TAA', 'TAAPass'];

/**
 * Detaching keeps the camera's slot empty and attaching at that index fills it again,
 * so the chain comes back in its order (`Camera.attachPostProcess`).
 */
function postProcessSwitch(
  camera: Camera,
  label: string,
  matches: (postProcess: PostProcess) => boolean,
  part = false,
): PassSwitch | undefined {
  if (!camera._postProcesses.some((postProcess) => postProcess && matches(postProcess)))
    return undefined;
  let detached: Array<[PostProcess, number]> = [];
  return {
    label,
    part,
    off() {
      detached = [];
      camera._postProcesses.forEach((postProcess, index) => {
        if (postProcess && matches(postProcess)) detached.push([postProcess, index]);
      });
      for (const [postProcess] of detached) camera.detachPostProcess(postProcess);
    },
    on() {
      for (const [postProcess, index] of detached) camera.attachPostProcess(postProcess, index);
      detached = [];
    },
  };
}

/** The passes of the camera's view that can be switched off, the shadows included. */
export function passSwitches(scene: Scene, camera: Camera): PassSwitch[] {
  const named = (names: readonly string[]) => (postProcess: PostProcess) =>
    names.includes(postProcess.name);
  const known = [...OCCLUSION, ...TEMPORAL];
  const switches = [
    postProcessSwitch(camera, 'occlusion ambiante', named(OCCLUSION)),
    postProcessSwitch(camera, 'flou de l’occlusion', named(OCCLUSION_BLUR), true),
    {
      label: 'ombres du soleil',
      off: () => {
        scene.shadowsEnabled = false;
      },
      on: () => {
        scene.shadowsEnabled = true;
      },
    },
    postProcessSwitch(camera, 'anticrénelage temporel', named(TEMPORAL)),
    postProcessSwitch(
      camera,
      'halo, tons et FXAA',
      (postProcess) => !known.includes(postProcess.name),
    ),
  ];
  return switches.filter((pass): pass is PassSwitch => pass !== undefined);
}

function ms(value: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Report lines, French like `mybob.profile()`: the owner reads them. */
export function breakdownLines(
  view: string,
  baseline: FrameProfile,
  costs: ReadonlyArray<{ label: string; part?: boolean; profile: FrameProfile }>,
): string[] {
  const total = baseline.gpu?.median;
  if (total === undefined || costs.some((cost) => !cost.profile.gpu))
    return [`[passes] ${view} · GPU non mesurable dans ce navigateur (pas de requête de minutage)`];
  const line = (label: string, cost: number, indent: string, width: number) =>
    `${indent}${label.padEnd(width)} ${ms(cost)} ms · ${Math.round((cost / total) * 100)} %`;
  let rest = total;
  const lines = [`[passes] ${view} · GPU médiane ${ms(total)} ms avec toutes les passes`];
  for (const cost of costs) {
    // Two runs of a few seconds differ by noise: a pass never costs less than nothing.
    const saved = Math.max(0, total - (cost.profile.gpu?.median ?? total));
    if (cost.part) lines.push(line(`dont ${cost.label}`, saved, '    ', 23));
    else {
      rest -= saved;
      lines.push(line(cost.label, saved, '  ', 25));
    }
  }
  lines.push(line('reste (scène, prépasse)', Math.max(0, rest), '  ', 25));
  return lines;
}

/** What the breakdown needs besides the benchmark: a quality that holds still meanwhile. */
export interface BreakdownViewer extends BenchmarkViewer {
  /** Keeps the resolution and effect tier until the returned release is called. */
  freezeQuality(): () => void;
}

/** The two views whose effects #319 is about. */
const BREAKDOWN_RUNS: ReadonlyArray<{ label: string; mode: 'overview' | 'walk' }> = [
  { label: 'visite', mode: 'walk' },
  { label: 'vue 3D', mode: 'overview' },
];

async function measure(viewer: BreakdownViewer, seconds: number): Promise<FrameProfile> {
  // Switching the shadows relinks every lit material: wait for the programs first.
  await viewer.scene.whenReadyAsync();
  return profileView(viewer, seconds * 1000);
}

/**
 * Visite then Vue 3D, each drawn whole and then without each pass in turn, the quality
 * frozen so that only the pass changes between two measures. The view the user was in is
 * restored, and every pass switched back on, whatever happened.
 */
export async function breakdownViews(
  viewer: BreakdownViewer,
  seconds = 3,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const start = { mode: viewer.mode, exterior: viewer.exteriorView };
  const lines: string[] = [];
  const release = viewer.freezeQuality();
  try {
    for (const [index, run] of BREAKDOWN_RUNS.entries()) {
      onProgress?.(index, BREAKDOWN_RUNS.length);
      if (!viewer.setMode(run.mode, false) && viewer.mode !== run.mode) {
        lines.push(`[passes] ${run.label} · vue indisponible`);
        continue;
      }
      await viewer.whenReady();
      const camera = viewer.scene.activeCamera;
      if (!camera) continue;
      const baseline = await measure(viewer, seconds);
      const costs = [];
      for (const pass of passSwitches(viewer.scene, camera)) {
        pass.off();
        try {
          costs.push({
            label: pass.label,
            part: pass.part,
            profile: await measure(viewer, seconds),
          });
        } finally {
          pass.on();
        }
      }
      lines.push(...breakdownLines(run.label, baseline, costs));
    }
  } finally {
    release();
    viewer.setMode(start.mode, start.exterior);
  }
  onProgress?.(BREAKDOWN_RUNS.length, BREAKDOWN_RUNS.length);
  return lines;
}
