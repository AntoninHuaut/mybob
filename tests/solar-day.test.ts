import assert from 'node:assert/strict';
import test from 'node:test';
import { localSolarDayBounds, solarDay, solarLocalDate, solarLocalTime } from '../src/ui/solarDay';
import { solarPosition } from '../src/scene/solar';

const paris = { latitude: 48.8566, longitude: 2.3522, northAngleDeg: 0, timeZone: 'Europe/Paris' };

test('solar day uses the actual local day length across DST and fractional time zones', () => {
  for (const [date, timeZone, hours] of [
    ['2026-03-29', 'Europe/Paris', 23],
    ['2026-10-25', 'Europe/Paris', 25],
    ['2026-07-01', 'Asia/Kathmandu', 24],
  ] as const) {
    const { start, end } = localSolarDayBounds(date, timeZone);
    assert.equal((end.getTime() - start.getTime()) / 3600000, hours);
    assert.equal(solarLocalDate(start, timeZone), date);
    assert.equal(solarLocalTime(start, timeZone), '00:00');
    assert.notEqual(solarLocalDate(end, timeZone), date);
  }
  assert.throws(() => localSolarDayBounds('2026-02-30', 'UTC'), /date/);
  assert.throws(() => localSolarDayBounds('2011-12-30', 'Pacific/Apia'), /n’existe pas/);
});

test('approximate sunrise and sunset cross the same model horizon used for lighting', () => {
  const day = solarDay(paris, '2026-06-21', 'Europe/Paris');
  assert.equal(day.state, 'crossings');
  assert.ok(day.sunrise && day.sunset);
  assert.ok(day.sunrise < day.sunset);
  for (const [instant, rises] of [
    [day.sunrise, true],
    [day.sunset, false],
  ] as const) {
    const before = solarPosition(paris, new Date(instant.getTime() - 1000));
    const after = solarPosition(paris, new Date(instant.getTime() + 1000));
    assert.equal(before.daylight, !rises);
    assert.equal(after.daylight, rises);
    assert.ok(Math.abs(solarPosition(paris, instant).altitudeDeg) < 0.01);
  }
  assert.equal(day.sunrise.getUTCDate(), 21);
  assert.equal(day.sunset.getUTCDate(), 21);
});

test('solar day explicitly handles polar daylight and darkness without invented event times', () => {
  for (const [latitude, date, state] of [
    [90, '2026-06-21', 'polar-day'],
    [90, '2026-12-21', 'polar-night'],
    [-90, '2026-12-21', 'polar-day'],
  ] as const) {
    const day = solarDay({ ...paris, latitude }, date, 'UTC');
    assert.equal(day.state, state);
    assert.equal(day.sunrise, undefined);
    assert.equal(day.sunset, undefined);
  }
});
