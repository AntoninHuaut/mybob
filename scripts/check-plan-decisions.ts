import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HouseProject, Level } from '../src/model/types';

const OFFSET_TOL = 0.01; // m, écart accepté entre l'offset du projet et le cumul de chaîne
const PERPENDICULAR_TOL = 0.5; // pt, appariement d'une ligne de cote
const CLASSES = ['printed', 'derived', 'scaled', 'assumed'] as const;

export type EvidenceClass = (typeof CLASSES)[number];

export interface RegistrySegment {
  text: string;
  kind: string;
  value: number;
  at: [number, number];
}

export interface RegistryChain {
  page: number;
  axis: 'horizontal' | 'vertical';
  perpendicular: number;
  segments: RegistrySegment[];
  sum: number;
  declaredTotal: { text: string; value: number; at: [number, number] } | null;
  residual: number | null;
  closed: boolean;
}

/** Couche 1 : registre produit par `scripts/extract_plan_evidence.py`. */
export interface EvidenceRegistry {
  schemaVersion: number;
  source: { file: string; sha256: string; pageCount: number };
  pages: { index: number; chains: RegistryChain[] }[];
}

export interface ChainRef {
  page: number;
  axis: 'horizontal' | 'vertical';
  perpendicular: number;
}

export interface Decision {
  id: string;
  wall: string;
  evidence: {
    class: EvidenceClass;
    chain?: ChainRef;
    segmentIndex?: number;
    /** Position imprimée du repère, cumulée depuis l'origine de la chaîne. */
    cumulativeOffset?: number;
    /** Position de l'origine du mur dans la chaîne ; sans elle l'offset n'est pas vérifiable. */
    wallOrigin?: number;
    equation?: string;
    note?: string;
  };
  unresolved: boolean;
  reason?: string;
}

/** Couche 2 : une décision par face de mur et par ouverture. */
export interface DecisionsFile {
  schemaVersion: number;
  project: string;
  level: string;
  registry: string;
  faces: Decision[];
  openings: Decision[];
}

export interface DecisionReport {
  project: string;
  level: string;
  faces: { total: number; byClass: Record<string, number>; unresolved: string[] };
  openings: { total: number; byClass: Record<string, number>; unresolved: string[] };
  errors: string[];
  warnings: string[];
  /** Vrai seulement si aucune erreur et aucune décision non résolue. */
  ready: boolean;
}

function findChain(registry: EvidenceRegistry, ref: ChainRef): RegistryChain | null {
  const page = registry.pages.find((candidate) => candidate.index === ref.page);
  if (!page) return null;
  return (
    page.chains.find(
      (chain) =>
        chain.axis === ref.axis &&
        Math.abs(chain.perpendicular - ref.perpendicular) <= PERPENDICULAR_TOL,
    ) ?? null
  );
}

/** Somme des segments imprimés avant `segmentIndex` : position cumulée le long de la chaîne. */
export function cumulativeOffset(chain: RegistryChain, segmentIndex: number): number {
  return chain.segments.slice(0, segmentIndex).reduce((total, segment) => total + segment.value, 0);
}

function checkDecision(
  decision: Decision,
  kind: 'face' | 'opening',
  registry: EvidenceRegistry,
  errors: string[],
  warnings: string[],
): void {
  const where = `${kind} ${decision.id || '(sans id)'}`;
  if (!decision.id) errors.push(`${where}: identifiant manquant`);
  if (!decision.wall) errors.push(`${where}: mur de rattachement manquant`);
  if (typeof decision.unresolved !== 'boolean')
    errors.push(`${where}: drapeau unresolved manquant`);
  if (!CLASSES.includes(decision.evidence?.class)) {
    errors.push(`${where}: classe de preuve invalide (${String(decision.evidence?.class)})`);
    return;
  }
  if (decision.evidence.class === 'assumed') {
    warnings.push(`${where}: preuve supposée, à confirmer par une cote ou un relevé`);
  }
  if (decision.unresolved && !decision.reason) {
    errors.push(`${where}: unresolved sans motif`);
  }
  const ref = decision.evidence.chain;
  if (!ref) {
    if (decision.evidence.class === 'printed') {
      errors.push(`${where}: preuve imprimée sans référence de chaîne`);
    }
    return;
  }
  const chain = findChain(registry, ref);
  if (!chain) {
    errors.push(
      `${where}: chaîne introuvable (page ${ref.page}, ${ref.axis}, perpendiculaire ${ref.perpendicular})`,
    );
    return;
  }
  if (kind === 'face' && !chain.closed) {
    errors.push(
      `${where}: la chaîne référencée ne se referme pas (résidu ${String(chain.residual)})`,
    );
  }
  if (decision.evidence.segmentIndex === undefined) return;
  const index = decision.evidence.segmentIndex;
  if (!Number.isInteger(index) || index < 0 || index >= chain.segments.length) {
    errors.push(
      `${where}: segmentIndex ${index} hors de la chaîne (${chain.segments.length} segments)`,
    );
    return;
  }
  const expected = cumulativeOffset(chain, index);
  if (
    decision.evidence.cumulativeOffset !== undefined &&
    Math.abs(decision.evidence.cumulativeOffset - expected) > OFFSET_TOL
  ) {
    errors.push(
      `${where}: cumul déclaré ${decision.evidence.cumulativeOffset} ≠ cumul imprimé ${expected.toFixed(3)}`,
    );
  }
}

function checkCoverage(
  decisions: Decision[],
  expected: { id: string; offset?: number }[],
  kind: 'face' | 'opening',
  registry: EvidenceRegistry,
  errors: string[],
  warnings: string[],
): void {
  for (const item of expected) {
    const matches = decisions.filter((decision) => decision.id === item.id);
    if (matches.length === 0) {
      errors.push(`${kind} ${item.id}: aucune décision`);
      continue;
    }
    if (matches.length > 1)
      errors.push(`${kind} ${item.id}: ${matches.length} décisions concurrentes`);
    const decision = matches[0];
    if (kind !== 'opening' || item.offset === undefined) continue;
    const ref = decision.evidence.chain;
    if (!ref || decision.evidence.segmentIndex === undefined) continue;
    const chain = findChain(registry, ref);
    if (!chain) continue;
    const printed = cumulativeOffset(chain, decision.evidence.segmentIndex);
    if (decision.evidence.wallOrigin === undefined) {
      warnings.push(
        `${kind} ${item.id}: origine du mur non déclarée, offset ${item.offset} non vérifiable ` +
          `(repère imprimé à ${printed.toFixed(3)} sur la chaîne page ${ref.page})`,
      );
      continue;
    }
    const expectedOffset = printed - decision.evidence.wallOrigin;
    if (Math.abs(expectedOffset - item.offset) > OFFSET_TOL) {
      errors.push(
        `${kind} ${item.id}: offset projet ${item.offset} ≠ ${expectedOffset.toFixed(3)} ` +
          `(repère imprimé ${printed.toFixed(3)} − origine ${decision.evidence.wallOrigin})`,
      );
    }
  }
}

function tally(decisions: Decision[]) {
  const byClass: Record<string, number> = {};
  const unresolved: string[] = [];
  for (const decision of decisions) {
    const label = decision.evidence?.class ?? 'inconnue';
    byClass[label] = (byClass[label] ?? 0) + 1;
    if (decision.unresolved)
      unresolved.push(`${decision.id}${decision.reason ? ` (${decision.reason})` : ''}`);
  }
  return { total: decisions.length, byClass, unresolved };
}

/**
 * Vérifie le fichier de décisions contre le registre d'évidence et le projet.
 * La construction ne démarre que si `ready` est vrai : aucune erreur, aucune
 * décision non résolue, et chaque ouverture recalculée depuis sa chaîne.
 */
export function checkDecisions(
  decisions: DecisionsFile,
  registry: EvidenceRegistry,
  project: HouseProject,
): DecisionReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (decisions.schemaVersion !== 1)
    errors.push(`schemaVersion inattendu : ${decisions.schemaVersion}`);
  if (registry.schemaVersion !== 1)
    errors.push(`registre : schemaVersion inattendu : ${registry.schemaVersion}`);
  if (decisions.project !== project.id) {
    errors.push(`projet ${decisions.project} ≠ projet importé ${project.id}`);
  }
  const level: Level | undefined = project.levels.find(
    (candidate) => candidate.id === decisions.level,
  );
  if (!level) {
    errors.push(`niveau ${decisions.level} absent du projet`);
    return {
      project: decisions.project,
      level: decisions.level,
      faces: tally(decisions.faces ?? []),
      openings: tally(decisions.openings ?? []),
      errors,
      warnings,
      ready: false,
    };
  }
  const faces = decisions.faces ?? [];
  const openings = decisions.openings ?? [];
  for (const decision of faces) checkDecision(decision, 'face', registry, errors, warnings);
  for (const decision of openings) checkDecision(decision, 'opening', registry, errors, warnings);
  checkCoverage(
    faces,
    level.walls.map((wall) => ({ id: wall.id })),
    'face',
    registry,
    errors,
    warnings,
  );
  checkCoverage(
    openings,
    level.walls.flatMap((wall) =>
      (wall.openings ?? []).map((opening) => ({ id: opening.id, offset: opening.offset })),
    ),
    'opening',
    registry,
    errors,
    warnings,
  );
  const faceTally = tally(faces);
  const openingTally = tally(openings);
  return {
    project: decisions.project,
    level: decisions.level,
    faces: faceTally,
    openings: openingTally,
    errors,
    warnings,
    ready:
      errors.length === 0 &&
      faceTally.unresolved.length === 0 &&
      openingTally.unresolved.length === 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [decisionsPath, projectPath, registryPath] = process.argv.slice(2);
    if (!decisionsPath || !projectPath || !registryPath) {
      throw new Error(
        'Usage: node --import tsx scripts/check-plan-decisions.ts decisions.json project.json registry.json',
      );
    }
    const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
    const report = checkDecisions(
      await read(decisionsPath),
      await read(registryPath),
      await read(projectPath),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
