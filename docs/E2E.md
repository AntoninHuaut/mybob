# End-to-end tests

Playwright scenarios only use the public demonstration build, served on `127.0.0.1`, on a free port drawn on every run. They target neither the deployed site nor a personal project. Every test starts with a blank browser context and storage.

One-time prerequisite: `pnpm exec playwright install chromium` (on Linux,
`pnpm exec playwright install --with-deps chromium` on first install). Port choice and
server: `playwright.config.ts`.

## Execution policy and CI recipes

[AGENTS.md: Local browser verification policy](../AGENTS.md#local-browser-verification-policy)
is the single source of truth for local runs and permitted evidence. Follow it before any
local browser command. Routine browser workflows run in CI, sharded in three:

```sh
pnpm run build
pnpm run check:public
node scripts/e2e-shard.mjs n/3
```

For the narrowly allowed reproduction of a concrete CI failure on an already-built `dist/`:

```sh
pnpm exec playwright test e2e/<failing-file>.spec.ts --grep "^exact failing test title$" --workers=1 --repeat-each=1
```

Scenarios: `e2e/workflows.spec.ts` (sofa against a wall, draft, variants, JSON
export/import, plan/PNG, measurements, welcome), `e2e/furniture-actions.spec.ts` (chairs and
table, TV link, dragging), `e2e/share-link.spec.ts` (link sharing: recipient read-only,
adoption, silence for the owner, old link, corrupted hash), `e2e/first-steps.spec.ts`
(« Premiers pas » card, help), `e2e/concurrent-tabs.spec.ts` (two tabs on the same storage),
`e2e/orbit-shaders.spec.ts` (shader reuse during orbit and cleanup on project switch),
`e2e/view-state.spec.ts` (accepted view chrome, project/level resets and touch-only walk refusal).
`pnpm run test:e2e` builds and checks the public output before running all scenarios in CI.
`pnpm run test:e2e:built` runs scenarios on the already verified build. Browser HTML reports,
screenshots, test-results and traces are not uploaded by CI. The public-build artifact is
still exchanged between build and browser jobs. Inspect text logs for failures and follow
the linked local policy before reproducing a failure.

Scenarios run in desktop Chromium, on the SwiftShader software renderer, to stay runnable on a
machine without a GPU. They go through the interface and downloaded files, without accessing
the engine's internal instance nor modifying `localStorage` directly. Assertions on visible
text match the French interface.

`e2e/screen-lines.spec.ts` uses only the bundled studio. It probes exported Plan dimension
coverage at DPR 1 and 2 and repeated settled overview exports after Plan round trips. The
overview scenario waits for the 32-image settle window, so its idle poll budgets for software
frame times far slower than a GPU. Downloaded PNG data is decoded in memory, and only numeric
summaries reach text logs; there are no image or trace attachments. These CI-only probes do
not replace visual acceptance of thin window geometry or a measured motion-performance
comparison.

Configuration: `playwright.config.ts`.

CI collects the current test list before assigning every test to exactly one shard,
longest estimates first. `scripts/e2e-durations.json` records each test's median worker
milliseconds over the text logs of six successful `main` runs (18 shard logs); new or
renamed scenarios default to 30 seconds. Single-run timings vary up to 2× per test on
the shared runners, so refresh from several runs when scenario durations change: save each
shard log with `gh run view <run> --log --job <job> > <file>`, then
`node scripts/e2e-shard.mjs --refresh <file>...` rewrites the estimates.
`node scripts/e2e-shard.mjs n/3 --list` checks membership without running browsers.
The static estimates balance expected work, not runner load; confirm the slowest shard
stays within 25% of the fastest over three consecutive successful `main` runs.

`e2e/antialias.spec.ts` exports the reset overview camera as a transparent PNG without
labels or a header. The first opaque silhouette edge in each column must contain
partially covered pixels. This tests raster coverage rather than material colours,
and needs no platform-specific screenshot baseline. Setting orbit bloom samples to 1
must make the scenario fail. It covers the overview silhouette, not Plan lines or walk TAA.

`tests/scene-budget.test.ts` builds the ground level, real material factories, exterior
and one default piece of every furniture kind on each public fixture using NullEngine.
Its mesh, material and vertex limits are the measured counts plus 10%, rounded up.
The canvas drawing API is stubbed; this measures resource counts, not texture appearance.
Lower these limits when optimisations reduce the baseline; investigate increases before
changing a limit.

The first-steps rotation scenarios observe `data-orbit-tour` and `data-orbit-tour-angle`
on the canvas. Completion is published only after the final camera angle is applied;
reduced motion completes synchronously in the click handler. They assert the 60-degree
preview angle (π/3 radians), without fixed sleeps.
