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

const registry: EvidenceRegistry = {
  schemaVersion: 1,
  source: { file: 'plan.pdf', sha256: 'x', pageCount: 1 },
  pages: [{ index: 1, chains: [chain] }],
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
  faces: [
    {
      id: 'nord',
      wall: 'nord',
      evidence: { class: 'printed', chain: { page: 1, axis: 'horizontal', perpendicular: 100 } },
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
  assert.ok(report.warnings.some((warning) => warning.includes('origine du mur non déclarée')));
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
  assert.ok(report.errors.some((error) => error.includes('offset projet 0.5')));
});

test('plan decisions reject a face resting on an unclosed chain', () => {
  const open: EvidenceRegistry = {
    ...registry,
    pages: [{ index: 1, chains: [{ ...chain, closed: false, residual: 0.12 }] }],
  };
  const report = checkDecisions(decisions(), open, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('ne se referme pas')));
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
  assert.ok(report.errors.some((error) => error.includes('face nord: aucune décision')));
  assert.ok(report.errors.some((error) => error.includes('opening baie: aucune décision')));
});

test('plan decisions reject an unresolved flag without a reason', () => {
  const pending = decisions();
  pending.openings[0].unresolved = true;
  const report = checkDecisions(pending, registry, project);
  assert.ok(report.errors.some((error) => error.includes('unresolved sans motif')));
});

test('plan decisions reject a printed claim without a chain reference', () => {
  const bare = decisions();
  bare.faces[0].evidence = { class: 'printed' };
  const report = checkDecisions(bare, registry, project);
  assert.ok(
    report.errors.some((error) => error.includes('preuve imprimée sans référence de chaîne')),
  );
});
