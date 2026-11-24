import {
  decodeShareLinkHash,
  encodeShareLinkHash,
  isOwnStaleHash,
  OWN_HASH_MEMORY_SIZE,
  samePackedState,
  type DecodedShareLink,
} from '../model/shareLink';
import { packShareDocument, type ShareDocument } from '../model/linkPacker';
import { confirmLinkDivergence } from '../ui/confirmLinkDivergence';
import { pauseForDialog, toast } from './dom';
import { app } from './state';
import {
  currentDocument,
  findProject,
  installProjectDocument,
  readProjectDocument,
  storedDocumentFor,
} from './projectLibrary';
import { loadProject } from './projectView';

/*
 * The #p1: hash. For an owned project it is rewritten (debounced) after every change, so the
 * URL is always a snapshot of the state; a received project's link stays the one that was
 * shared.
 */

let linkHashTimer: ReturnType<typeof setTimeout>;
let desiredLinkHash: string | undefined;
let linkHashPending = false;
let linkHashWriteScheduled = false;
// Set when the page is being left: a write finishing then would move the memory past the URL
// the reload was started with.
let leavingPage = false;
const LINK_HASH_DEBOUNCE = 500;
const LINK_HASH_MEMORY = 'maison-atelier:last-link-hash';
const LINK_HASH_EXIT = 'maison-atelier:exit-link-hash';

/** Hashes this tab published, oldest first (the memory once held a single hash). */
function publishedLinkHashes(): string[] {
  const raw = sessionStorage.getItem(LINK_HASH_MEMORY);
  if (raw === null) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (Array.isArray(list)) return list.filter((item) => typeof item === 'string');
  } catch {
    /* A bare hash from the single-hash memory. */
  }
  return [raw];
}

/* ---------------------------------------------------------------------------------------------- */
/* Writing the hash: the URL is a snapshot of the state, updated after every change               */
/* ---------------------------------------------------------------------------------------------- */

export function scheduleLinkHashUpdate() {
  clearTimeout(linkHashTimer);
  linkHashWriteScheduled = true;
  linkHashTimer = setTimeout(() => void writeLinkHash(), LINK_HASH_DEBOUNCE);
}

/**
 * Writes the current state into the hash via `history.replaceState` — never `location.hash`,
 * which would stack navigation history on every furniture move. A silent
 * replaceState failure (quota, sandbox) is retried on the next pointerup.
 */
async function writeLinkHash() {
  clearTimeout(linkHashTimer);
  linkHashWriteScheduled = false;
  if (app.readOnlyLink || !app.current) return;
  let hash: string;
  try {
    hash = await encodeShareLinkHash(currentDocument());
  } catch {
    return; // Incorruptible state: the JSON export stays the way out.
  }
  if (leavingPage) return;
  desiredLinkHash = hash;
  try {
    history.replaceState(null, '', hash);
  } catch {
    linkHashPending = true;
    return;
  }
  linkHashPending = false;
  // Memory written only once the URL is published: if replaceState fails or if the tab
  // disappears in between, the URL keeps an old hash and the memory must not run ahead of it,
  // otherwise a reload would take its own stale hash for a foreign link.
  try {
    const published = publishedLinkHashes().filter((item) => item !== hash);
    published.push(hash);
    sessionStorage.setItem(
      LINK_HASH_MEMORY,
      JSON.stringify(published.slice(-OWN_HASH_MEMORY_SIZE)),
    );
  } catch {
    /* Without this memory, a stale hash could be taken for an old link. */
  }
}

/**
 * When leaving the page, a pending hash write will never go out (deflate is
 * asynchronous): the URL left in place would describe a stale state, and a reload would
 * take it for an old link. The hash is removed synchronously — an owned project's state
 * lives in local storage, and the next change will rewrite the hash.
 */
export function wireLinkHashFlush() {
  const dropStaleHash = () => {
    if (app.readOnlyLink || !app.current || !linkHashWriteScheduled) return;
    linkHashWriteScheduled = false;
    desiredLinkHash = undefined;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* The stale hash stays: with no follow-up, it is only ever read back on load. */
    }
  };
  window.addEventListener('pagehide', () => {
    dropStaleHash();
    leavingPage = true;
    // The hash shown when leaving tells a reload overtaken by a write from a deliberate
    // return to an older link (see `isOwnStaleHash`).
    try {
      sessionStorage.setItem(LINK_HASH_EXIT, location.hash);
    } catch {
      /* Without it, an older own hash counts as the tab's own. */
    }
  });
  window.addEventListener('pageshow', () => {
    leavingPage = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') dropStaleHash();
  });
  window.addEventListener('pointerup', () => {
    if (!app.current || app.readOnlyLink) return;
    if (!linkHashPending && desiredLinkHash === location.hash) return;
    void writeLinkHash();
  });
}

export async function copyShareLink() {
  clearTimeout(linkHashTimer);
  const message = 'Lien copié : il contient une photographie de l’état actuel du projet.';
  try {
    await writeLinkHash();
    await navigator.clipboard.writeText(location.href);
    toast(message);
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = location.href;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast(message);
    } catch {
      toast('Copie impossible : copiez l’adresse depuis la barre d’adresse du navigateur.');
    }
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Reading a share link: owner (comparison) or recipient (read-only)                              */
/* ---------------------------------------------------------------------------------------------- */

/**
 * A #p1: link opened at start-up. For the project's owner: identical = silence,
 * different = three outcomes (replace, keep both, ignore) — never a silent
 * loss. For a visitor: the project lives in memory only, read-only,
 * until « Ajouter à mes projets ».
 */
export async function openSharedLink(fallbackId: string) {
  // Tab resume: a hash write interrupted or overtaken by a reload leaves a stale hash in
  // the URL. If this tab published it, it is not a shareable link: the (more recent)
  // local state is loaded without a dialog.
  let ownStale = false;
  try {
    const exitHash = sessionStorage.getItem(LINK_HASH_EXIT);
    sessionStorage.removeItem(LINK_HASH_EXIT);
    ownStale = isOwnStaleHash(location.hash, publishedLinkHashes(), exitHash);
  } catch {
    /* Without memory, the dialog will judge normally. */
  }
  if (ownStale) {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* No consequence: once reloaded, the hash will be recognised again. */
    }
    loadProject(fallbackId);
    return;
  }
  let link: DecodedShareLink;
  try {
    link = await decodeShareLinkHash(location.hash);
  } catch {
    loadProject(fallbackId);
    toast('Lien illisible : le projet enregistré sur cet ordinateur est chargé.');
    return;
  }
  const existing = findProject(link.document.id);
  if (!existing) {
    openReceivedShare(link, fallbackId);
    return;
  }
  const identical = samePackedState(packShareDocument(storedDocumentFor(existing)), link.packed);
  loadProject(existing.id);
  if (identical) return;
  const choice = await confirmLinkDivergence(existing.name, pauseForDialog);
  if (choice === 'replace') {
    if (await installProjectDocument(readProjectDocument(link.document), { confirmed: true }))
      toast('Projet remplacé par la version du lien.');
  } else if (choice === 'copy') {
    await adoptReceived(link.document);
  }
  // 'ignore': the local project stays displayed; the hash will catch up with the current state.
}

/** The link's project does not exist here: opened in memory only, without touching localStorage. */
function openReceivedShare(link: DecodedShareLink, fallbackId: string) {
  try {
    const { project, staged, variants } = readProjectDocument(link.document);
    const levelIds = project.levels.map((level) => level.id);
    app.layoutSession.register(project.id, levelIds);
    const nextVariants = app.layoutSession.prepareImport(project.id, levelIds, staged, variants);
    app.layoutSession.install(project.id, nextVariants);
    app.receivedShare = link;
    loadProject(project.id, undefined, project);
  } catch (error) {
    loadProject(fallbackId);
    toast(
      error instanceof Error
        ? error.message
        : 'Lien illisible : le projet enregistré sur cet ordinateur est chargé.',
    );
  }
}

/** « Ajouter à mes projets »: copy of the received project under a new identifier, then normal installation. */
export async function adoptReceived(source: ShareDocument) {
  const fork: ShareDocument = {
    ...source,
    id: `${source.id}-${crypto.randomUUID().slice(0, 8)}`,
  };
  if (await installProjectDocument(readProjectDocument(fork))) {
    // The shared link must no longer survive a reload: it is removed right
    // away, the deferred write will re-record the owned project's state.
    history.replaceState(null, '', location.pathname + location.search);
    toast('Projet ajouté à vos projets : il est maintenant modifiable.');
  }
}
