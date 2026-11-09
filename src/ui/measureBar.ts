import { number } from './format';
import type { Measurement } from '../scene/viewer';

interface MeasureBarHost {
  querySelector<T>(selector: string): T | null;
}

/**
 * DOM_only controller for the measure instructions bar and floating label.
 * The geometry lives in HouseViewer; this class never computes a distance.
 */
export class MeasureBar {
  constructor(
    private host: MeasureBarHost = typeof document === 'undefined'
      ? (undefined as never)
      : document,
  ) {}

  private element<T extends HTMLElement>(selector: string): T {
    return this.host.querySelector<T>(selector)!;
  }

  /** instructions visibility follows the viewer measure mode. */
  setActive(active: boolean): void {
    this.element('#measure-instructions').hidden = !active;
  }

  /** first click of a fresh measurement sequence. */
  resetPrompt(): void {
    this.element('#measure-instructions span').textContent = 'Cliquez sur deux points du sol.';
  }

  /** called from viewer.onMeasure for every interaction state change. */
  sync(measurement?: Measurement, message?: string): void {
    const label = this.element('#measure-label');
    label.hidden = !measurement?.b;
    this.element('#clear-measures').hidden = !measurement || Boolean(measurement.preview);
    if (measurement?.distance !== undefined) {
      label.textContent = `${number(measurement.distance)} m${
        measurement.aligned ? ' · droit' : ''
      }`;
      this.element('#measure-instructions span').textContent = measurement.preview
        ? 'Cliquez pour confirmer · Maj : droit · Alt : libre'
        : 'Un nouveau clic commence une autre mesure.';
    } else if (measurement)
      this.element('#measure-instructions span').textContent =
        message ?? 'Déplacez le pointeur · Maj : droit · Alt : libre';
  }

  /** clears the measurement UI when leaving the view or the mode. */
  hide(): void {
    this.element('#measure-instructions').hidden = true;
    this.element('#measure-label').hidden = true;
  }

  /** screen-space follow of the floating distance label. */
  moveTo(position: { x: number; y: number; visible: boolean }): void {
    const label = this.element('#measure-label');
    label.style.left = `${position.x}px`;
    label.style.top = `${position.y}px`;
    label.hidden = !position.visible;
  }

  /** one-shot wiring of the two bar buttons. */
  wire(handlers: { onEnd: () => void; onClear: () => boolean }): void {
    this.element('#end-measure').addEventListener('click', handlers.onEnd);
    this.element('#clear-measures').addEventListener('click', () => {
      if (handlers.onClear()) this.element('#clear-measures').hidden = true;
    });
  }
}
