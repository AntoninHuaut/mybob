# End-to-end tests

Playwright scenarios only use the public demonstration build, served on `127.0.0.1`, on a free port drawn on every run. They target neither the deployed site nor a personal project. Every test starts with a blank browser context and storage.

One-time prerequisite: `pnpm exec playwright install chromium` (on Linux,
`pnpm exec playwright install --with-deps chromium` on first install). Port choice and
server: `playwright.config.ts`.

## Locally: target the feature, never the whole suite

The full e2e suite belongs to the pipeline: CI runs it sharded in three
(`test:e2e:built --shard=n/3`, `ci.yml`). Locally, an e2e scenario is only for iterating on
the browser workflow touched by a change — by title with `--grep`, or by file:

```sh
pnpm run build                                   # once, freezes dist/
pnpm exec playwright test --grep "measure"       # scenarios whose title contains "measure"
pnpm exec playwright test --grep "link"          # URL sharing (e2e/share-link.spec.ts)
pnpm exec playwright test e2e/furniture-actions.spec.ts   # every scenario of a file
```

Scenarios: `e2e/workflows.spec.ts` (sofa against a wall, draft, variants, JSON
export/import, plan/PNG, measurements, welcome), `e2e/furniture-actions.spec.ts` (chairs and
table, TV link, dragging), `e2e/share-link.spec.ts` (link sharing: recipient read-only,
adoption, silence for the owner, old link, corrupted hash), `e2e/first-steps.spec.ts`
(« Premiers pas » card, help), `e2e/concurrent-tabs.spec.ts` (two tabs on the same storage),
`e2e/orbit-shaders.spec.ts` (shader reuse during orbit and cleanup on project switch).
Pick the file first, the `--grep` second.

`pnpm run test:e2e` (full build + personal-plan exclusion + every scenario) is not the local
loop: it only exists for CI, which replays everything on the verified build. After an already
verified public build, `pnpm run test:e2e:built` runs the scenarios alone — it is the one that
takes the `--grep` or the file. `pnpm run test:e2e:report` opens the local HTML report.
`--headed` shows the browser.

Scenarios run in desktop Chromium, on the SwiftShader software renderer, to stay runnable on a
machine without a GPU. They go through the interface and downloaded files, without accessing
the engine's internal instance nor modifying `localStorage` directly. Assertions on visible
text match the French interface.

Configuration: `playwright.config.ts`.
