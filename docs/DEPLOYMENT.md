# Cloudflare Pages deployment and GitHub CI

## Public publication, local house data

`pnpm run build` produces a public application with **only the demonstration studio**. Vite does not copy the `public/` folder: a plugin explicitly bundles the favicon and `studio-demo.json`. Any personal plan (`public/projects/private-*.json`, git-ignored), PDFs and building-site photos are not part of this artefact.

Furniture, solar settings and imported projects are processed and kept in the browser. Their export stays a personal file. This data is not sent to Cloudflare by the application. Changing the site origin does not transfer browser storage: **export the project and its arrangement from the old private site before the migration**, then import that file on the new site.

The GitHub repository is public and contains no personal plan: personal projects live in `public/projects/private-*.json`, git-ignored, and their history has been purged.

The Cloudflare build service compiles these public sources; the separation guarantees that the distributed site contains no personal data.

To use the real plan locally, explicitly:

```sh
pnpm run dev:private
pnpm run build:private
```

The output of `build:private` must never be published on a public site. `pnpm run check:public` rejects it.

## GitHub Actions CI

Every change goes through a `<type>/<slug>` branch and a PR to `main`; commit conventions are in [AGENTS.md](../AGENTS.md). No direct push nor merge with remote CI pending or failing. Local tests do not replace the checks of the PR's latest commit. The owner authorises GitHub auto-merge once required checks are green: enable it for completed, validated changes, without asking permission again for each PR. Cloudflare must only receive the production branch after this validation; its build pipelines stay technically independent of GitHub Actions.

GitHub protection of `main`: PR required, check « Tests, types, build et confidentialité » required from GitHub Actions, branch up to date (`strict`), rules applied to administrators, force-push and deletion forbidden. Auto-merge waits for these checks and is not a bypass. These server settings are not contained in the Git diff. The CI job names stay in French because the required check is matched by name: renaming it breaks branch protection.

The `.github/workflows/ci.yml` workflow runs on pushes to `main`, pull requests targeting `main` and on manual dispatch. It uses Node 24, pnpm 12.15.0 and `pnpm install --frozen-lockfile` with `pnpm-lock.yaml`.

Checks: formatting, tests, TypeScript check, public build, then artefact check. The public check rejects files outside the allowlist, original documents, the real house project and its known signatures in the JavaScript assets. This safeguard complements the explicit inclusion of the demonstration files only; it does not replace reviewing any new asset meant to be public.

Actions only have `contents: read`, no Cloudflare secret, a 15-minute limit, and cancel runs made obsolete on the same branch.

After the public check, GitHub shares the build with three runners that run the E2E tests in parallel (`--shard`), in desktop Chromium. Chromium headless shell is cached per version. The required check « Tests, types, build et confidentialité » aggregates the build and the three shards: any failure or skipped shard blocks it and blocks auto-merge. Failure reports and traces are archived for seven days. See `docs/E2E.md`. This step is not part of `npm run ci` on the Cloudflare side: the two pipelines stay independent.

## Cloudflare Pages connection

In the owner's Cloudflare account: **Workers & Pages → create a Pages application → connect GitHub**, then authorise only the `AntoninHuaut/mybob` repository.

| Setting                 | Value                        |
| ----------------------- | ---------------------------- |
| Pages project           | `mybob` or an available name |
| Production branch       | `main`                       |
| Root directory          | repository root              |
| Framework               | none / Vite                  |
| Build command           | `npm run ci`                 |
| Output directory        | `dist`                       |
| `NODE_VERSION` variable | `24`                         |

Cloudflare installs the dependencies then runs the same checks before publishing. A test or public-check failure prevents that deployment and keeps the previous version. There is therefore no need to assume GitHub CI has already finished: the two pipelines are independent and enforce the same requirements.

`wrangler.toml` declares the Pages output directory. No Cloudflare token is stored in the repository. Branch previews must also keep the public command; never substitute `build:private`.

## Connection status

The GitHub → Cloudflare Pages connection is active on `main`. The site is `https://mybob-9rj.pages.dev/`. Cloudflare Access protects previews; do not change these restrictions to test. Check the GitHub CI and Cloudflare checks of the exact commit before announcing a publication.

The town search of the Soleil setting contacts Open-Meteo only after an explicit click and only sends the searched name. Chosen coordinates, plans and furniture stay in local storage and exports.
