import type { SolarSettings } from '../model/types';
import { localDateTimeToInstant } from '../scene/solar';
import { solarDay, solarLocalDate, solarLocalTime, type SolarDay } from './solarDay';

/** Compact scene controls; native inputs stay mounted while the slider moves. */
export class SolarTimeline {
  readonly element = document.createElement('details');
  private settings?: SolarSettings;
  private instant = new Date();
  private day?: SolarDay;
  private dayKey = '';
  private animation?: {
    startMinutes: number;
    endMinutes: number;
    startedAt: number;
    lastBucket: number;
    frame: number;
  };
  constructor(
    host: HTMLElement,
    private onChange: (instant: Date) => void,
    onSettings: () => void,
  ) {
    this.element.className = 'solar-timeline';
    this.element.open = true;
    this.element.hidden = true;
    this.element.innerHTML = `<summary>Soleil <span data-solar-timeline-time></span></summary>
      <div class="solar-timeline-body">
        <div class="solar-timeline-date-row"><label>Date sur place<input type="date" min="0001-01-01" max="9999-12-30" data-solar-timeline-date></label><button type="button" data-solar-season="summer">Été</button><button type="button" data-solar-season="winter">Hiver</button><button type="button" data-solar-timeline-settings aria-label="Localisation et orientation du soleil" title="Localisation et orientation">Réglages</button></div>
        <label class="solar-timeline-slider">Heure sur place<input type="range" min="0" step="1" data-solar-timeline-slider></label>
        <div class="solar-timeline-play-row"><button type="button" data-solar-timeline-play aria-pressed="false" title="Dérouler la journée en 12 secondes">Animer la journée</button></div>
        <p data-solar-timeline-day></p><p class="solar-timeline-note">Lever / coucher approximatifs · Plan : éclairage neutre</p>
        <p class="solar-timeline-status" data-solar-timeline-status role="status"></p>
      </div>`;
    host.append(this.element);
    this.control<HTMLInputElement>('[data-solar-timeline-slider]').addEventListener('input', () => {
      this.stopAnimation();
      if (!this.day) return;
      const minutes = Number(this.control<HTMLInputElement>('[data-solar-timeline-slider]').value);
      this.change(new Date(this.day.start.getTime() + minutes * 60000));
    });
    this.control<HTMLInputElement>('[data-solar-timeline-date]').addEventListener('change', () => {
      this.stopAnimation();
      this.changeDate(this.control<HTMLInputElement>('[data-solar-timeline-date]').value);
    });
    this.control<HTMLButtonElement>('[data-solar-timeline-play]').addEventListener('click', () =>
      this.animation ? this.stopAnimation() : this.startAnimation(),
    );
    this.element.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.hasAttribute('data-solar-timeline-settings')) {
        this.stopAnimation();
        onSettings();
      }
      const season = button.dataset.solarSeason;
      if (season && this.settings) {
        this.stopAnimation();
        const year = solarLocalDate(this.instant, this.timeZone()).slice(0, 4);
        const june = (season === 'summer') === this.settings.latitude >= 0;
        this.changeDate(`${year}-${june ? '06-21' : '12-21'}`);
      }
    });
  }
  private control<T extends HTMLElement>(selector: string): T {
    return this.element.querySelector<T>(selector)!;
  }
  private timeZone() {
    return this.settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  update(settings: SolarSettings | undefined, instant: Date) {
    this.settings = settings;
    this.instant = instant;
    this.element.hidden = !settings;
    if (!settings) {
      this.stopAnimation();
      return;
    }
    const zone = this.timeZone();
    const date = solarLocalDate(instant, zone);
    const dayKey = JSON.stringify([date, zone, settings.latitude, settings.longitude]);
    if (this.dayKey !== dayKey) {
      this.stopAnimation();
      this.day = solarDay(settings, date, zone);
      this.dayKey = dayKey;
    }
    const day = this.day!;
    const clock = new Intl.DateTimeFormat('fr-FR', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset',
    }).format(instant);
    this.control('[data-solar-timeline-time]').textContent = clock;
    this.control<HTMLInputElement>('[data-solar-timeline-date]').value = date;
    const slider = this.control<HTMLInputElement>('[data-solar-timeline-slider]');
    slider.max = String(Math.ceil((day.end.getTime() - day.start.getTime()) / 60000) - 1);
    slider.value = String(Math.floor((instant.getTime() - day.start.getTime()) / 60000));
    slider.setAttribute('aria-valuetext', `${clock}, ${zone}`);
    this.control('[data-solar-timeline-day]').textContent =
      day.state === 'polar-day'
        ? 'Soleil au-dessus de l’horizon toute la journée'
        : day.state === 'polar-night'
          ? 'Soleil sous l’horizon toute la journée'
          : `Lever ${day.sunrise ? solarLocalTime(day.sunrise, zone) : 'absent ce jour'} · Coucher ${day.sunset ? solarLocalTime(day.sunset, zone) : 'absent ce jour'}`;
    for (const season of ['summer', 'winter']) {
      const june = (season === 'summer') === settings.latitude >= 0;
      this.control<HTMLButtonElement>(`[data-solar-season=${season}]`).title =
        `${june ? '21 juin' : '21 décembre'} · même heure locale, même caméra`;
    }
  }
  private startAnimation() {
    if (!this.day || !this.settings) return;
    const slider = this.control<HTMLInputElement>('[data-solar-timeline-slider]');
    const endMinutes = Number(slider.max);
    const startMinutes = Math.min(Number(slider.value), endMinutes);
    const animation = {
      startMinutes,
      endMinutes,
      startedAt: performance.now(),
      lastBucket: Math.floor(startMinutes / 15),
      frame: 0,
    };
    this.animation = animation;
    const button = this.control<HTMLButtonElement>('[data-solar-timeline-play]');
    button.setAttribute('aria-pressed', 'true');
    button.textContent = 'Arrêter';
    const step = () => {
      if (this.animation !== animation) return;
      if (!this.element.open || this.element.hidden) {
        this.stopAnimation();
        return;
      }
      const elapsed = performance.now() - animation.startedAt;
      const progress = Math.min(elapsed / 12000, 1);
      const minutes =
        animation.startMinutes + progress * (animation.endMinutes - animation.startMinutes);
      const bucket = Math.floor(minutes / 15);
      if (bucket !== animation.lastBucket || progress >= 1) {
        animation.lastBucket = bucket;
        this.change(new Date(this.day!.start.getTime() + minutes * 60000));
      }
      if (progress >= 1) this.stopAnimation();
      else animation.frame = this.scheduleFrame(step);
    };
    animation.frame = this.scheduleFrame(step);
  }
  private scheduleFrame(callback: () => void): number {
    return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : 0;
  }
  private stopAnimation() {
    if (!this.animation) return;
    if (this.animation.frame && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(this.animation.frame);
    this.animation = undefined;
    const button = this.control<HTMLButtonElement>('[data-solar-timeline-play]');
    button.setAttribute('aria-pressed', 'false');
    button.textContent = 'Animer la journée';
  }
  private changeDate(date: string) {
    try {
      const instant = localDateTimeToInstant(
        date,
        solarLocalTime(this.instant, this.timeZone()),
        this.timeZone(),
      );
      this.change(instant);
    } catch (error) {
      this.showError(error);
    }
  }
  private change(instant: Date) {
    try {
      this.onChange(instant);
      this.control('[data-solar-timeline-status]').textContent = '';
    } catch (error) {
      this.showError(error);
    }
  }
  private showError(error: unknown) {
    this.update(this.settings, this.instant);
    this.control('[data-solar-timeline-status]').textContent =
      error instanceof Error ? error.message : 'Impossible de modifier le soleil.';
  }
}
