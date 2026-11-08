# Context — read little, read right

Entry page for an agent discovering the repository. It restates neither the rules
([AGENTS.md](../AGENTS.md)) nor the module map ([ARCHITECTURE.md](ARCHITECTURE.md)): it says
**what not to read** and **how to translate** a request into files.

## In three lines

3D house walkthrough in the browser, no backend: Vite + TypeScript + Babylon.js 9, JSON
projects (`schemaVersion: 1`), parametric furniture, all state in `localStorage`. The interface
is French, everything else is English; the repository is public and only contains fictitious
houses.

## Vocabulary: from the interface to the code

Requests arrive with the interface's (French) words. The code name is the one to search for.

| In the interface                 | In the code                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| Vue 3D                           | mode `overview`                                               |
| Extérieur                        | `overview` + `viewer.setExteriorView(true)`, `#view-exterior` |
| Plan                             | mode `plan`                                                   |
| Visite                           | mode `walk`, `scene/walkCamera.ts`                            |
| Coupe des murs (wall cutaway)    | `cutaway` (`auto` / `full` / `low`), `scene/wallCutaway.ts`   |
| Meubles, edit popup              | `src/furniture/`, draft in `editorDraft.ts`                   |
| Variantes                        | `furniture/variants.ts`, `ui/variantsPanel.ts`                |
| Soleil                           | `solar`, `scene/solar.ts`, `ui/solarPanel.ts`                 |
| Mesurer                          | `measure`, `scene/measurement.ts`, `ui/measureBar.ts`         |
| Cotes (dimensions)               | `tool-dimensions`                                             |
| Circulation                      | `furniture/circulation.ts`                                    |
| Lien (share link, `#p1:` in URL) | `model/shareLink.ts`, `model/linkPacker.ts`                   |
| Premiers pas, aide               | `ui/firstSteps.ts`, `ui/onboarding.ts`                        |
| Image (PNG export)               | `ui/imageExport.ts`                                           |
| Bob (mascot, tone of the copy)   | [BRAND.md](BRAND.md), `src/assets/brand/`                     |

Toolbar buttons are `#tool-<name>` in `ui/appTemplate.ts`; their wiring is found with
`grep -n "tool-<name>" src/main.ts`.

## Reading budget

A few files hold most of the volume. Do not open them in full: search for the symbol, then
read the function.

| File                                    | Size            | How to get in                                                                  |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| `src/main.ts`                           | ~2,200 lines    | `grep -nE "^(async )?function" src/main.ts`                                    |
| `src/scene/viewer.ts`                   | ~1,500 lines    | `grep -nE "^  [a-zA-Z]+\(.*\) \{" src/scene/viewer.ts` (`HouseViewer` methods) |
| `src/furniture/layer.ts`, `panel.ts`    | ~1,000 / 700 l. | by method name or HTML `id`                                                    |
| `.agents/skills/mybob-plan-conversion/` | ~80 KB          | by section: `grep -n '^##'`, see its Claude pointer                            |
| `scripts/*.py`                          | 20–55 KB        | only for plan conversion; `--help` first                                       |

Never read: `pnpm-lock.yaml`, `dist/`, `node_modules/`, `playwright-report/`,
`test-results/`, the PNGs in `src/assets/brand/` (described in [BRAND.md](BRAND.md)).
`public/projects/*.json` projects and `tests/fixtures/` are read by key (`node -e` or `grep`),
not in full.

## Where to look, in order

1. The area's row in the module map ([ARCHITECTURE.md](ARCHITECTURE.md)).
2. The mirror test: `tests/<area>.test.ts` describes the expected behaviour in few lines.
3. The source file, by symbol.
4. The document owning the area (linked from AGENTS.md), only if the rule is not in the code.
