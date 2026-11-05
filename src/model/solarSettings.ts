import type { SolarSettings } from './types';

export class SolarSettingsValidationError extends Error {}

/** Validate only explicit settings: no geolocation lookup, network, storage or default place. */
export function validateSolarSettings(input: unknown): SolarSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SolarSettingsValidationError('Les réglages du soleil doivent être un objet.');
  const value = input as Record<string, unknown>;
  const finite = (candidate: unknown): candidate is number =>
    typeof candidate === 'number' && Number.isFinite(candidate);
  if (!finite(value.latitude) || value.latitude < -90 || value.latitude > 90)
    throw new SolarSettingsValidationError(
      'La latitude doit être un nombre compris entre −90° et 90°.',
    );
  if (!finite(value.longitude) || value.longitude < -180 || value.longitude > 180)
    throw new SolarSettingsValidationError(
      'La longitude doit être un nombre compris entre −180° et 180°.',
    );
  if (!finite(value.northAngleDeg))
    throw new SolarSettingsValidationError(
      'L’orientation du nord doit être un angle numérique en degrés.',
    );
  const result: SolarSettings = {
    latitude: value.latitude,
    longitude: value.longitude,
    northAngleDeg: ((value.northAngleDeg % 360) + 360) % 360,
  };
  if (value.timeZone !== undefined) {
    if (typeof value.timeZone !== 'string' || !value.timeZone.trim() || value.timeZone.length > 100)
      throw new SolarSettingsValidationError(
        'Le fuseau horaire doit être un identifiant IANA valide, par exemple Europe/Paris.',
      );
    const timeZone = value.timeZone.trim();
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone });
    } catch {
      throw new SolarSettingsValidationError(
        'Fuseau horaire inconnu. Utilisez un identifiant IANA, par exemple Europe/Paris.',
      );
    }
    result.timeZone = timeZone;
  }
  if (value.label !== undefined) {
    if (typeof value.label !== 'string' || value.label.length > 160)
      throw new SolarSettingsValidationError(
        'Le nom du lieu doit être un texte de 160 caractères au plus.',
      );
    if (value.label.trim()) result.label = value.label.trim();
  }
  return result;
}
