# Mybob / Maison — agent instructions

## Start here

1. [docs/CONTEXT.md](docs/CONTEXT.md) — what not to read, and how UI words map to code names.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the code map: modules, data flow, the three
   view modes, invariants, verification recipes, known traps.
3. The one doc for the area you touch: [PROJECT-FORMAT](docs/PROJECT-FORMAT.md),
   [FURNITURE](docs/FURNITURE.md), [EXTERIOR](docs/EXTERIOR.md),
   [UI-REFINEMENT](docs/UI-REFINEMENT.md), [DEPLOYMENT](docs/DEPLOYMENT.md),
   [E2E](docs/E2E.md), [BRAND](docs/BRAND.md).
4. Then only the files that map names. Do not re-read all of `src/` to "get oriented": the map
   exists so you don't have to. If it is wrong or silent about what you needed, fix the map in
   the same change.

```text
src/main.ts          UI composition and screen state: mode, selection, preferences
src/scene/viewer.ts  Babylon scene: cameras, modes, cutaway, lighting, measurement
src/model/           pure data: types, validation, geometry
src/furniture/       furniture: model, placement, groups, history, render layer
src/ui/              pure HTML fragments and panels
```

Skills: maintenance and releases follow
[.agents/skills/mybob-maintenance/SKILL.md](.agents/skills/mybob-maintenance/SKILL.md);
reconstructing a plan from an architectural PDF follows
[.agents/skills/mybob-plan-conversion/SKILL.md](.agents/skills/mybob-plan-conversion/SKILL.md);
opening a workable issue follows
[.agents/skills/mybob-issues/SKILL.md](.agents/skills/mybob-issues/SKILL.md).
These files replace reliance on any previous chat context.

## Product and privacy

- Language: the web application's user-facing text (UI labels, messages, validation errors
  shown to the user, bundled project names) is French. Everything else is English: code,
  identifiers, comments, tests and test titles, scripts and their output, documentation,
  skills, commits, PRs and issues. Exceptions kept on purpose: the CI job names (the required
  check is matched by name) and `maison-atelier:` storage keys.
- Desktop keyboard/mouse is the primary target. Babylon.js + TypeScript + Vite,
  modular JSON projects and parametric furniture, metres internally.
- Keep the application adaptable to other houses. Never hardcode the owner's house dimensions
  or identifiers into scene/UI logic.
- The owner explicitly wants their house **absent from the repository and the deployed site**.
  The repository is public: personal plans live in `reference-documents/<id>.json` (the
  reference) and in their working copies in `public/projects/private-*.json`. Both are
  git-ignored and never committed (`dev:private` loads every `private-*.json` present), and
  their Git history has been purged before publication. Which copy wins:
  [Backing up personal projects](.agents/skills/mybob-plan-conversion/SKILL.md#backing-up-personal-projects). Public builds include only the fictitious
  demonstrations; personal plans are imported locally. Preserve the allowlist in
  `vite.config.ts` and `scripts/check-public-build.mjs`. Never commit original PDF/photos,
  secrets or generated private bundles.
- No account/backend/cloud storage for house data. Browser localStorage is per origin and
  browser profile. Exports are the migration/backup mechanism.
- Cloudflare **Pages**, connected to GitHub `main`, is the deployment path. Do not replace it
  with Workers, Netlify or Sites. Access restrictions are managed in the owner's Cloudflare
  account.

## Implementation

- Preserve geometry, collision constraints, stable IDs, import validation and undo/redo. Never
  resize a room to hide a discrepancy with the source plan.
- Furniture edit dialogs are transactional: every action remains a draft until Save; Cancel
  discards all changes. Preserve exact unedited values despite rounded UI measurements.
- Reactivity must not replace active native form controls on every keystroke or selection.
  Keep units attached to fields and inputs aligned when labels wrap.
- Overview uses camera-facing façade cutaways by default; plan uses neutral lighting. Full
  volumes remain in walk/exterior. Solar preview is approximate and requires explicit
  location/orientation.
- Keep controls compact and task-specific. Navigation is global; furniture editing is a popup.
  No favorite feature, misleading photo/link-to-3D flow, shopping list or compulsory furniture
  clearances.

## Documentation

- One source of truth per topic. A rule, a map or a behaviour belongs in exactly one document;
  everywhere else, link to it. Do not restate the module map outside `docs/ARCHITECTURE.md`.
- Documentation describes what the code does now. Delete a section when the behaviour it
  describes is gone, rather than leaving a stale paragraph behind.
- When behaviour changes, update the doc that owns it. Never place credentials, Cloudflare
  Access OTPs, private email lists or API tokens in documentation.

## Work and verification

Use Node 26 and `pnpm install --frozen-lockfile`. Verify locally only what the change
touches, never the whole suite as a reflex. Unit test files mirror the module they test
(`tests/furniture.test.ts`, `tests/plan-openings.test.ts`): run the touched ones,
`node --import tsx --test --test-isolation=none tests/<zone>.test.ts`.
`pnpm run ci` (format, unit tests, build, public-build check) is the local release gate;
it does not run e2e. Happy DOM and Babylon NullEngine prove behavior, not visual correctness.

### Local browser verification policy

Browser e2e belongs to CI. Do not run routine local Playwright/e2e scenarios, including
targeted feature batches, repeats, or concurrent browser captures/benchmarks: they make the
owner's PC unusably slow. Only one or two exact failing tests may run locally to reproduce
a concrete CI error, with one worker and no repeats. Stop only your own browser runs.
Prefer focused unit/NullEngine/DOM checks and CI logs. Defer visual acceptance to existing
permitted evidence or explicit later authorization; do not open a browser for optional
evidence. CI execution recipes live in [E2E](docs/E2E.md).

Agent-created visual evidence must stay local and ignored: never commit images or
image-reference reports, or upload browser captures, HTML reports or traces to PRs, Actions
or external services. Only `studio-demo` may be used for public-facing visual validation;
never publish captures of other house fixtures. Text evidence must omit private identifying
information and encoded image attachments. CI keeps its browser tests but uploads no browser
image/report/trace artifacts; the verified public-build artifact exchange is preserved.

Several agents share this machine. The e2e suite takes a free port on every run
(`playwright.config.ts`): never hardcode a port, never add `--strictPort` on a known one, and
never stop another agent's Vite server. `pnpm run dev` already increments its own port; an
orphaned `vite preview` is simply ignored because the suite picks a different port.

All changes must go through a pull request (MR) to `main`. Do not commit or push changes
directly to `main`. Branch names are `<type>/<kebab-case-slug>`, using the Conventional Commit
types below (`feat/walk-lighting`, `fix/garage-door`). Commit messages follow
[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`,
description in English, imperative mood, no trailing period.
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`, `build`, `ci`. Add `!` after
the type or scope for a breaking change. A local test pass is not a substitute for the remote
CI. Never merge while any required check is pending, failed, cancelled or missing; verify the
checks for the exact latest PR commit. The owner authorizes auto-merge through GitHub once
required CI checks pass; enable it for completed, validated changes without asking again. Never
bypass branch protections or required checks.

Never block on CI with long sleeps. Push, enable auto-merge, then continue other work; check
`gh pr checks` afterwards. A `sleep` longer than about 30 s is a smell: do something useful
instead.

Use existing app architecture instead of rewriting the renderer or migrating frameworks. When
the user asks for independent agent reviews, delegation is appropriate; otherwise follow the
current session's delegation rules. Complete authorized fixes, but never claim a deployment
until GitHub CI and the Cloudflare Pages check succeed for the pushed commit.
