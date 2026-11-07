---
name: mybob-maintenance
description: Maintain, debug, test and release the Mybob Babylon.js house and furniture planner while preserving local personal data and the public-demo-only deployment.
---

# Mybob maintenance

Use this repository-local skill when changing the house viewer, furniture UI, project import/export, local storage, tests or deployment. Start with `AGENTS.md`, then `docs/ARCHITECTURE.md` for the module map, and the local passation journal `docs/HANDOFF.md` (git-ignored, present on the owner's clone). Consult `docs/PROJECT-FORMAT.md`, `docs/FURNITURE.md`, `docs/UI-REFINEMENT.md`, `docs/DEPLOYMENT.md` for the touched area.

## Establish the working state

1. Read `git status --short` and the recent log. Preserve unrelated user work.
2. Use Node 24 (`.node-version`). Install locked dependencies with `pnpm install --frozen-lockfile` when needed.
3. Start `pnpm run dev` for the generic demonstration. Use `pnpm run dev:private` only when intentionally inspecting the personal house locally. Never publish the private build.
4. For actual customer furnishings, ask them to import/export the JSON using the application. Repository files do not contain the browser's current arrangement. Back up exports before origin changes or storage migrations.

## Locate the correct layer

`docs/ARCHITECTURE.md` carries the module map, the data flow, the three view modes and the
invariants. Read it instead of scanning `src/`. Two details it does not spell out:

- Every furniture edit action goes through `editorDraft.ts` and is committed only by
  `onApplyDraft`.
- Solar mathematics live in `src/scene/solar.ts`, settings validation in
  `src/model/solarSettings.ts`, controls and local preferences in `src/ui/solarPanel.ts`.

## Fix without regressions

Reproduce with a minimal generic project where possible. Keep world units in metres and UI units in centimetres. Test constraints against the occupied parts of an L sofa, including rotation and the floor level; an overall rectangle can reject valid placements. Group operations must remain atomic. Untouched measurements must retain their exact stored values.

Audit the fixtures you rely on before trusting a green suite. `public/projects/maison-atelier.json` feeds about ten test files and the public-build check; it carried fifteen geometry defects while every test passed, because no test asserted its geometric coherence. Run `scripts/audit-plan.ts` on a fixture you are about to build tests on, and treat a fixture defect as a test defect: a suite built on broken geometry cannot tell correct from incorrect. When you fix a fixture, recompute any `planArea` from the corrected polygon, since `tests/model.test.ts` requires them to agree within a square centimetre.

For form/keyboard bugs, use the existing Happy DOM tests. Cover cancellation, actual event routing and no accidental movement while interacting with UI controls. For mesh/camera changes use NullEngine tests. Do not describe either as screenshot/browser QA. If a graphical browser is available locally, check Plan, overview, exterior, walk, add/edit dialogs and narrow viewport layouts.

Check both day and night, multiple time zones and project switches when changing sunlight. Solar settings must not infer personal location; only explicit town searches send text to Open-Meteo, and never house geometry. Plan stays neutral; partial-wall overview suppresses misleading full-wall shadows.

## Validate and release

1. Format changed files with Prettier. Verify only what the change touches: the zone's unit test file (`node --import tsx --test --test-isolation=none tests/<zone>.test.ts`) or, for a browser workflow, the targeted e2e run of `docs/E2E.md` (`--grep` or single spec file on a built `dist/`). The full e2e suite never runs on this machine: the CI pipeline replays all of it sharded in three. `pnpm run ci` stays the local release gate — format, unit tests, TypeScript/build and public artefact exclusions — and does not run e2e.
2. Inspect `git diff --check` and the staged diff. Verify no original plans/photos, tokens or private exports entered the public asset allowlist.
3. Commit a coherent change. Push only within the user's authorized scope. Find the GitHub remote using `git remote -v` (usually `origin` after a fresh clone; it was `github` in the cloud workspace).
4. Inspect GitHub checks for that exact commit, for example `gh api repos/AntoninHuaut/mybob/commits/<sha>/check-runs`. Both CI and Cloudflare Pages must succeed. The public URL is in `docs/DEPLOYMENT.md`.
5. Cloudflare Access may return HTTP 302 to an unauthenticated request. This is not evidence of a rendering failure or successful authenticated visual inspection. Never weaken Access to make a check easier.
6. Update the local passation journal `docs/HANDOFF.md` (git-ignored) with changes, checks performed and unresolved material limitations. It is short-lived state, not a knowledge base: move any durable trap or method into the doc or skill that owns the area, keep entries short, and archive old ones in `docs/HANDOFF.archive.md`. State clearly if deployment or real-browser checks remain unverified.

No special approvals are introduced by this skill. Follow the current user's authorization, environment permissions and actual destructive-action requirements.
