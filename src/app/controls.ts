import { openRoomDivision } from './divideRoom';
import { openWallDrawing } from './drawHouse';
import { openNewHouse } from './newHouse';
import { userMessage } from '../errorMessage';
import { isImmersiveSupported, preloadImmersive } from '../scene/headsetSession';
import type { ViewMode } from '../scene/viewer';
import type { WallDisplay } from '../scene/wallCutaway';
import { fullHelpHtml, shortHelpHtml } from '../ui/firstSteps';
import { sourceDialogHtml } from '../ui/sourcePanel';
import { exportSceneImage } from '../ui/imageExport';
import { number } from '../ui/format';
import { activeButton, closeDialog, el, openDialog, toast } from './dom';
import { app } from './state';
import { setFurnitureCirculation } from './furnitureController';
import { openPlanOpenings } from './planOpenings';
import { downloadProject, importProject, openRemoveProject } from './projectLibrary';
import { loadLevel, loadProject } from './projectView';
import { chooseQuality, dismissStartCard, updateNavigationPreferences } from './preferences';
import { adoptReceived, copyShareLink } from './shareLinkSync';
import {
  setMode,
  setNavigationPanel,
  setSidebar,
  setSidebarTab,
  syncDisplayControls,
} from './viewChrome';

/*
 * Wiring of the static controls of `ui/appTemplate.ts`: each listener is attached once, at
 * start-up. Furniture controls live in furnitureController.ts.
 */

/** Short help by default; the detailed text stays one click away, nothing removed. */
function openFirstSteps() {
  openDialog('PRENDRE EN MAIN L’ATELIER', shortHelpHtml());
  el('#show-full-help').addEventListener('click', () => {
    el('#dialog-content').innerHTML = fullHelpHtml();
  });
}

function openImageExport() {
  const { viewer, display } = app;
  openDialog(
    'EXPORTER UNE IMAGE',
    `<h2>Garder cette vue</h2><p>Image PNG de la caméra actuelle, sans les panneaux de l’interface. Le fichier est généré sur cet ordinateur.</p><div class="image-export-options"><label><input id="image-labels" type="checkbox" ${display.labels && viewer.mode !== 'walk' ? 'checked' : ''}> Noms et surfaces des pièces</label><label><input id="image-dimensions" type="checkbox" ${display.dimensions && viewer.mode !== 'walk' ? 'checked' : ''} ${viewer.mode === 'walk' ? 'disabled' : ''}> Dimensions extérieures</label><label><input id="image-transparent" type="checkbox"> Fond transparent</label><label><input id="image-header" type="checkbox" checked> Cartouche projet</label></div><p id="image-export-status" role="status"></p><button id="download-scene-image" class="primary-button">Télécharger le PNG</button>`,
  );
  el<HTMLButtonElement>('#download-scene-image').addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await exportSceneImage(viewer, {
        labels: el<HTMLInputElement>('#image-labels').checked,
        dimensions: el<HTMLInputElement>('#image-dimensions').checked,
        transparent: el<HTMLInputElement>('#image-transparent').checked,
        header: el<HTMLInputElement>('#image-header').checked,
        projectName: app.current.name,
        levelName: viewer.level.name,
        variantName: app.layoutSession.active(app.current.id).name,
      });
      closeDialog();
      toast('Image PNG exportée.');
    } catch (error) {
      el('#image-export-status').textContent = userMessage(error, 'Export image impossible.');
      button.disabled = false;
    }
  });
}

/** Navigation panel, sidebar tabs, walk preferences, destination and section. */
export function wireNavigationControls() {
  const { viewer } = app;
  el('#tool-navigation').addEventListener('click', () =>
    setNavigationPanel(Boolean(el('#navigation-panel').hidden)),
  );
  el('#close-navigation').addEventListener('click', () => setNavigationPanel(false));
  document.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (
      !el('#navigation-panel').hidden &&
      !el('#navigation-panel').contains(target) &&
      !el('#tool-navigation').contains(target)
    )
      setNavigationPanel(false);
  });
  for (const tab of ['house', 'furniture'] as const) {
    const button = el(`#sidebar-${tab}-tab`);
    button.addEventListener('click', () => setSidebarTab(tab));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 'house'
          : event.key === 'End'
            ? 'furniture'
            : tab === 'house'
              ? 'furniture'
              : 'house';
      setSidebarTab(next, true);
    });
  }
  const responsiveSidebar = matchMedia('(min-width: 761px)');
  setSidebar(responsiveSidebar.matches);
  responsiveSidebar.addEventListener('change', () => setSidebar(responsiveSidebar.matches));
  el('#walk-speed').addEventListener('input', () => updateNavigationPreferences());
  el('#look-sensitivity').addEventListener('input', () => updateNavigationPreferences());
  el('#quality').addEventListener('change', () =>
    chooseQuality(el<HTMLSelectElement>('#quality').value),
  );
  el('#go-to').addEventListener('click', () => {
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) {
      setMode('walk');
      return;
    }
    const enabled = !el('#go-to').classList.contains('active');
    viewer.setGoToMode(enabled);
    activeButton('#go-to', enabled);
    syncDisplayControls();
    if (enabled) {
      setNavigationPanel(false);
      setSidebar(false);
      toast('Cliquez sur un point libre du sol pour y commencer la visite.');
    }
  });
  el<HTMLSelectElement>('#eye-height').addEventListener('change', (event) => {
    const height = viewer.setEyeHeight(Number((event.target as HTMLSelectElement).value));
    if (viewer.mode === 'walk')
      el('#view-subtitle').textContent = `Une visite à ${number(height)} m du sol.`;
  });
  el<HTMLSelectElement>('#wall-display').addEventListener('change', (event) =>
    viewer.setWallDisplay((event.target as HTMLSelectElement).value as WallDisplay),
  );
  const updateSection = () => {
    const enabled = el<HTMLInputElement>('#section-enable').checked,
      height = Number(el<HTMLInputElement>('#section-height').value);
    el<HTMLInputElement>('#section-height').disabled = !enabled;
    el('#section-value').textContent = `${number(height)} m`;
    viewer.setSectionHeight(enabled ? height : undefined);
  };
  el('#section-enable').addEventListener('change', updateSection);
  el('#section-height').addEventListener('input', updateSection);
}

/** Header, mode buttons, headset, project and level selection, export, import, removal. */
export function wireProjectControls() {
  const { viewer } = app;
  el('#toggle-sidebar').addEventListener('click', () =>
    setSidebar(el('#toggle-sidebar').getAttribute('aria-expanded') !== 'true'),
  );
  el('.sidebar-backdrop').addEventListener('click', () => {
    setSidebar(false);
    el('#toggle-sidebar').focus();
  });
  el('.brand').addEventListener('click', (event) => {
    event.preventDefault();
    setMode('overview');
    viewer.reset();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      setMode(b.dataset.view as ViewMode);
    }),
  );
  el('#enter-immersive').addEventListener('click', async () => {
    if (viewer.immersiveActive) {
      void viewer.exitImmersive();
      return;
    }
    if (viewer.mode !== 'walk' && !setMode('walk')) return;
    el('#walk-start').hidden = true;
    try {
      await viewer.enterImmersive();
    } catch (error) {
      console.info(
        `[casque] session refusée : ${error instanceof Error ? error.message : String(error)}`,
      );
      toast('Le casque n’a pas pu ouvrir la visite. Vérifiez qu’il est allumé et autorisé.');
    }
  });
  // Only a browser that can open a headset session shows the button. Asked again when a
  // headset connects or leaves: on a PC, Quest Link often starts after the page is open.
  const checkImmersive = () =>
    void isImmersiveSupported().then((supported) => {
      el('#enter-immersive').hidden = !supported;
      if (supported) void preloadImmersive().catch(() => undefined);
    });
  checkImmersive();
  navigator.xr?.addEventListener?.('devicechange', checkImmersive);
  el('#view-exterior').addEventListener('click', () => {
    if (!app.current.site) return;
    viewer.setExteriorView(true);
    viewer.canvas.focus({ preventScroll: true });
  });
  el<HTMLSelectElement>('#project-select').addEventListener('change', (event) =>
    loadProject((event.target as HTMLSelectElement).value),
  );
  el<HTMLSelectElement>('#level-select').addEventListener('change', (event) =>
    loadLevel((event.target as HTMLSelectElement).value),
  );
  el('#export-project').addEventListener('click', downloadProject);
  el('#copy-link').addEventListener('click', () => void copyShareLink());
  el('#adopt-received-project').addEventListener('click', () => {
    if (app.receivedShare) void adoptReceived(app.receivedShare.document);
  });
  el('#export-image').addEventListener('click', openImageExport);
  el('#tool-openings').addEventListener('click', openPlanOpenings);
  el('#divide-room').addEventListener('click', openRoomDivision);
  el('#draw-house').addEventListener('click', openWallDrawing);
  el('#create-house').addEventListener('click', openNewHouse);
  el('#import-project').addEventListener('click', () =>
    el<HTMLInputElement>('#import-file').click(),
  );
  el<HTMLInputElement>('#import-file').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.files?.[0]) void importProject(input.files[0]);
    input.value = '';
  });
  el('#remove-project').addEventListener('click', openRemoveProject);
}

/** Viewport toolbar, measurement, walk capture, help, welcome card and the info dialog. */
export function wireViewportControls() {
  const { viewer, display, measureBar } = app;
  el('#tool-reset').addEventListener('click', () => {
    viewer.reset();
    toast('Vue recentrée.');
  });
  el('#tool-labels').addEventListener('click', () => {
    display.labels = !display.labels;
    syncDisplayControls();
  });
  el('#tool-dimensions').addEventListener('click', () => {
    display.dimensions = !display.dimensions;
    activeButton('#tool-dimensions', display.dimensions);
    viewer.setDimensions(display.dimensions);
    el('#width-label').hidden = !display.dimensions;
    el('#depth-label').hidden = !display.dimensions;
  });
  el('#tool-circulation').addEventListener('click', () => {
    display.circulation = !display.circulation;
    activeButton('#tool-circulation', display.circulation);
    setFurnitureCirculation(display.circulation);
  });
  el('#tool-solar').addEventListener('click', () => app.solarPanel.open());
  el('#tool-lights').addEventListener('click', () => {
    display.lights = !display.lights;
    activeButton('#tool-lights', display.lights);
    viewer.setLights(display.lights);
  });
  const endMeasure = () => {
    viewer.setMeasureMode(false);
    syncDisplayControls();
  };
  measureBar.wire({
    onEnd: endMeasure,
    onClear: () => {
      if (viewer.clearPinnedMeasurements()) {
        toast('Mesures épinglées effacées.');
        return true;
      }
      return false;
    },
  });
  el('#tool-measure').addEventListener('click', () => {
    viewer.setMeasureMode(!viewer.measureMode);
    syncDisplayControls();
    measureBar.resetPrompt();
  });
  el('#mini-plan').addEventListener('click', () => setMode('plan'));
  el('#capture-mouse').addEventListener('click', () => {
    el('#walk-start').hidden = true;
    viewer.captureMouse();
  });
  el('#resume-walk').addEventListener('click', () => {
    viewer.captureMouse();
  });
  el('#help').addEventListener('click', openFirstSteps);
  el('#first-steps').addEventListener('click', openFirstSteps);
  el('#start-card').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-start-action]');
    if (!button) return;
    if (button.dataset.startAction === 'orbit') viewer.tourOrbit();
    else if (button.dataset.startAction === 'plan') setMode('plan');
    else if (button.dataset.startAction === 'walk') setMode('walk');
  });
  el('#close-start-card').addEventListener('click', dismissStartCard);
  el('#source-info').addEventListener('click', () => {
    openDialog('PLANS & PRÉCISION', sourceDialogHtml(app.current, viewer.level.rooms));
  });
  const dialog = el<HTMLDialogElement>('#info-dialog');
  el('#close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => viewer.setPaused(false));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (document.querySelector('dialog[open]')) return;
    if (event.code === 'Escape') setNavigationPanel(false);
    if (event.code === 'Escape' && viewer.measureMode) endMeasure();
    if (event.code === 'Escape' && el('.workspace').classList.contains('sidebar-open')) {
      setSidebar(false);
      el('#toggle-sidebar').focus();
    }
  });
}
