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

test('le plan de référence synthétique est un projet valide', () => {
  const validated = validateProject(project);
  assert.equal(validated.id, 'maison-reference');
  assert.equal(validated.levels.length, 1);
});

test('la porte accepte le plan de référence sans erreur ni avertissement', () => {
  const report = checkDecisions(decisions, registry, project);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.ready, true);
  assert.deepEqual(report.faces.unresolved, []);
  assert.deepEqual(report.openings.unresolved, []);
});

test('le plan de référence exerce les trois classes de preuve', () => {
  const report = checkDecisions(decisions, registry, project);
  assert.equal(report.faces.byClass.printed, 2);
  assert.equal(report.faces.byClass['printed-partial'], 1);
  assert.equal(report.faces.byClass.derived, 2);
  assert.equal(report.openings.byClass.printed, 5);
});

test('la porte refuse le plan de référence dès qu’une cote est altérée', () => {
  const tampered: DecisionsFile = JSON.parse(JSON.stringify(decisions));
  const face = tampered.faces.find((decision) => decision.id === 'nord');
  assert.ok(face?.evidence.length !== undefined);
  face.evidence.length = 6.1;
  const report = checkDecisions(tampered, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('somme imprimée')));
});

test('la porte refuse une preuve empruntée à la page d’un autre niveau', () => {
  const borrowed: DecisionsFile = JSON.parse(JSON.stringify(decisions));
  borrowed.pages = [2];
  const report = checkDecisions(borrowed, registry, project);
  assert.equal(report.ready, false);
  assert.ok(report.errors.some((error) => error.includes('hors des pages du niveau')));
});
