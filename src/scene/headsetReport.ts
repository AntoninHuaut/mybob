import { GPU_CLASS_LABELS, steadyRateHz, type GpuClass } from './deviceProfile';
import { distribution } from './frameProfiler';

/**
 * The headset's own performance report, shown when a `?diagnostic` session leaves the
 * headset: the Quest Browser has no console, so the figures come back as copyable text.
 */

/** A frame longer than this many display intervals missed at least one refresh. */
const MISSED_REFRESH = 1.5;

export interface HeadsetFrameSummary {
  frames: number;
  durationMs: number;
  median: number;
  p95: number;
  /** Frames that missed at least one display refresh. */
  overBudget: number;
  /** The display rate read from the steadiest intervals, for a session without rate control. */
  measuredHz?: number;
}

/** Frame intervals of one session, each with the display rate asked for at the time. */
export class HeadsetFrameStats {
  private readonly intervals: number[] = [];
  private readonly rates: Array<number | undefined> = [];

  record(intervalMs: number, rateHz?: number): void {
    this.intervals.push(intervalMs);
    this.rates.push(rateHz);
  }

  summary(): HeadsetFrameSummary {
    const frames = this.intervals.length;
    const measuredHz = steadyRateHz(this.intervals);
    let overBudget = 0;
    this.intervals.forEach((interval, index) => {
      const rate = this.rates[index] ?? measuredHz;
      if (rate && interval > (MISSED_REFRESH * 1000) / rate) overBudget++;
    });
    return {
      frames,
      durationMs: this.intervals.reduce((sum, interval) => sum + interval, 0),
      ...distribution(this.intervals),
      overBudget,
      measuredHz,
    };
  }
}

export interface HeadsetSetup {
  /** The rate first asked for; undefined where the browser cannot set it (Link). */
  requestedHz?: number;
  /** The rate the governor ended on. */
  retainedHz?: number;
  scale: number;
  tethered: boolean;
  /** Null when the layer has no fixed foveation. */
  foveation: number | null;
  gpuClass: GpuClass;
  gpu: string;
}

function decimal(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

export function headsetReportLines(summary: HeadsetFrameSummary, setup: HeadsetSetup): string[] {
  const share = summary.frames ? (summary.overBudget * 100) / summary.frames : 0;
  const shareText = share > 0 && share < 0.5 ? 'moins de 1' : String(Math.round(share));
  const rate =
    setup.requestedHz === undefined
      ? `choisie par le casque · ${summary.measuredHz ?? '?'} Hz mesurés`
      : `demandée ${setup.requestedHz} Hz · retenue ${setup.retainedHz ?? setup.requestedHz} Hz`;
  return [
    '[casque] MyBob — rapport de la visite au casque',
    summary.frames
      ? `  images      ${summary.frames} images en ${decimal(summary.durationMs / 1000)} s · médiane ${decimal(summary.median)} ms · p95 ${decimal(summary.p95)} ms`
      : '  images      aucune image mesurée : la session s’est arrêtée pendant le chargement',
    `  saccades    ${shareText} % des images ont manqué au moins un rafraîchissement`,
    `  fréquence   ${rate}`,
    `  rendu       échelle ${decimal(setup.scale)} · ${setup.tethered ? 'relié à un PC' : 'autonome'} · fovéation ${setup.foveation === null ? 'non prise en charge' : decimal(setup.foveation)}`,
    `  machine     carte ${GPU_CLASS_LABELS[setup.gpuClass]} · ${setup.gpu}`,
  ];
}
