import assert from 'node:assert/strict';
import test from 'node:test';
import { localDateTimeToInstant, solarPosition } from '../src/scene/solar';
import type { SolarSettings } from '../src/model/types';

const near = (actual: number, expected: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
const settings: SolarSettings = { latitude: 39.742476, longitude: -105.1786, northAngleDeg: 0 };

test('NOAA approximation agrees with the published NREL SPA solar-position example', () => {
  // NREL SPA reference: 2003-10-17, 12:30:30 at UTC−07, 39.742476°N/105.1786°W.
  // Published azimuth194.340241°,zenith50.111622°; SPA uses a specific atmosphere,
  // while this preview uses NOAA's standard refraction and neglects parallax.
  const sun = solarPosition(settings, new Date('2003-10-17T19:30:30Z'));
  near(sun.azimuthDeg, 194.340241, 0.05);
  near(sun.altitudeDeg, 90 - 50.111622, 0.05);
  assert.ok(sun.daylight);
});

test('plan north rotates the geographic sun without mirroring or changing its elevation', () => {
  const instant = new Date('2026-06-21T09:00:00Z');
  const up = solarPosition(settings, instant);
  const right = solarPosition({ ...settings, northAngleDeg: 90 }, instant);
  near(right.directionToSun.x, -up.directionToSun.z);
  near(right.directionToSun.z, up.directionToSun.x);
  near(right.directionToSun.y, up.directionToSun.y);
  near(right.azimuthDeg, up.azimuthDeg);
  const reversed = solarPosition({ ...settings, northAngleDeg: 180 }, instant);
  near(reversed.directionToSun.x, -up.directionToSun.x);
  near(reversed.directionToSun.z, -up.directionToSun.z);
});

test('summer sun rises toward the east and sets toward the west in a north-up plan', () => {
  const observer: SolarSettings = { latitude: 48, longitude: 0, northAngleDeg: 0 };
  const morning = solarPosition(observer, new Date('2026-06-21T07:00:00Z'));
  const evening = solarPosition(observer, new Date('2026-06-21T17:00:00Z'));
  assert.ok(morning.directionToSun.x > 0);
  assert.ok(evening.directionToSun.x < 0);
  assert.ok(morning.daylight && evening.daylight);
});

test('sun and light directions are opposite unit vectors, including night and polar latitudes', () => {
  for (const latitude of [-90, -66.6, 0, 66.6, 90]) {
    for (const instant of [
      '2026-03-20T12:00:00Z',
      '2026-06-21T00:00:00Z',
      '2026-12-21T12:00:00Z',
    ]) {
      const sun = solarPosition({ ...settings, latitude }, new Date(instant));
      assert.ok(Number.isFinite(sun.azimuthDeg) && Number.isFinite(sun.altitudeDeg));
      near(Math.hypot(...Object.values(sun.directionToSun)), 1);
      for (const axis of ['x', 'y', 'z'] as const)
        near(sun.lightDirection[axis], -sun.directionToSun[axis]);
      assert.equal(sun.daylight, sun.altitudeDeg > 0);
    }
  }
  assert.equal(
    solarPosition({ ...settings, latitude: 90 }, new Date('2026-06-21T00:00:00Z')).daylight,
    true,
  );
  assert.equal(
    solarPosition({ ...settings, latitude: 90 }, new Date('2026-12-21T12:00:00Z')).daylight,
    false,
  );
});

test('the absolute instant controls the sun, independently from the display time zone', () => {
  const date = new Date('2026-06-21T12:00:00Z');
  assert.deepEqual(
    solarPosition({ ...settings, timeZone: 'Europe/Paris' }, date),
    solarPosition({ ...settings, timeZone: 'America/Denver' }, date),
  );
  const east = solarPosition({ ...settings, longitude: 180 }, date);
  const west = solarPosition({ ...settings, longitude: -180 }, date);
  near(east.altitudeDeg, west.altitudeDeg);
  near(east.azimuthDeg, west.azimuthDeg);
  for (const axis of ['x', 'y', 'z'] as const)
    near(east.directionToSun[axis], west.directionToSun[axis]);
  assert.throws(() => solarPosition(settings, new Date('invalid')), RangeError);
});

test('local date/time conversion respects explicit summer/winter zones and leap dates', () => {
  assert.equal(
    localDateTimeToInstant('2026-07-01', '12:00', 'Europe/Paris').toISOString(),
    '2026-07-01T10:00:00.000Z',
  );
  assert.equal(
    localDateTimeToInstant('2026-01-01', '12:00', 'Europe/Paris').toISOString(),
    '2026-01-01T11:00:00.000Z',
  );
  assert.equal(
    localDateTimeToInstant('2028-02-29', '12:34:56', 'Asia/Kathmandu').toISOString(),
    '2028-02-29T06:49:56.000Z',
  );
  assert.equal(
    localDateTimeToInstant('2026-01-01', '00:00', 'UTC').toISOString(),
    '2026-01-01T00:00:00.000Z',
  );
});

test('nonexistent DST times are rejected and repeated hours require a deliberate choice', () => {
  assert.throws(
    () => localDateTimeToInstant('2026-03-29', '02:30', 'Europe/Paris'),
    /n’existe pas/,
  );
  assert.throws(() => localDateTimeToInstant('2026-10-25', '02:30', 'Europe/Paris'), /deux fois/);
  assert.equal(
    localDateTimeToInstant('2026-10-25', '02:30', 'Europe/Paris', 'earlier').toISOString(),
    '2026-10-25T00:30:00.000Z',
  );
  assert.equal(
    localDateTimeToInstant('2026-10-25', '02:30', 'Europe/Paris', 'later').toISOString(),
    '2026-10-25T01:30:00.000Z',
  );
  // Lord Howe changes by 30 minutes, not one hour.
  assert.throws(
    () => localDateTimeToInstant('2026-10-04', '02:15', 'Australia/Lord_Howe'),
    /n’existe pas/,
  );
  const first = localDateTimeToInstant('2026-04-05', '01:45', 'Australia/Lord_Howe', 'earlier');
  const last = localDateTimeToInstant('2026-04-05', '01:45', 'Australia/Lord_Howe', 'later');
  near(last.getTime() - first.getTime(), 30 * 60000);
});

test('invalid wall dates, clock fields and IANA zones do not silently roll over', () => {
  for (const [date, time, zone] of [
    ['2026-02-29', '12:00', 'UTC'],
    ['2026-04-31', '12:00', 'UTC'],
    ['2026-12-01', '24:00', 'UTC'],
    ['2026-12-01', '12:60', 'UTC'],
    ['2026-12-01', '12:00:60', 'UTC'],
    ['2026-12-01', '12:00', 'bad-zone'],
    ['2026-12-01', '12:00', ''],
    ['0000-01-01', '12:00', 'UTC'],
    ['2026-12-01', '12:00+02:00', 'UTC'],
  ])
    assert.throws(() => localDateTimeToInstant(date, time, zone), RangeError);
});
