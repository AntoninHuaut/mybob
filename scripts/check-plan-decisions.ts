import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { wallLength } from '../src/model/geometry';
import type { HouseProject, Level, Opening, Wall } from '../src/model/types';

const OFFSET_TOL = 0.01; // m, écart accepté entre l'offset du projet et le cumul de chaîne
const LENGTH_TOL = 0.01; // m, écart accepté sur une longueur ou une cote
const PERPENDICULAR_TOL = 0.5; // pt, appariement d'une ligne de cote
const CLASSES = ['printed', 'printed-partial', 'derived', 'scaled', 'assumed'] as const;
const CONVENTIONS = ['both', 'width', 'height'] as const;
const OPENING_TEXT = /^(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/;

export type EvidenceClass = (typeof CLASSES)[number];
export type OpeningConvention = (typeof CONVENTIONS)[number];

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

export interface EnvelopeFrame {
  page: number;
  axis: 'horizontal' | 'vertical';
  perpendicular: number;
  base: number;
  sign: 1 | -1;
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
    /** Suite contiguë de segments imprimés qui porte la cote. */
    span?: { start: number; end: number };
    /** Somme imprimée de la suite, en mètres. */
    length?: number;
    /** Décalage de la première face du mur par rapport à son axe. */
    startOffset?: number;
    /** Décalage de la dernière face du mur par rapport à son axe. */
    endOffset?: number;
    segmentIndex?: number;
    /** Position imprimée du repère, cumulée depuis l'origine de la chaîne. */
    cumulativeOffset?: number;
    /** Position de l'origine du mur dans la chaîne ; sans elle l'offset n'est pas vérifiable. */
    wallOrigin?: number;
    printedWidth?: number;
    printedHeight?: number;
    convention?: OpeningConvention;
    /** Ce qui rattache la cote au mur : ses propres baies, ou une chaîne calée sur l'emprise. */
    anchor?: 'openings' | 'envelope';
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
  /** Pages du registre qui portent ce niveau ; une cote d'un autre niveau ne prouve rien. */
  pages?: number[];
  /** Chaînes refermées calées sur l'emprise, avec leur origine et leur sens de lecture. */
  envelopes?: EnvelopeFrame[];
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

function metres(token: string): number {
  return /[.,]/.test(token) ? Number(token.replace(',', '.')) : Number(token) / 100;
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

function checkCommon(
  decision: Decision,
  kind: 'face' | 'opening',
  errors: string[],
  warnings: string[],
): boolean {
  const where = `${kind} ${decision.id || '(sans id)'}`;
  if (!decision.id) errors.push(`${where}: identifiant manquant`);
  if (!decision.wall) errors.push(`${where}: mur de rattachement manquant`);
  if (typeof decision.unresolved !== 'boolean')
    errors.push(`${where}: drapeau unresolved manquant`);
  if (!CLASSES.includes(decision.evidence?.class)) {
    errors.push(`${where}: classe de preuve invalide (${String(decision.evidence?.class)})`);
    return false;
  }
  if (decision.evidence.class === 'assumed') {
    warnings.push(`${where}: preuve supposée, à confirmer par une cote ou un relevé`);
  }
  if (decision.unresolved && !decision.reason) {
    errors.push(`${where}: unresolved sans motif`);
  }
  return true;
}

/**
 * Vérifie l'arithmétique d'une face : la suite imprimée vaut la cote déclarée,
 * et la longueur d'axe du mur se recalcule depuis cette cote et les décalages.
 */
function checkFace(
  decision: Decision,
  decisions: DecisionsFile,
  registry: EvidenceRegistry,
  level: Level,
  errors: string[],
  warnings: string[],
): void {
  const where = `face ${decision.id || '(sans id)'}`;
  if (!checkCommon(decision, 'face', errors, warnings)) return;
  const evidence = decision.evidence;
  const ref = evidence.chain;
  if (!ref) {
    if (evidence.class !== 'scaled' && evidence.class !== 'assumed') {
      errors.push(`${where}: preuve ${evidence.class} sans référence de chaîne`);
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
  if (evidence.class === 'printed' && !chain.closed) {
    errors.push(
      `${where}: preuve imprimée sur une chaîne ouverte (résidu ${String(chain.residual)})`,
    );
  }
  if (evidence.class === 'printed-partial' && chain.closed) {
    errors.push(`${where}: preuve partielle sur une chaîne refermée`);
  }
  const { span, length, startOffset, endOffset } = evidence;
  if (
    span === undefined ||
    length === undefined ||
    startOffset === undefined ||
    endOffset === undefined
  ) {
    errors.push(`${where}: preuve sans suite, longueur ou décalages`);
    return;
  }
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end >= chain.segments.length ||
    span.start > span.end
  ) {
    errors.push(`${where}: suite ${span.start}..${span.end} hors de la chaîne`);
    return;
  }
  const printed = chain.segments
    .slice(span.start, span.end + 1)
    .reduce((total, segment) => total + segment.value, 0);
  if (Math.abs(printed - length) > LENGTH_TOL) {
    errors.push(
      `${where}: longueur déclarée ${length} ≠ somme imprimée ${printed.toFixed(3)} ` +
        `(segments ${span.start}..${span.end})`,
    );
  }
  const wall: Wall | undefined = level.walls.find((candidate) => candidate.id === decision.wall);
  if (!wall) {
    errors.push(`${where}: mur ${decision.wall} absent du niveau`);
    return;
  }
  const axis = wallLength(wall);
  const expected = length - endOffset + startOffset;
  if (Math.abs(expected - axis) > LENGTH_TOL) {
    errors.push(
      `${where}: longueur d'axe ${axis.toFixed(3)} ≠ ${expected.toFixed(3)} ` +
        `(cote ${length} − décalages ${startOffset}/${endOffset})`,
    );
  }
  const exact = Math.abs(startOffset) <= LENGTH_TOL && Math.abs(endOffset) <= LENGTH_TOL;
  if ((evidence.class === 'printed' || evidence.class === 'printed-partial') && !exact) {
    errors.push(`${where}: preuve imprimée avec des décalages non nuls`);
  }
  if (evidence.class === 'derived' && exact) {
    errors.push(`${where}: preuve dérivée sans décalage, la cote est déjà la longueur du mur`);
  }
  if (evidence.anchor === 'envelope') {
    checkEnvelopeFace(decisions, chain, level, wall, span, startOffset, endOffset, where, errors);
  }
}

/** Vérifie qu'une ouverture recalculée depuis sa cote imprimée concorde avec le projet. */
function checkOpening(
  decision: Decision,
  decisions: DecisionsFile,
  registry: EvidenceRegistry,
  level: Level,
  errors: string[],
  warnings: string[],
): void {
  const where = `ouverture ${decision.id || '(sans id)'}`;
  if (!checkCommon(decision, 'opening', errors, warnings)) return;
  const evidence = decision.evidence;
  const ref = evidence.chain;
  if (!ref) {
    if (evidence.class !== 'scaled' && evidence.class !== 'assumed') {
      errors.push(`${where}: preuve ${evidence.class} sans référence de chaîne`);
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
  const index = evidence.segmentIndex;
  if (index === undefined) {
    errors.push(`${where}: preuve sans segment de baie`);
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= chain.segments.length) {
    errors.push(
      `${where}: segmentIndex ${index} hors de la chaîne (${chain.segments.length} segments)`,
    );
    return;
  }
  const segment = chain.segments[index];
  if (segment.kind !== 'opening') {
    errors.push(`${where}: le segment ${index} n'est pas une baie (${segment.kind})`);
    return;
  }
  const parsed = OPENING_TEXT.exec(segment.text);
  if (!parsed) {
    errors.push(`${where}: cote de baie illisible « ${segment.text} »`);
    return;
  }
  const width = metres(parsed[1]);
  const height = metres(parsed[2]);
  const convention = evidence.convention;
  if (!convention || !CONVENTIONS.includes(convention)) {
    errors.push(`${where}: convention d'appariement inconnue (${String(convention)})`);
    return;
  }
  if (convention !== 'height' && Math.abs(width - (evidence.printedWidth ?? NaN)) > LENGTH_TOL) {
    errors.push(`${where}: largeur déclarée ${String(evidence.printedWidth)} ≠ imprimée ${width}`);
  }
  if (convention !== 'width' && Math.abs(height - (evidence.printedHeight ?? NaN)) > LENGTH_TOL) {
    errors.push(
      `${where}: hauteur déclarée ${String(evidence.printedHeight)} ≠ imprimée ${height}`,
    );
  }
  const expected = cumulativeOffset(chain, index);
  if (Math.abs((evidence.cumulativeOffset ?? NaN) - expected) > LENGTH_TOL) {
    errors.push(
      `${where}: cumul déclaré ${String(evidence.cumulativeOffset)} ≠ cumul imprimé ${expected.toFixed(3)}`,
    );
  }
  if (evidence.anchor === 'envelope') {
    const wall = level.walls.find((candidate) => candidate.id === decision.wall);
    const opening = wall?.openings?.find((candidate) => candidate.id === decision.id);
    if (!wall || !opening) {
      errors.push(`${where}: mur ou baie introuvable pour la preuve d'emprise`);
    } else {
      checkEnvelopeOpening(decisions, chain, level, wall, opening, index, where, errors);
    }
  }
}

function outlineBounds(level: Level, axis: 'horizontal' | 'vertical') {
  const along = axis === 'horizontal' ? 0 : 1;
  const values = level.outline.map((point) => point[along]);
  return { low: Math.min(...values), high: Math.max(...values) };
}

function cumulativeSums(chain: RegistryChain): number[] {
  const sums = [0];
  for (const segment of chain.segments) sums.push(sums[sums.length - 1] + segment.value);
  return sums;
}

/** Intervalle monde d'une suite, une fois la chaîne calée sur le contour. */
function runInterval(
  chain: RegistryChain,
  start: number,
  end: number,
  base: number,
  sign: number,
): [number, number] {
  const sums = cumulativeSums(chain);
  const first = base + sign * sums[start];
  const last = base + sign * sums[end + 1];
  return [Math.min(first, last), Math.max(first, last)];
}

function alongAxis(wall: Wall): 0 | 1 {
  return Math.abs(wall.end[0] - wall.start[0]) >= Math.abs(wall.end[1] - wall.start[1]) ? 0 : 1;
}

function faceSpan(wall: Wall, startOffset: number, endOffset: number): [number, number] {
  const along = alongAxis(wall);
  const low = Math.min(wall.start[along], wall.end[along]);
  const high = Math.max(wall.start[along], wall.end[along]);
  return [low + startOffset, high + endOffset];
}

function openingSpan(opening: Opening, wall: Wall): [number, number] {
  const along = alongAxis(wall);
  const low = Math.min(wall.start[along], wall.end[along]);
  return [low + opening.offset, low + opening.offset + opening.width];
}

function findEnvelope(decisions: DecisionsFile, ref: ChainRef): EnvelopeFrame | undefined {
  return (decisions.envelopes ?? []).find(
    (frame) =>
      frame.page === ref.page &&
      frame.axis === ref.axis &&
      Math.abs(frame.perpendicular - ref.perpendicular) <= PERPENDICULAR_TOL,
  );
}

/** Une preuve d'emprise n'est valable que si la chaîne couvre le contour et tombe sur les faces. */
function checkEnvelopeFace(
  decisions: DecisionsFile,
  chain: RegistryChain,
  level: Level,
  wall: Wall,
  span: { start: number; end: number },
  startOffset: number,
  endOffset: number,
  where: string,
  errors: string[],
): void {
  const frame = findEnvelope(decisions, {
    page: chain.page,
    axis: chain.axis,
    perpendicular: chain.perpendicular,
  });
  if (!frame) {
    errors.push(`${where}: preuve d'emprise sans chaîne calée déclarée`);
    return;
  }
  const bounds = outlineBounds(level, chain.axis);
  if (Math.abs(chain.sum - (bounds.high - bounds.low)) > LENGTH_TOL) {
    errors.push(
      `${where}: la chaîne somme ${chain.sum.toFixed(3)} m, l'emprise ${(bounds.high - bounds.low).toFixed(3)} m`,
    );
    return;
  }
  const interval = runInterval(chain, span.start, span.end, frame.base, frame.sign);
  const expected = faceSpan(wall, startOffset, endOffset);
  if (
    Math.abs(interval[0] - expected[0]) > LENGTH_TOL ||
    Math.abs(interval[1] - expected[1]) > LENGTH_TOL
  ) {
    errors.push(
      `${where}: intervalle imprimé ${interval[0].toFixed(3)}..${interval[1].toFixed(3)} ` +
        `≠ faces du mur ${expected[0].toFixed(3)}..${expected[1].toFixed(3)}`,
    );
  }
}

function checkEnvelopeOpening(
  decisions: DecisionsFile,
  chain: RegistryChain,
  level: Level,
  wall: Wall,
  opening: Opening,
  index: number,
  where: string,
  errors: string[],
): void {
  const frame = findEnvelope(decisions, {
    page: chain.page,
    axis: chain.axis,
    perpendicular: chain.perpendicular,
  });
  if (!frame) {
    errors.push(`${where}: preuve d'emprise sans chaîne calée déclarée`);
    return;
  }
  const bounds = outlineBounds(level, chain.axis);
  if (Math.abs(chain.sum - (bounds.high - bounds.low)) > LENGTH_TOL) {
    errors.push(
      `${where}: la chaîne somme ${chain.sum.toFixed(3)} m, l'emprise ${(bounds.high - bounds.low).toFixed(3)} m`,
    );
    return;
  }
  const interval = runInterval(chain, index, index, frame.base, frame.sign);
  const expected = openingSpan(opening, wall);
  if (
    Math.abs(interval[0] - expected[0]) > LENGTH_TOL ||
    Math.abs(interval[1] - expected[1]) > LENGTH_TOL
  ) {
    errors.push(
      `${where}: intervalle imprimé ${interval[0].toFixed(3)}..${interval[1].toFixed(3)} ` +
        `≠ baie du projet ${expected[0].toFixed(3)}..${expected[1].toFixed(3)}`,
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
      // Une preuve d'emprise place déjà la baie en absolu : rien à avertir.
      if (decision.evidence.anchor === 'envelope') continue;
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
 * décision non résolue, et chaque preuve recalculée depuis ses segments.
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
  const pages = decisions.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    errors.push('pages du niveau manquantes : une cote d’un autre niveau ne prouve rien');
  } else {
    for (const decision of [...faces, ...openings]) {
      const page = decision.evidence?.chain?.page;
      if (page !== undefined && !pages.includes(page)) {
        errors.push(
          `${decision.id}: chaîne page ${page} hors des pages du niveau (${pages.join(', ')})`,
        );
      }
    }
  }
  for (const decision of faces) checkFace(decision, decisions, registry, level, errors, warnings);
  for (const decision of openings)
    checkOpening(decision, decisions, registry, level, errors, warnings);
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
        'Usage: node --import tsx scripts/check-plan-decisions.ts decisions.json project.json registry.json [--allow-unresolved]',
      );
    }
    // Une face non résolue n'est pas une contradiction : en fusion, les murs
    // viennent du modèle et la décision ne construit rien. Le drapeau dit que
    // l'appelant assume ce repli ; une erreur, elle, bloque toujours.
    const allowUnresolved = process.argv.includes('--allow-unresolved');
    const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
    const report = checkDecisions(
      await read(decisionsPath),
      await read(registryPath),
      await read(projectPath),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const blocking = report.errors.length > 0 || (!allowUnresolved && !report.ready);
    if (blocking) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
