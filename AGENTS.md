# Mybob / Maison — agent instructions

Read [docs/HANDOFF.md](docs/HANDOFF.md) first, then the relevant technical docs. For maintenance and releases, follow [.agents/skills/mybob-maintenance/SKILL.md](.agents/skills/mybob-maintenance/SKILL.md). These files replace reliance on any previous chat context.

## Product and privacy

- French UI; desktop keyboard/mouse is the primary target. Babylon.js + TypeScript + Vite, modular JSON projects and parametric furniture, metres internally.
- Keep the application adaptable to other houses. Never hardcode the owner's house dimensions or identifiers into scene/UI logic.
- The owner explicitly wants their house **absent from the deployed site**. Public builds include only the fictitious demonstration. Personal plans are imported locally. Preserve the allowlist in `vite.config.ts` and `scripts/check-public-build.mjs`.
- The GitHub repository is private. Do not make it public: the personal model and history are present. Do not commit original PDF/photos, secrets or generated private bundles.
- No account/backend/cloud storage for house data. Browser localStorage is per origin and browser profile. Exports are the migration/backup mechanism.
- Cloudflare **Pages**, connected to GitHub `main`, is the deployment path. Do not replace it with Workers, Netlify or Sites. Access restrictions are managed in the owner's Cloudflare account.

## Implementation

- Preserve geometry, collision constraints, stable IDs, import validation and undo/redo. Never resize a room to hide a discrepancy with the source plan.
- Furniture edit dialogs are transactional: every action remains a draft until Save; Cancel discards all changes. Preserve exact unedited values despite rounded UI measurements.
- Reactivity must not replace active native form controls on every keystroke or selection. Keep units attached to fields and inputs aligned when labels wrap.
- Overview uses camera-facing façade cutaways by default; plan uses neutral lighting. Full volumes remain in walk/exterior. Solar preview is approximate and requires explicit location/orientation.
- Keep controls compact and task-specific. Navigation is global; furniture editing is a popup. No favorite feature, misleading photo/link-to-3D flow, shopping list or compulsory furniture clearances.

## Work and verification

Use Node 24, `npm ci`, and `npm run ci` for a release. Tests cover DOM behavior with Happy DOM and geometry with Babylon NullEngine. Neither proves visual correctness: use a real browser when available and record what was actually inspected.

Use existing app architecture instead of rewriting the renderer or migrating frameworks. When the user asks for independent agent reviews, delegation is appropriate; otherwise follow the current session's delegation rules. Complete authorized fixes, but never claim a deployment until GitHub CI and the Cloudflare Pages check succeed for the pushed commit.

Update the handoff and relevant docs when behavior changes. Never place credentials, Cloudflare Access OTPs, private email lists or API tokens in documentation.
