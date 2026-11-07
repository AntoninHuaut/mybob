# Mybob / Maison — agent instructions

Read the local passation journal `docs/HANDOFF.md` first (git-ignored: present on the owner's clone, never committed), then the relevant technical docs. For maintenance and releases, follow [.agents/skills/mybob-maintenance/SKILL.md](.agents/skills/mybob-maintenance/SKILL.md). These files replace reliance on any previous chat context.

## Product and privacy

- French UI; desktop keyboard/mouse is the primary target. Babylon.js + TypeScript + Vite, modular JSON projects and parametric furniture, metres internally.
- Keep the application adaptable to other houses. Never hardcode the owner's house dimensions or identifiers into scene/UI logic.
- The owner explicitly wants their house **absent from the deployed site**. Public builds include only the fictitious demonstration. Personal plans are imported locally. Preserve the allowlist in `vite.config.ts` and `scripts/check-public-build.mjs`.
- The owner explicitly wants their house **absent from the repository and the deployed site**. The repository is public: personal plans live in `public/projects/private-*.json` — git-ignored, never committed (`dev:private` loads every `private-*.json` present), and their Git history has been purged before publication. Public builds include only the fictitious demonstrations. Personal plans are imported locally. Preserve the allowlist in `vite.config.ts` and `scripts/check-public-build.mjs`. Never commit original PDF/photos, secrets or generated private bundles.
- No account/backend/cloud storage for house data. Browser localStorage is per origin and browser profile. Exports are the migration/backup mechanism.
- Cloudflare **Pages**, connected to GitHub `main`, is the deployment path. Do not replace it with Workers, Netlify or Sites. Access restrictions are managed in the owner's Cloudflare account.

## Implementation

- Preserve geometry, collision constraints, stable IDs, import validation and undo/redo. Never resize a room to hide a discrepancy with the source plan.
- Furniture edit dialogs are transactional: every action remains a draft until Save; Cancel discards all changes. Preserve exact unedited values despite rounded UI measurements.
- Reactivity must not replace active native form controls on every keystroke or selection. Keep units attached to fields and inputs aligned when labels wrap.
- Overview uses camera-facing façade cutaways by default; plan uses neutral lighting. Full volumes remain in walk/exterior. Solar preview is approximate and requires explicit location/orientation.
- Keep controls compact and task-specific. Navigation is global; furniture editing is a popup. No favorite feature, misleading photo/link-to-3D flow, shopping list or compulsory furniture clearances.

## Work and verification

Use Node 24, `pnpm install --frozen-lockfile`, and `pnpm run ci` for a release. Run `pnpm run test:e2e` for browser workflows. Tests cover DOM behavior with Happy DOM and geometry with Babylon NullEngine. Neither proves visual correctness: use a real browser when available and record what was actually inspected.

Several agents share this machine. The e2e suite takes a free port on every run (`playwright.config.ts`): never hardcode a port, never add `--strictPort` on a known one, and never stop another agent's Vite server. `pnpm run dev` already increments its own port; an orphaned `vite preview` is simply ignored because the suite picks a different port.

All changes must go through a pull request (MR) to `main`. Do not commit or push changes directly to `main`. Branch names are `<type>/<kebab-case-slug>`, using the Conventional Commit types below (`feat/visite-eclairage`, `fix/porte-garage`). Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`, description in French like the rest of the project, imperative present, no trailing period. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`, `build`, `ci`. Add `!` after the type or scope for a breaking change. A local test pass is not a substitute for the remote CI. Never merge while any required check is pending, failed, cancelled or missing; verify the checks for the exact latest PR commit. The owner authorizes auto-merge through GitHub once required CI checks pass; enable it for completed, validated changes without asking again. Never bypass branch protections or required checks.

Never block on CI with long sleeps. Push, enable auto-merge, then continue other work; check `gh pr checks` afterwards. A `sleep` longer than about 30 s is a smell: do something useful instead.

Use existing app architecture instead of rewriting the renderer or migrating frameworks. When the user asks for independent agent reviews, delegation is appropriate; otherwise follow the current session's delegation rules. Complete authorized fixes, but never claim a deployment until GitHub CI and the Cloudflare Pages check succeed for the pushed commit.

Update the handoff and relevant docs when behavior changes. Never place credentials, Cloudflare Access OTPs, private email lists or API tokens in documentation.
