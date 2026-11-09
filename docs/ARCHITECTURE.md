# Architecture — code map

This document exists so that nobody has to re-read all of `src/` for every task. Read this
page, then only the files of the area concerned. Product rules and delivery constraints are in
[AGENTS.md](../AGENTS.md); the data format in [PROJECT-FORMAT.md](PROJECT-FORMAT.md).

## In one minute

Static Vite + TypeScript + Babylon.js 9 application. No backend, no account: all persistent
state lives in the browser's `localStorage`.

- `src/main.ts` — UI composition and **screen state**: current mode, selection, preferences,
  projects. It owns the DOM.
- `src/scene/viewer.ts` — the Babylon scene: cameras, modes, cutaway, lighting, measurements,
  collisions. It owns rendering.
- `src/model/` — pure data: types, validation, geometry. Neither DOM nor Babylon.
- `src/furniture/` — furniture: model, placement, groups, history, render layer.
- `src/ui/` — pure HTML fragments and self-contained panels.

The two worlds talk in one direction at a time: `main.ts` calls viewer methods, and the viewer
reports back through callbacks (`onModeChange`, `onFrame`, `onSelectRoom`, `onDestination`,
`onMeasure`, `onEditFurniture`).

## Module map

| Area                  | File                                    | Role                                                                 |
| --------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| Composition           | `src/main.ts`                           | DOM wiring, `setMode`, projects, preferences, shortcuts              |
| Engine                | `src/scene/engine.ts`                   | WebGL engine, message when graphics acceleration is missing          |
| Scene                 | `src/scene/viewer.ts`                   | `HouseViewer`: modes, cameras, cutaway, shadows, measurements, doors |
| House geometry        | `src/scene/buildHouse.ts`               | Walls, floors, ceilings, joinery, doors                              |
| Wall edges            | `src/scene/beveledBox.ts`               | Box with chamfered edges, for walls                                  |
| Vertical corners      | `src/scene/cornerBead.ts`               | Chamfer of the concave corners between two walls                     |
| Exterior              | `src/scene/buildExterior.ts`            | Façades, roof, terrain                                               |
| Materials             | `src/scene/materials.ts`                | Shared materials, procedural tiling                                  |
| Relief and roughness  | `src/scene/surfaceTextures.ts`          | Procedural normal and roughness maps, tiled per metre                |
| Frame of reference    | `src/scene/coordinates.ts`              | Conversion to the plan frame, plan framing, keyboard movement        |
| Framing               | `src/scene/framing.ts`                  | `fitOverview`, `fitPlan`, UI margins                                 |
| Navigation            | `src/scene/navigation.ts`               | Walk destination, section plane, wall facing the camera              |
| Walk camera           | `src/scene/walkCamera.ts`               | Eye height, visitor radius, speed, step                              |
| Wall cutaway          | `src/scene/wallCutaway.ts`              | `auto` / `full` / `low`, clipping planes per material                |
| Shadow map            | `src/scene/shadowRefresh.ts`            | Sun map redrawn only when a shadow changes                           |
| Idle rendering        | `src/scene/renderScheduler.ts`          | Frame drawn only when the scene changes                              |
| Dynamic resolution    | `src/scene/adaptiveResolution.ts`       | Resolution steps while moving, driven by frame time                  |
| Openings in plan      | `src/scene/planOpenings.ts`             | Windows and doors drawn in Plan view, cut faces                      |
| Walk ambience         | `src/scene/interiorAmbience.ts`         | Local IBL, TAA, occlusion, bloom (walk, 3D view and Exterior)        |
| Diagnostics           | `src/scene/diagnostics.ts`              | `mybob.diag()`: engine, GPU, frame rate, resolution, scene           |
| Measurement           | `src/scene/measurement.ts`              | Snapping to the plan axes                                            |
| Sun                   | `src/scene/solar.ts`                    | NOAA equations, IANA time zones                                      |
| Data                  | `src/model/types.ts`                    | Versioned format (`schemaVersion: 1`)                                |
| Validation            | `src/model/validate.ts`                 | Import checks, readable errors                                       |
| Pure geometry         | `src/model/geometry.ts`                 | Areas, containment, wall segments, floor elevation                   |
| Share link — pack     | `src/model/linkPacker.ts`               | Semantic binary pack of the `#p1:` hash (varints, quantisation)      |
| Share link — URL      | `src/model/shareLink.ts`                | Hash encoding/decoding, canonical state comparison                   |
| Furniture — model     | `src/furniture/model.ts`                | Types, identifiers, storage key, history                             |
| Furniture — rendering | `src/furniture/layer.ts`                | Meshes, selection, dragging, layers, plan clipping                   |
| Furniture — placement | `src/furniture/placement.ts`            | Building constraints, free-spot search                               |
| Furniture — groups    | `src/furniture/groups.ts`               | Linking, transforms, constrained dragging                            |
| Furniture — editing   | `src/furniture/editorDraft.ts`          | Transactional draft of the popup                                     |
| Furniture — panel     | `src/furniture/panel.ts`                | List, add, edit popup                                                |
| Furniture — variants  | `src/furniture/variants.ts`             | Variant book per project                                             |
| Furniture — session   | `src/furniture/layoutSession.ts`        | Loading/writing per project and level                                |
| Interface             | `src/ui/appTemplate.ts`                 | Static application template                                          |
| Mode texts            | `src/ui/modeChrome.ts`                  | Titles, keyboard and touch help per mode                             |
| Frame-rate counter    | `src/ui/frameRate.ts`                   | fps display, written at most four times per second                   |
| Panels                | `src/ui/roomPanels.ts`, `minimap.ts`    | Room list, room card, mini-map                                       |
| Link divergence       | `src/ui/confirmLinkDivergence.ts`       | Three outcomes when a link and the local state differ                |
| Help and welcome      | `src/ui/firstSteps.ts`, `onboarding.ts` | "Premiers pas" card, short and full help                             |
| Image export          | `src/ui/imageExport.ts`                 | PNG of the camera, title block, options                              |
| Test bench (dev)      | `src/ui/fxLab.ts`                       | Unsettled rendering questions — never in a build                     |
| Styles                | `src/style.css` + `src/style/*.css`     | `chrome`, `scene`, `feedback`; `furniture/panel.css` for the popup   |

## The path of a piece of data

```text
public/projects/*.json
  → validateProject()            src/model/validate.ts
  → HouseViewer.load()           src/scene/viewer.ts
      → buildHouse()             walls, floors, doors
      → buildExterior()          façades, roof, terrain
      → buildWallCutaway()       clipping planes
      → buildPlanOpenings()      openings in plan
  → FurnitureLayer               src/furniture/layer.ts
  → localStorage                 keys below
```

Storage keys, all prefixed `maison-atelier:` — `projects:v1` (imported projects),
`layout:v1:<project>:<level>` (arrangement), `variants:v1:<project>`, `navigation:v1`,
`onboarding`, `solar:<project>`, `last-project`. Changing a key breaks local data: only do it
with a migration.

## The three modes and their state — the most fragile point

`overview`, `plan` and `walk` exist **twice**: `mode` in `src/main.ts` (what the interface
shows) and `viewer.mode` in `src/scene/viewer.ts` (what the scene renders).

- `main.setMode(next, fromViewer)` is the interface's only entry point. It sets `mode`, calls
  `viewer.setMode(next)` if needed, then updates the buttons, titles, help and
  `syncDisplayControls()`.
- `viewer.setMode()` may **refuse**: without a valid walk destination it calls
  `onDestinationRejected` and returns without changing `viewer.mode`. `main.setMode` then
  re-reads `viewer.mode` and returns `false`: that is why `setMode` returns a boolean.
- `viewer.onModeChange` reports back to `main.setMode(next, true)`. The `syncingViewerMode`
  flag prevents recursion when `main` triggered the change.
- Never write `viewer.mode` directly, nor switch the active camera outside `viewer.setMode`:
  the section (`updateSection`), the cutaways (`updateCutaway`), the shadows
  (`updateShadowPolicy`) and the ambience are all derived from `viewer.mode`.

Symptom of a desynchronisation: the interface still shows "Plan" while the camera walks, or
the reverse. Any new way of entering the walk must go through `main.setMode` or through a
viewer method that calls `setMode` (such as `goTo` and `focusRoom`).

## Walk and rendering

- Walking speed is 2.8 m/s by default, adjustable from 1 to 5 m/s; Shift multiplies it by 1.7.
  Look sensitivity ranges from 50 to 200 %. Both settings are local
  (`maison-atelier:navigation:v1`) and apply to every project.
- ACES tone mapping, reduced sky and sun intensities. The Light button only controls the
  interior light fittings, never the sun.
- The walk has its own ambience: a locally generated cube environment (no remote file) for an
  ambient reflection, visible mostly on glass and steel; relief comes from ambient occlusion
  and the level's light fittings, boosted because the ceiling hides the sun. This environment
  is in **half floats**, hence linear and beyond white: the bay window and the light fitting
  are worth several times a wall in it, which gives reflections a hot spot instead of a grey
  smudge. It is generated at 128 px — a reflection resolves no more than that, and the six
  faces cost about thirty milliseconds when entering the walk. Plan and 3D view keep their
  lighting: the environment and the geometry buffer are only attached during the walk and
  released on exit, and the previous environment is restored rather than cleared. With a
  solar preview applied, the ambience follows the sun as elsewhere.
- Walls are boxes with chamfered edges (`beveledBox.ts`, 4 mm): a sharp edge is the number-one
  marker of a computer-generated image, a chamfer catches the light. The wall/ceiling and
  wall/floor junctions carry one.
- **Vertical** corners between two walls carry none, and that is measured, not assumed. Such
  a corner is concave: its two inner faces intersect, there is no edge to chamfer. Mitring it
  would change nothing in the image — the mitre only moves the overlap hidden inside the wall,
  the visible face stays the same. `cornerBead.ts` can lay a 45° chamfer on top, but at 4 mm
  it is invisible and at 12 mm it erases the hollow drawn by the occlusion: the two walls
  differ there by 6 levels out of 255, there is nothing to soften. The module stays, the test
  bench lets you check it again.
- The test bench (`src/ui/fxLab.ts`) only exists in development: `main.ts` imports it behind
  `import.meta.env.DEV` and dynamically, so Vite removes it entirely from a build. It carries
  the unsettled rendering questions, to judge them on the real house rather than blindly. Dust
  particles were tried there then removed: a real speck is a few tens of microns, below a
  pixel at any distance, and a sprite big enough to be seen reads as snow. No setting fits in
  between.
- Surfaces are no longer flat colours: plaster, parquet, concrete and steel carry a normal map
  and a roughness map, generated from fractal noise and tiled per metre. Box UVs are rewritten
  in metres by `worldScaleUvs`, otherwise a 4 m wall and a 50 cm skirting board would stretch
  the same grain differently. Parquet keeps its 4.8 × 3.2 m tile, that of its albedo, and its
  roughness varies plank by plank. Pixel data is computed once per session and cached:
  switching project rebuilds the scene, not the noise.
- The walk post-processing chain is ordered and the order matters: Babylon appends each
  pipeline at the end of the camera's chain, so `updateInteriorAmbience` builds the TAA first,
  the occlusion next, the bloom last. It reads `TAA, TAAPass, SSAO…, ssaoCombine, bloom`. The
  bloom is set to a threshold of 0.9 and a weight of 0.2: the values are displayed values (tone
  mapping has already run) and lit white walls sit between 0.6 and 0.9 — at 0.6 the whole room
  bloomed and read as a milky sheen on the walls. Only the lamp and the view through the bay
  window exceed the threshold. Its `imageProcessingEnabled` is false, otherwise tone mapping
  would be applied twice — the app already tone-maps in the material shaders — and its
  sub-effects are configured before the cut-off, which destroys the post-process and nulls
  `imageProcessing`.
- Walk occlusion is **unconditional**: the probe that removed it below 24 frames per second has
  been deleted — judged on the test bench, losing the corner hollows cost more than a few
  frames per second on a weak machine. The only remaining refusal: a backend without multiple
  render targets, which `createInteriorOcclusion` detects and remembers so as not to reject on
  every walk entry. A slow GPU therefore keeps the occlusion and renders fewer frames.
- The frame rate is shown very small in the scene footer and turns amber below 24 frames per
  second. It is a display, not a quality setting. To diagnose a slow machine remotely,
  `mybob.diag()` prints engine, GPU, frame rate, actually rendered resolution, walk ambience
  state, scene size and machine characteristics; the command is recalled at start-up.
  `mybob.diag()` returns nothing — the console would echo the return value and the report
  would appear twice — and `mybob.report()` gives the same text without printing it, for
  `copy(mybob.report())`.
- The exterior frames the building and its roof — distance and azimuth are chosen with them,
  and the plot stays whole in the background without dictating the framing; 3D view shows the
  house open; Plan hides terrain and roof. Selecting a room or adding furniture from the
  exterior returns to the interior view.
- The walk leaves the house: the limit is the plot (`site.boundary`), not the level footprint.
  Without `site`, the footprint stays the limit. The `beforeFrame` guard only sends the visitor
  back to the start when outside the plot, below the floor or above the ceiling; the floor
  under the visitor is the room's inside and the flat terrain's outside (`groundElevationAt`).
  The step between the two is climbed by `prepareWalkStep`, which measures the rise from that
  floor: terrain declared below the floor no longer blocks the way back. Returning from the
  plan to the walk from the lawn keeps the current point (`isParcelDestination`) instead of
  refusing the destination. The roof is visible during the walk: inside, the ceiling hides it;
  outside, it renders the whole house. Exterior walls keep their collisions, so you only leave
  through an open door.

## The share link

The header's **Lien** button copies a URL whose `#p1:<base64url>` fragment is a snapshot of
the current state (`history.replaceState`, never `location.hash`: navigation does not stack
up). The fragment is written after every change, with a 500 ms debounce guaranteed on the
last call, and read back at start-up.

- **Content**: `model/linkPacker.ts` packs a complete export document — project, arrangement
  of every level and all the variants — never the camera nor the navigation preferences.
- **Transport projection**: the pack only exists in the URL. Identifiers (furniture, levels,
  walls, openings, rooms) are **renumbered positionally** in it (`meuble-0`, `mur-0-1`…): UUID
  entropy does not fit under 3 KB. Only fields carrying a stable meaning are kept:
  `project.id`, names, notes, description, source, variant identifiers. Repacking an unpacked
  document yields the same bytes.
- **Reading at start-up** (`main.ts`, `openSharedLink`): the hash wins over `localStorage`.
  - The project already exists here (owner): silent comparison on the **canonical packed
    bytes** (`samePackedState`, not on the compressed hash, deflate being non-deterministic
    across browsers). Identical → nothing. Different → `ui/confirmLinkDivergence.ts`: replace,
    keep both, or ignore — never a silent loss.
  - The project does not exist here (recipient): opened **in memory only** (no `localStorage`
    write), read-only with a banner and an **Ajouter à mes projets** button that copies the
    document under a new identifier then installs it normally.
- **Tab reload**: `sessionStorage` remembers the last 8 hashes published by this tab (only
  after `replaceState` succeeded) and the hash shown at `pagehide`; no hash is published once
  the page is being left. A reload starts with the URL of the moment it was requested, so a
  debounced write can publish a newer hash before the page goes away. On load
  (`isOwnStaleHash`), the last published hash is the tab's own; an older one is too, unless
  the page was showing it when left — a deliberate return to an older link still opens the
  dialog. An own hash loads the more recent local state without a dialog.
- An unreadable hash never prevents start-up: the local project is loaded, a warning is shown.

## Invariants not to break

- Metres internally, centimetres in fields; unedited values keep their exact value despite
  display rounding.
- Stable identifiers, `schemaVersion: 1`, validation on import.
- Identifiers only live in memory and in `localStorage`; the link pack is a transport
  projection that renumbers them — never reuse the pack as state.
- Furniture dialogs are transactional: everything stays a draft until Enregistrer (Save),
  Annuler (Cancel) discards it all.
- Reactivity does not replace a native control while typing.
- Walk and exterior keep full volumes; an explicit cutaway keeps priority.
- At rest the scene is no longer redrawn (`renderScheduler.ts`): one frame per second only,
  after 32 smoothing frames. An interaction in the page (pointer, keyboard, input), a camera
  movement, a swinging door or a compiling shader restarts drawing. A scene change that comes
  from none of these signals (timer, loading, animation driven by `requestAnimationFrame`)
  calls `viewer.requestRender()`, otherwise it only appears with the next second's frame.
- Dynamic resolution (`adaptiveResolution.ts`), only while moving: if the median frame time
  exceeds 25 ms (under 40 fps), rendering drops one step (100, 80, 67, 50 %); when still, it
  always returns to 100 % and TAA finishes the still image. A PC that holds the frame rate
  never leaves 100 %. `mybob.diag()` shows the step reached.
- The sun shadow map is only redrawn when its casters change (`shadowRefresh.ts`): mode,
  cutaway, roof, sun, animated door. A new moving shadow caster calls `invalidate()`.
- The public build only contains the demonstration: `vite.config.ts` and
  `scripts/check-public-build.mjs` carry the allowlist.
- No personal data in the repository: private plans are git-ignored
  `public/projects/private-*.json`.

## Recipes

**Add a view mode** — `ViewMode` in `viewer.ts`, a branch in `viewer.setMode` (camera,
section, cutaways), a title and help in `ui/modeChrome.ts`, a `[data-view]` button in
`ui/appTemplate.ts`, then check `syncDisplayControls` and the `mode === 'walk'` guards
scattered through `main.ts`.

**Add a furniture type** — `FurnitureKind` and the default dimensions in `furniture/model.ts`,
the geometry in `furniture/layer.ts`, the popup fields in `furniture/panel.ts` and
`measurements.ts`, the constraints in `placement.ts` and `checks.ts`.

**Add a field to the project format** — `model/types.ts`, `model/validate.ts` (with an error
message in French, it is shown to the user), the consumer in `scene/` or `ui/`, a test in
`tests/model.test.ts`, and the documentation in `PROJECT-FORMAT.md`.

**Change an interface text** — mode labels are in `ui/modeChrome.ts`, help in
`ui/firstSteps.ts`, rooms in `ui/roomPanels.ts`, the rest in `ui/appTemplate.ts` and
`main.ts`. Follow the voice described in [BRAND.md](BRAND.md).

## Verify

```sh
pnpm install --frozen-lockfile
pnpm test          # node --test + tsx: DOM (Happy DOM) and geometry (NullEngine)
node --import tsx --test --test-isolation=none tests/<area>.test.ts   # a single area file
pnpm run ci        # format, tests, build, public-build check (no e2e)
```

A browser workflow is verified locally by the e2e scenarios of the touched feature only —
`--grep` or file, never the whole suite: the recipe and commands are in [E2E.md](E2E.md), the
full suite belongs to CI.

DOM tests use Happy DOM and scene tests a `NullEngine`: they prove behaviour, not rendering. To
judge a rendering, open a real browser and say what was looked at.

A useful browser recipe when a bug depends on a multi-level project, without ever creating a
private file in the repository: run `pnpm run dev`, then inject a test project into
`localStorage` before the page loads (key `maison-atelier:projects:v1`, array of validated
projects) and select it in `#project-select`. A "Premier étage" level is made by duplicating
the studio's level with `elevation: 2.8`.

On a fixture you are about to use in a test, run `scripts/audit-plan.ts`: a green suite on
wrong geometry does not tell the correct from the incorrect.

## Known traps

- `public/projects/maison-atelier.json` is a **synthetic test template**, not the owner's
  house; `studio-demo.json` is the public demonstration. Both may be edited.
- `planArea` must match the polygon to within one square centimetre (`tests/model.test.ts`).
- An L-shaped or rotated piece of furniture is not tested with its bounding box: it rejects
  valid placements. Use the projected triangles.
- Plan sets a horizontal section plane; the walk must reset it to `null`, otherwise walls stay
  truncated.
- Shadows are turned off when walls are lowered: a truncated façade must not cast the shadow
  of its full volume.
- The automatic cutaway is at 0.85 m, below the window sills (0.90 m): that is what makes them
  disappear entirely. Bay windows and doors start at the floor and are sliced; their cut face is
  solid (`plan-wall-cap-full`) and the joinery stops 18 mm lower. Raising the cut above 0.90 m
  re-slices every window.
- The e2e suite takes a free port: never `--strictPort` on a known port, and never stop another
  agent's server.
- The engine is **WebGL only**. Walk occlusion goes through the geometry buffer, which Babylon
  does not implement in WebGPU: a WebGPU engine would render the walk flatter without reporting
  anything. Do not reintroduce a fallback.
