/**
 * Reading the local storage of imported projects.
 *
 * Local storage is the only copy of the house until the user has exported it:
 * whatever the build cannot read back (stricter validator, older version, truncated JSON)
 * is quarantined in a separate key that no write touches any more.
 */
import type { HouseProject } from './model/types';

export const QUARANTINE_SUFFIX = ':quarantine';
export const MAX_IMPORTED_PROJECTS = 10;

export interface RestoredProjects {
  projects: HouseProject[];
  /** Entries kept in quarantine after this read (older ones included). */
  quarantined: number;
  /** Entries not restored this time. */
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
            /* quarantined below */
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
      /* Full storage must not prevent opening; the original key stays intact. */
    }
  }
  return { projects, quarantined: merged.length, unreadable: rejected.length };
}

/** Content of the rescue file: entries readable as JSON, the others as raw text. */
export function quarantineExport(storage: Storage, key: string): string {
  const entries = readQuarantine(storage, key).map((entry) => {
    try {
      return JSON.parse(entry) as unknown;
    } catch {
      return entry;
    }
  });
  return JSON.stringify(entries, null, 2);
}
