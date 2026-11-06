---
name: mybob-plan-conversion
description: Reconstruct or regenerate Mybob house JSON from architectural PDFs using dimension evidence, geometric audits and source overlays. Also use to investigate reconstruction artifacts; excludes ordinary furniture editing.
---

# Architectural plans to Mybob

Deliver a faithful, traceable reconstruction within the current schema. An importable JSON is only the first technical gate. Do not promote guessed geometry to a completed conversion because it passes validation.

Read `AGENTS.md`, `docs/HANDOFF.md`, `docs/PROJECT-FORMAT.md`, `src/model/types.ts` and `src/model/validate.ts`. Follow the maintenance skill for repository changes. Keep original plans, rendered pages, evidence ledgers, overlays and personal generated bundles in ignored directories (`reference-documents/`, `artifacts/plan-review/`). Never add them to the public asset allowlist.

## Establish evidence before generating

Inventory actual source files, SHA-256 hashes, page counts, drawing titles, project identifiers, dates and revisions. Separate different houses and superseded drawings. Verify files exist locally: old summaries, existing JSON and model notes cannot replace the source. If an essential source is unavailable, continue independent audit work and request that source; do not call a regenerated old JSON source-verified.

Render floor plans, sections, elevations and site plans. Inspect readable crops including symbols and dimension endpoints. Extraction/OCR is only an aid. Follow [references/reconstruction.md](references/reconstruction.md) for the measurement ledger, coordinate construction and source overlay workflow. Complete the envelope and partition ledger before final geometry; revisit it when checks expose contradictions.

Classify dimensions as printed, derived, scaled or assumed. Keep each value's page, endpoints, equation and uncertainty. Derived values refer to independently transcribed dimensions, not output JSON. Resolve contradictory chains using revisions and measurement conventions; do not silently average them. Never derive linear dimensions from advertised areas.

## Build from shared constraints

Reconstruct finished wall faces and joins from one coordinate schedule, then derive wall axes and room polygons. Metres internally; x right, z down, y up. Thickness is centred on the axis. Opening offsets follow the directed wall from start: explicitly convert dimension-chain world coordinates. Check sill, lintel, floor datum and swing separately.

Preserve IDs, datums and reference frame when correcting an existing project. Save a backup and ID/change inventory before replacement. Do not import a regeneration over the owner's browser arrangement or invent furnishings from repository data.

Distinguish floor footprint, usable headroom and declared habitable area. The schema has horizontal ceilings and no native stairs, floor voids, roof windows or sloping interior ceilings. Roof meshes represent exterior envelopes, not those missing features. Record each unsupported feature's source location and effect on fidelity. Do not replace a trémie with a wall, a roof window with a façade window, or a sloping storey with a claimed faithful full-height box. A provisional upper level can be supplied separately with explicit limitations. Extending the schema is a separate implementation decision, not an undocumented JSON field.

## Verify and iterate

Run these checks on the actual deliverable:

1. Run `validateProject`, then the deterministic audit below. Resolve accidental room overlaps, room/solid-wall intersections, disconnected joins and blocked passages. Investigate area residuals; retain `planArea` separately and explain differences with evidence. Area agreement alone is insufficient.
2. Compare a generated plan with the source using an independently calibrated overlay. Inspect perimeter steps, partition junctions, jambs and asymmetric anchors that detect mirroring. Record residuals and source pixel uncertainty. Never calibrate to the output geometry.
3. Import in a real browser. Inspect every level in Plan and overview, exterior if supplied, and walk through available doors. Check corners, duplicate/overhanging walls, floating/blocked openings, floor datums, spawn clearance and ceiling/roof relationships. Record screenshots and actual views inspected. NullEngine and DOM tests do not replace visual review.
4. Correct the ledger/model and repeat affected checks. Run applicable CI/privacy checks; release only via the repository PR workflow.

From the repository root with Node 24 and locked dependencies installed:

```sh
node --import tsx scripts/audit-plan.ts artifacts/plan-review/house.json > artifacts/plan-review/house-audit.json
```

For source comparison use `python scripts/overlay-plan.py project.json calibration.json overlay.png`; the calibration JSON supplies `image`, `level`, three non-collinear `anchors` and independent `checks`, each with `world: [x,z]` and `pixel: [u,v]`. The helper requires Pillow and writes a calibration residual report alongside the overlay. Source rendering and anchor interpretation remain explicit inputs.

The audit reports polygon intersections, room areas, world opening endpoints and wall clearance. It subtracts floor-level traversable openings from wall footprints. It does not establish source fidelity, connectivity, door swing clearance or complete wall-join correctness. Never auto-adjust geometry just to make its report green.

## Deliver an honest completion state

Supply local importable JSON, evidence ledger, before/after changes, audit report and source-comparison/browser results. State measured maximum residuals and unresolved features instead of an invented accuracy percentage. Mark the result provisional while material dimensions, source comparison or visual checks remain unresolved. Name missing evidence precisely. Do not claim perfection, survey accuracy or deployment without corresponding evidence.
