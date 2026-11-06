---
name: mybob-plan-conversion
description: Reconstruct or regenerate Mybob house JSON from architectural PDFs using dimension evidence, geometric audits and source overlays. Also use to investigate reconstruction artifacts; excludes ordinary furniture editing.
---

# Architectural plans to Mybob

Deliver a faithful, traceable reconstruction within the current schema. An importable JSON is only the first technical gate. Do not promote guessed geometry to a completed conversion because it passes validation.

Read `AGENTS.md`, the local passation journal `docs/HANDOFF.md` (git-ignored, present on the owner's clone), `docs/PROJECT-FORMAT.md`, `src/model/types.ts` and `src/model/validate.ts`. Follow the maintenance skill for repository changes. Keep original plans, rendered pages, evidence ledgers, overlays and personal generated bundles in ignored directories (`reference-documents/`, `artifacts/plan-review/`). A personal project JSON that must live under `public/projects/` uses the `private-*.json` convention (git-ignored); `scripts/check-public-build.mjs` remains the authority on what may ship. Never add personal data to the public asset allowlist.

## Establish evidence before generating

Inventory actual source files, SHA-256 hashes, page counts, drawing titles, project identifiers, dates and revisions. Separate different houses and superseded drawings. Verify files exist locally: old summaries, existing JSON and model notes cannot replace the source. If an essential source is unavailable, continue independent audit work and request that source; do not call a regenerated old JSON source-verified.

Render floor plans, sections, elevations and site plans. Inspect readable crops including symbols and dimension endpoints. Extraction/OCR is only an aid. Follow [references/reconstruction.md](references/reconstruction.md) for the measurement ledger, coordinate construction and source overlay workflow. Complete the envelope and partition ledger before final geometry; revisit it when checks expose contradictions.

For paging through a multi-page PDF (individual renders plus labelled contact
sheets) and for candidate wall axes extracted from the vector strokes, use
`scripts/render_pages.py` and `scripts/extract_walls.py` from the repository root
(`uvx --from pymupdf python scripts/render_pages.py plan.pdf out-dir/`).
`references/pdf-extraction.md` records the verified pitfalls of these helpers:
rotated-page coordinate frames, scale deduced from a printed overall dimension,
and label/surface cross-checks. Use the printed surface schedule as a cross-check
(the sum of the rooms must reach the printed total); never derive linear
dimensions from advertised areas.

To confront a model with the source without going through the model's own
geometry, measure the rendered plan directly: `scripts/measure_plan.py` scans
lines across the image and reports wall bands in metres, merging the two faces
of a hatched partition and discarding thin dimension lines. Measure at several
places before concluding on a thickness: a window interrupts the wall and shows
its frame where the face should be, which reads as a thinner wall. This is how a
0.34 m wall was once mistaken for a 0.21 m one.

## Three layers, one gate

Keep extraction, decision and construction separate so a wrong guess cannot hide
behind a valid JSON.

1. **Extraction** — `scripts/extract_plan_evidence.py` turns a PDF into a
   deterministic registry: pages, classified labels (dimensions, openings, sills,
   room areas, levels, slopes), surface tables, and dimension chains with their
   closure residual and the scale deduced from the label centres alone. A chain
   counts as closed only when its contiguous segments sum to the printed total;
   wall thicknesses and isolated dimensions are reported separately instead of
   being folded into the sum.
2. **Decision** — one record per wall face and per opening, each carrying an
   evidence class (`printed`, `derived`, `scaled`, `assumed`) and an `unresolved`
   flag. `scripts/derive_plan_decisions.py` writes a conservative skeleton: it
   claims `printed` only when a contiguous run of printed segments reproduces the
   length, or the opening width and height, within a centimetre, uniquely, and
   from a closed chain.
3. **Construction and verification** — generator, `validateProject`,
   `scripts/audit-plan.ts`, overlay, browser.

`scripts/check-plan-decisions.ts` is the gate between layers 2 and 3. It rejects
a face resting on an unclosed chain, a printed claim without a chain reference, a
missing decision for a wall or an opening, and an opening offset that contradicts
its chain once the wall origin is declared. It exits non-zero while any decision
stays unresolved: construction does not start on a guess.

```sh
uvx --from pymupdf python scripts/extract_plan_evidence.py plan.pdf artifacts/plan-review/registry.json --pages 13,14
uvx --from pymupdf python scripts/derive_plan_decisions.py project.json artifacts/plan-review/registry.json rdc artifacts/plan-review/decisions.json
node --import tsx scripts/check-plan-decisions.ts artifacts/plan-review/decisions.json project.json artifacts/plan-review/registry.json
```

The registry and the decisions file carry real plan data: keep them in the
ignored directories, never in the repository.

Classify dimensions as printed, derived, scaled or assumed. Keep each value's page, endpoints, equation and uncertainty. Derived values refer to independently transcribed dimensions, not output JSON. Resolve contradictory chains using revisions and measurement conventions; do not silently average them. Never derive linear dimensions from advertised areas.

## Build from shared constraints

Reconstruct finished wall faces and joins from one coordinate schedule, then derive wall axes and room polygons. Metres internally; x right, z down, y up. Thickness is centred on the axis. Opening offsets follow the directed wall from start: explicitly convert dimension-chain world coordinates. Check sill, lintel, floor datum and swing separately.

Preserve IDs, datums and reference frame when correcting an existing project. Save a backup and ID/change inventory before replacement. Do not import a regeneration over the owner's browser arrangement or invent furnishings from repository data.

Distinguish floor footprint, usable headroom and declared habitable area. The schema has horizontal ceilings, straight stair flights (`stairs`) and floor openings (`floorVoids`), but no roof windows or sloping interior ceilings. Roof meshes represent exterior envelopes, not those missing features. Record each unsupported feature's source location and effect on fidelity. Do not replace a trémie with a wall, a roof window with a façade window, or a sloping storey with a claimed faithful full-height box. A winder, a landing or a curved flight is approximated by straight flights: declare the approximation instead of presenting it as the drawn geometry. A provisional upper level can be supplied separately with explicit limitations. Extending the schema is a separate implementation decision, not an undocumented JSON field.

## Schema traps that cost iterations

`validateProject` rejects these before any geometry check runs; complete them at
input time instead of discovering them one by one:

- every room needs `label` and `viewpoint` inside its polygon (the visitor needs
  about 0.17 m of clearance);
- every level needs a `lights` array and a positive `ceilingHeight`, even under a
  sloping roof (document the value retained);
- identifiers are unique across the whole project: prefix per level (`wc`,
  `wc-etage`);
- polygons must be simple (no crossing, no repeated edge);
- openings must fit under the wall or ceiling height, doors/sliding/garage start
  at floor level, and every opening is at least 10 cm wide and high;
- room polygons, labels and viewpoints must stay inside the level outline;
- room polygons stop at the **finished faces** of walls, never on their axes. A
  polygon that reaches the axis overlaps the wall by half its thickness: the
  audit reports `room-solid-wall` and the room area silently grows. Compute each
  face as `axis ± thickness / 2` and use it on both sides of every partition.
  This single mistake accounted for most of the defects found in three separate
  reconstructions; check it before reading any area residual;
- `planArea` is optional and positive; it is the printed value, never a target to
  reach by moving walls.

## Verify and iterate

Run these checks on the actual deliverable:

1. Run `validateProject`, then the deterministic audit below. It reports room/room overlaps, room/solid-wall intersections, duplicate collinear walls, wall ends that stop just short of another wall, rooms no floor-level passage reaches, a spawn outside every room, visitor clearance and declared-area residuals. Resolve accidental overlaps, doubled partitions, almost-joined wall ends and blocked passages. Investigate area residuals; retain `planArea` separately and explain differences with evidence. Area agreement alone is insufficient.
2. Compare a generated plan with the source using an independently calibrated overlay. Inspect perimeter steps, partition junctions, jambs and asymmetric anchors that detect mirroring. Record residuals and source pixel uncertainty. Never calibrate to the output geometry.
3. Import in a real browser. Inspect every level in Plan and overview, exterior if supplied, and walk through available doors. Check corners, duplicate/overhanging walls, floating/blocked openings, floor datums, spawn clearance and ceiling/roof relationships. Record screenshots and actual views inspected. NullEngine and DOM tests do not replace visual review. Confirm that new geometry reads in the **Plan** projection, not only in 3D: an orthographic top view lights every horizontal face identically, so a flight of steps sharing the floor material becomes invisible, as does any object whose top face matches the surface below it. Give such geometry a distinct material and verify it on a screenshot rather than by reasoning about the scene.
4. Correct the ledger/model and repeat affected checks. Run applicable CI/privacy checks; release only via the repository PR workflow.

From the repository root with Node 24 and locked dependencies installed:

```sh
node --import tsx scripts/audit-plan.ts artifacts/plan-review/house.json > artifacts/plan-review/house-audit.json
```

For source comparison use `python scripts/overlay-plan.py project.json calibration.json overlay.png`; the calibration JSON supplies `image`, `level`, three non-collinear `anchors` and independent `checks`, each with `world: [x,z]` and `pixel: [u,v]`. The helper requires Pillow and writes a calibration residual report alongside the overlay. Source rendering and anchor interpretation remain explicit inputs.

The audit reports polygon intersections, room areas, world opening endpoints, wall clearance, duplicate walls, endpoint gaps and a grid flood fill from the spawn through floor-level traversable openings (`reachedRooms`). It subtracts floor-level traversable openings from wall footprints; windows stay solid. It does not establish source fidelity, door-leaf swing clearance, thresholds, furniture or complete wall-join correctness. Never auto-adjust geometry just to make its report green.

A `reachedRooms` count is only meaningful once the walls are closed. A gap left between two rooms lets the flood fill through and reports full connectivity while no door serves the area; close the wall first, then read the count. A residual you cannot derive from the printed dimensions is a finding, not a rounding error: state the range the ambiguity produces and mark it unresolved instead of moving a wall until the number matches.

## Deliver an honest completion state

Supply local importable JSON, evidence ledger, before/after changes, audit report and source-comparison/browser results. State measured maximum residuals and unresolved features instead of an invented accuracy percentage. Mark the result provisional while material dimensions, source comparison or visual checks remain unresolved. Name missing evidence precisely. Do not claim perfection, survey accuracy or deployment without corresponding evidence.
