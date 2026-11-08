import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  collectDiagnostics,
  diagnosticLines,
  engineInfo,
  engineLabel,
  installDiagnostics,
  type DiagnosticEngine,
  type DiagnosticScene,
  type DiagnosticSnapshot,
} from '../src/scene/diagnostics';

function engine(overrides: Partial<DiagnosticEngine> = {}): DiagnosticEngine {
  return {
    getClassName: () => 'ThinEngine',
    getFps: () => 58.4,
    getDeltaTime: () => 17.2,
    getRenderWidth: () => 2560,
    getRenderHeight: () => 1440,
    getHardwareScalingLevel: () => 0.625,
    webGLVersion: 2,
    getGlInfo: () => ({
      vendor: 'WebKit',
      renderer: 'ANGLE (NVIDIA RTX 3060)',
      version: 'WebGL 2.0',
    }),
    ...overrides,
  };
}

function scene(): DiagnosticScene {
  return {
    meshes: new Array(412),
    materials: new Array(38),
    lights: new Array(6),
    getActiveMeshes: () => ({ length: 187 }),
  };
}

const view = { mode: 'walk', exterior: false, environment: true, occlusion: 'active' } as const;

test('le nom du moteur donne la version WebGL, ou le nom de classe à défaut', () => {
  assert.equal(engineLabel(engine()), 'WebGL 2');
  assert.equal(engineLabel(engine({ webGLVersion: undefined })), 'ThinEngine');
});

test('le GPU se lit sur le moteur et reste lisible sans information', () => {
  assert.deepEqual(engineInfo(engine()), {
    vendor: 'WebKit',
    renderer: 'ANGLE (NVIDIA RTX 3060)',
    version: 'WebGL 2.0',
  });
  assert.deepEqual(engineInfo(engine({ getGlInfo: undefined })), {
    vendor: 'inconnu',
    renderer: 'inconnu',
    version: 'inconnu',
  });
});

test('le rapport reprend moteur, cadence, vue, rendu et scène', () => {
  const snapshot = collectDiagnostics(engine(), scene(), view);
  const lines = diagnosticLines(snapshot);
  assert.equal(lines[0], '[diag] MyBob — rapport de performance');
  assert.match(lines[1], /WebGL 2 · WebKit · ANGLE \(NVIDIA RTX 3060\)/);
  assert.match(lines[2], /58 fps · 17,2 ms par image/);
  assert.match(lines[3], /visite · occlusion active · environnement actif/);
  assert.match(lines[4], /2560 × 1440 px · facteur 0,6 · dpr/);
  assert.match(lines[5], /412 maillages, 187 actifs, 38 matériaux, 6 lumières/);
});

test('le rapport nomme l’extérieur et l’occlusion indisponible', () => {
  const lines = diagnosticLines(
    collectDiagnostics(engine(), scene(), {
      mode: 'overview',
      exterior: true,
      environment: false,
      occlusion: 'unavailable',
    }),
  );
  assert.match(lines[3], /extérieur · occlusion indisponible \(WebGL\) · environnement inactif/);
});

test('au repos, le rapport dit que l’image est figée au lieu d’une cadence trompeuse', () => {
  const lines = diagnosticLines(collectDiagnostics(engine(), scene(), { ...view, idle: true }));
  assert.match(lines[2], /au repos, image figée · bougez la vue pendant la mesure/);
  assert.doesNotMatch(lines[2], /fps/);
});

test('le rapport dit à quelle résolution la vue est rendue en mouvement', () => {
  assert.match(
    diagnosticLines(collectDiagnostics(engine(), scene(), view))[4],
    /en mouvement 100 %/,
  );
  const slow = diagnosticLines(
    collectDiagnostics(engine(), scene(), { ...view, motionScale: 0.67 }),
  );
  assert.match(slow[4], /en mouvement 67 %/);
});

test('un instantané complet reste formattable sans navigateur', () => {
  const snapshot: DiagnosticSnapshot = {
    engine: 'WebGL 2',
    gpu: 'WebKit · ANGLE (NVIDIA RTX 3060)',
    frameRate: 12,
    frameTimeMs: 83.3,
    view,
    renderWidth: 1920,
    renderHeight: 1080,
    scaling: 1,
    pixelRatio: 1,
    meshes: 1,
    activeMeshes: 1,
    materials: 1,
    lights: 1,
    cores: 8,
    memoryGb: 8,
    screen: '1920 × 1080',
    userAgent: 'test',
    heapMb: 142.4,
  };
  const lines = diagnosticLines(snapshot);
  assert.match(lines[6], /8 cœurs · 8 Go de mémoire · écran 1920 × 1080 · tas 142 Mo/);
  assert.equal(lines[7], '  navigateur  test');
});

test('diag imprime le rapport une fois et report le renvoie pour la copie', () => {
  const window = new Window({ url: 'http://localhost' });
  const globals = globalThis as { window?: unknown };
  const previousWindow = globals.window;
  const printed: string[] = [];
  const originalInfo = console.info;
  globals.window = window;
  console.info = (...args: unknown[]) => void printed.push(args.join(' '));
  try {
    installDiagnostics(() => collectDiagnostics(engine(), scene(), view));
    assert.equal(printed.length, 1, 'le démarrage rappelle la commande une seule fois');
    assert.match(printed[0], /tapez mybob\.diag\(\)/);

    const api = (window as unknown as { mybob: { diag(): unknown; report(): string } }).mybob;
    printed.length = 0;
    assert.equal(
      api.diag(),
      undefined,
      'diag ne renvoie rien : la console répéterait la valeur de retour',
    );
    assert.equal(printed.length, 1, 'un seul affichage par appel');
    assert.match(printed[0], /rapport de performance/);

    assert.equal(api.report(), printed[0], 'report renvoie le même texte');
    assert.equal(printed.length, 1, 'report n’imprime rien');
  } finally {
    console.info = originalInfo;
    globals.window = previousWindow;
  }
});
