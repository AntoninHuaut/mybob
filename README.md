# Maison — Atelier 3D (MyBob)

3D house walkthrough application for desktop, built with **Babylon.js 9**, TypeScript and Vite. The engine is independent of the projects: an imported plan and the fictitious studio use exactly the same code. The interface is in French; code, documentation and tooling are in English.

## Picking up with a new agent

Read [AGENTS.md](AGENTS.md), then [the code map](docs/ARCHITECTURE.md) and [the maintenance skill](.agents/skills/mybob-maintenance/SKILL.md). **Export your project from the current browser before switching to local**: the repository does not contain the arrangement saved in that browser.

Parametric kitchens support corner runs, separate worktop and front colours, wall units and equipment markers. See [furniture configurations](docs/FURNITURE.md#types-and-configurations).

## Getting started

Node.js 26.13.0 and pnpm 12.18.0.

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Open the address printed by Vite. By default only the demonstration studio is bundled; import your house locally. `pnpm run dev:private` loads a local personal plan. The application renders with WebGL 2; browser graphics acceleration is required. No account nor data server is needed locally.

```sh
pnpm test
pnpm run build
pnpm run format:check
```

The `dist/` folder contains the deployable static version. Dependencies and house data are bundled or served locally; Google Fonts is optional and has system fallback fonts.

Automated browser tests run in CI; local reproduction is restricted by [AGENTS.md](AGENTS.md#local-browser-verification-policy). See [the E2E guide](docs/E2E.md).

The normal build is **public and limited to the demonstration**. `pnpm run ci` runs every check and verifies that no personal plan is present in the artefact. Cloudflare Pages and GitHub Actions configuration: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

V2 adds a configurable terrain and roof, adjustable navigation and tone-mapped lighting. The Soleil button adds a preview based on the town, the plan's north, the date and the local time; Plan view stays neutral. Details and limits: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/EXTERIOR.md](docs/EXTERIOR.md).

## Usage

Interface names are given in French, as shown in the application.

- **Premiers pas**: on first launch, a card offers to orbit around the house, open the plan or enter the walk. It blocks nothing, stays until closed and remains reachable from the sidebar.
- **Vue 3D**: drag with the left button to rotate; wheel to zoom; right button to pan.
- Framing adapts to the window and keeps a margin for the interface. **Recentrer** shows the whole house again after a zoom or a pan.
- **Extérieur**: if the project contains a terrain, shows the plot, façades and roof; the 3D view keeps the roof open for arranging.
- **Plan**: orthographic view, selection of rooms and exterior dimensions; drag to pan, pinch or use the wheel to zoom.
- **Visite**: ZQSD, WASD or arrows to walk, mouse to look, Shift to speed up, E to open or close a nearby door. Escape releases the mouse.
- If mouse capture is refused, click in the scene and drag with the left button to look.
- Click a room in the list or the mini-map, then **Visiter cette pièce**, to go there.
- **Mesurer**: first click on the floor, preview of the segment and its distance while moving, second click to confirm. Automatic alignment near the plan axes; Shift forces a straight line, Alt keeps a free angle. A third click starts a new measurement; confirmed measurements stay displayed and « Effacer les mesures » removes them. This is neither edge snapping nor construction dimensioning.
- **Furniture actions**: edit, rotate, duplicate, place against a wall and remove are available in the selection bar. Clicking elsewhere in the scene or pressing Escape deselects. Ctrl Z undoes the last change even with no selection or with a button focused; text fields and edit dialogs keep their native behaviour.
- Interior doors are open at start. In 3D view, clicking a door also operates it.
- Projects can be exported and imported as JSON. Imported projects are kept in the browser's local storage, on this computer. Export the files to back them up or transfer them.
- **Variantes**: in Meubles, duplicate and name several arrangements, then switch between them with the same camera; each variant shows a plan preview of the current level. The JSON export keeps every variant and every level.
- **Repeating furniture**: Ctrl C then Ctrl V copies the selected piece; each copy is independent and undoable. On a table, **Chaises** distributes the requested number around the top, with adjustable dimensions and optional linking.
- **Precise placement**: select several pieces to align them or distribute their spacing; separately enable snapping to an adjustable grid or to walls while dragging.
- **Soleil**: after locating, the panel in the scene offers a time slider, Été/Hiver and approximate sunrise/sunset, without moving the camera. « Animer la journée » plays the day's sunlight in 12 seconds; any manual action stops it.
- **Image**: download a PNG of Plan or 3D without panels, with optional names/areas and dimensions; transparent background and project title block as options.

## Important files

The full module map is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The only paths to know
before reading the code:

```text
public/projects/private-*.json      Local personal plans (git-ignored, never committed)
public/projects/studio-demo.json    Public demonstration
public/projects/maison-atelier.json Synthetic test template, no personal data
docs/PROJECT-FORMAT.md              Project format, to add another house
```

## Scope of this version

Multiple levels, walk, doors, plan, measurements and multiple projects. The workshop now adds dimensioned parametric furniture, moves it, checks its clearances and saves/exports the arrangement. Sofas may have a corner or chaise longue, televisions a mounting height, and furniture is checked against walls. Adding goes by dimensions; the old photo and merchant-link options were removed. See [docs/FURNITURE.md](docs/FURNITURE.md). Terrain and the exterior envelope are included; fitting out the attic stays out of scope.

**An imported project is not an exact survey of the existing building.** Dimensions come from the reference document, but the joins between rooms and walls remain to be confirmed project by project. Areas stated on the plan and areas computed from the model's outlines are shown separately.

No personal plan or photo is included in the sources nor on the site. The Cloudflare Pages build only bundles the demonstration; a personal project is imported and kept locally in the browser.

A phone can view the 3D view and the plan at full width, with a collapsible rooms panel. Walking stays intended for a computer with keyboard and mouse. Texts, focus and dialogs were reworked during the accessibility review.

## Planned extensions

Furniture is an independent collection, tied to the project and the level, with identifiers, dimensions in metres and transforms. Rendering, placement checks, history and saves are isolated in `src/furniture/`. A future full delivery test would need a simulation of the path and rotations; the theoretical standing-passage module stays in the code, but is no longer exposed as a placement warning.

Identifiers are stable and the format carries `schemaVersion: 1`, to allow later migrations. No automatic PDF analysis tool is included in the application.
