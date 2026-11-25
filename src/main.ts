import { userMessage } from './errorMessage';
import './style.css';
import { SolarPanel } from './ui/solarPanel';
import { appTemplate } from './ui/appTemplate';
import { solarPosition } from './scene/solar';
import { HouseViewer } from './scene/viewer';
import { generateMapsInWorker } from './scene/surfaceMapsInWorker';
// Inlined: a blob worker needs no request, so a slow or intercepted fetch cannot stall it.
import SurfaceMapsWorker from './scene/surfaceMaps.worker?worker&inline';
import { createEngine } from './scene/engine';
import {
  collectDiagnostics,
  diagnosticLines,
  installDiagnostics,
  type StartupTiming,
  profileContextLine,
  viewLabel,
  type DiagnosticView,
} from './scene/diagnostics';
import {
  copyReport,
  passesRequested,
  reportProgressHtml,
  reportRequested,
  reportResultHtml,
  withoutReportParameter,
} from './ui/performanceReport';
import { shaderLog } from './scene/shaderLog';
import { FrameRateMeter } from './ui/frameRate';
import { validateProject } from './model/validate';
import { icon } from './ui/icons';
import { escapeHtml as esc } from './ui/format';
import { ViewportProjection } from './ui/viewportProjection';
import { StairNavigation } from './ui/stairNavigation';
import { setAttribute } from './ui/domWrites';
import { pointInPolygon } from './model/geometry';
import { isShareLink } from './model/shareLink';
import { app } from './app/state';
import { activeButton, el, openDialog, pauseForDialog, toast } from './app/dom';
import {
  furnitureBuildMs,
  furnitureLabelObstacles,
  openFurnitureEditor,
  updateFurnitureContext,
  wireFurnitureShortcuts,
  wireFurnitureToolbar,
} from './app/furnitureController';
import {
  renderProjectOptions,
  restoreLibrary,
  showQuarantineBanner,
  wireProjectStorageWatch,
} from './app/projectLibrary';
import { handleStairLevelChange, loadLevel, loadProject, selectRoom } from './app/projectView';
import { readOnboarding, showStartCard } from './app/preferences';
import { openSharedLink, wireLinkHashFlush } from './app/shareLinkSync';
import { canChangeMode, setSidebar, syncViewChrome } from './app/viewChrome';
import { render as renderWallDraft, wallToolActive } from './app/wallDrawing';
import { wireNavigationControls, wireProjectControls, wireViewportControls } from './app/controls';
import { renderPlanSelection } from './app/planSelection';

/*
 * Start-up: the template, the bundled and stored projects, the viewer and its callbacks, then
 * the first project. Screen state and behaviour live in `src/app/` (docs/ARCHITECTURE.md).
 */

el('#app').innerHTML = appTemplate();

const SOFTWARE_RENDER_HELP =
  'Le navigateur dessine la 3D sans la carte graphique, d’où la lenteur. Activez l’accélération graphique (Chrome, Edge : Paramètres → Système ; Firefox : Paramètres → Performances), puis relancez le navigateur.';

function wireEvents() {
  wireFurnitureToolbar();
  wireProjectStorageWatch();
  wireNavigationControls();
  wireFurnitureShortcuts();
  wireProjectControls();
  wireViewportControls();
  wireLinkHashFlush();
}

/** `?diagnostic` also asks for the headset's frame report on leaving it; the URL loses the flag. */
const diagnosticSession = reportRequested(location.search);
const passBreakdown = passesRequested(location.search);

let startup: StartupTiming | undefined;

function diagnostics() {
  const { viewer } = app;
  const snapshot = collectDiagnostics(
    viewer.engine,
    viewer.scene,
    diagnosticView(),
    viewer.refreshRate,
  );
  return { ...snapshot, startup };
}

function showReport(title: string, text: string) {
  openDialog(title, reportResultHtml(text));
  el('#copy-report').addEventListener('click', async () => {
    const copied = await copyReport(text, el('#report-text'));
    el('#copy-report').textContent = copied ? 'Copié' : 'Texte sélectionné : Ctrl+C';
  });
}

function diagnosticView(): DiagnosticView {
  const { viewer } = app;
  return {
    mode: viewer.mode,
    exterior: viewer.exteriorView,
    environment: viewer.ambience.environment,
    occlusion: viewer.ambience.occlusion,
    idle: viewer.renderingIdle,
    renderScale: viewer.currentRenderScale,
    effectTier: viewer.currentEffectTier,
  };
}

/**
 * `?diagnostic`: measure every view and show a report to copy (`ui/performanceReport.ts`);
 * `?diagnostic=passes` measures what each effect of Visite and Vue 3D costs instead.
 */
async function measureForReport() {
  const { viewer } = app;
  history.replaceState(null, '', withoutReportParameter(location.href));
  openDialog('PERFORMANCES', reportProgressHtml(0, 1, passBreakdown ? 120 : 30));
  // The refresh rate is read only from undrawn frames, which the benchmark never leaves.
  for (let wait = 0; wait < 20 && viewer.refreshRate === undefined; wait++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  const onProgress = (done: number, total: number) => {
    const progress = document.querySelector<HTMLProgressElement>('#report-progress');
    if (progress) {
      progress.max = total;
      progress.value = done;
    }
  };
  const lines = passBreakdown
    ? await (await import('./scene/passBreakdown')).breakdownViews(viewer, 3, onProgress)
    : await (await import('./scene/frameProfiler')).benchmarkViews(viewer, 4, onProgress);
  showReport('PERFORMANCES', [...diagnosticLines(diagnostics()), ...lines].join('\n'));
}

/**
 * The plan-photo overlay was removed; drop the database it left behind so no
 * personal plan image stays in the browser. Idempotent, safe to keep for now.
 */
function dropLegacyPlanPhotoStore(): void {
  try {
    indexedDB?.deleteDatabase('maison-atelier:plan-photo');
  } catch {
    /* optional cleanup */
  }
}

/** The viewer's callbacks into the chrome. */
function wireViewer(viewer: HouseViewer) {
  const frameRate = new FrameRateMeter(el('#frame-rate'));
  viewer.canChangeMode = canChangeMode;
  viewer.onViewChange = syncViewChrome;
  viewer.onDestination = () => {
    activeButton('#go-to', false);
    el('#walk-start').hidden = true;
    el<HTMLCanvasElement>('#scene').focus();
    toast('Vous êtes à cet endroit. Glissez pour regarder ou cliquez sur Reprendre la visite.');
  };
  viewer.onDestinationRejected = () =>
    toast('Choisissez un point libre, à distance des murs et des meubles.');
  viewer.onLevelChange = handleStairLevelChange;
  viewer.onImmersiveChange = (active, report) => {
    el('#viewport').classList.toggle('immersive', active);
    el('#enter-immersive').setAttribute('aria-pressed', String(active));
    if (!active) toast('Retour à la visite à l’écran.');
    if (!active && report && diagnosticSession) showReport('CASQUE', report);
  };
  viewer.onSelectRoom = (id) => selectRoom(id, false);
  viewer.onEditFurniture = openFurnitureEditor;
  viewer.onPointerLockError = () => {
    toast('Capture indisponible : cliquez dans la vue, puis glissez pour regarder autour de vous.');
    el<HTMLCanvasElement>('#scene').focus();
  };
  viewer.onMeasure = (measurement) => app.measureBar.sync(measurement);
  const viewportProjection = new ViewportProjection(
    el('#viewport'),
    app.measureBar,
    furnitureLabelObstacles,
  );
  const stairNavigation = new StairNavigation(
    el('#stair-navigation'),
    loadLevel,
    el('#floor-navigation'),
  );
  const viewport = el('#viewport');
  viewer.onFrame = () => {
    if (!app.current) return;
    frameRate.update(performance.now(), viewer.engine.getFps());
    updateFurnitureContext();
    // Test hook only: lets e2e prove the visitor crossed into another room.
    const room =
      viewer.mode === 'walk'
        ? viewer.level.rooms.find((r) =>
            pointInPolygon([viewer.walk.position.x, viewer.walk.position.z], r.polygon),
          )
        : undefined;
    setAttribute(viewport, 'data-walk-room', room?.id ?? '');
  };
  // After the image is drawn: the camera matrices are then the ones the rooms were drawn with.
  viewer.onRendered = (frame) => {
    if (!app.current) return;
    viewportProjection.update(viewer, frame, {
      showLabels: app.display.labels,
      showDimensions: app.display.dimensions,
      selectedRoomId: app.selectedRoom?.id,
      northAngleDeg: app.solarPanel.settings?.northAngleDeg ?? 0,
    });
    stairNavigation.update(app.current, viewer, frame.cameraMoved !== false);
    if (frame.cameraMoved !== false) renderPlanSelection();
    if (wallToolActive() && frame.cameraMoved !== false) renderWallDraft();
  };
}

async function start() {
  dropLegacyPlanPhotoStore();
  // The panel shows its real state before any wait: a control read during the start-up
  // (the template says closed) must not be toggled once the start-up opens it.
  setSidebar(matchMedia('(min-width: 761px)').matches);
  // The procedural maps are generated meanwhile, while the projects download and the engine starts.
  const maps = generateMapsInWorker(() => new SurfaceMapsWorker());
  try {
    const projectPaths = __PUBLIC_BUILD__
      ? ['/projects/studio-demo.json']
      : [...__PRIVATE_PROJECTS__, '/projects/studio-demo.json'];
    const bundled = await Promise.all(
      projectPaths.map(async (path) => {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Impossible de charger les données de la maison.');
        return validateProject(await response.json());
      }),
    );
    const projectsAt = performance.now();
    await maps;
    const mapsAt = performance.now();
    const unreadableProjects = restoreLibrary(bundled);
    const libraryAt = performance.now();
    const sceneEngine = createEngine(el<HTMLCanvasElement>('#scene'));
    const viewer = new HouseViewer(el<HTMLCanvasElement>('#scene'), sceneEngine);
    const engineAt = performance.now();
    app.viewer = viewer;
    if (viewer.softwareRendering) {
      // A CPU rasteriser draws the scene ten to fifty times slower than any GPU: the
      // usual cause is graphics acceleration switched off in the browser settings.
      el('#software-render').hidden = false;
      el('#software-render').addEventListener('click', () => toast(SOFTWARE_RENDER_HELP, 15000));
    }
    app.solarPanel = new SolarPanel({
      onApply: (settings, instant) => {
        viewer.setSolar(settings ? solarPosition(settings, instant) : undefined);
        activeButton('#tool-solar', Boolean(settings));
        el('.orientation span').textContent = settings ? 'NORD' : 'HAUT DU PLAN';
        el('.orientation').title = settings
          ? 'Nord géographique renseigné pour ce projet'
          : 'Direction du haut du document de référence';
      },
      onDialogState: pauseForDialog,
    });
    app.solarPanel.mountTimeline(el('#viewport'));
    wireViewer(viewer);
    renderProjectOptions();
    let initial = bundled[0].id;
    try {
      initial = localStorage.getItem('maison-atelier:last-project') ?? initial;
    } catch {
      /* optional persistence */
    }
    const loadStarted = performance.now();
    if (isShareLink(location.hash)) {
      // A link error (10-project limit, rejected document…) is not a failure of the
      // 3D engine: a toast message, then the local project stays usable.
      try {
        await openSharedLink(initial);
      } catch (error) {
        console.error(error);
        if (!app.current) loadProject(initial);
        toast(
          error instanceof Error
            ? error.message
            : 'Le lien n’a pas pu être ouvert : le projet enregistré sur cet ordinateur est chargé.',
        );
      }
    } else loadProject(initial);
    const builtAt = performance.now();
    // Development-only bench: the dynamic import behind `DEV` is what keeps the
    // whole module out of a production build.
    if (import.meta.env.DEV) {
      void import('./ui/fxLab').then(({ mountFxLab }) => mountFxLab(viewer));
    }
    installDiagnostics(
      diagnostics,
      () => shaderLog.report(),
      async (seconds) => {
        const { profileView, profileLines } = await import('./scene/frameProfiler');
        const view = viewLabel(viewer.mode, viewer.exteriorView);
        // Read before the profile: its forced images stop the refresh-rate sampling.
        const context = profileContextLine(diagnostics());
        const profile = await profileView(viewer, seconds * 1000);
        return [context, ...profileLines(profile, view)].join('\n');
      },
    );
    wireEvents();
    viewer.onPreparingProgress = (fraction) => {
      const bar = el('#loading-progress');
      const percent = Math.round(fraction * 100);
      bar.setAttribute('aria-valuenow', String(percent));
      bar.style.setProperty('--progress', String(fraction));
    };
    // The first view links its shaders behind the start-up screen, which covers the whole
    // page: the header and the sidebar would otherwise look alive while the links stall
    // the page. The other views do the same over the viewport only, with a shorter
    // message, the first time they are opened.
    await viewer.whenReady();
    const scene = viewer.loadTimings;
    if (scene) {
      const readyAt = performance.now();
      const sceneParts = scene.materialsMs + scene.levelsMs + scene.exteriorMs;
      startup = {
        readyAt,
        phases: [
          { label: 'projets', ms: projectsAt },
          { label: 'attente des textures', ms: mapsAt - projectsAt },
          { label: 'bibliothèque', ms: libraryAt - mapsAt },
          { label: 'moteur', ms: engineAt - libraryAt },
          { label: 'matériaux', ms: scene.materialsMs },
          { label: 'niveaux', ms: scene.levelsMs },
          { label: 'extérieur', ms: scene.exteriorMs },
          { label: 'scène', ms: scene.totalMs - sceneParts },
          { label: 'meubles', ms: furnitureBuildMs },
          {
            label: 'interface',
            ms: builtAt - loadStarted - scene.totalMs - furnitureBuildMs,
          },
          { label: 'préparation de la vue', ms: readyAt - builtAt },
        ],
      };
    }
    viewer.onPreparing = (active) => {
      el('#loading span').textContent = 'Préparation de la vue…';
      el('#loading').hidden = !active;
    };
    el('#loading').hidden = true;
    el('#loading').classList.remove('loading-startup');
    app.onboarding = readOnboarding();
    showStartCard();
    if (unreadableProjects > 0) showQuarantineBanner(unreadableProjects);
    if (diagnosticSession) void measureForReport();
  } catch (error) {
    el('#loading').hidden = true;
    el('#loading').classList.remove('loading-startup');
    el('#fatal-error').hidden = false;
    el('#fatal-error').innerHTML =
      `${icon('info', 30)}<h2>La vue 3D n’a pas pu démarrer.</h2><p>${esc(userMessage(error, 'Erreur de chargement.'))}</p><p>Utilisez une version récente de Chrome, Firefox ou Edge, avec l’accélération graphique activée.</p><button class="primary-button" id="reload">Réessayer</button>`;
    el('#reload').addEventListener('click', () => location.reload());
    console.error(error);
  }
}

void start();
