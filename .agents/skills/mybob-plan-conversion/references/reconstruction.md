# Reconstruction and evidence

## Private measurement ledger

Keep one machine-readable ledger per house with its private outputs (`reference-documents/`, `artifacts/plan-review/`, or `public/projects/private-*.json` for a project file). Record source filename, SHA-256, one-based PDF page, revision and explicit datum/axis convention. Personal titles and paths do not belong in generic skill examples/tests.

Each observation needs an ID, element IDs, face/axis endpoints, raw text, metres, evidence class (printed, derived, scaled, assumed), page/crop and uncertainty. Derived observations include equations and input observation IDs. Scaled observations include pixel endpoints, calibration anchors, independent X/Z scales and maximum calibration residual. Round to measurement precision; half-thickness axes can legitimately require half-centimetres.

For a wall starting at z=0.17 with a printed jamb chain establishing z=3.29, offset is 3.29−0.17=3.12 m. For reversed walls use the signed unit tangent. A façade distance is not automatically an offset. Standard door width establishes neither position nor height/swing. Check dimension strings such as 120/215 against elevations before selecting the opening type.

## Reconstruct topology

1. Build exterior finished faces from overall dimensions and independent chains. Include concave steps; record chain closure residuals in metres.
2. Place internal finished faces from clear room dimensions and intervening thicknesses. Derive shared faces once. Reconcile independent chains on both axes. An unannotated return remains scaled/uncertain even when its area matches the schedule.
3. Derive axes from paired faces. Include thickness overlap at corner/T joins without obstructing openings. Avoid duplicate collinear segments and extensions into adjoining rooms. Exterior wall boxes stay within the intended footprint except documented details.
4. Derive room contours from free finished faces, retaining recesses, piers and alcoves. Record consistent ownership of thresholds and open boundaries. Do not leave unexplained strips between hall and living room, count walls as room floor, or reshape rooms to match area totals.
5. Locate openings by jamb chains; derive world endpoints independently of offset. Check perpendicular walls do not block passage. Record unverified height/sill/swing individually.
6. Derive vertical datums from sections, not typical construction values. Check garage level, headroom and upper-floor elevation. Dotted stair/trémie symbols are not partitions. Read roof planes, ridge/eaves and gables from multiple views; footprint alone is insufficient.

## Overlay comparison

Generate a private SVG/PNG projection with wall solids, jambs, room contours and IDs. Match source orientation and aspect ratio. Calibrate against printed dimensions on both axes with at least three non-collinear anchors and independent check anchors. Scans can have unequal X/Z scales or skew: document corrections and residuals. Never warp individual rooms to fit the output.

Render pages and contact sheets with `scripts/render_pages.py`; see `references/pdf-extraction.md` for rotated-page coordinate frames and scale deduction. Blend the projection over a readable crop and inspect the whole plan plus enlarged disputed joins. Record residuals for corners, partition junctions and jambs. Translate pixel uncertainty into metres before judging discrepancies. Prioritize printed cotes over apparently exact tracing. Keep contradictions visible in the ledger/report.

## Passages and moving joinery

A floor-polygon audit ignores door leaves. Build the actual house in Babylon NullEngine and check the collision meshes with the visitor radius, including frames and moving panels. A grid flood-fill can diagnose disconnected rooms; use level-relative elevations and world bounds correctly, validate the spawn before seeding it, and record grid spacing and approximation limits. Keep this separate from real-browser traversal.

Read `poseDoor` in `src/scene/buildHouse.ts`: omitted hinge/swing fields still produce a definite default pose. Verify the interpreted symbol against the resulting leaf position, and keep spawns/viewpoints clear of the leaf as well as wall solids. Check wardrobes have an intended access opening and that a perpendicular return does not obstruct a jamb. A window or dotted stair outline must not become a passage or partition by accident.

For adjacent doors on a tight landing, test the relevant open/closed combinations. A single all-open flood-fill can report a false disconnection when one open leaf temporarily obstructs another doorway. Preserve source-supported swings and document any required door operation; do not reverse the source swing just to make the all-open configuration pass. Investigate initial defaults that leave a visitor trapped. Record which rooms are reachable in each tested state, rather than claiming all doors were walked through.

## Delivery evidence

Distinguish schema-valid, geometry-audited, source-compared and browser-inspected. List actual files/checks/residuals, not merely validated. Include old/new dimensions and stable-ID changes with evidence references. Separate schema limitations, missing evidence and defects. Preserve prior JSON and never touch user localStorage as a side effect of generating a file.
