---
name: mybob-maintenance
description: Maintain, debug, test and release the Mybob Babylon.js house and furniture planner while preserving local personal data and the public-demo-only deployment.
---

# Mybob maintenance

Use this repository-local skill when changing the house viewer, furniture UI, project import/export, local storage, tests or deployment. Start with `AGENTS.md` and `docs/HANDOFF.md`. Consult `docs/PROJECT-FORMAT.md`, `docs/FURNITURE.md`, `docs/UI-REFINEMENT.md`, `docs/DEPLOYMENT.md` for the touched area.

## Establish the working state

1. Read `git status --short` and the recent log. Preserve unrelated user work.
2. Use Node 24 (`.node-version`). Install locked dependencies with `npm ci` when needed.
3. Start `npm run dev` for the generic demonstration. Use `npm run dev:private` only when intentionally inspecting the personal house locally. Never publish the private build.
4. For actual customer furnishings, ask them to import/export the JSON using the application. Repository files do not contain the browser's current arrangement. Back up exports before origin changes or storage migrations.

## Locate the correct layer

- House schema/units/validation: `src/model/`.
- House meshes, cameras, lighting, doors, cutaways: `src/scene/`.
- Furniture schema/history/storage: `src/furniture/model.ts`.
- Furniture transforms/groups/placement constraints: `groups.ts`, `placement.ts`, `checks.ts`.
- All furniture edit actions: `editorDraft.ts` plus `panel.ts`; commit only with `onApplyDraft`.
- Furniture meshes/dragging: `layer.ts`.
- Application composition: `src/main.ts`; shared visual styles: `src/style.css`.
- Solar mathematics/time-zone conversion: `src/scene/solar.ts`; settings validation: `src/model/solarSettings.ts`; controls/local preferences: `src/ui/solarPanel.ts`.

## Fix without regressions

Reproduce with a minimal generic project where possible. Keep world units in metres and UI units in centimetres. Test constraints against the occupied parts of an L sofa, including rotation and the floor level; an overall rectangle can reject valid placements. Group operations must remain atomic. Untouched measurements must retain their exact stored values.

For form/keyboard bugs, use the existing Happy DOM tests. Cover cancellation, actual event routing and no accidental movement while interacting with UI controls. For mesh/camera changes use NullEngine tests. Do not describe either as screenshot/browser QA. If a graphical browser is available locally, check Plan, overview, exterior, walk, add/edit dialogs and narrow viewport layouts.

Check both day and night, multiple time zones and project switches when changing sunlight. Solar settings must not infer personal location; only explicit town searches send text to Open-Meteo, and never house geometry. Plan stays neutral; partial-wall overview suppresses misleading full-wall shadows.

## Validate and release

1. Format changed files with Prettier and run `npm run ci`. That command checks format, all tests, TypeScript/build and public artefact exclusions.
2. Inspect `git diff --check` and the staged diff. Verify no original plans/photos, tokens or private exports entered the public asset allowlist.
3. Commit a coherent change. Push only within the user's authorized scope. Find the GitHub remote using `git remote -v` (usually `origin` after a fresh clone; it was `github` in the cloud workspace).
4. Inspect GitHub checks for that exact commit, for example `gh api repos/AntoninHuaut/mybob/commits/<sha>/check-runs`. Both CI and Cloudflare Pages must succeed. The public URL is in `docs/HANDOFF.md`.
5. Cloudflare Access may return HTTP 302 to an unauthenticated request. This is not evidence of a rendering failure or successful authenticated visual inspection. Never weaken Access to make a check easier.
6. Update `docs/HANDOFF.md` with changes, checks performed and unresolved material limitations. State clearly if deployment or real-browser checks remain unverified.

No special approvals are introduced by this skill. Follow the current user's authorization, environment permissions and actual destructive-action requirements.
