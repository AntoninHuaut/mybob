/**
 * `mybob.profile()`: what one image of the current view costs, measured instead of
 * guessed. The idle loop draws nothing while the view is still, so the profiler asks
 * the viewer to draw every image for the duration, and reads, per image:
 *
 * - the GPU time, from the timer query extension when the browser exposes it
 *   (Chrome on most desktops; not Firefox or Safari). The query result arrives a few
 *   images late, so only some images carry one;
 * - the CPU time of `scene.render()`, the draw calls and the active-mesh selection.
 *
 * Nothing runs until a profile is asked for: the instrumentation is created on start
 * and disposed on stop, and this module is only loaded by `mybob.profile()`.
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { PerfCounter } from '@babylonjs/core/Misc/perfCounter';

export interface FrameSample {
  cpuMs: number;
  drawCalls: number;
  selectionMs: number;
  gpuMs?: number;
}

export interface Distribution {
  median: number;
  p95: number;
}

export interface FrameProfile {
  frames: number;
  durationMs: number;
  cpu: Distribution;
  drawCalls: Distribution;
  selection: Distribution;
  /** Absent when the browser has no GPU timer: the report says so instead of inventing it. */
  gpu?: Distribution & { samples: number };
}

/** Nearest-rank percentile of an already sorted list. */
function percentile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

export function summariseFrames(samples: readonly FrameSample[], durationMs: number): FrameProfile {
  const gpu = samples.flatMap((sample) => (sample.gpuMs === undefined ? [] : [sample.gpuMs]));
  return {
    frames: samples.length,
    durationMs,
    cpu: distribution(samples.map((sample) => sample.cpuMs)),
    drawCalls: distribution(samples.map((sample) => sample.drawCalls)),
    selection: distribution(samples.map((sample) => sample.selectionMs)),
    gpu: gpu.length ? { ...distribution(gpu), samples: gpu.length } : undefined,
  };
}

function ms(value: number): string {
  return value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function pair(value: Distribution, format: (value: number) => string): string {
  return `médiane ${format(value.median)} · p95 ${format(value.p95)}`;
}

/** Console lines, French like `mybob.diag()`: the owner reads them. */
export function profileLines(profile: FrameProfile, label: string): string[] {
  if (!profile.frames) return [`[profil] ${label} · aucune image mesurée`];
  const fps = (profile.frames * 1000) / Math.max(1, profile.durationMs);
  return [
    `[profil] ${label} · ${profile.frames} images en ${ms(profile.durationMs / 1000)} s (${Math.round(fps)} fps)`,
    profile.gpu
      ? `  GPU         ${pair(profile.gpu, ms)} ms · ${profile.gpu.samples} mesures`
      : '  GPU         non mesurable dans ce navigateur (pas de requête de minutage)',
    `  CPU rendu   ${pair(profile.cpu, ms)} ms`,
    `  sélection   ${pair(profile.selection, ms)} ms`,
    `  appels      ${pair(profile.drawCalls, (value) => String(Math.round(value)))} par image`,
  ];
}

/** The slice of Babylon's counters the profiler reads; a stub is enough in tests. */
export interface ProfilerCounters {
  frame: PerfCounter;
  drawCalls: PerfCounter;
  selection: PerfCounter;
  /** Undefined without the timer query extension. */
  gpu?: PerfCounter;
  dispose(): void;
}

/**
 * Collects one sample per rendered image between `start` and `stop`. The GPU counter
 * changes only when a query result lands: a sample carries a GPU time only then, so a
 * stale value is never counted twice.
 */
export class FrameRecorder {
  private samples: FrameSample[] = [];
  private gpuCount = 0;
  private startedAt = 0;

  constructor(private readonly counters: ProfilerCounters) {}

  start(now: number) {
    this.samples = [];
    this.gpuCount = this.counters.gpu?.count ?? 0;
    this.startedAt = now;
  }

  /** After each `scene.render()`. */
  record() {
    const gpu = this.counters.gpu;
    let gpuMs: number | undefined;
    if (gpu && gpu.count !== this.gpuCount) {
      this.gpuCount = gpu.count;
      // The timer query reports nanoseconds.
      gpuMs = gpu.current / 1e6;
    }
    this.samples.push({
      cpuMs: this.counters.frame.current,
      drawCalls: this.counters.drawCalls.current,
      selectionMs: this.counters.selection.current,
      gpuMs,
    });
  }

  stop(now: number): FrameProfile {
    return summariseFrames(this.samples, now - this.startedAt);
  }
}

/** Babylon's instrumentation, created for one profile and released after it. */
export async function createCounters(
  engine: AbstractEngine,
  scene: Scene,
): Promise<ProfilerCounters> {
  const [{ SceneInstrumentation }, { EngineInstrumentation }] = await Promise.all([
    import('@babylonjs/core/Instrumentation/sceneInstrumentation'),
    import('@babylonjs/core/Instrumentation/engineInstrumentation'),
    // Register `captureGPUFrameTime` on the WebGL engine and the counter it fills
    // (`getGPUFrameTimeCounter`, a separate module); loaded here, not at start-up.
    import('@babylonjs/core/Engines/Extensions/engine.query'),
    import('@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery'),
  ]);
  const sceneCounters = new SceneInstrumentation(scene);
  sceneCounters.captureFrameTime = true;
  sceneCounters.captureActiveMeshesEvaluationTime = true;
  const timer = !!(engine.getCaps() as { timerQuery?: unknown }).timerQuery;
  const engineCounters = timer ? new EngineInstrumentation(engine) : undefined;
  if (engineCounters) engineCounters.captureGPUFrameTime = true;
  return {
    frame: sceneCounters.frameTimeCounter,
    drawCalls: sceneCounters.drawCallsCounter,
    selection: sceneCounters.activeMeshesEvaluationTimeCounter,
    gpu: engineCounters?.gpuFrameTimeCounter,
    dispose() {
      sceneCounters.dispose();
      engineCounters?.dispose();
    },
  };
}

/** What the profiler needs from the viewer. */
export interface ProfiledViewer {
  readonly engine: AbstractEngine;
  readonly scene: Scene;
  /** Draws every image until the returned release is called. */
  holdRendering(): () => void;
}

/**
 * Profiles the current view for `durationMs`. Every image is drawn meanwhile, still
 * or not: the measure is the cost of an image of this view, not the idle cadence.
 */
export async function profileView(
  viewer: ProfiledViewer,
  durationMs: number,
): Promise<FrameProfile> {
  const scene = viewer.scene;
  const counters = await createCounters(viewer.engine, scene);
  const recorder = new FrameRecorder(counters);
  const release = viewer.holdRendering();
  let observer: Observer<Scene> | null = null;
  try {
    // The first images after the hold may still settle a temporal effect: skip a few.
    await new Promise((resolve) => setTimeout(resolve, 250));
    recorder.start(performance.now());
    observer = scene.onAfterRenderObservable.add(() => recorder.record());
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    return recorder.stop(performance.now());
  } finally {
    scene.onAfterRenderObservable.remove(observer);
    release();
    counters.dispose();
  }
}

/** What a whole-app benchmark needs from the viewer, besides profiling. */
export interface BenchmarkViewer extends ProfiledViewer {
  readonly mode: 'plan' | 'overview' | 'walk';
  readonly exteriorView: boolean;
  setMode(mode: 'plan' | 'overview' | 'walk', exterior?: boolean): boolean;
  whenReady(): Promise<void>;
  tourOrbit(radians?: number, duration?: number): boolean;
}

/** The same path every run: a rendering change is judged on numbers from one route. */
export const BENCHMARK_RUNS: ReadonlyArray<{
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

/**
 * Profiles each view in turn for `seconds`: Plan, Vue 3D still and turning (its
 * antialiasing is bypassed in motion), Extérieur, Visite. A view the viewer refuses (no
 * plot for Extérieur, a touch screen for the Visite) is reported, not measured. The view
 * the user was in is restored at the end, whatever happened.
 */
export async function benchmarkViews(
  viewer: BenchmarkViewer,
  seconds = 4,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const start = { mode: viewer.mode, exterior: viewer.exteriorView };
  const lines: string[] = [];
  try {
    for (const [index, run] of BENCHMARK_RUNS.entries()) {
      onProgress?.(index, BENCHMARK_RUNS.length);
      const accepted = viewer.setMode(run.mode, run.exterior ?? false);
      if (
        (!accepted && viewer.mode !== run.mode) ||
        Boolean(run.exterior) !== viewer.exteriorView
      ) {
        lines.push(`[profil] ${run.label} · vue indisponible`);
        continue;
      }
      await viewer.whenReady();
      if (run.turn) viewer.tourOrbit(Math.PI * 2, seconds * 1000 + 500);
      lines.push(...profileLines(await profileView(viewer, seconds * 1000), run.label));
    }
  } finally {
    viewer.setMode(start.mode, start.exterior);
  }
  onProgress?.(BENCHMARK_RUNS.length, BENCHMARK_RUNS.length);
  return lines;
}
