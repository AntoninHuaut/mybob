import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { validateProject, ProjectValidationError } from '../src/model/validate';
import { validateSolarSettings } from '../src/model/solarSettings';
import type { HouseProject, SolarSettings } from '../src/model/types';

const fixture: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
);

test('projects without solar settings remain unchanged and do not acquire a location or timezone', () => {
  const original = structuredClone(fixture);
  delete original.solar;
  const checked = validateProject(original);
  assert.equal(Object.hasOwn(checked, 'solar'), false);
  assert.deepEqual(checked, original);
  const minimal = validateSolarSettings({ latitude: 0, longitude: 0, northAngleDeg: 0 });
  assert.deepEqual(minimal, { latitude: 0, longitude: 0, northAngleDeg: 0 });
  assert.equal(Object.hasOwn(minimal, 'timeZone'), false);
  assert.equal(Object.hasOwn(minimal, 'label'), false);
});

test('explicit solar coordinates, plan orientation and timezone survive JSON export/import', () => {
  const solar: SolarSettings = {
    latitude: 48.25,
    longitude: -1.75,
    northAngleDeg: 123.5,
    timeZone: 'Europe/Paris',
    label: 'Lieu renseigné pour la simulation',
  };
  const project = { ...structuredClone(fixture), solar };
  const imported = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(imported.solar, solar);
  assert.notEqual(imported.solar, solar);
  assert.deepEqual(project.solar, solar);
  imported.solar!.latitude = 12;
  assert.equal(project.solar.latitude, 48.25);
});

test('orientation normalization is independent of coordinates and never mutates the source', () => {
  for (const [input, expected] of [
    [450, 90],
    [-90, 270],
    [360, 0],
    [0, 0],
    [-720, 0],
  ]) {
    const settings = { latitude: -33.5, longitude: 151.2, northAngleDeg: input };
    const checked = validateSolarSettings(settings);
    assert.equal(checked.northAngleDeg, expected);
    assert.equal(settings.northAngleDeg, input);
    const project = { ...structuredClone(fixture), solar: settings };
    assert.equal(validateProject(project).solar!.northAngleDeg, expected);
    assert.equal(project.solar.northAngleDeg, input);
  }
});

test('coordinate limits and IANA timezones are validated explicitly', () => {
  for (const settings of [
    { latitude: -90, longitude: -180, northAngleDeg: 0 },
    { latitude: 90, longitude: 180, northAngleDeg: 0, timeZone: 'UTC' },
    { latitude: 0, longitude: 0, northAngleDeg: 0, timeZone: 'America/New_York' },
  ])
    assert.doesNotThrow(() => validateSolarSettings(settings));
  const good = { latitude: 10, longitude: 20, northAngleDeg: 30 };
  for (const bad of [
    null,
    [],
    true,
    { ...good, latitude: 90.01 },
    { ...good, latitude: -90.01 },
    { ...good, latitude: NaN },
    { ...good, latitude: '48' },
    { ...good, longitude: 180.01 },
    { ...good, longitude: -180.01 },
    { ...good, longitude: Infinity },
    { ...good, northAngleDeg: NaN },
    { ...good, northAngleDeg: Infinity },
    { ...good, northAngleDeg: '90' },
    { ...good, timeZone: 'Unknown/Nowhere' },
    { ...good, timeZone: '' },
    { ...good, timeZone: 1 },
    { ...good, label: 'x'.repeat(161) },
    { ...good, label: 1 },
  ]) {
    assert.throws(() => validateSolarSettings(bad));
    assert.throws(
      () => validateProject({ ...structuredClone(fixture), solar: bad }),
      ProjectValidationError,
    );
  }
});

test('optional explicit display fields are trimmed without inventing geographic data', () => {
  assert.deepEqual(
    validateSolarSettings({
      latitude: 1,
      longitude: 2,
      northAngleDeg: 3,
      timeZone: ' Europe/Paris ',
      label: '  Exemple  ',
    }),
    { latitude: 1, longitude: 2, northAngleDeg: 3, timeZone: 'Europe/Paris', label: 'Exemple' },
  );
  assert.deepEqual(
    validateSolarSettings({ latitude: 1, longitude: 2, northAngleDeg: 3, label: '  ' }),
    { latitude: 1, longitude: 2, northAngleDeg: 3 },
  );
});
