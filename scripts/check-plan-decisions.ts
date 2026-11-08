import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { wallLength } from '../src/model/geometry';
import type { HouseProject, Level, Opening, Wall } from '../src/model/types';

const OFFSET_TOL = 0.01; // m, accepted gap between the project offset and the chain cumulative sum
const LENGTH_TOL = 0.01; // m, accepted gap on a length or a dimension
const PERPENDICULAR_TOL = 0.5; // pt, pairing of a dimension line
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

/** Layer 1: registry produced by `scripts/extract_plan_evidence.py`. */
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
    /** Contiguous sequence of printed segments carrying the dimension. */
    span?: { start: number; end: number };
    /** Printed sum of the sequence, in metres. */
    length?: number;
    /** Offset of the wall's first face relative to its axis. */
    startOffset?: number;
    /** Offset of the wall's last face relative to its axis. */
    endOffset?: number;
    segmentIndex?: number;
    /** Printed position of the tick, cumulated from the chain origin. */
    cumulativeOffset?: number;
    /** Position of the wall origin in the chain; without it the offset cannot be checked. */
    wallOrigin?: number;
    printedWidth?: number;
    printedHeight?: number;
    convention?: OpeningConvention;
    /** What ties the dimension to the wall: its own openings, or a chain fitted to the footprint. */
    anchor?: 'openings' | 'envelope';
    equation?: string;
    note?: string;
  };
  unresolved: boolean;
  reason?: string;
}

/** Layer 2: one decision per wall face and per opening. */
export interface DecisionsFile {
  schemaVersion: number;
  project: string;
  level: string;
  registry: string;
  /** Registry pages carrying this level; a dimension from another level proves nothing. */
  pages?: number[];
  /** Closed chains fitted to the footprint, with their origin and reading direction. */
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
  /** True only if there is no error and no unresolved decision. */
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

/** Sum of the printed segments before `segmentIndex`: cumulative position along the chain. */
export function cumulativeOffset(chain: RegistryChain, segmentIndex: number): number {
  return chain.segments.slice(0, segmentIndex).reduce((total, segment) => total + segment.value, 0);
}

function checkCommon(
  decision: Decision,
  kind: 'face' | 'opening',
  errors: string[],
  warnings: string[],
): boolean {
  const where = `${kind} ${decision.id || '(no id)'}`;
  if (!decision.id) errors.push(`${where}: missing identifier`);
  if (!decision.wall) errors.push(`${where}: missing host wall`);
  if (typeof decision.unresolved !== 'boolean') errors.push(`${where}: missing unresolved flag`);
  if (!CLASSES.includes(decision.evidence?.class)) {
    errors.push(`${where}: invalid evidence class (${String(decision.evidence?.class)})`);
    return false;
  }
  if (decision.evidence.class === 'assumed') {
    warnings.push(`${where}: assumed proof, to be confirmed by a dimension or a survey`);
  }
  if (decision.unresolved && !decision.reason) {
    errors.push(`${where}: unresolved without a reason`);
  }
  return true;
}

/**
 * Checks a face's arithmetic: the printed sequence equals the declared dimension,
 * and the wall's axis length is recomputed from that dimension and the offsets.
 */
function checkFace(
  decision: Decision,
  decisions: DecisionsFile,
  registry: EvidenceRegistry,
  level: Level,
  errors: string[],
  warnings: string[],
): void {
  const where = `face ${decision.id || '(no id)'}`;
  if (!checkCommon(decision, 'face', errors, warnings)) return;
  const evidence = decision.evidence;
  const ref = evidence.chain;
  if (!ref) {
    if (evidence.class !== 'scaled' && evidence.class !== 'assumed') {
      errors.push(`${where}: ${evidence.class} proof without a chain reference`);
    }
    return;
  }
  const chain = findChain(registry, ref);
  if (!chain) {
    errors.push(
      `${where}: chain not found (page ${ref.page}, ${ref.axis}, perpendicular ${ref.perpendicular})`,
    );
    return;
  }
  if (evidence.class === 'printed' && !chain.closed) {
    errors.push(`${where}: printed proof on an open chain (residual ${String(chain.residual)})`);
  }
  if (evidence.class === 'printed-partial' && chain.closed) {
    errors.push(`${where}: partial proof on a closed chain`);
  }
  const { span, length, startOffset, endOffset } = evidence;
  if (
    span === undefined ||
    length === undefined ||
    startOffset === undefined ||
    endOffset === undefined
  ) {
    errors.push(`${where}: proof without a sequence, length or offsets`);
    return;
  }
  if (
    !Number.isInteger(span.start) ||
    !Number.isInteger(span.end) ||
    span.start < 0 ||
    span.end >= chain.segments.length ||
    span.start > span.end
  ) {
    errors.push(`${where}: sequence ${span.start}..${span.end} outside the chain`);
    return;
  }
  const printed = chain.segments
    .slice(span.start, span.end + 1)
    .reduce((total, segment) => total + segment.value, 0);
  if (Math.abs(printed - length) > LENGTH_TOL) {
    errors.push(
      `${where}: declared length ${length} ≠ printed sum ${printed.toFixed(3)} ` +
        `(segments ${span.start}..${span.end})`,
    );
  }
  const wall: Wall | undefined = level.walls.find((candidate) => candidate.id === decision.wall);
  if (!wall) {
    errors.push(`${where}: wall ${decision.wall} missing from the level`);
    return;
  }
  const axis = wallLength(wall);
  const expected = length - endOffset + startOffset;
  if (Math.abs(expected - axis) > LENGTH_TOL) {
    errors.push(
      `${where}: axis length ${axis.toFixed(3)} ≠ ${expected.toFixed(3)} ` +
        `(dimension ${length} − offsets ${startOffset}/${endOffset})`,
    );
  }
  const exact = Math.abs(startOffset) <= LENGTH_TOL && Math.abs(endOffset) <= LENGTH_TOL;
  if ((evidence.class === 'printed' || evidence.class === 'printed-partial') && !exact) {
    errors.push(`${where}: printed proof with non-zero offsets`);
  }
  if (evidence.class === 'derived' && exact) {
    errors.push(
      `${where}: derived proof without an offset, the dimension already is the wall length`,
    );
  }
  if (evidence.anchor === 'envelope') {
    checkEnvelopeFace(decisions, chain, level, wall, span, startOffset, endOffset, where, errors);
  }
}

/** Checks that an opening recomputed from its printed dimension agrees with the project. */
function checkOpening(
  decision: Decision,
  decisions: DecisionsFile,
  registry: EvidenceRegistry,
  level: Level,
  errors: string[],
  warnings: string[],
): void {
  const where = `opening ${decision.id || '(no id)'}`;
  if (!checkCommon(decision, 'opening', errors, warnings)) return;
  const evidence = decision.evidence;
  const ref = evidence.chain;
  if (!ref) {
    if (evidence.class !== 'scaled' && evidence.class !== 'assumed') {
      errors.push(`${where}: ${evidence.class} proof without a chain reference`);
    }
    return;
  }
  const chain = findChain(registry, ref);
  if (!chain) {
    errors.push(
      `${where}: chain not found (page ${ref.page}, ${ref.axis}, perpendicular ${ref.perpendicular})`,
    );
    return;
  }
  const index = evidence.segmentIndex;
  if (index === undefined) {
    errors.push(`${where}: proof without an opening segment`);
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= chain.segments.length) {
    errors.push(
      `${where}: segmentIndex ${index} outside the chain (${chain.segments.length} segments)`,
    );
    return;
  }
  const segment = chain.segments[index];
  if (segment.kind !== 'opening') {
    errors.push(`${where}: segment ${index} is not an opening (${segment.kind})`);
    return;
  }
  const parsed = OPENING_TEXT.exec(segment.text);
  if (!parsed) {
    errors.push(`${where}: unreadable opening dimension « ${segment.text} »`);
    return;
  }
  const width = metres(parsed[1]);
  const height = metres(parsed[2]);
  const convention = evidence.convention;
  if (!convention || !CONVENTIONS.includes(convention)) {
    errors.push(`${where}: unknown pairing convention (${String(convention)})`);
    return;
  }
  if (convention !== 'height' && Math.abs(width - (evidence.printedWidth ?? NaN)) > LENGTH_TOL) {
    errors.push(`${where}: declared width ${String(evidence.printedWidth)} ≠ printed ${width}`);
  }
  if (convention !== 'width' && Math.abs(height - (evidence.printedHeight ?? NaN)) > LENGTH_TOL) {
    errors.push(`${where}: declared height ${String(evidence.printedHeight)} ≠ printed ${height}`);
  }
  const expected = cumulativeOffset(chain, index);
  if (Math.abs((evidence.cumulativeOffset ?? NaN) - expected) > LENGTH_TOL) {
    errors.push(
      `${where}: declared cumulative ${String(evidence.cumulativeOffset)} ≠ printed cumulative ${expected.toFixed(3)}`,
    );
  }
  if (evidence.anchor === 'envelope') {
    const wall = level.walls.find((candidate) => candidate.id === decision.wall);
    const opening = wall?.openings?.find((candidate) => candidate.id === decision.id);
    if (!wall || !opening) {
      errors.push(`${where}: wall or opening not found for the footprint proof`);
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

/** World interval of a sequence, once the chain is fitted to the outline. */
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

/** A footprint proof is only valid if the chain covers the outline and lands on the faces. */
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
    errors.push(`${where}: footprint proof without a declared fitted chain`);
    return;
  }
  const bounds = outlineBounds(level, chain.axis);
  if (Math.abs(chain.sum - (bounds.high - bounds.low)) > LENGTH_TOL) {
    errors.push(
      `${where}: the chain sums ${chain.sum.toFixed(3)} m, the footprint ${(bounds.high - bounds.low).toFixed(3)} m`,
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
      `${where}: printed interval ${interval[0].toFixed(3)}..${interval[1].toFixed(3)} ` +
        `≠ wall faces ${expected[0].toFixed(3)}..${expected[1].toFixed(3)}`,
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
    errors.push(`${where}: footprint proof without a declared fitted chain`);
    return;
  }
  const bounds = outlineBounds(level, chain.axis);
  if (Math.abs(chain.sum - (bounds.high - bounds.low)) > LENGTH_TOL) {
    errors.push(
      `${where}: the chain sums ${chain.sum.toFixed(3)} m, the footprint ${(bounds.high - bounds.low).toFixed(3)} m`,
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
      `${where}: printed interval ${interval[0].toFixed(3)}..${interval[1].toFixed(3)} ` +
        `≠ project opening ${expected[0].toFixed(3)}..${expected[1].toFixed(3)}`,
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
      errors.push(`${kind} ${item.id}: no decision`);
      continue;
    }
    if (matches.length > 1)
      errors.push(`${kind} ${item.id}: ${matches.length} competing decisions`);
    const decision = matches[0];
    if (kind !== 'opening' || item.offset === undefined) continue;
    const ref = decision.evidence.chain;
    if (!ref || decision.evidence.segmentIndex === undefined) continue;
    const chain = findChain(registry, ref);
    if (!chain) continue;
    const printed = cumulativeOffset(chain, decision.evidence.segmentIndex);
    if (decision.evidence.wallOrigin === undefined) {
      // A footprint proof already places the opening absolutely: nothing to warn about.
      if (decision.evidence.anchor === 'envelope') continue;
      warnings.push(
        `${kind} ${item.id}: wall origin not declared, offset ${item.offset} cannot be checked ` +
          `(tick printed at ${printed.toFixed(3)} on the chain, page ${ref.page})`,
      );
      continue;
    }
    const expectedOffset = printed - decision.evidence.wallOrigin;
    if (Math.abs(expectedOffset - item.offset) > OFFSET_TOL) {
      errors.push(
        `${kind} ${item.id}: project offset ${item.offset} ≠ ${expectedOffset.toFixed(3)} ` +
          `(printed tick ${printed.toFixed(3)} − origin ${decision.evidence.wallOrigin})`,
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
 * Checks the decision file against the evidence registry and the project.
 * Construction only starts if `ready` is true: no error, no
 * unresolved decision, and every proof recomputed from its segments.
 */
export function checkDecisions(
  decisions: DecisionsFile,
  registry: EvidenceRegistry,
  project: HouseProject,
): DecisionReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (decisions.schemaVersion !== 1)
    errors.push(`unexpected schemaVersion: ${decisions.schemaVersion}`);
  if (registry.schemaVersion !== 1)
    errors.push(`registry: unexpected schemaVersion: ${registry.schemaVersion}`);
  if (decisions.project !== project.id) {
    errors.push(`project ${decisions.project} ≠ imported project ${project.id}`);
  }
  const level: Level | undefined = project.levels.find(
    (candidate) => candidate.id === decisions.level,
  );
  if (!level) {
    errors.push(`level ${decisions.level} missing from the project`);
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
    errors.push('level pages missing: a dimension from another level proves nothing');
  } else {
    for (const decision of [...faces, ...openings]) {
      const page = decision.evidence?.chain?.page;
      if (page !== undefined && !pages.includes(page)) {
        errors.push(
          `${decision.id}: chain page ${page} outside the level's pages (${pages.join(', ')})`,
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
    // An unresolved face is not a contradiction: in merge mode, walls
    // come from the model and the decision builds nothing. The flag says
    // the caller accepts this fallback; an error, on the other hand, always blocks.
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
