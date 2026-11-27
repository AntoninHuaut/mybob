import { userMessage } from '../errorMessage';
import type { HouseProject } from '../model/types';
import { validateProject } from '../model/validate';
import type { ShareDocument } from '../model/linkPacker';
import { quarantineExport, restoreProjects } from '../projectStorage';
import { escapeHtml as esc } from '../ui/format';
import { icon } from '../ui/icons';
import { confirmImportReplacement } from '../ui/confirmImport';
import { chooseProjectToReplace } from '../ui/chooseProjectToReplace';
import { STALE_MESSAGE, variantsStorageKey } from '../furniture/variants';
import { layoutStorageKey, validateFurnitureList, type FurnitureItem } from '../furniture/model';
import { closeDialog, downloadText, el, openDialog, pauseForDialog, toast } from './dom';
import { app, MAX_IMPORTED, STORAGE } from './state';
import { clearProjectHistories, committedFurniture, setLayoutStatus } from './furnitureController';
import { loadProject } from './projectView';
import { paintedProject, paintStorageKey } from './roomPaint';

/*
 * The project list: bundled projects, projects imported into this browser (localStorage), and
 * the documents that move a project in or out — JSON export, import and link installation.
 */

/** Bundled projects, then imported ones; an import with a bundled identifier replaces it. */
let projects: HouseProject[] = [];
let imported: HouseProject[] = [];
let builtins: HouseProject[] = [];
/** The project list as last read or written by this tab, to detect another tab's write. */
let projectsRaw: string | null = null;
let projectsStale = false;

export function findProject(id: string) {
  return projects.find((project) => project.id === id);
}

/** The project to show when the requested one is gone. */
export function firstProject(): HouseProject | undefined {
  return projects[0];
}

export function isImported(id: string) {
  return imported.some((project) => project.id === id);
}

/**
 * Start-up: the bundled projects, then the ones this browser kept. Returns how many stored
 * projects could not be read (kept aside, exportable from a banner).
 */
export function restoreLibrary(bundled: HouseProject[]): number {
  builtins = bundled;
  projectsRaw = localStorage.getItem(STORAGE);
  const restored = restoreProjects(localStorage, STORAGE, validateProject);
  imported.push(...restored.projects);
  return restored.unreadable;
}

export function renderProjectOptions() {
  const importedIds = new Set(imported.map((p) => p.id));
  projects = [...builtins.filter((p) => !importedIds.has(p.id)), ...imported];
  el<HTMLSelectElement>('#project-select').innerHTML = projects
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join('');
}

/* ---------------------------------------------------------------------------------------------- */
/* Several tabs                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/** Another tab has written: this tab no longer saves anything until it is reloaded. */
function showStaleBanner() {
  if (document.querySelector('#stale-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'stale-banner';
  banner.className = 'stale-banner';
  banner.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = 'Ce projet a été modifié dans un autre onglet. Rechargez avant de continuer.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'text-button';
  reload.textContent = 'Recharger';
  reload.addEventListener('click', () => location.reload());
  banner.append(text, reload);
  document.body.prepend(banner);
  setLayoutStatus('Modifié dans un autre onglet · rechargez la page', true);
}

/** Watches other tabs' writes to the project list and to the displayed project's variants. */
export function wireProjectStorageWatch() {
  app.layoutSession.onStale = showStaleBanner;
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return;
    if (event.key === null || event.key === variantsStorageKey(app.current.id))
      app.layoutSession.markStale(app.current.id);
    else if (event.key === STORAGE) projectsStale = true;
    if (projectsStale) showStaleBanner();
  });
}

/** Some local projects could not be opened: they are kept, and exportable in one click. */
export function showQuarantineBanner(count: number) {
  const banner = document.createElement('div');
  banner.id = 'quarantine-banner';
  banner.className = 'stale-banner';
  banner.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent =
    count === 1
      ? '1 projet local n’a pas pu être ouvert. Il est conservé : exportez-le pour le récupérer.'
      : `${count} projets locaux n’ont pas pu être ouverts. Ils sont conservés : exportez-les pour les récupérer.`;
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'text-button';
  download.textContent = 'Télécharger';
  download.addEventListener('click', () =>
    downloadText('projets-non-restaures.json', quarantineExport(localStorage, STORAGE)),
  );
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'text-button';
  close.textContent = 'Fermer';
  close.addEventListener('click', () => banner.remove());
  banner.append(text, download, close);
  document.body.prepend(banner);
}

/** Refuses to overwrite the project list if another tab rewrote it since our read. */
function assertProjectsUnchanged() {
  if (projectsStale || localStorage.getItem(STORAGE) !== projectsRaw) {
    projectsStale = true;
    showStaleBanner();
    throw new Error(STALE_MESSAGE);
  }
}

/** Saves a geometry edit while leaving independently stored layouts and finishes intact. */
export function savePlanProject(before: HouseProject, after: HouseProject) {
  assertProjectsUnchanged();
  if (app.readOnlyLink || before.id !== app.current.id || !imported.includes(before))
    throw new Error('Le projet a changé. Rouvrez le plan.');
  validateProject(after);
  const previous = imported;
  const next = imported.map((project) => (project === before ? after : project));
  const levelId = app.viewer.level.id;
  const view = app.viewer.planView();
  writeProjects(next);
  imported = next;
  try {
    renderProjectOptions();
    loadProject(after.id, levelId, undefined, { mode: 'plan', exterior: false });
    if (view) app.viewer.restorePlanView(view);
  } catch (error) {
    writeProjects(previous);
    imported = previous;
    renderProjectOptions();
    loadProject(before.id, levelId, undefined, { mode: 'plan', exterior: false });
    throw error;
  }
}

function writeProjects(list: HouseProject[]) {
  const text = JSON.stringify(list);
  localStorage.setItem(STORAGE, text);
  projectsRaw = text;
}

/* ---------------------------------------------------------------------------------------------- */
/* Documents: export, import, installation                                                        */
/* ---------------------------------------------------------------------------------------------- */

/**
 * The current state document, in the shape of a complete export: project, effective
 * arrangement of every level and all the variants. It is what the link carries and
 * what « Exporter » downloads — never the camera nor the navigation preferences.
 */
export function currentDocument(): ShareDocument {
  const { current, viewer, layoutSession } = app;
  return {
    ...current,
    solar: app.solarPanel.settings,
    furnishing: {
      version: 1,
      levels: Object.fromEntries(
        current.levels.map((level) => [
          level.id,
          level.id === viewer.level.id
            ? committedFurniture()
            : layoutSession.load(current.id, level.id),
        ]),
      ),
      variants: layoutSession.book(current.id),
    },
  };
}

/** The saved state of an owned project, without going through the view: basis of the start-up comparison. */
export function storedDocumentFor(stored: HouseProject): ShareDocument {
  const { layoutSession, solarPanel } = app;
  const project = paintedProject(stored);
  try {
    layoutSession.register(
      project.id,
      project.levels.map((level) => level.id),
    );
    return {
      ...project,
      solar: solarPanel.settingsFor(project),
      furnishing: {
        version: 1,
        levels: Object.fromEntries(
          project.levels.map((level) => [level.id, layoutSession.load(project.id, level.id)]),
        ),
        variants: layoutSession.book(project.id),
      },
    };
  } catch {
    // Unreadable arrangement: the comparison will be on the project alone, the link
    // will be declared divergent rather than silently accepted.
    return { ...project, solar: solarPanel.settingsFor(project) };
  }
}

export function downloadProject() {
  let snapshot: ShareDocument;
  try {
    snapshot = currentDocument();
  } catch (error) {
    toast(userMessage(error, 'Export indisponible.'));
    return;
  }
  downloadText(
    `${app.current.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.json`,
    JSON.stringify(snapshot, null, 2),
  );
  toast('Les données de votre maison ont été exportées.');
}

type ProjectDocument = {
  project: HouseProject;
  staged: [string, FurnitureItem[]][];
  variants: unknown;
};

/**
 * Validates a complete export project (file or link) and separates the arrangement awaiting
 * installation. Does not modify the received object: a link's document stays intact for
 * a later adoption.
 */
export function readProjectDocument(input: unknown): ProjectDocument {
  const project = validateProject(structuredClone(input)) as HouseProject & {
    furnishing?: { version: number; levels: Record<string, unknown>; variants?: unknown };
  };
  const furnishing = project.furnishing;
  const staged: [string, FurnitureItem[]][] = [];
  if (furnishing !== undefined) {
    if (
      !furnishing ||
      furnishing.version !== 1 ||
      !furnishing.levels ||
      typeof furnishing.levels !== 'object' ||
      Array.isArray(furnishing.levels)
    )
      throw new Error('Aménagement exporté invalide.');
    for (const level of project.levels)
      if (Object.hasOwn(furnishing.levels, level.id))
        staged.push([level.id, validateFurnitureList(furnishing.levels[level.id])]);
  }
  const variants = furnishing?.variants;
  delete project.furnishing;
  return { project, staged, variants };
}

/** Every localStorage key a project owns besides its entry in the project list. */
function projectStorageKeys(project: HouseProject) {
  return [
    variantsStorageKey(project.id),
    `maison-atelier:solar:${project.id}`,
    paintStorageKey(project.id),
    ...project.levels.map((level) => layoutStorageKey(project.id, level.id)),
  ];
}

function purgeProjectData(project: HouseProject) {
  for (const key of projectStorageKeys(project)) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Orphan data with no consequence: the project is no longer listed. */
    }
  }
  app.layoutSession.forgetProject(project.id);
  clearProjectHistories(project.id);
}

/**
 * Installs a validated project in this browser: local save, variants, then
 * loading. `confirmed` skips the replacement prompt (choice already made
 * by the divergence dialog or the adoption of a received project). Falls back to the
 * previous state if display fails.
 */
export async function installProjectDocument(
  incoming: ProjectDocument,
  options: { confirmed?: boolean } = {},
): Promise<boolean> {
  const { layoutSession } = app;
  const { project, staged, variants } = incoming;
  const existing = findProject(project.id);
  if (existing)
    layoutSession.register(
      existing.id,
      existing.levels.map((level) => level.id),
    );
  const previousVariantEntry = layoutSession.capture(project.id);
  const nextVariants = layoutSession.prepareImport(
    project.id,
    project.levels.map((level) => level.id),
    staged,
    variants,
  );
  if (
    existing &&
    !(options.confirmed
      ? true
      : await confirmImportReplacement(
          existing.name,
          pauseForDialog,
          app.current.id === existing.id ? downloadProject : undefined,
        ))
  )
    return false;
  const previous = imported;
  const previousProjectId = app.current.id;
  const previousLevelId = app.viewer.level.id;
  let next = [...imported.filter((p) => p.id !== project.id), project];
  let replaced: HouseProject | undefined;
  if (next.length > MAX_IMPORTED) {
    // Limit reached: offer to replace a project rather than failing. Nothing is
    // deleted before the new one has been installed successfully.
    const choice = await chooseProjectToReplace(
      imported.filter((p) => p.id !== project.id).map(({ id, name }) => ({ id, name })),
      MAX_IMPORTED,
      pauseForDialog,
    );
    replaced = imported.find((p) => p.id === choice);
    if (!replaced) return false;
    next = [...imported.filter((p) => p.id !== project.id && p.id !== replaced!.id), project];
  }
  assertProjectsUnchanged();
  const backups = [
    [variantsStorageKey(project.id), localStorage.getItem(variantsStorageKey(project.id))],
    [paintStorageKey(project.id), localStorage.getItem(paintStorageKey(project.id))],
  ] as const;
  try {
    localStorage.setItem(variantsStorageKey(project.id), JSON.stringify(nextVariants));
    // The document carries its rooms' paint: earlier local choices would override it.
    localStorage.removeItem(paintStorageKey(project.id));
    writeProjects(next);
  } catch {
    for (const [key, value] of backups) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    throw new Error(
      'La mémoire locale est indisponible ou pleine. Exportez vos projets avant de libérer de la place.',
    );
  }
  imported = next;
  layoutSession.install(project.id, nextVariants);
  clearProjectHistories(project.id);
  try {
    renderProjectOptions();
    loadProject(project.id);
  } catch (error) {
    imported = previous;
    layoutSession.restore(project.id, previousVariantEntry);
    for (const [key, value] of backups) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    writeProjects(previous);
    renderProjectOptions();
    loadProject(previousProjectId, previousLevelId);
    throw error;
  }
  if (replaced) purgeProjectData(replaced);
  return true;
}

export async function importProject(file: File) {
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('Le projet doit peser moins de 32 Mo.');
    const parsed = readProjectDocument(JSON.parse(await file.text()));
    if (await installProjectDocument(parsed))
      toast('Maison importée et conservée dans ce navigateur.');
  } catch (error) {
    toast(userMessage(error, 'Impossible de lire ce projet.'));
  }
}

/** « Supprimer »: an imported project and its arrangements leave this browser, after confirmation. */
export function openRemoveProject() {
  const project = imported.find((project) => project.id === app.current.id);
  if (!project) return;
  openDialog(
    'SUPPRIMER CE PROJET',
    `<h2>Supprimer « ${esc(project.name)} » ?</h2><p>Ce projet et les aménagements de ses niveaux seront supprimés de cet ordinateur. Exportez une copie pour les conserver.</p><div class="dialog-actions"><button type="button" class="text-button dialog-actions-start" id="export-before-delete">${icon('export', 17)} Exporter une copie</button><button type="button" class="text-button" id="cancel-delete-project">Annuler</button><button type="button" class="danger-button" id="confirm-delete-project">Supprimer le projet</button></div>`,
  );
  el('#export-before-delete').addEventListener('click', downloadProject);
  el('#cancel-delete-project').addEventListener('click', closeDialog);
  el('#confirm-delete-project').addEventListener('click', () => {
    const next = imported.filter((candidate) => candidate.id !== project.id);
    const keys = [STORAGE, ...projectStorageKeys(project)];
    let backups: [string, string | null][] = [];
    try {
      assertProjectsUnchanged();
      backups = keys.map((key) => [key, localStorage.getItem(key)]);
      writeProjects(next);
      for (const key of keys.slice(1)) localStorage.removeItem(key);
    } catch {
      for (const [key, value] of backups) {
        try {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        } catch {
          /* Keep reporting the failed operation if storage remains unavailable. */
        }
      }
      toast(
        'Suppression impossible : la mémoire locale est indisponible. Votre projet reste ouvert.',
      );
      return;
    }
    imported = next;
    app.layoutSession.forgetProject(project.id);
    clearProjectHistories(project.id);
    closeDialog();
    renderProjectOptions();
    try {
      loadProject(projects[0].id);
      toast('Projet et aménagements supprimés de cet ordinateur.');
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : 'Le projet a été supprimé, mais la vue suivante n’a pas pu être chargée.',
      );
    }
  });
}
