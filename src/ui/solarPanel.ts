import './solarPanel.css';
import type { HouseProject, SolarSettings } from '../model/types';
import { validateSolarSettings } from '../model/solarSettings';
import { localDateTimeToInstant } from '../scene/solar';
import { escapeHtml as esc } from './format';
import { icon } from './icons';
import { SolarTimeline } from './solarTimeline';

interface SolarCallbacks {
  onApply(settings: SolarSettings | undefined, instant: Date): void;
  onDialogState(open: boolean): void;
}
const key = (id: string) => `maison-atelier:solar:${id}`;

/** Location stays local; only an explicitly submitted town search reaches Open-Meteo. */
export class SolarPanel {
  readonly dialog = document.createElement('dialog');
  private project?: HouseProject;
  private value?: SolarSettings;
  private instant = new Date();
  private searchController?: AbortController;
  private timeline?: SolarTimeline;
  private candidates: { name: string; latitude: number; longitude: number; timezone: string }[] =
    [];
  constructor(private callbacks: SolarCallbacks) {
    this.dialog.className = 'solar-dialog';
    this.dialog.setAttribute('aria-labelledby', 'solar-title');
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => {
      this.searchController?.abort();
      callbacks.onDialogState(false);
    });
    this.dialog.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.dataset.solarClose !== undefined) this.dialog.close();
      if (button.dataset.solarSearch !== undefined) void this.search();
      if (button.dataset.solarResult !== undefined) {
        const result = this.candidates[Number(button.dataset.solarResult)];
        if (!result) return;
        this.input('latitude').value = String(result.latitude);
        this.input('longitude').value = String(result.longitude);
        this.input('timeZone').value = result.timezone;
        this.input('city').value = result.name;
        this.query('[data-solar-results]').replaceChildren();
        this.status('Localisation sélectionnée. Appliquez pour voir le soleil.');
      }
      if (button.dataset.solarReset !== undefined) this.reset();
    });
    this.dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      this.apply();
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || (event.target as HTMLInputElement).name !== 'city') return;
      event.preventDefault();
      void this.search();
    });
    this.dialog.addEventListener('input', (event) => {
      if ((event.target as HTMLInputElement).name !== 'city') return;
      this.searchController?.abort();
      this.query<HTMLButtonElement>('[data-solar-search]').disabled = false;
      this.query('[data-solar-results]').replaceChildren();
      this.candidates = [];
      this.input('latitude').value = '';
      this.input('longitude').value = '';
      this.query<HTMLDetailsElement>('details').open = true;
      this.status('Recherchez et choisissez une commune, ou saisissez ses coordonnées.');
    });
  }
  get settings() {
    return this.value ? { ...this.value } : undefined;
  }
  mountTimeline(host: HTMLElement) {
    this.timeline?.element.remove();
    this.timeline = new SolarTimeline(
      host,
      (instant) => {
        if (this.value) this.commit(this.value, instant);
      },
      () => this.open(),
    );
    this.timeline.update(this.settings, this.instant);
  }
  private commit(settings: SolarSettings, instant: Date) {
    const next = { ...settings, instant: instant.toISOString() };
    localStorage.setItem(key(this.project!.id), JSON.stringify(next));
    this.value = next;
    this.instant = instant;
    this.callbacks.onApply(this.settings, instant);
    this.timeline?.update(this.settings, instant);
  }
  /**
   * Effective settings of a project: the local preference wins, otherwise the project's.
   * Used by the state link even before the project is loaded into the panel.
   */
  settingsFor(project: HouseProject): SolarSettings | undefined {
    let value: SolarSettings | undefined = project.solar;
    try {
      const saved = localStorage.getItem(key(project.id));
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        value = parsed === null ? undefined : validateSolarSettings(parsed);
      }
    } catch {
      /* A malformed preference must not stop loading a house. */
    }
    return value;
  }
  load(project: HouseProject) {
    this.project = project;
    this.value = this.settingsFor(project);
    this.instant = this.value?.instant ? new Date(this.value.instant) : new Date();
    this.callbacks.onApply(this.settings, this.instant);
    this.timeline?.update(this.settings, this.instant);
  }
  open() {
    this.searchController?.abort();
    this.candidates = [];
    const settings = this.value;
    const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(this.instant);
    const part = (name: string) => parts.find((p) => p.type === name)?.value ?? '';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    const time = `${part('hour')}:${part('minute')}`;
    this.dialog.innerHTML = `<form class="solar-form">
      <div class="solar-heading"><h2 id="solar-title">Soleil et orientation</h2><button type="button" data-solar-close aria-label="Fermer">${icon('close', 20)}</button></div>
      <p class="solar-intro">Situez la maison, puis choisissez un moment de la journée. Le mode Plan conserve un éclairage neutre.</p>
      <section><h3>Où se trouve la maison ?</h3><div class="solar-search"><label>Commune<input name="city" value="${esc(settings?.label ?? '')}" placeholder="Rechercher une commune" autocomplete="off"></label><button type="button" data-solar-search>Rechercher</button></div><p class="solar-note">Recherche <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> : seul le nom saisi est envoyé. Le plan reste sur cet ordinateur.</p><div data-solar-results class="solar-results"></div>
      <details ${settings ? '' : 'open'}><summary>Coordonnées et fuseau horaire</summary><div class="solar-grid"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required value="${settings?.latitude ?? ''}" placeholder="Ex. 48,86"></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required value="${settings?.longitude ?? ''}" placeholder="Ex. 2,35"></label></div><label>Fuseau horaire<input name="timeZone" required value="${esc(timeZone)}" placeholder="Europe/Paris"></label></details></section>
      <section><h3>Orientation du plan</h3><div class="solar-north-row"><label>Direction du nord<select name="northPreset"><option value="0">Vers le haut du plan</option><option value="90">Vers la droite</option><option value="180">Vers le bas</option><option value="270">Vers la gauche</option><option value="custom">Angle personnalisé</option></select></label><label>Angle depuis le haut du plan<span class="solar-unit"><input name="northAngleDeg" type="number" min="0" max="359.9" step="any" value="${settings?.northAngleDeg ?? 0}" required><span>°</span></span></label></div><p class="solar-note">Sens horaire : 0° = haut, 90° = droite. Reprenez la flèche nord du plan ; le haut de la feuille n’est pas forcément le nord.</p></section>
      <section><h3>Date et heure sur place</h3><div class="solar-grid"><label>Date<input type="date" name="date" required value="${date}"></label><label>Heure<input type="time" name="time" required value="${time}"></label></div></section>
      <p class="solar-note">Aperçu de l’ensoleillement sur les volumes modélisés. Le relief, les bâtiments voisins et la météo ne sont pas simulés. La toiture et les murs visibles influencent les ombres.</p>
      <p class="solar-status" data-solar-status role="status"></p>
      <footer><button type="button" data-solar-reset>Éclairage standard</button><span></span><button type="button" data-solar-close>Annuler</button><button type="submit" class="primary-button">Appliquer</button></footer></form>`;
    const preset = this.query<HTMLSelectElement>('[name=northPreset]');
    const north = this.input('northAngleDeg');
    preset.value = ['0', '90', '180', '270'].includes(north.value) ? north.value : 'custom';
    preset.addEventListener('change', () => {
      if (preset.value !== 'custom') north.value = preset.value;
    });
    north.addEventListener('input', () => {
      preset.value = ['0', '90', '180', '270'].includes(north.value) ? north.value : 'custom';
    });
    this.dialog.showModal();
    this.callbacks.onDialogState(true);
    this.input('city').focus();
  }
  private query<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.dialog.querySelector<T>(selector)!;
  }
  private input(name: string) {
    return this.query<HTMLInputElement>(`[name=${name}]`);
  }
  private status(message: string) {
    this.query('[data-solar-status]').textContent = message;
  }
  private apply() {
    if (!this.query<HTMLFormElement>('form').reportValidity()) return;
    try {
      const settings = validateSolarSettings({
        latitude: Number(this.input('latitude').value),
        longitude: Number(this.input('longitude').value),
        northAngleDeg: Number(this.input('northAngleDeg').value),
        timeZone: this.input('timeZone').value.trim(),
        label: this.input('city').value.trim().slice(0, 160),
      });
      const instant = localDateTimeToInstant(
        this.input('date').value,
        this.input('time').value,
        settings.timeZone!,
      );
      this.commit(settings, instant);
      this.dialog.close();
    } catch (error) {
      this.status(error instanceof Error ? error.message : 'Réglages impossibles à appliquer.');
    }
  }
  private reset() {
    try {
      // A null preference explicitly overrides a solar setting carried in an imported file.
      localStorage.setItem(key(this.project!.id), 'null');
      this.value = undefined;
      this.callbacks.onApply(undefined, this.instant);
      this.timeline?.update(undefined, this.instant);
      this.dialog.close();
    } catch {
      this.status('Sauvegarde locale indisponible.');
    }
  }
  private async search() {
    const name = this.input('city').value.trim();
    if (name.length < 2) {
      this.status('Saisissez au moins deux caractères.');
      return;
    }
    this.searchController?.abort();
    const controller = (this.searchController = new AbortController());
    const button = this.query<HTMLButtonElement>('[data-solar-search]');
    button.disabled = true;
    this.status('Recherche de la commune…');
    try {
      const response = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name, count: '5', language: 'fr', format: 'json' })}`,
        { signal: controller.signal },
      );
      if (!response.ok)
        throw new Error('Recherche indisponible. Vous pouvez saisir les coordonnées.');
      const data: unknown = await response.json();
      if (controller.signal.aborted || controller !== this.searchController || !this.dialog.open)
        return;
      const results = (data as { results?: unknown[] })?.results;
      this.candidates = Array.isArray(results)
        ? results
            .flatMap((entry) => {
              if (!entry || typeof entry !== 'object') return [];
              const row = entry as Record<string, unknown>;
              if (
                typeof row.name !== 'string' ||
                typeof row.latitude !== 'number' ||
                typeof row.longitude !== 'number' ||
                typeof row.timezone !== 'string'
              )
                return [];
              return [
                {
                  name: [row.name, row.admin1, row.country]
                    .filter((v) => typeof v === 'string')
                    .join(', '),
                  latitude: row.latitude,
                  longitude: row.longitude,
                  timezone: row.timezone,
                },
              ];
            })
            .slice(0, 5)
        : [];
      this.query('[data-solar-results]').innerHTML = this.candidates
        .map(
          (result, i) =>
            `<button type="button" data-solar-result="${i}">${esc(result.name)}</button>`,
        )
        .join('');
      this.status(
        this.candidates.length
          ? 'Choisissez la commune dans les résultats.'
          : 'Aucune commune trouvée. Essayez un nom voisin ou les coordonnées.',
      );
    } catch (error) {
      if (!controller.signal.aborted)
        this.status(error instanceof Error ? error.message : 'Recherche indisponible.');
    } finally {
      if (!controller.signal.aborted) button.disabled = false;
    }
  }
}
