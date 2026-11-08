# Contexte — lire peu, lire juste

Page d'entrée pour un agent qui découvre le dépôt. Elle ne répète ni les règles
([AGENTS.md](../AGENTS.md)) ni la carte des modules ([ARCHITECTURE.md](ARCHITECTURE.md)) :
elle dit **quoi ne pas lire** et **comment traduire** une demande en fichiers.

## En trois lignes

Visite 3D de maisons dans le navigateur, sans backend : Vite + TypeScript + Babylon.js 9,
projets JSON (`schemaVersion: 1`), meubles paramétriques, tout l'état dans `localStorage`.
Interface et documentation en français ; le dépôt est public et ne contient que des maisons
fictives.

## Vocabulaire : de l'interface au code

Une demande arrive avec les mots de l'interface. Le nom du code est celui à chercher.

| Dans l'interface                  | Dans le code                                                  |
| --------------------------------- | ------------------------------------------------------------- |
| Vue 3D                            | mode `overview`                                               |
| Extérieur                         | `overview` + `viewer.setExteriorView(true)`, `#view-exterior` |
| Plan                              | mode `plan`                                                   |
| Visite                            | mode `walk`, `scene/walkCamera.ts`                            |
| Coupe des murs                    | `cutaway` (`auto` / `full` / `low`), `scene/wallCutaway.ts`   |
| Meubles, popup d'édition          | `src/furniture/`, brouillon dans `editorDraft.ts`             |
| Variantes                         | `furniture/variants.ts`, `ui/variantsPanel.ts`                |
| Soleil                            | `solar`, `scene/solar.ts`, `ui/solarPanel.ts`                 |
| Mesurer                           | `measure`, `scene/measurement.ts`, `ui/measureBar.ts`         |
| Cotes                             | `tool-dimensions`                                             |
| Circulation                       | `furniture/circulation.ts`                                    |
| Lien de partage (`#p1:` dans URL) | `model/shareLink.ts`, `model/linkPacker.ts`                   |
| Premiers pas, aide                | `ui/firstSteps.ts`, `ui/onboarding.ts`                        |
| Image (export PNG)                | `ui/imageExport.ts`                                           |
| Bob (mascotte, ton des textes)    | [IDENTITE-MYBOB.md](IDENTITE-MYBOB.md), `src/assets/brand/`   |

Les boutons de la barre d'outils sont des `#tool-<nom>` dans `ui/appTemplate.ts` ; leur
câblage se trouve par `grep -n "tool-<nom>" src/main.ts`.

## Budget de lecture

Quelques fichiers concentrent l'essentiel du volume. Ne pas les ouvrir en entier : chercher
le symbole, puis lire la fonction.

| Fichier                                 | Taille          | Comment y entrer                                                                   |
| --------------------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `src/main.ts`                           | ~2 200 l.       | `grep -nE "^(async )?function" src/main.ts`                                        |
| `src/scene/viewer.ts`                   | ~1 500 l.       | `grep -nE "^  [a-zA-Z]+\(.*\) \{" src/scene/viewer.ts` (méthodes de `HouseViewer`) |
| `src/furniture/layer.ts`, `panel.ts`    | ~1 000 / 700 l. | par nom de méthode ou d'`id` HTML                                                  |
| `.agents/skills/mybob-plan-conversion/` | ~80 Ko          | par section : `grep -n '^##'`, voir son renvoi Claude                              |
| `scripts/*.py`                          | 20–55 Ko        | seulement pour la conversion de plan ; `--help` d'abord                            |

Ne jamais lire : `pnpm-lock.yaml`, `dist/`, `node_modules/`, `playwright-report/`,
`test-results/`, les PNG de `src/assets/brand/` (leur description est dans
[IDENTITE-MYBOB.md](IDENTITE-MYBOB.md)). Les projets `public/projects/*.json` et les
fixtures `tests/fixtures/` se lisent par clé (`node -e` ou `grep`), pas en entier.

## Où chercher, dans l'ordre

1. La ligne de la zone dans la carte des modules ([ARCHITECTURE.md](ARCHITECTURE.md)).
2. Le test miroir : `tests/<zone>.test.ts` décrit le comportement attendu en peu de lignes.
3. Le fichier source, par symbole.
4. Le document qui possède la zone (lien depuis AGENTS.md), seulement si la règle n'est pas
   dans le code.
