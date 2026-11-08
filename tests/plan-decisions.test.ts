import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkDecisions,
  cumulativeOffset,
  type DecisionsFile,
  type EvidenceRegistry,
  type RegistryChain,
} from '../scripts/check-plan-decisions';
import type { HouseProject } from '../src/model/types';

const chain: RegistryChain = {
  page: 1,
  axis: 'horizontal',
  perpendicular: 100,
  segments: [
    { text: '50', kind: 'centimetres', value: 0.5, at: [100, 100] },
    { text: '1.20/2.10', kind: 'opening', value: 1.2, at: [200, 100] },
    { text: '0.80', kind: 'linear', value: 0.8, at: [300, 100] },
  ],
  sum: 2.5,
  declaredTotal: { text: '2.50', value: 2.5, at: [200, 90] },
  residual: 0,
  closed: true,
};

/** Same wall, printed dimension longer by two declared half-thicknesses. */
const wideChain: RegistryChain = {
  ...chain,
  perpendicular: 200,
  segments: [
    { text: '50', kind: 'centimetres', value: 0.5, at: [100, 200] },
    { text: '1.20/2.10', kind: 'opening', value: 1.2, at: [200, 200] },
    { text: '1.00', kind: 'linear', value: 1.0, at: [300, 200] },
  ],
  sum: 2.7,
  declaredTotal: { text: '2.70', value: 2.7, at: [200, 190] },
};

const registry: EvidenceRegistry = {
  schemaVersion: 1,
  source: { file: 'plan.pdf', sha256: 'x', pageCount: 1 },
  pages: [{ index: 1, chains: [chain, wideChain] }],
};

const project: HouseProject = {
  schemaVersion: 1,
  id: 'maison-test',
  name: 'Test',
  description: '',
  units: 'm',
  source: { title: 'plan', status: 'provisional', notes: [] },
  levels: [
    {
      id: 'rdc',
      name: 'RDC',
      elevation: 0,
      ceilingHeight: 2.5,
      outline: [
        [0, 0],
        [2.5, 0],
        [2.5, 3],
        [0, 3],
      ],
      walls: [
        {
          id: 'nord',
          start: [0, 0],
          end: [2.5, 0],
          thickness: 0.2,
          openings: [{ id: 'baie', kind: 'sliding', offset: 0.5, width: 1.2, height: 2.1 }],
        },
      ],
      rooms: [],
      lights: [],
      spawn: { position: [1, 1], yaw: 0 },
    },
  ],
};

const decisions = (overrides: Partial<DecisionsFile> = {}): DecisionsFile => ({
  schemaVersion: 1,
  project: 'maison-test',
  level: 'rdc',
  registry: 'registry.json',
  pages: [1],
  faces: [
    {
      id: 'nord',
      wall: 'nord',
      evidence: {
        class: 'printed',
        chain: { page: 1, axis: 'horizontal', perpendicular: 100 },
        span: { start: 0, end: 2 },
        length: 2.5,
        startOffset: 0,
        endOffset: 0,
      },
      unresolved: false,
    },
  ],
  openings: [
    {
      id: 'baie',
      wall: 'nord',
      evidence: {
        class: 'printed',
        chain: { page: 1, axis: 'horizontal', perpendicular: 100 },
        segmentIndex: 1,
        cumulativeOffset: 0.5,
        printedWidth: 1.2,
        printedHeight: 2.1,
        convention: 'both',
      },
      unresolved: false,
    },
  ],
  ...overrides,
});

test('plan decisions accept a closed chain and a recomputed opening offset', () => {
  const report = checkDecisions(decisions(), registry, project);
  assert.deepEqual(report.errors, []);
  assert.equal(report.ready, true);
  assert.equal(report.faces.byClass.printed, 1);
  assert.equal(report.openings.byClass.printed, 1);
  assert.ok(report.warnings.some((warning) => warning.includes('wall origin not declared')));
});

test('plan decisions verify the offset once the wall origin is declared', () => {
  const anchored = decisions();
  anchored.openings[0].evidence.wallOrigin = 0;
  const report = checkDecisions(anchored, registry, project);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.ready, true);
});

test('plan decisions recompute the cumulative offset from the printed segments', () => {
  assert.equal(cumulativeOffset(chain, 0), 0);
  assert.ok(Math.abs(cumulativeOffset(chain, 1) - 0.5) < 1e-9);
  assert.ok(Math.abs(cumulativeOffset(chain, 2) - 1.7) < 1e-9);
});

test('plan decisions reject an opening offset that contradicts the chain', () => {
  const shifted = decisions();
  shifted.openings[0].evidence.segmentIndex = 2;
  shifted.openings[0].evidence.wallOrigin = 0;
  const report = checkDecisions(shifted, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('project offset 0.5')));
});

test('plan decisions reject a face resting on an unclosed chain', () => {
  const open: EvidenceRegistry = {
    ...registry,
    pages: [{ index: 1, chains: [{ ...chain, closed: false, residual: 0.12 }] }],
  };
  const report = checkDecisions(decisions(), open, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('open chain')));
});

test('plan decisions accept a partial proof on an open chain', () => {
  const open: EvidenceRegistry = {
    ...registry,
    pages: [{ index: 1, chains: [{ ...chain, closed: false, residual: null }] }],
  };
  const partial = decisions();
  partial.faces[0].evidence.class = 'printed-partial';
  const report = checkDecisions(partial, open, project);
  assert.deepEqual(report.errors, []);
  assert.equal(report.ready, true);
});

test('plan decisions reject a partial proof on a closed chain', () => {
  const partial = decisions();
  partial.faces[0].evidence.class = 'printed-partial';
  const report = checkDecisions(partial, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('partial proof on a closed chain')));
});

test('plan decisions reject a declared length that the printed segments do not sum to', () => {
  const wrong = decisions();
  wrong.faces[0].evidence.length = 2.6;
  const report = checkDecisions(wrong, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('printed sum 2.500')));
});

test('plan decisions reject a face whose axis length does not follow from the cote', () => {
  const wrong = decisions();
  wrong.faces[0].evidence.startOffset = -0.1;
  const report = checkDecisions(wrong, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('axis length 2.500')));
});

test('plan decisions accept a derived face whose cote spans two declared half-thicknesses', () => {
  const derived = decisions();
  derived.faces[0].evidence = {
    class: 'derived',
    chain: { page: 1, axis: 'horizontal', perpendicular: 200 },
    span: { start: 0, end: 2 },
    length: 2.7,
    startOffset: -0.1,
    endOffset: 0.1,
  };
  const report = checkDecisions(derived, registry, project);
  assert.deepEqual(report.errors, []);
  assert.equal(report.ready, true);
});

test('plan decisions reject a printed face carrying declared offsets', () => {
  const derived = decisions();
  derived.faces[0].evidence = {
    class: 'printed',
    chain: { page: 1, axis: 'horizontal', perpendicular: 200 },
    span: { start: 0, end: 2 },
    length: 2.7,
    startOffset: -0.1,
    endOffset: 0.1,
  };
  const report = checkDecisions(derived, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('non-zero offsets')));
});

test('plan decisions reject a chain taken from another level page', () => {
  const elsewhere = decisions();
  elsewhere.pages = [2];
  const report = checkDecisions(elsewhere, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes("outside the level's pages")));
});

test('plan decisions require the level pages', () => {
  const bare = decisions();
  delete bare.pages;
  const report = checkDecisions(bare, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('level pages missing')));
});

test('plan decisions reject an opening whose printed width contradicts the segment', () => {
  const wrong = decisions();
  wrong.openings[0].evidence.printedWidth = 1.4;
  const report = checkDecisions(wrong, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('declared width 1.4')));
});

test('plan decisions reject an opening pointing at a dimension segment', () => {
  const wrong = decisions();
  wrong.openings[0].evidence.segmentIndex = 0;
  const report = checkDecisions(wrong, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('is not an opening')));
});

test('plan decisions block construction while a decision is unresolved', () => {
  const pending = decisions();
  pending.faces[0].unresolved = true;
  pending.faces[0].reason = 'retour non coté';
  const report = checkDecisions(pending, registry, project);
  assert.equal(report.ready, false);
  assert.deepEqual(report.faces.unresolved, ['nord (retour non coté)']);
});

test('plan decisions require one decision per wall and per opening', () => {
  const report = checkDecisions(decisions({ faces: [], openings: [] }), registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('face nord: no decision')));
  assert.ok(report.errors.some((error) => error.includes('opening baie: no decision')));
});

test('plan decisions reject an unresolved flag without a reason', () => {
  const pending = decisions();
  pending.openings[0].unresolved = true;
  const report = checkDecisions(pending, registry, project);
  assert.ok(report.errors.some((error) => error.includes('unresolved without a reason')));
});

test('plan decisions reject a printed claim without a chain reference', () => {
  const bare = decisions();
  bare.faces[0].evidence = { class: 'printed' };
  const report = checkDecisions(bare, registry, project);
  assert.ok(report.errors.some((error) => error.includes('without a chain reference')));
});
