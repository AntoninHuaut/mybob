import type { SolarSettings } from '../model/types';
import { solarPosition } from '../scene/solar';

export function solarLocalDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (name: string) => parts.find((entry) => entry.type === name)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

export function solarLocalTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

export interface SolarDay {
  start: Date;
  end: Date;
  sunrise?: Date;
  sunset?: Date;
  state: 'crossings' | 'polar-day' | 'polar-night';
}

/** Real instants in a local calendar day: the range includes DST gaps/repeated hours. */
export function localSolarDayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('La date est invalide.');
  const noon = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(noon.getTime()) || noon.toISOString().slice(0, 10) !== date)
    throw new RangeError('La date est invalide.');
  const tomorrow = new Date(noon);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const nextDate = solarLocalDate(tomorrow, 'UTC');
  const boundary = (target: string) => {
    const calendarNumber = (value: string) => Number(value.replaceAll('-', ''));
    let low = noon.getTime() - 48 * 3600000;
    let high = noon.getTime() + 48 * 3600000;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (calendarNumber(solarLocalDate(new Date(middle), timeZone)) < calendarNumber(target))
        low = middle;
      else high = middle;
    }
    return new Date(high);
  };
  const start = boundary(date);
  if (solarLocalDate(start, timeZone) !== date)
    throw new RangeError('Cette date locale n’existe pas dans ce fuseau.');
  return { start, end: boundary(nextDate) };
}

/** Approximate centre-of-disc horizon crossings, using the same apparent altitude as the scene. */
export function solarDay(settings: SolarSettings, date: string, timeZone: string): SolarDay {
  const bounds = localSolarDayBounds(date, timeZone);
  const altitude = (time: number) => solarPosition(settings, new Date(time)).altitudeDeg;
  let previous = bounds.start.getTime();
  let wasDay = altitude(previous) > 0;
  const beganInDaylight = wasDay;
  let sunrise: Date | undefined;
  let sunset: Date | undefined;
  for (let sample = previous + 10 * 60000; ; sample += 10 * 60000) {
    const current = Math.min(sample, bounds.end.getTime() - 1);
    const isDay = altitude(current) > 0;
    if (isDay !== wasDay) {
      let low = previous;
      let high = current;
      while (high - low > 1000) {
        const middle = Math.floor((low + high) / 2);
        if (altitude(middle) > 0 === wasDay) low = middle;
        else high = middle;
      }
      if (isDay) sunrise = new Date(high);
      else sunset = new Date(high);
    }
    previous = current;
    wasDay = isDay;
    if (current >= bounds.end.getTime() - 1) break;
  }
  return {
    ...bounds,
    sunrise,
    sunset,
    state: sunrise || sunset ? 'crossings' : beganInDaylight ? 'polar-day' : 'polar-night',
  };
}
