import type { SolarSettings } from '../model/types';
import { validateSolarSettings } from '../model/solarSettings';

export { validateSolarSettings } from '../model/solarSettings';
export type { SolarSettings } from '../model/types';

export interface SolarPosition {
  /** Apparent centre-of-disc elevation, with standard atmospheric refraction. */
  altitudeDeg: number;
  geometricAltitudeDeg: number;
  /** True geographic bearing, clockwise from north: east = 90°, south = 180°. */
  azimuthDeg: number;
  /** Unit vector from the house toward the sun, in model x/y/z coordinates. */
  directionToSun: { x: number; y: number; z: number };
  /** Babylon directional lights travel in the opposite direction. */
  lightDirection: { x: number; y: number; z: number };
  /** Apparent solar centre above the horizon; no sunlight is emitted at night. */
  daylight: boolean;
}

const radians = Math.PI / 180;
const degrees = 180 / Math.PI;
const mod = (value: number, base: number) => ((value % base) + base) % base;
const sin = (angle: number) => Math.sin(angle * radians);
const cos = (angle: number) => Math.cos(angle * radians);

/**
 * NOAA solar-calculator equations (Julian centuries, apparent longitude, equation
 * of time and atmospheric refraction). Longitude is positive east of Greenwich.
 * The instant is absolute: time zones affect UI conversion, not the astronomy.
 *
 * Model axes: +X right, +Z down the plan, +Y up. northAngleDeg is clockwise from
 * the plan's top (-Z); 90° points geographic north toward +X. No location or
 * orientation is inferred from personal documents or the user's browser.
 *
 * Refraction assumes a standard atmosphere; terrain, horizon obstructions and
 * weather are not modelled. Suitable for daylight previews, not survey readings.
 */
export function solarPosition(input: SolarSettings, instant: Date): SolarPosition {
  const settings = validateSolarSettings(input);
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime()))
    throw new RangeError('La date et l’heure du soleil sont invalides.');
  const julianDay = instant.getTime() / 86400000 + 2440587.5;
  const t = (julianDay - 2451545) / 36525;
  const meanLongitude = mod(280.46646 + t * (36000.76983 + 0.0003032 * t), 360);
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const equationOfCentre =
    sin(meanAnomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin(2 * meanAnomaly) * (0.019993 - 0.000101 * t) +
    sin(3 * meanAnomaly) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + equationOfCentre - 0.00569 - 0.00478 * sin(omega);
  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cos(omega);
  const declination = Math.asin(sin(obliquity) * sin(apparentLongitude)) * degrees;
  const y = Math.tan((obliquity * radians) / 2) ** 2;
  const equationOfTime =
    4 *
    degrees *
    (y * sin(2 * meanLongitude) -
      2 * eccentricity * sin(meanAnomaly) +
      4 * eccentricity * y * sin(meanAnomaly) * cos(2 * meanLongitude) -
      0.5 * y * y * sin(4 * meanLongitude) -
      1.25 * eccentricity * eccentricity * sin(2 * meanAnomaly));
  const utcMinutes =
    instant.getUTCHours() * 60 +
    instant.getUTCMinutes() +
    instant.getUTCSeconds() / 60 +
    instant.getUTCMilliseconds() / 60000;
  const solarMinutes = mod(utcMinutes + equationOfTime + 4 * settings.longitude, 1440);
  const hourAngle = solarMinutes / 4 - 180;
  const vertical =
    sin(settings.latitude) * sin(declination) +
    cos(settings.latitude) * cos(declination) * cos(hourAngle);
  const geometricAltitudeDeg = Math.asin(Math.max(-1, Math.min(1, vertical))) * degrees;
  // Vector form avoids tan(latitude) singularities at the geographic poles.
  const east = -cos(declination) * sin(hourAngle);
  const north =
    cos(settings.latitude) * sin(declination) -
    sin(settings.latitude) * cos(declination) * cos(hourAngle);
  const azimuthDeg = mod(Math.atan2(east, north) * degrees, 360);
  const tangent = Math.tan(geometricAltitudeDeg * radians);
  let refractionArcSeconds = 0;
  if (geometricAltitudeDeg <= 85 && geometricAltitudeDeg > 5)
    refractionArcSeconds = 58.1 / tangent - 0.07 / tangent ** 3 + 0.000086 / tangent ** 5;
  else if (geometricAltitudeDeg <= 5 && geometricAltitudeDeg > -0.575) {
    const h = geometricAltitudeDeg;
    refractionArcSeconds = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)));
  } else if (geometricAltitudeDeg <= -0.575) refractionArcSeconds = -20.772 / tangent;
  const altitudeDeg = geometricAltitudeDeg + refractionArcSeconds / 3600;
  const modelBearing = azimuthDeg + settings.northAngleDeg;
  const directionToSun = {
    x: cos(altitudeDeg) * sin(modelBearing),
    y: sin(altitudeDeg),
    z: -cos(altitudeDeg) * cos(modelBearing),
  };
  return {
    altitudeDeg,
    geometricAltitudeDeg,
    azimuthDeg,
    directionToSun,
    lightDirection: { x: -directionToSun.x, y: -directionToSun.y, z: -directionToSun.z },
    daylight: altitudeDeg > 0,
  };
}

export type LocalTimeDisambiguation = 'reject' | 'earlier' | 'later';

/**
 * Convert user-entered wall-clock date/time with an explicit IANA time zone.
 * DST gaps are rejected; repeated hours require an explicit earlier/later choice.
 * This deliberately does not use Date.parse('dateTtime') and the computer's zone.
 */
export function localDateTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
  disambiguation: LocalTimeDisambiguation = 'reject',
): Date {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof time !== 'string' ||
    !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)
  )
    throw new RangeError('Saisissez une date et une heure valides.');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, second, 0);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== day ||
    !['reject', 'earlier', 'later'].includes(disambiguation)
  )
    throw new RangeError('Saisissez une date et une heure valides.');
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 100)
    throw new RangeError('Le fuseau horaire est invalide.');
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new RangeError('Le fuseau horaire est invalide.');
  }
  const parts = (instant: Date) => {
    const fields = Object.fromEntries(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    const result = new Date(0);
    result.setUTCFullYear(Number(fields.year), Number(fields.month) - 1, Number(fields.day));
    result.setUTCHours(Number(fields.hour), Number(fields.minute), Number(fields.second), 0);
    return result.getTime();
  };
  const offsets = new Set<number>();
  // Both sides of every modern DST transition, including 30-minute changes.
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = wall.getTime() + delta * 3600000;
    offsets.add(parts(new Date(sample)) - sample);
  }
  const candidates = [...offsets]
    .map((offset) => wall.getTime() - offset)
    .filter((candidate) => parts(new Date(candidate)) === wall.getTime())
    .sort((a, b) => a - b);
  if (!candidates.length)
    throw new RangeError(
      'Cette heure locale n’existe pas dans ce fuseau lors du passage à l’heure d’été.',
    );
  if (candidates.length > 1 && disambiguation === 'reject')
    throw new RangeError(
      'Cette heure locale existe deux fois lors du changement d’heure ; choisissez la première ou la seconde occurrence.',
    );
  return new Date(disambiguation === 'later' ? candidates[candidates.length - 1] : candidates[0]);
}
