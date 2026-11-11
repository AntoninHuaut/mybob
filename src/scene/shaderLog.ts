/**
 * Which shader programs the engine links, when, and how long each blocks: the data
 * behind `mybob.shaders()`, meant to be read over the phone like `mybob.diag()`.
 * The program names come from the engine's effect cache, so they are approximate
 * when several programs are queued at once.
 */

/** The engine surface the log reads. */
export interface ShaderLogEngine {
  onBeforeShaderCompilationObservable: {
    add(callback: (engine: unknown, state: { target?: unknown }) => void): unknown;
  };
  onAfterShaderCompilationObservable: {
    add(callback: (engine: unknown, state: { target?: unknown }) => void): unknown;
  };
}

export interface ShaderLogEntry {
  kind: 'link' | 'mark';
  /** Milliseconds since the log started. */
  at: number;
  /** Time the link blocked, for a link. */
  ms: number;
  label: string;
}

const MAX_ENTRIES = 600;

export class ShaderLog {
  readonly entries: ShaderLogEntry[] = [];
  private readonly origin: number;
  private readonly started = new Map<unknown, { at: number; label: string }>();
  private readonly seen = new Set<string>();
  private cacheSize = () => 0;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.origin = now();
  }

  attach(engine: ShaderLogEngine): void {
    this.cacheSize = () =>
      Object.keys(
        (engine as unknown as { _compiledEffects?: Record<string, unknown> })._compiledEffects ??
          {},
      ).length;
    const cache = () =>
      Object.keys(
        (engine as unknown as { _compiledEffects?: Record<string, unknown> })._compiledEffects ??
          {},
      );
    engine.onBeforeShaderCompilationObservable.add((_engine, state) => {
      const fresh = cache().find((key) => !this.seen.has(key));
      if (fresh) this.seen.add(fresh);
      this.started.set(state.target, { at: this.now(), label: fresh ?? '?' });
    });
    engine.onAfterShaderCompilationObservable.add((_engine, state) => {
      const start = this.started.get(state.target);
      if (!start) return;
      this.started.delete(state.target);
      this.push({
        kind: 'link',
        at: start.at - this.origin,
        ms: this.now() - start.at,
        label: start.label,
      });
    });
  }

  /** Programs the engine has created so far, linked or not. */
  get effectCount(): number {
    return this.cacheSize();
  }

  /** A named point in the timeline, such as the start of a warm-up view. */
  mark(label: string): void {
    this.push({ kind: 'mark', at: this.now() - this.origin, ms: 0, label });
  }

  private push(entry: ShaderLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  report(): string {
    const links = this.entries.filter((entry) => entry.kind === 'link');
    const total = links.reduce((sum, entry) => sum + entry.ms, 0);
    const lines = [
      `[shaders] ${links.length} programmes liés · ${Math.round(total)} ms bloquants au total`,
    ];
    for (const entry of this.entries) {
      const at = `${(entry.at / 1000).toFixed(2)} s`.padStart(8);
      lines.push(
        entry.kind === 'mark'
          ? `${at}  ── ${entry.label}`
          : `${at}  ${String(Math.round(entry.ms)).padStart(5)} ms  ${shorten(entry.label)}`,
      );
    }
    return lines.join('\n');
  }
}

function shorten(key: string): string {
  const flat = key.replace(/\s+/g, ' ');
  return flat.length > 150 ? `${flat.slice(0, 150)}… (${flat.length})` : flat;
}

/** One log per page: engines are created once, scenes come and go. */
export const shaderLog = new ShaderLog();
