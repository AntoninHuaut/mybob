import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  checkDecisions,
  type DecisionsFile,
  type EvidenceRegistry,
} from '../scripts/check-plan-decisions';
import { validateProject } from '../src/model/validate';

const read = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/plan-reference/${name}`, 'utf8'));

const project = read('project.json');
const registry: EvidenceRegistry = read('registry.json');
const decisions: DecisionsFile = read('decisions.json');

test('the synthetic reference plan is a valid project', () => {
  const validated = validateProject(project);
  assert.equal(validated.id, 'maison-reference');
  assert.equal(validated.levels.length, 1);
});

test('the gate accepts the reference plan without error or warning', () => {
  const report = checkDecisions(decisions, registry, project);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.ready, true);
  assert.deepEqual(report.faces.unresolved, []);
  assert.deepEqual(report.openings.unresolved, []);
});

test('the reference plan exercises the three evidence classes', () => {
  const report = checkDecisions(decisions, registry, project);
  assert.equal(report.faces.byClass.printed, 2);
  assert.equal(report.faces.byClass['printed-partial'], 1);
  assert.equal(report.faces.byClass.derived, 2);
  assert.equal(report.openings.byClass.printed, 5);
});

test('the gate refuses the reference plan as soon as a dimension is altered', () => {
  const tampered: DecisionsFile = JSON.parse(JSON.stringify(decisions));
  const face = tampered.faces.find((decision) => decision.id === 'nord');
  assert.ok(face?.evidence.length !== undefined);
  face.evidence.length = 6.1;
  const report = checkDecisions(tampered, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('printed sum')));
});

test('the gate refuses a proof borrowed from another level’s page', () => {
  const borrowed: DecisionsFile = JSON.parse(JSON.stringify(decisions));
  borrowed.pages = [2];
  const report = checkDecisions(borrowed, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes("outside the level's pages")));
});

test('the gate refuses a fitted chain whose origin no longer lands on the faces', () => {
  const shifted: DecisionsFile = JSON.parse(JSON.stringify(decisions));
  assert.ok(shifted.envelopes && shifted.envelopes.length > 0);
  shifted.envelopes[0].base += 0.5;
  const report = checkDecisions(shifted, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('printed interval')));
});

test('the gate refuses a footprint proof without a declared fitted chain', () => {
  const bare: DecisionsFile = JSON.parse(JSON.stringify(decisions));
  bare.envelopes = [];
  const report = checkDecisions(bare, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('without a declared fitted chain')));
});
