import type { PlanPhotoAdjustments } from './planPhoto';

/** Image d'un plan importée : conservée dans ce navigateur, jamais envoyée. */
export interface StoredPlanPhoto {
  blob: Blob;
  adjustments: PlanPhotoAdjustments;
  /** Millisecondes de l'import. */
  savedAt: number;
}

const DB_NAME = 'maison-atelier:plan-photo';
const STORE = 'overlays';
const VERSION = 1;

export const planPhotoKey = (projectId: string, levelId: string) => `${projectId}::${levelId}`;

function open(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(undefined);
    try {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** undefined quand la photo n'existe pas ou qu'IndexedDB est indisponible. */
export async function loadPlanPhoto(key: string): Promise<StoredPlanPhoto | undefined> {
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as StoredPlanPhoto | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** false quand l'écriture a échoué : l'image reste affichée mais non persistée. */
export async function savePlanPhoto(key: string, photo: StoredPlanPhoto): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(photo, key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function deletePlanPhoto(key: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
