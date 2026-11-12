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
  /** `parallelShaderCompile` is the `KHR_parallel_shader_compile` extension, when present. */
  getCaps?(): { parallelShaderCompile?: unknown };
}

export interface ShaderLogEntry {
  kind: 'link' | 'mark';
  /** Milliseconds since the log started. */
  at: number;
  /** Time the link blocked, for a link. */
  ms: number;
  label: string;
  /** For a mark, the view whose preparation it starts or ends. */
  view?: { key: string; edge: 'start' | 'end' };
}

const MAX_ENTRIES = 600;

export class ShaderLog {
  readonly entries: ShaderLogEntry[] = [];
  private readonly origin: number;
  private readonly started = new Map<unknown, { at: number; label: string }>();
  private readonly seen = new Set<string>();
  private cacheSize = () => 0;
  /** Whether the engine links in the background; unknown until attached. */
  private parallel: boolean | undefined;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.origin = now();
  }

  attach(engine: ShaderLogEngine): void {
    // Without the extension every link blocks the page until the driver is done.
    this.parallel = engine.getCaps ? Boolean(engine.getCaps().parallelShaderCompile) : undefined;
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

  /** Start (`start`) or end (`end`) of a view's preparation behind the overlay. */
  markView(key: string, edge: 'start' | 'end', detail: string): void {
    const label = `${edge === 'start' ? 'préparation' : 'prête'} : ${key} · ${detail}`;
    this.push({ kind: 'mark', at: this.now() - this.origin, ms: 0, label, view: { key, edge } });
  }

  /**
   * The figures to check first, before the truncated timeline. With
   * `KHR_parallel_shader_compile` the engine only polls for completion, so a link's
   * `ms` is how long it took to finish, not how long it froze the page, and links
   * overlap: their sum means nothing. What the user waits for is the overlay, from
   * a view's `préparation` mark to its `prête` mark.
   */
  summary(): string[] {
    const views: Array<{ key: string; from: number; to?: number; links: number; ms: number }> = [];
    let current: (typeof views)[number] | undefined;
    let late = 0;
    for (const entry of this.entries) {
      if (entry.view?.edge === 'start') {
        current = { key: entry.view.key, from: entry.at, links: 0, ms: 0 };
        views.push(current);
      } else if (entry.view?.edge === 'end') {
        if (current) current.to = entry.at;
        current = undefined;
      } else if (entry.kind === 'link') {
        if (current) {
          current.links++;
          current.ms += entry.ms;
        } else if (views.length) late++;
      }
    }
    const parallel =
      this.parallel === undefined
        ? 'inconnue'
        : this.parallel
          ? 'oui (les durées de liaison sont des latences, pas des blocages)'
          : 'non (chaque liaison bloque la page)';
    return [
      `[shaders] compilation parallèle (KHR_parallel_shader_compile) : ${parallel}`,
      ...views.map((view) => {
        const overlay =
          view.to === undefined ? 'en cours' : `${((view.to - view.from) / 1000).toFixed(2)} s`;
        const blocking = this.parallel === false ? ` · ${Math.round(view.ms)} ms bloquants` : '';
        return `[shaders] préparation ${view.key} : ${overlay} · ${view.links} programmes${blocking}`;
      }),
      views.length
        ? `[shaders] ${late} programmes liés après une préparation`
        : '[shaders] aucune vue préparée',
    ];
  }

  private push(entry: ShaderLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  report(): string {
    const links = this.entries.filter((entry) => entry.kind === 'link');
    const total = links.reduce((sum, entry) => sum + entry.ms, 0);
    const lines = [
      this.parallel
        ? `[shaders] ${links.length} programmes liés`
        : `[shaders] ${links.length} programmes liés · ${Math.round(total)} ms bloquants au total`,
      ...this.summary(),
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

/**
 * Plugins attached to the scene's first PBR material, with their enabled state: a
 * plugin switching on or off changes the defines of every material, hence every
 * program. Reads Babylon's private list, which is fine for a diagnostic.
 */
export function pluginSummary(
  materials: ReadonlyArray<{ getClassName(): string; pluginManager?: unknown }>,
): string {
  const material = materials.find((candidate) => candidate.getClassName() === 'PBRMaterial');
  const plugins = (
    material?.pluginManager as
      { _plugins?: Array<{ name: string; isEnabled?: boolean; _isEnabled?: boolean }> } | undefined
  )?._plugins;
  if (!plugins) return 'plugins ?';
  return `plugins ${plugins.map((plugin) => `${plugin.name}${(plugin.isEnabled ?? plugin._isEnabled) ? '+' : '-'}`).join(' ')}`;
}

function shorten(key: string): string {
  const flat = key.replace(/\s+/g, ' ');
  return flat.length > 150 ? `${flat.slice(0, 150)}… (${flat.length})` : flat;
}

/** One log per page: engines are created once, scenes come and go. */
export const shaderLog = new ShaderLog();
