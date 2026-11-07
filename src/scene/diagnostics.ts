/**
 * A one-command performance report, meant to be read over the phone: the owner
 * asks for `mybob.diag()` and gets the engine, the GPU, the cadence and the
 * resolution actually rendered. Nothing here appears in the interface.
 */

/** The engine surface the report reads; a stub object is enough in tests. */
export interface DiagnosticEngine {
  getClassName(): string;
  getFps(): number;
  getDeltaTime(): number;
  getRenderWidth(): number;
  getRenderHeight(): number;
  getHardwareScalingLevel(): number;
  webGLVersion?: number;
  getInfo?(): { vendor?: string; renderer?: string; version?: string };
  getGlInfo?(): { vendor?: string; renderer?: string; version?: string };
}

/** The scene surface the report reads. */
export interface DiagnosticScene {
  meshes: readonly unknown[];
  materials: readonly unknown[];
  lights: readonly unknown[];
  getActiveMeshes(): { readonly length: number };
}

export type OcclusionState = 'active' | 'refused' | 'unavailable' | 'idle';

export interface DiagnosticView {
  mode: string;
  exterior: boolean;
  environment: boolean;
  occlusion: OcclusionState;
}

export interface DiagnosticSnapshot {
  engine: string;
  gpu: string;
  frameRate: number;
  frameTimeMs: number;
  view: DiagnosticView;
  renderWidth: number;
  renderHeight: number;
  scaling: number;
  pixelRatio: number;
  meshes: number;
  activeMeshes: number;
  materials: number;
  lights: number;
  cores?: number;
  memoryGb?: number;
  screen: string;
  userAgent: string;
  heapMb?: number;
}

const MODE_LABELS: Record<string, string> = {
  overview: 'vue 3D',
  plan: 'plan',
  walk: 'visite',
};

const OCCLUSION_LABELS: Record<OcclusionState, string> = {
  active: 'active',
  refused: 'retirée (GPU faible)',
  unavailable: 'indisponible',
  idle: 'hors visite',
};

/** One decimal, French comma: the report is read by a person, not parsed. */
function decimal(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

/**
 * Babylon exposes the GPU name through `getInfo()` on WebGPU and `getGlInfo()` on
 * WebGL. Both stay optional so a stub engine still produces a report.
 */
export function engineInfo(engine: DiagnosticEngine): {
  vendor: string;
  renderer: string;
  version: string;
} {
  const info = engine.getInfo?.() ?? engine.getGlInfo?.();
  return {
    vendor: info?.vendor || 'inconnu',
    renderer: info?.renderer || 'inconnu',
    version: info?.version || 'inconnu',
  };
}

/** "WebGL 2" or "WebGPU": the first question when a machine renders slowly. */
export function engineLabel(engine: DiagnosticEngine): string {
  if (engine.getClassName().includes('WebGPU')) return 'WebGPU';
  return engine.webGLVersion ? `WebGL ${engine.webGLVersion}` : engine.getClassName();
}

function deviceLine(snapshot: DiagnosticSnapshot): string {
  const parts: string[] = [];
  if (snapshot.cores) parts.push(`${snapshot.cores} cœurs`);
  if (snapshot.memoryGb) parts.push(`${decimal(snapshot.memoryGb)} Go de mémoire`);
  parts.push(`écran ${snapshot.screen}`);
  if (snapshot.heapMb) parts.push(`tas ${Math.round(snapshot.heapMb)} Mo`);
  return parts.join(' · ');
}

/** The report as console lines: one fact per line, aligned for a screenshot. */
export function diagnosticLines(snapshot: DiagnosticSnapshot): string[] {
  const view = snapshot.view;
  const mode = view.exterior ? 'extérieur' : (MODE_LABELS[view.mode] ?? view.mode);
  return [
    '[diag] MyBob — rapport de performance',
    `  moteur      ${snapshot.engine} · ${snapshot.gpu}`,
    `  cadence     ${Math.round(snapshot.frameRate)} fps · ${decimal(snapshot.frameTimeMs)} ms par image`,
    `  vue         ${mode} · occlusion ${OCCLUSION_LABELS[view.occlusion]} · environnement ${view.environment ? 'actif' : 'inactif'}`,
    `  rendu       ${snapshot.renderWidth} × ${snapshot.renderHeight} px · facteur ${decimal(snapshot.scaling)} · dpr ${decimal(snapshot.pixelRatio)}`,
    `  scène       ${snapshot.meshes} maillages, ${snapshot.activeMeshes} actifs, ${snapshot.materials} matériaux, ${snapshot.lights} lumières`,
    `  machine     ${deviceLine(snapshot)}`,
    `  navigateur  ${snapshot.userAgent}`,
  ];
}

/**
 * Reads the live engine and scene. Every browser-only value is optional: the
 * report must not throw on the machine it is meant to diagnose.
 */
export function collectDiagnostics(
  engine: DiagnosticEngine,
  scene: DiagnosticScene,
  view: DiagnosticView,
): DiagnosticSnapshot {
  const info = engineInfo(engine);
  const gpu = [info.vendor, info.renderer].filter((part) => part !== 'inconnu').join(' · ');
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number });
  const screen = typeof window === 'undefined' ? undefined : window.screen;
  const heap = (performance as { memory?: { usedJSHeapSize: number } } | undefined)?.memory;
  return {
    engine: engineLabel(engine),
    gpu: gpu || 'inconnu',
    frameRate: engine.getFps(),
    frameTimeMs: engine.getDeltaTime(),
    view,
    renderWidth: engine.getRenderWidth(),
    renderHeight: engine.getRenderHeight(),
    scaling: engine.getHardwareScalingLevel(),
    pixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
    meshes: scene.meshes.length,
    activeMeshes: scene.getActiveMeshes().length,
    materials: scene.materials.length,
    lights: scene.lights.length,
    cores: nav?.hardwareConcurrency,
    memoryGb: nav?.deviceMemory,
    screen: screen ? `${screen.width} × ${screen.height}` : 'inconnu',
    userAgent: nav?.userAgent ?? 'inconnu',
    heapMb: heap ? heap.usedJSHeapSize / 1024 / 1024 : undefined,
  };
}

/**
 * Publishes `mybob.diag()` and states it once at startup, so a relative who never
 * opens the developer tools still has the command in front of them. The report is
 * returned as text as well, which makes `copy(mybob.diag())` work in Chrome.
 */
export function installDiagnostics(report: () => DiagnosticSnapshot): void {
  const diag = () => {
    const text = diagnosticLines(report()).join('\n');
    console.info(text);
    return text;
  };
  (window as unknown as { mybob?: { diag: () => string } }).mybob = { diag };
  const first = report();
  console.info(
    `[diag] ${first.engine} · ${first.gpu} · tapez mybob.diag() pour un rapport complet.`,
  );
}
