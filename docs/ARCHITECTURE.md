# Architecture — code map

This document exists so that nobody has to re-read all of `src/` for every task. Read this
page, then only the files of the area concerned. Product rules and delivery constraints are in
[AGENTS.md](../AGENTS.md); the data format in [PROJECT-FORMAT.md](PROJECT-FORMAT.md).

## In one minute

Static Vite + TypeScript + Babylon.js 9 application. No backend, no account: all persistent
state lives in the browser's `localStorage`.

- `src/main.ts` — UI composition and **screen state**: selection, preferences,
  projects. It owns the DOM.
- `src/scene/viewer.ts` — the Babylon scene: cameras, modes, cutaway, lighting, measurements,
  collisions. It owns rendering.
- `src/model/` — pure data: types, validation, geometry. Neither DOM nor Babylon.
- `src/furniture/` — furniture: model, placement, groups, history, render layer.
- `src/ui/` — pure HTML fragments and self-contained panels.

The two worlds talk in one direction at a time: `main.ts` calls viewer methods, and the viewer
reports back through callbacks (`onViewChange`, `onFrame`, `onRendered`, `onSelectRoom`, `onDestination`,
`onMeasure`, `onEditFurniture`).

## Module map

| Area                    | File                                                                         | Role                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Composition             | `src/main.ts`                                                                | DOM wiring, `setMode`, projects, preferences, shortcuts                                                             |
| Engine                  | `src/scene/engine.ts`                                                        | WebGL engine, message when graphics acceleration is missing                                                         |
| Scene                   | `src/scene/viewer.ts`                                                        | `HouseViewer`: modes, cameras, cutaway, shadows, measurements, doors                                                |
| House geometry          | `src/scene/buildHouse.ts`                                                    | Walls, floors, ceilings, joinery, doors                                                                             |
| Wall edges              | `src/scene/beveledBox.ts`                                                    | Box with chamfered edges, for walls                                                                                 |
| Vertical corners        | `src/scene/cornerBead.ts`                                                    | Chamfer of the concave corners between two walls                                                                    |
| Exterior                | `src/scene/buildExterior.ts`                                                 | Façades, roof, terrain                                                                                              |
| Materials               | `src/scene/materials.ts`                                                     | Shared materials, procedural tiling                                                                                 |
| Relief and roughness    | `src/scene/surfaceTextures.ts`                                               | Procedural normal, roughness and exterior maps, tiled per metre                                                     |
| Sky                     | `src/scene/sky.ts`                                                           | Sky background layer, off in Plan and headset, hidden by a transparent export                                       |
| Frame of reference      | `src/scene/coordinates.ts`                                                   | Conversion to the plan frame, plan framing, keyboard movement                                                       |
| Framing                 | `src/scene/framing.ts`                                                       | `fitOverview`, `fitPlan`, UI margins                                                                                |
| Navigation              | `src/scene/navigation.ts`                                                    | Walk destination, section plane, wall facing the camera                                                             |
| Walk camera             | `src/scene/walkCamera.ts`                                                    | Eye height, visitor radius, speed, step                                                                             |
| Headset visit           | `src/scene/xrWalk.ts`                                                        | WebXR session of the walk: sticks, snap turn, teleport, doors; loaded on demand                                     |
| Orbit controls          | `src/scene/orbitNavigation.ts`, `orbitPointerInput.ts`                       | Keyboard pan in screen directions; one-finger pan and pinch zoom in Plan                                            |
| Wall cutaway            | `src/scene/wallCutaway.ts`                                                   | `auto` / `full` / `low`, clipping planes per material                                                               |
| Shadow map              | `src/scene/shadowRefresh.ts`                                                 | Sun map redrawn only when a shadow changes                                                                          |
| Idle rendering          | `src/scene/renderScheduler.ts`                                               | Frame drawn only when the scene changes; mouse moves wake it only over the canvas (`wakesScene`)                    |
| Shader warm-up          | `src/scene/shaderWarmup.ts`, `shaderLog.ts`                                  | Links a view's shaders behind an overlay on first use; `mybob.shaders()` log of every link                          |
| Dynamic resolution      | `src/scene/adaptiveResolution.ts`                                            | Resolution steps while moving, driven by frame time                                                                 |
| Openings in plan        | `src/scene/planOpenings.ts`                                                  | Windows and doors drawn in Plan view, cut faces                                                                     |
| Walk ambience           | `src/scene/interiorAmbience.ts`                                              | Local IBL, TAA, occlusion, bloom (walk, 3D view and Exterior)                                                       |
| View effect lifecycle   | `src/scene/viewEffects.ts`                                                   | Scene-owned environment and pipelines, camera replacement, effect tiers and disposal                                |
| Diagnostics             | `src/scene/diagnostics.ts`                                                   | `mybob.diag()`: engine, GPU, frame rate, resolution, scene                                                          |
| Frame profiler          | `src/scene/frameProfiler.ts`                                                 | `mybob.profile(s)`: GPU/CPU time and draw calls per image of the current view, loaded on demand                     |
| Screen-width lines      | `src/scene/screenLines.ts`                                                   | CSS-width dimension/measurement polylines, resize and material ownership                                            |
| Measurement             | `src/scene/measurement.ts`                                                   | Snapping to the plan axes                                                                                           |
| Sun                     | `src/scene/solar.ts`                                                         | NOAA equations, IANA time zones                                                                                     |
| Solar settings          | `src/model/solarSettings.ts`                                                 | Validation of explicit settings: no geolocation, no default place                                                   |
| Data                    | `src/model/types.ts`                                                         | Versioned format (`schemaVersion: 1`)                                                                               |
| Validation              | `src/model/validate.ts`                                                      | Import checks, readable errors                                                                                      |
| Pure geometry           | `src/model/geometry.ts`                                                      | Areas, containment, wall segments, floor elevation                                                                  |
| Share link — pack       | `src/model/linkPacker.ts`                                                    | Semantic binary pack of the `#p1:` hash (varints, quantisation)                                                     |
| Share link — URL        | `src/model/shareLink.ts`                                                     | Hash encoding/decoding, canonical state comparison                                                                  |
| Project storage         | `src/projectStorage.ts`                                                      | Reading imported projects, quarantine, 10-project limit                                                             |
| Furniture — model       | `src/furniture/model.ts`                                                     | Types, identifiers, storage key, history                                                                            |
| Furniture — rendering   | `src/furniture/layer.ts`                                                     | Meshes, selection, dragging, layers, plan clipping                                                                  |
| Furniture contact       | `src/furniture/contactShadow.ts`                                             | Procedural alpha tile and non-pickable floor footprints                                                             |
| Furniture — view policy | `src/furniture/viewState.ts`                                                 | Real camera mode and independent permission for scene interaction                                                   |
| Furniture — placement   | `src/furniture/placement.ts`                                                 | Building constraints, free-spot search                                                                              |
| Furniture — groups      | `src/furniture/groups.ts`                                                    | Linking, transforms, constrained dragging                                                                           |
| Furniture — editing     | `src/furniture/editorDraft.ts`                                               | Transactional draft of the popup                                                                                    |
| Furniture — panel       | `src/furniture/panel.ts`                                                     | List, add, edit popup                                                                                               |
| Furniture — variants    | `src/furniture/variants.ts`                                                  | Variant book per project; `VariantSession` loads and writes it per project and level                                |
| Furniture — arrangement | `src/furniture/arrangement.ts`                                               | Align, distribute, magnet (wall contact, neighbour alignment)                                                       |
| Furniture — circulation | `src/furniture/circulation.ts`                                               | Remaining passage strips around bed, sofa and table                                                                 |
| Furniture — room move   | `src/furniture/roomMove.ts`                                                  | Move a piece or linked set into another room (menu or drop), flip it against a partition's other face, with reasons |
| Furniture — helpers     | `src/furniture/clipboard.ts`, `resize.ts`, `tableChairs.ts`, `television.ts` | Session clipboard, local resize, chairs around a table, 16:9 screen                                                 |
| Interface               | `src/ui/appTemplate.ts`                                                      | Static application template                                                                                         |
| Mode texts              | `src/ui/modeChrome.ts`                                                       | Titles, keyboard and touch help per mode                                                                            |
| Viewport projection     | `src/ui/viewportProjection.ts`                                               | Frame-to-DOM projection: room labels, obstacle layout, dimensions, measurement position and walk HUD                |
| Frame-rate counter      | `src/ui/frameRate.ts`                                                        | fps display, written at most four times per second                                                                  |
| Panels                  | `src/ui/roomPanels.ts`, `minimap.ts`                                         | Room list, room card, mini-map                                                                                      |
| Variants panel          | `src/ui/variantsPanel.ts`, `variantThumbnail.ts`                             | Variant list, plan preview per variant                                                                              |
| Focus keeper            | `src/ui/focusKeeper.ts`                                                      | Keeps keyboard focus on the same control when a panel rebuilds its HTML                                             |
| Arrangement panel       | `src/ui/arrangementPanel.ts`                                                 | Align/distribute actions, grid snapping                                                                             |
| Sun panel               | `src/ui/solarPanel.ts`, `solarTimeline.ts`, `solarDay.ts`                    | Location (Open-Meteo only on an explicit search), timeline, day bounds                                              |
| Measure bar             | `src/ui/measureBar.ts`                                                       | Measure instructions and floating label; no geometry                                                                |
| Plan labels             | `src/ui/labelLayout.ts`                                                      | Non-overlapping label placement, confined to the room                                                               |
| Plans and precision     | `src/ui/sourcePanel.ts`                                                      | « Plans et précision » dialog: gap to the stated areas                                                              |
| Link divergence         | `src/ui/confirmLinkDivergence.ts`                                            | Three outcomes when a link and the local state differ                                                               |
| Import and limit        | `src/ui/confirmImport.ts`, `chooseProjectToReplace.ts`                       | Confirm a replacing import; pick a project to replace at the limit                                                  |
| Help and welcome        | `src/ui/firstSteps.ts`, `onboarding.ts`                                      | "Premiers pas" card, short and full help                                                                            |
| Image export            | `src/ui/imageExport.ts`                                                      | PNG of the camera, title block, options                                                                             |
| UI helpers              | `src/ui/format.ts`, `icons.ts`                                               | HTML escaping, number/area formatting, inline icons                                                                 |
| Test bench (dev)        | `src/ui/fxLab.ts`                                                            | Unsettled rendering questions — never in a build                                                                    |
| Build constants         | `src/build-env.d.ts`                                                         | Vite-injected public/private build flags                                                                            |
| Styles                  | `src/style.css` + `src/style/*.css`                                          | `chrome`, `scene`, `feedback`; panel CSS next to `furniture/panel.ts`, `ui/arrangementPanel.ts`, `ui/solarPanel.ts` |

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

`src/projectStorage.ts` owns the reading of `projects:v1`:

- An entry this build cannot read back (stricter validator, truncated JSON) is moved to
  `projects:v1:quarantine`, which no write touches; a banner offers to export it.
- At most 10 imported projects (`MAX_IMPORTED_PROJECTS`). At the limit, an import or a kept
  link opens `ui/chooseProjectToReplace.ts`; the chosen project is deleted only after the new
  one is installed.
- Two tabs on the same storage: when another tab writes (`storage` event), this tab shows a
  banner and stops saving until it is reloaded, popup drafts included.

## The three modes and their state — the most fragile point

`HouseViewer` owns the accepted `overview`, `plan` or `walk` mode and exterior status.
`viewer.mode` and `viewer.exteriorView` are read-only; the UI reads them directly.

- Every transition uses `viewer.setMode`, including load, room entry and destinations.
  `setExteriorView` requests an overview transition through the same path. Exterior remains
  an overview state; a headset session remains a walk state.
- Before changing state or cameras, `setMode` checks the host's `canChangeMode` policy
  (the UI explains refused touch-only walking) and resolves a valid walk destination.
  Refusal returns `false`, preserving the accepted mode, exterior, camera and active tools.
- After applying the camera, roof, section, cutaway and ambience, the viewer calls
  `onViewChange`. `main.syncViewChrome` derives buttons, titles, help and furniture policy
  from the accepted state. It never requests another transition. Ambience failures still
  allow the rest of the transition and notification to complete.
- `main.setMode` adds UI-request conveniences after acceptance: focus the selected room
  and return keyboard focus to the canvas. Viewer-originated transitions do not refocus it.
- Headset exit restores the camera of the currently accepted mode, even when an asynchronous
  session end follows a transition out of the walk.

Do not switch the active camera outside the viewer's transition/headset lifecycle.

Furniture interaction permission is derived from accepted view, active tools and read-only
status. `FurnitureLayer.setView` keeps the actual camera mode for clipping and label scaling;
disabling selection, dragging and overlays never substitutes a different camera mode.

`HouseViewer.load` releases the previous scene through `releaseScene`, then builds its
replacement and attaches scene-scoped input observers. Viewer disposal uses the same teardown;
Babylon clears those observers with their scene. `ViewEffects` owns effect creation and
disposal together, releases walk pipelines when their camera changes, and also cleans up on
scene disposal. Bootstrap composes the viewer and `ViewportProjection`; per-frame UI inputs
are explicit, while project loading and share-link adoption keep their existing boundaries.
`onFrame` fires before Babylon updates the camera (HUD state); `ViewportProjection` runs from
`onRendered`, after the image is drawn, because `viewer.project` only reads the camera's
current matrices: projected before the render, a label trails its room by one frame while the
camera moves.

## Walk and rendering

- Orbit temporal refinement is initialized only after a rendered scene frame establishes
  texture-fetch support. Its 16-sample TAA precedes bloom, retains 4x MSAA on its first
  target for motion and uses Babylon's default bypass while the camera moves. It needs
  no velocity pre-pass. The initial bloom is replaced once to establish this order;
  subsequent Plan round trips detach/reuse both pipelines. Plan resets the projection
  matrix to discard jitter. Orbit TAA stays outside walk effect tiers and does not
  request frames after initial setup: the existing 32-frame settle budget owns idle work.
  Screen overlays — room labels, dimension tags, the measure tag, export captions — project
  through the camera's unjittered matrix, restored from a forced recompute so the geometry
  pass keeps its sample; read through the jittered scene transform they tremble on every
  settle frame.
- Image export takes a fresh 16-sample average with frozen camera input when orbit TAA is
  active, so changed dimension/measurement visibility does not inherit old history.
  It restores blend/motion policy even on failure, resets camera history and requests
  settling after restoring overlays. Without orbit TAA, export retains its single render.
  This synchronous export cost and visual fidelity remain unverified on a real renderer.
- Overall dimensions share one GreasedLine mesh; each live/pinned measurement keeps its
  existing toggle/disposal group. Their unlit StandardMaterial retains scene clip planes.
  Width follows rendered pixels per CSS pixel on resize, including adaptive scaling;
  the requested raster width is 1.5 CSS pixels. Babylon 9.35's camera-facing shader needs
  twice that value in its material width because of its half-width NDC offset.
  Plan openings, furniture overlays and the plot boundary still use LinesMesh: migration
  stops at this first stage pending clipping and real raster review. DPR coverage and
  repeated-export stability have CI-only numeric probes, without visual attachments.
- The stable Babylon vendor chunk excludes WebXR modules: those live in `babylon-xr`,
  reached through the lazy `xrWalk` entry. A public-build guard rejects WebXR in the
  static import graph of an entry. Walk effects still load with the main engine. Mesh
  builders are imported one by one (`Meshes/Builders/<name>Builder`): `MeshBuilder`
  re-exports all of them and cost about 80 kB of minified engine chunk
  (`tests/bundle-imports.test.ts`).

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
  faces cost about thirty milliseconds when entering the walk. The geometry buffer is
  attached during the walk and released on exit. Mode environment selection is described
  below in Fixture ranges and exterior environment.
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
  pipeline at the end of the camera's chain, so `ViewEffects.updateWalk` builds the TAA first,
  the occlusion next, the bloom last. It reads `TAA, TAAPass, SSAO…, ssaoCombine, bloom, fxaa`. The
  bloom is set to a threshold of 0.9 and a weight of 0.2: the values are displayed values (tone
  mapping has already run) and lit white walls sit between 0.6 and 0.9 — at 0.6 the whole room
  bloomed and read as a milky sheen on the walls. Only the lamp and the view through the bay
  window exceed the threshold. Its `imageProcessingEnabled` is false, otherwise tone mapping
  would be applied twice — the app already tone-maps in the material shaders — and its
  sub-effects are configured before the cut-off, which destroys the post-process and nulls
  `imageProcessing`.
- Vue 3D has its own occlusion (#205), the walk's pipeline at the overview's scale
  (`ORBIT_OCCLUSION`: 0.5 m radius, 100 m depth range), built by `ViewEffects.updateOrbit` on
  the orbit camera between the orbit TAA and the bloom: it waits for the TAA's one attempt,
  detaches the bloom, and the bloom is attached again last. Extérieur and Plan have none, and
  it is released on leaving Vue 3D. The prepass it reads is shared with the walk, so whichever
  is released last switches the prepass off (`prePassInUse`). Software renderers never build
  it (`hardwareRenderer` in `viewer.ts`), which keeps CI's SwiftShader e2e as before; the last
  effect tier fades it out like the walk's, for good.
- Walk occlusion is **unconditional**: the probe that removed it below 24 frames per second has
  been deleted — judged on the test bench, losing the corner hollows cost more than a few
  frames per second on a weak machine. The only remaining refusal: a backend without multiple
  render targets, which `createInteriorOcclusion` detects and remembers so as not to reject on
  every walk entry. A slow GPU therefore keeps the occlusion and renders fewer frames.
- The frame rate is shown very small in the scene footer and turns amber below 24 frames per
  second. It is a display, not a quality setting. Next to it, « Sans accélération graphique »
  appears when the renderer is a CPU rasteriser (`isSoftwareRenderer`: SwiftShader, WARP,
  llvmpipe — graphics acceleration off in the browser); a click explains how to switch it
  on. It is the one cause of a slow scene a visitor fixes alone, without losing quality. To diagnose a slow machine remotely,
  `mybob.diag()` prints engine, GPU, frame rate, actually rendered resolution, walk ambience
  state, scene size and machine characteristics; the command is recalled at start-up.
  `mybob.diag()` returns nothing — the console would echo the return value and the report
  would appear twice — and `mybob.report()` gives the same text without printing it, for
  `copy(mybob.report())`. `mybob.profile(seconds)` measures instead of describing: it draws every image of the
  current view for that long (a still view included, without feeding the dynamic resolution)
  and prints the median and 95th percentile of the GPU time — only where the browser exposes
  the timer query, Chrome on most desktops — the CPU time of the render, the mesh selection
  and the draw calls. The development bench's « Mesurer chaque vue » runs it on Plan, Vue 3D
  still and turning, Extérieur and Visite in turn: a rendering change is judged on those
  numbers, from the same path, before and after.
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

## Fixture ranges and exterior environment

`scene/fixtureLights.ts` assigns fittings to world AABBs by sphere intersection. It runs
at house/exterior construction, range changes (5.5 m overview, 7 m walk), furniture
`setItems`, and a completed group drag position update. Materials retain their light
limits. Door descendants use conservative swept bounds around both jambs, including
handles and sectional travel; animated poses do not rebuild assignments. An empty
intersection explicitly excludes receivers because Babylon treats an empty inclusion
list as unrestricted. The eight-room test fixture has a clean floor-plane audit.

`scene/exteriorAmbience.ts` generates a local half-float sky, sun lobe and ground bounce.
`ViewEffects.updateEnvironment` explicitly selects sky in overview/exterior, no environment
in Plan, and the existing interior bounce in walk. Sky intensity is 0.25 and overview
hemispheric intensity is 0.45. Solar direction changes debounce regeneration by 150 ms;
the previous texture is disposed after replacement. Scene disposal cancels pending work. Each request snapshots its direction; completed sky
rebuilds explicitly request a render, and diagnostics report either active owned environment.
No location is inferred. The walk environment and bloom calibration remain unchanged.

Four comparisons were closed on the development bench, on the reference PC, and it no longer
offers them: Vue 3D occlusion was adopted (#205, described above), and three were dropped:

- Tone mapping stays ACES. Khronos PBR Neutral was compared in every view and showed no
  visible difference: the finishes people choose here are light, low-saturation colours
  (default wall `#eeede8`), where both curves agree; they diverge on saturated colours in
  strong light, which this tool's projects rarely use (#202). The bloom thresholds and walk
  intensities, calibrated on ACES, are unchanged.
- Occlusion stays at 16 samples with Babylon's fixed noise. The candidate took 8 samples and
  swapped the noise among 8 patterns every image for the TAA to average (the GTAO/XeGTAO
  approach). Measured with « Mesurer chaque vue » on an RX 9060 XT, it saved 0.1–0.2 ms of a
  1.8 ms Visite image, and left streaky grain on plain walls even at rest: the walk's TAA
  clamps its history, so it never averages the moving noise away. Not worth a visible loss.
- Sun shadows stay on medium PCF: contact-hardening shadows (PCSS, light size ratio 0.03)
  were compared in Extérieur with a solar preview and showed no visible difference (#204). The orbit experiment releases on mode exit and resets its controls on scene replacement.
  It remains outside production adaptive-quality policy.

## The visit in a headset

The **Casque** button (`#enter-immersive`) only shows when
`navigator.xr.isSessionSupported('immersive-vr')` says yes (Quest browser, desktop VR). It is a
state of the walk, **not a fourth view mode**: `viewer.mode` stays `walk`, and
`viewer.enterImmersive()` swaps the camera for the session's. Leaving the walk (`setMode`) ends
the session; the end, whoever caused it, goes through `leaveImmersive`, which puts the screen
walk where the headset left the visitor and restores the camera of the current mode.

- `scene/xrWalk.ts` is a separate chunk, imported on demand (`preloadImmersive` fetches it as
  soon as the browser says yes, so the click keeps its user gesture).
- The visitor is carried by a **rig node**, parent of the session camera: walking, turning,
  teleporting and following the floor move the rig, never the camera. Moving the camera would
  make Babylon offset the XR reference space, which the Immersive Web Emulator 2.0 ignores — the
  visitor then stood at the plan origin, outside the house, in an empty view.
- Controls, xr-standard mapping: left stick walks where the head looks (1.6 m/s, walls collide
  through an ellipsoid hung under the head, resolved on the rig, a 20 cm step does not); right
  stick sideways snaps 30°, pushed forward aims a teleport validated like a walk destination
  (`isSceneVisitDestination` or `isParcelDestination`); trigger on a door toggles it; B/Y
  switches the walk post-processing, to compare frame rates in the headset.
- `local-floor` reference space: the real head height replaces the eye-height setting, and the
  real floor is kept on `groundElevationAt` every frame. Room-scale moves (the headset itself
  moving, the emulator's ZQSD) go through the stick's collider every frame (`followPose`): the
  rig takes back what a wall refused, so the head stops at the wall. A jump over 0.5 m in one
  frame is a tracking reset and is not collided. The open edge of the modelled ground has no
  wall: there, the `isVisitArea` guard sends the visitor back.
- No controller model is downloaded: gamepads are read directly and the pointers are drawn
  locally.
- In a session the render loop draws every frame (a skipped frame judders in a headset) and the
  dynamic resolution is off. TAA and SSAO are rebuilt on the session camera at its **first
  frame**, once the framebuffer has its size. The bloom stays off in the headset: on the session
  camera it renders into a zero-size target every frame (`INVALID_FRAMEBUFFER_OPERATION`) and
  adds nothing. Whether TAA and SSAO hold the frame rate on a Quest 2 is still to be measured on
  the device.
- A counter plane (`scene/xrHud.ts`) is carried by the head, lower left of the view: the frame
  rate over 500 ms windows, in red under 24 fps (the page's own counter is DOM, which a headset
  never shows). A second line, `limite du terrain ×N`, appears once the `isVisitArea` guard has
  sent the visitor back inside the modelled ground: it tells a rollback from that guard apart
  from any other. It is drawn over the house (own rendering group, depth test off); its text is
  not yet checked in a real headset.
- Without a headset: the Immersive Web Emulator extension (Chrome/Edge, enabled for the site)
  emulates a Quest in the page, with its sticks and buttons in an overlay. It checks controls
  and rendering, not the headset's frame rate.
- Local test on a Quest: `adb reverse tcp:<port> tcp:<port>`, then `http://localhost:<port>` in
  the Quest browser (WebXR needs HTTPS or `localhost`; a LAN address over HTTP is refused).
  `dev:private` this way keeps a personal plan on the computer.

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
- **Integrity**: since revision 4 the pack ends with a CRC-32 (`crc32` in `linkPacker.ts`). A
  link altered by one character is refused (« Ce lien est tronqué ou illisible ») instead of
  decoding into another valid project; revisions 1 to 3 carry no checksum and still read.
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
- Shader effects persist for the current scene: automatic cutaways switch wall materials as
  the camera turns, and repeatedly linking their shaders can stall Firefox. The engine releases
  the cached effects when the scene is replaced, so project switches do not accumulate them.
- At rest the scene is no longer redrawn (`renderScheduler.ts`) after 32 smoothing frames.
  An interaction in the page (pointer, keyboard, input), the window regaining focus or the
  tab becoming visible, a camera movement, a swinging door or a compiling shader restarts
  drawing. A scene change that comes from none of these signals (timer, loading, animation
  driven by `requestAnimationFrame`) calls `viewer.requestRender()`.
  Where no temporal effect is on screen (Plan) one frame per second still catches a change
  nobody announced. Walk (TAA and occlusion) and the 3D view (orbit TAA) have no such
  refresh: each image jitters the camera and re-reads the depth, so the occlusion and the
  accumulated antialiasing shift at every one and a still view changed by itself (measured
  on the demo, mean 1.5-3/255 within 25 s; 0 with the refresh off). `ViewEffects.temporalActive`
  tells the scheduler.
- Dynamic resolution (`adaptiveResolution.ts`), the same at rest and in motion: if the median
  frame time exceeds 25 ms (under 40 fps), rendering drops one step (100, 80, 67 %) without
  going below one rendered pixel per CSS pixel. The
  scale only goes down and is kept for the session, because changing it resizes every render
  target, which hitches. The first 30 images and the 30 after each change are not measured.
  A gap over 5 s between two images is a stall, never a measurement, and hiding the
  page, losing or regaining the focus restarts that warm-up and drops the half-measured
  series: the slow images after an alt-tab are not the machine, and a tier is never lifted.
  Once at the resolution floor and still over budget, the visit drops its one effect tier:
  no occlusion (the walk's and Vue 3D's), which fades out over 0.8 s rather than blinking off. The occlusion is never
  degraded on the way (fewer samples, cheap blur): a look that changes by itself reads as a
  bug. Fewer TAA samples is no tier: the count only sets the length of the jitter sequence,
  each image costs the same. A tier is never lifted. A PC that holds the frame rate never
  leaves 100 % nor tier 0. At dpr 1 the floor is 100 %, so the tier is the only lever; on an
  integrated GPU at 75 Hz the walk can run at 63–70 fps (frames missing one refresh), measured
  above the 40 fps budget and left as it is: no single effect costs more than the run-to-run
  noise, only half the resolution holds 75 fps.
  `mybob.diag()` shows the scale and the tier (`effets palier n/1`). The tier is not stored
  between sessions.
- Static house and exterior meshes freeze their world matrices after construction. Moving
  door leaves and every descendant of a moving pivot stay unfrozen. House shell and trim
  merge separately per wall, material, picking and collision policy; trim keeps a name outside
  the `wall:<id>:` shell prefix. Merged shadow casters replace their disposed source entries.
- Room/dimension projection skips still frames unless preferences, level, measurements or
  page interactions invalidate it. A separate furniture-obstacle revision also invalidates labels
  after live placement, selection/overlay rebuilding and final Plan label layout; it does not
  invalidate shadows or lighting. Walk prompts still update each frame; their ray reuses its
  hit until the camera, a door or furniture changes. Plan furniture labels cache camera and
  overlay identity. Direct mode/cutaway changes still apply immediately.
- A view's shaders are linked behind an overlay, the first time the view is drawn
  (`shaderWarmup.ts`, `viewer.prepareView`). Babylon links a material the first time it is drawn
  with a given set of defines, and a view change alters them (sky, lights, prepass, temporal
  pass); on ANGLE/D3D11 each program blocks the frame ~90 ms, so an unprepared first switch froze
  the page for seconds. The render loop spots a view not yet in `ViewWarmth`, skips drawing,
  tells the host (`onPreparing`: `#loading`) and draws until the engine reports every effect ready and the sun shadow map has settled, three frames in a row (receivers relink once their shadow is ready), for at most 20 s. Software renderers (SwiftShader, llvmpipe, WARP) skip it: they link slowly and
  front-loading would only multiply their work, so CI e2e keeps the on-demand behaviour.
  The start-up is the same path with the landing view, so nothing else needs to call it. A new
  scene (project or level change) releases the cached effects and makes every view cold again.
  `mybob.shaders()` lists every link with its duration and the preparation marks. Its first
  lines summarise what to check: whether the engine has `KHR_parallel_shader_compile`, each
  view's overlay time (from its `préparation` mark to its `prête` mark) with its program count,
  and the links that came after a preparation. With the extension, which Firefox and Chrome
  both expose, Babylon only polls for completion: a link's `ms` is the time until it finished,
  not time the page was frozen, and overlapping links must not be summed. Without it, each
  link blocks, and the report also gives the blocking sum per view. `mybob.shaders(true)` also copies the report, because
  the console truncates it; when the clipboard refuses, `copy(mybob.shaderReport())` does it.
- Babylon keys a program by its define string, in the order the defines were first set on
  that sub-mesh: a light index seen for the first time lands after `LIGHTCOUNT`, so a mesh
  first drawn in the plan asked for the overview's programs again, reordered, and linked
  duplicates after the view was ready. `installCanonicalDefineOrder`
  (`src/scene/canonicalDefines.ts`, called by the viewer) sorts the keys of every
  `MaterialDefines`; `tests/canonical-defines.test.ts` drives the viewer through every view
  on a NullEngine and requires no new program on the way back.
- Leaving the visit switches the temporal jitter material plugin off (`reprojectHistory = false`
  before the pipeline is disposed, `ViewEffects.releaseWalkPipelines`): Babylon leaves that plugin
  attached and enabled on every material, which changes their defines and made the plan, the
  overview and the exterior relink all their programs after a visit.
- The sun shadow map is only redrawn when its casters change (`shadowRefresh.ts`): mode,
  cutaway, roof, sun, animated door and furniture changes. A new moving shadow caster calls `invalidate()`.
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

Browser verification follows the [local policy in AGENTS.md](../AGENTS.md#local-browser-verification-policy).
CI recipes are in [E2E.md](E2E.md). DOM and NullEngine tests prove behavior, not rendering;
leave visual acceptance unproven when the policy prevents further inspection.

A useful browser recipe when a bug depends on a multi-level project, without ever creating a
private file in the repository: run `pnpm run dev`, then inject a test project into
`localStorage` before the page loads (key `maison-atelier:projects:v1`, array of validated
projects) and select it in `#project-select`. A "Premier étage" level is made by duplicating
the studio's level with `elevation: 2.8`.

On a fixture you are about to use in a test, run `scripts/audit-plan.ts`: a green suite on
wrong geometry does not tell the correct from the incorrect.

Spatial upscaling (AMD FSR 1) was examined and not adopted. Babylon 9.35 ships it
(`FSR1RenderingPipeline`), but it only shrinks the image that enters its own first pass: the
prepass that feeds the TAA and the occlusion is sized from the engine's render size, so in
front of them it changes nothing, and behind them it would upscale an image already rendered
in full. A lower render scale therefore stays hardware scaling (`adaptiveResolution.ts`),
stretched by the browser. Doing better needs the whole chain in one reduced-size target, which
is what Babylon's Frame Graph provides, not the pipelines this app uses.

## Known traps

- Merged wall bounds span empty doorways. Collision/reachability checks must use occupied
  triangles or actual visitor movement, not treat an entire mesh AABB as solid.

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
- The engine is **WebGL only**. Occlusion needs multiple render targets for its prepass; on
  WebGPU, Babylon provides them only through a side-effect module
  (`Engines/WebGPU/Extensions/engine.multiRender`) the app never imports, so a WebGPU engine
  refuses the occlusion and renders the walk flatter without reporting anything. Importing it
  would not settle the question either: it is a second implementation of every pass (WGSL
  shaders, a different prepass path) that CI's SwiftShader e2e never runs. One backend, one
  path to keep correct. Do not reintroduce a fallback.
