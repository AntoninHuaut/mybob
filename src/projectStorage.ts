/**
 * Lecture du stockage local des projets importés.
 *
 * Le stockage local est la seule copie de la maison tant que l'utilisateur n'a pas exporté :
 * ce que le build ne sait pas relire (validateur plus strict, version antérieure, JSON tronqué)
 * est mis en quarantaine dans une clé séparée que plus aucune écriture ne touche.
 */
import type { HouseProject } from './model/types';

export const QUARANTINE_SUFFIX = ':quarantine';
export const MAX_IMPORTED_PROJECTS = 10;

export interface RestoredProjects {
  projects: HouseProject[];
  /** Entrées conservées en quarantaine après cette lecture (anciennes comprises). */
  quarantined: number;
  /** Entrées non restaurées cette fois-ci. */
  unreadable: number;
}

function readQuarantine(storage: Storage, key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key + QUARANTINE_SUFFIX) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

export function quarantinedEntries(storage: Storage, key: string): string[] {
  return readQuarantine(storage, key);
}

export function restoreProjects(
  storage: Storage,
  key: string,
  validate: (value: unknown) => HouseProject,
): RestoredProjects {
  const raw = storage.getItem(key);
  const projects: HouseProject[] = [];
  const rejected: string[] = [];
  if (raw !== null) {
    let saved: unknown;
    try {
      saved = JSON.parse(raw);
    } catch {
      rejected.push(raw);
    }
    if (Array.isArray(saved)) {
      saved.forEach((entry, index) => {
        if (index < MAX_IMPORTED_PROJECTS) {
          try {
            projects.push(validate(entry));
            return;
          } catch {
            /* mis en quarantaine ci-dessous */
          }
        }
        rejected.push(JSON.stringify(entry));
      });
    } else if (saved !== undefined) rejected.push(raw);
  }
  const quarantine = readQuarantine(storage, key);
  const merged = [...quarantine, ...rejected.filter((entry) => !quarantine.includes(entry))];
  if (merged.length !== quarantine.length) {
    try {
      storage.setItem(key + QUARANTINE_SUFFIX, JSON.stringify(merged));
    } catch {
      /* Le stockage plein ne doit pas empêcher l'ouverture ; la clé d'origine reste intacte. */
    }
  }
  return { projects, quarantined: merged.length, unreadable: rejected.length };
}
