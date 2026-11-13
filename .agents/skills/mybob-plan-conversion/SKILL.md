---
name: mybob-plan-conversion
description: Reconstruct or regenerate Mybob house JSON from architectural PDFs. Splits what a script may do (measure, compute, verify) from what the AI must decide (which wall, which thickness, which dimension), gates the result on the surfaces printed in the plan, and records the traps that already cost a session.
---

# From the PDF to the Mybob plan

Deliver a faithful, traceable reconstruction in the current schema. An importable JSON is only
the first technical gate: do not promote a guessed geometry to a finished conversion because it
passes validation.

Read `AGENTS.md`, `docs/PROJECT-FORMAT.md`, `src/model/types.ts` and `src/model/validate.ts`.
Follow the maintenance skill for any change to the repository. Keep the original plans,
rendered pages, evidence registries, overlays and personal bundles in the ignored directories
(`reference-documents/`, `artifacts/plan-review/`). A personal project that must live under
`public/projects/` follows the `private-*.json` convention (ignored by git);
`scripts/check-public-build.mjs` stays the authority on what may be published. Never add
personal data to the public asset allowlist.

The reference cases of this document are called **plan A** (ground floor, page 8, 1/75) and
**plan B** (ground floor page 13, attic page 14, 1/50) — pages counted from 1, like the
`--pages` options of the repository scripts. No person, builder or file name is written here —
the repository is public; the town, however, is allowed by the owner (see house naming below).
The plans themselves live in `reference-documents/`, ignored by git.

Plans are French architect drawings: their printed vocabulary (RDC = ground floor, combles =
attic, cloison = partition, allège = sill, trémie = floor opening, SH = living area, cartouche
= title block) is quoted as printed.

## The rule: a script measures, the AI decides

**A script measures or computes. It does not decide.**

Every decision — which wall exists, what thickness it has, which printed dimension goes on
which face, where a partition stops — is made by the AI, then verified by a script. A script
that guesses produces a plausible, wrong result, and nobody sees it: that is exactly what the
hatched bands cost.

Corollary, and it is the owner's condition: **a script that is not 100 % exact does not enter
the chain**. It stays a proposal to validate, or it disappears. Better a precise AI with few
tools than an approximate tool you trust.

## The inventory

The scripts listed here live in `scripts/` at the repository root, not in the skill folder:
they are shared with CI (`--self-test` mode), npm scripts and other skills, and tracked by
Prettier. Never move or duplicate them into `.agents/`.

| script                     | what it does                                               | exactness                                                            |
| -------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `extract_plan_evidence.py` | reads dimensions, chains, area labels                      | **100 %** — reading, no interpretation                               |
| `check_plan_surfaces.py`   | compares printed areas and project polygons                | **100 %** — computation, it is the exit gate                         |
| `check_site.py`            | checks plot, siting, levels and roof against the site plan | **100 %** — computation, refuses gaps and flags the undimensioned    |
| `plan_faces.py`            | computes rooms from the level's walls                      | **100 %** — computation, no detection                                |
| `compare_plan.py`          | measures the ink under each model wall                     | **100 %** — measurement, corrects nothing                            |
| `audit-plan.ts`            | internal consistency of the project                        | **100 %** — computation                                              |
| `check-plan-decisions.ts`  | arithmetic of the decisions and replay of the envelope     | **100 %** — computation                                              |
| `extract_plan.py`          | partitions, from the drawing's colour fill                 | **100 % on partitions**, blind to hatched bands                      |
| `derive_outline.py`        | level outline, from closed chains and ink                  | **exact on plan A**, refuses plan B (undimensioned depth)            |
| `extract_doors.py`         | interior doors, from the drawing's swing arcs              | **exact on the arc**, silent on doors without an arc (see below)     |
| `generate_project.py`      | exterior walls, thicknesses and openings read on the plan  | **exact but incomplete**: never invents, omits what it does not read |

The last four are the only ones producing geometry. They are usable because they invent
nothing: `extract_plan.py` only returns filled rectangles, `derive_outline.py` only keeps an
outline if every edge is reproduced by a printed sequence or filled by a dimensioned thickness,
`extract_doors.py` only returns a door if a quarter circle and its leaf can be measured,
`generate_project.py` only places an opening on a closed chain. What they cannot read is
missing, and it is up to the AI to see it.

**Interior doors** are not dimensioned, so no chain carries them — but their **symbol** is
standardised, and that is what gets measured. See "Interior doors, read on the arc" below: the
script returns the hinge, the width and the swing direction, and it reports the doors it cannot
read instead of guessing them.

## Two loops, and not confusing them

CI tests run on **synthetic** plans: no personal data in the repository. They check the
mechanics — a chain closes, an area pairs, a room is computed. They say **nothing** about
fidelity to the plan.

The real PDFs are the only source of truth, and they stay local (`reference-documents/`,
`artifacts/plan-review/`, ignored by git).

| loop       | material        | what it proves                     | where |
| ---------- | --------------- | ---------------------------------- | ----- |
| regression | synthetic plans | the code still does what it did    | CI    |
| design     | the real PDFs   | the approach works on a real house | local |

**A green CI does not validate a plan.** Twice in the same session, a script passed its
self-test and broke the real plan:

- `merge_openings` carried openings over by their offset: on the real plan, two walls six
  centimetres apart got confused and the garage opening landed in bedroom 1;
- `merge_partitions` took the thickness from the fill: on the real plan, the garage/WC
  partition went from 15 to 10.2 cm and the WC gained 0.09 m².

Both were caught by the area gate on plan A, not by CI. A synthetic self-test is a regression
net, not a validation.

### The design loop, as commands

```sh
# 1. Read the document.
uvx --from pymupdf python scripts/extract_plan_evidence.py plan.pdf registry.json --pages 8
uvx --from pymupdf python scripts/extract_plan.py plan.pdf plan.json \
    --scale 37.795 --envelope x0,y0,x1,y1

# 1 bis. Derive the level outline, instead of writing it by hand.
python scripts/derive_outline.py registry.json outline.json --pages 8 \
    --pdf plan.pdf --plan plan.json

# 1 ter. Read the interior doors on their arcs, and compare with the project.
python scripts/extract_doors.py plan.pdf 8 doors.json --registry registry.json \
    --pages 8 --compare out.json --level rdc

# 2. Build: exterior walls, partitions, openings, thicknesses read on the plan.
python scripts/generate_project.py plan.json registry.json modele.json rdc out.json \
    --pages 8 --outline outline.json

# 2 bis. Or only the openings, when the model's walls are already right.
python scripts/generate_project.py plan.json registry.json modele.json rdc out.json \
    --pages 8 --openings-only --outline outline.json

# 3. Judge the result, not the drawing.
python scripts/check_plan_surfaces.py registry.json out.json --level rdc --page 8
python scripts/plan_faces.py out.json --level rdc --compare
node --import tsx scripts/audit-plan.ts out.json

# 4. Recompute the closed rooms from the walls, and rewrite the project.
python scripts/plan_faces.py out.json --level rdc --apply --write out.json
```

The third step is the one that counts. As long as a room is out of tolerance, the plan is not
finished — unless the gap is documented as an inconsistency of the plan itself, which is a
result, not a failure.

**The audit has a gate the areas do not**: `room-unreachable`. A room can be exact to the
square centimetre and have no door. On plan B, nine rooms out of nine were exact and six were
unreachable by the walk, because the ground floor did not have a single opening. Areas do not
see it: they only compare the rooms they are given. All three gates are needed, and
`reachedRooms` is read on every pass.

**Two more audit kinds are blocking** (`audit-plan.ts` prints them and exits with code 1):
`wall-room-gap` (the inner face of a wall further than 3 cm from the edge of the room it
bounds, a partition being fine when it is flush with one of its two rooms),
`opening-under-roof-uncarried` (an opening in a knee wall or dormer back wall that lies under
the roof covering and that no `site.roofs[].windows` entry nor `dormers` entry carries). The
fix is to recalibrate the walls on the printed dimensions, never to resize the room, and to
declare the dormers and roof windows. A back wall that exceeds the covering without a dormer
is already refused by the import (`validateProject`).

The fourth removes the partition returns that stuck out into a room: on plan A, the audit goes
from eight warnings to one.

A level under a roof slope does not follow this loop as is: the floor stops at the rafter and
the page prints three area tables. See "A level under a roof slope", below.

When a real plan reveals a pattern the fixtures do not cover, add the pattern to the fixture
**and** the line to this file. A fixture that does not come from a real case is a fixture that
reassures wrongly.

## What the state of the art says

Two families of methods, and the choice depends on a single question: is the PDF vector?

- **Vector** — geometric and rule-based methods dominate and reach good accuracy. That is our
  case. Recent literature describes the chain in four modules: axis grid and dimension
  detection, text recognition and **scale recovery**, line topology reconstruction, geometric
  rectification. That is exactly ours.
- **Scan** — deep learning is needed (semantic segmentation, object detection, OCR). Geometric
  methods fail there on noise and broken lines.

Do not bring out deep learning for a vector plan: it adds nothing and costs reproducibility.

Two results established elsewhere that confirm the split:

- **Vision models read plans badly.** A recent model correctly extracts room names and areas,
  but hallucinates or misses wall details, and a misread wall produces an absurd conclusion. A
  sheet image sent to a model is moreover reduced to about 1568 px on the long side: the
  dimension text of a dense A3 disappears. Reading stays with the script.
- **The textbook method "thick lines = walls, thin lines = doors" does not apply to a PDF.** It
  assumes layers or a clean drawing. A PDF has no layers, and dimension lines are also pairs of
  parallel lines: that is precisely why line pairing returned 44 walls instead of 25. The
  textbook does not say how to tell a dimension from a wall; the drawing does — through the
  partitions' colour fill and through closed chains.

Useful sources: `solidtakeoff.com/guides/how-to-find-the-scale-of-a-pdf-drawing` (hierarchy of
scale sources), `mdpi.com/2075-5309/16/5/1043` (four-module chain, vector versus scan),
`axcelerate.ai/blogs/ai-powered-floor-plan-analysis` (measured limits of vision models on
plans).

## Establishing the evidence before generating

Inventory the real source files, their SHA-256 fingerprints, page counts, drawing titles,
project identifiers, dates and revisions. Separate different houses and outdated drawings.
Check the files exist locally: an old summary, an existing JSON or model notes do not replace
the source. If an essential source is missing, continue the independent audit work and ask for
that source; never declare a regenerated old JSON verified.

Name each house by its town, never by a person's name nor by a file acronym:
`plans-emieville.pdf`, `plan-sannerville.pdf`, and the projects `maison-emieville`,
`maison-sannerville`. The town is read in the PDF title block, not in the received file name.
`pnpm run backup:private` names the copies after `project.id`: renaming a project renames its
backup.

A house often has several PDFs, and the obvious name is not the right one. A
`plans-emieville-scan.pdf` turned out to be a 15-page scan of an earlier edition while the
vector original slept next to it as `plans-emieville.pdf`; a whole session concluded the house
had no vector plan. Before accepting a source, list every candidate file for that house and
compare them on `page.get_drawings()` and `page.get_text("words")`. Prefer vector, and say which
file and which page were used. When the owner mentions a document that cannot be found, ask
where it is rather than substituting the closest name.

Check whether the source is a vector drawing or a scan before promising a chain.
`page.get_text()` and `page.get_drawings()` answer in one call: a vector PDF returns dimensions
and lines, a scan returns neither. The extraction and decision layers need text; the
verification layer (`measure_plan.py`, `compare_plan.py`, the overlay) reads pixels and works on
both. On a scan, the evidence registry is built by hand from the rendered image, and the scale
is printed in the title block for want of a chain to deduce it — a scan at 1/75 is 105 px/m at
200 dpi, not the 157 px/m of a drawing at 1/50.

Render the level plans, sections, elevations and site plan. Inspect readable crops, symbols and
dimension ends included. Extraction and OCR are only an aid. Follow
[references/reconstruction.md](references/reconstruction.md) for the measurement ledger, the
construction of coordinates and the overlay on the source. Finish the envelope and partition
registry before the final geometry; come back to it when the checks reveal contradictions.

To browse a multi-page PDF (individual renders and annotated contact sheets) and for candidate
wall axes taken from vector lines, use `scripts/render_pages.py` and `scripts/extract_walls.py`
from the repository root (`uvx --from pymupdf python scripts/render_pages.py plan.pdf out-dir/`).
`references/pdf-extraction.md` records the verified traps of these tools: rotated page frames,
scale deduced from a printed overall dimension, and label/area cross-checking. Use the printed
area table as a cross-check (the sum of the rooms must reach the printed total); never deduce a
linear dimension from a stated area.

**A page is located by its text, not by its number from an old note.** The repository scripts
count from 1 (`--pages 8` opens `doc[7]`); only pymupdf itself counts from 0, and a note from a
past session may count in either convention. Two neighbouring pages from the same builder look
alike enough for a hurried overlay to believe it is aligned. Locate a level's page by a text
that only exists on it — the area of a given room, a drawing title — and record that text in
the registry, not an inherited number. `grid_page.py`, `overlay_page.py` and `extract_walls.py`
print the first words of the page read: check that line before reading a render. An evening
pass rendered the attic page while looking for the ground floor: the number came from a note,
the page changed index depending on the convention.

To compare a model with the source without going through the model's geometry, measure the
rendered plan directly: `scripts/measure_plan.py` sweeps lines over the image and reports wall
bands in metres, merging the two faces of a hatched partition and discarding thin dimension
lines. Measure in several places before concluding on a thickness: a window interrupts the wall
and shows its frame where the face should be, which reads as a thinner wall. That is how a
0.34 m wall was taken for a 0.21 m wall.

Render large enough for the thinnest partition. A 7 cm wall needs about ten pixels between its
two faces, so the required resolution depends on the printed scale: 200 dpi is enough at 1/50,
but a drawing at 1/75 needs 300 dpi. Below that, the faces merge into one line and the wall
reads as absent — five walls of a 1/75 plan were declared missing at 120 dpi and all reappeared
at 300 dpi. `compare_plan.py` warns when the thinnest declared wall falls under eight pixels.

### Scale

Three sources, and they are not equal. The order of preference is that of professional
practice, not a personal preference:

1. **A printed dimension** — an isolated dimension or a closed chain. It stays right even if
   the PDF was resized on export. It is the only source used to measure.
2. **A graphic scale** — a graduated bar drawn on the sheet. It shrinks with the drawing, so it
   stays right after a resize. Good cross-check, never a measurement source.
3. **The title-block ratio** (`1/75`, `1:50`) — a claim about the original printed sheet, not
   about the received file. A PDF exported at 117 % keeps its `1/75` and no longer measures
   anything. Read it as a hint, never use it as the scale.

A vector plan exported at 1:1 gives exactly **37.795 pt/m at 1/75** and **56.693 pt/m at
1/50**. Measured on the builder's two houses: 37.79 on plan A, 56.66 to 56.71 on plan B. If the
value deduced from the chains departs from these numbers, it is the file that was resized, not
the method that is wrong: keep the deduced value and note it.

Take the **median** of the per-chain scales, never the mean: a mispaired chain gives an outlier
(53.11 pt/m found on a 1/50 page) and the mean would outweigh the six correct chains.

`check_plan_surfaces.py` prints the recognised scale and its deviation from the nearest
standard (`1/75 expected 37.795 (-0.0 %)`). Beyond 1 %, it warns: the file was resized on
export. It is a diagnosis, not a correction — the measurement stays that of the dimensions.

On a scan there is no chain: the scale is read in the title block, and the ratio becomes the
only source again, with the uncertainty that goes with it.

### Origin, when no chain covers the axis

Scale comes from the chains; so does the **origin**, and that is where it breaks. A partial
chain does not start at the edge of the level: taking its start as the origin shifts the whole
level. Page 14 of plan B only has a vertical chain of 2.78 + 1.27 = 4.05 m for an 8.50 m
footprint; the origin fell 3.5 m too low, every area label projected to negative z, and the
seven attic rooms came out `room without a label`. You then believe room
names do not match, when it is the frame of reference.

The rule: if an axis's longest chain does not cover the level footprint, the **overall
dimension** gives the origin. Beware of what is called "the footprint": it is that of the
**building**, not that of the level's floor. A recessed level — an attic between rafters, whose
floor starts 1.27 m from the façade — has a smaller footprint than the overall dimension.
Computing the origin with the level footprint shifts everything by half the gap: on plan B,
4.45 m, and the seven attic rooms come out `room without a label` again.

So: look for the dimension whose value equals the level footprint; failing that, the axis's
largest dimension, and take **its** value for the origin (`at - value * scale / 2`), never the
level's.

The symptom to recognise: area labels falling outside the level, a computed total far below
the printed total, or a frame whose origin changes between two levels of the same page. Check
the frame before suspecting the geometry.

## Fixed equipment read on the drawing

Before delivering a conversion, inspect every room on every level for sanitary, kitchen and
technical symbols. A connection label such as `(V)`, `(E)` or `(LL)` alone is not an object:
only import a piece when the drawing carries its footprint. Do not confuse the maintenance
clearance of a heat pump with its casing, or a crossed shower tray with a cupboard.

Keep a reviewed inventory in the ignored evidence directory: source PDF fingerprint, page
and room, symbol identity, measured footprint, centre, orientation and uncertainty. A script
may measure vector paths or calibrated pixels and compute coordinates; the AI decides which
paths belong to which equipment. Use the same printed-dimension frame as the walls. Check
independent anchors before accepting the frame, especially on an attic page. Compare each
placed footprint back to its symbol; every WC, shower, bathtub and basin must be present in
its room within 5 cm of the drawn position. Count both basins of a double vanity.

Use the existing `toilet`, `shower`, `bathtub`, `vanity` and `kitchen` kinds; use named `custom`
boxes for technical units. Do not invent a new furniture kind for conversion. Heights and
elevations not given by the source remain explicit provisional assumptions. A shower's tray,
panels and orientation must follow the symbol; do not infer a full glass enclosure from a
crossed tray. Keep technical maintenance zones out of the furniture footprint.

Write the inventory as a variant named **Équipements du plan**, with stable item identifiers
and `locked: true`. Furniture belongs in `furnishing`, never in the house's `levels`. Preserve
all existing variants and furnishings (including a separately documented purchased kitchen);
do not silently replace them with a schematic kitchen. For a new export, select the equipment
variant and mirror it in `furnishing.levels`. When enriching an existing export, keep its active
variant and matching mirror; the equipment variant remains selectable. Avoid duplicate variant
or item identifiers on a repeated pass. The export contract is in
[PROJECT-FORMAT.md](../../../docs/PROJECT-FORMAT.md#adding-and-saving).

Add a French `source.notes` entry stating that footprints are read on the drawing, not printed
dimensions, and identifying provisional heights or unresolved symbols. Furniture has no note
field: do not add one that import would discard. Retain the per-item evidence locally.

Validate the whole project with `validateProject`, every furniture list with
`validateFurnitureList`, and the variant book with `validateVariantBook` using that project's
level identifiers. Run `tests/variants.test.ts` as a regression check; it does not read private
exports, so it cannot replace those direct validations. Re-run the area gate and internal
audit, compare with their baseline, and require unchanged house geometry. Back up the original
export and keep the inventory and replay script in `reference-documents/historique/`; then
synchronise the reference and private working copies as described below. Browser verification
follows [AGENTS.md](../../../AGENTS.md#local-browser-verification-policy).

## The three layers

Keep extraction, decision and construction separate so that an error cannot hide behind a
valid JSON.

### 0. Geometry

`scripts/extract_plan.py` reads the walls on the drawing itself. With this builder, walls are
drawn in two ways, and the difference matters:

- **partitions** are **filled rectangles** in a fill colour specific to the CAD tool. That
  colour is a semantic marker, not a geometric property: it gives the thickness and both ends
  exactly, with no ambiguity with dimension lines. Do not hardcode it — take the most frequent
  non-white, non-black fill of the page, so that another builder's colour works too. The title
  block often reuses the same fill: crop on the level envelope.
- **exterior walls** are **hatched bands** between two faces, unfilled. Their position comes
  from the closed dimension chains, which give it to the millimetre.

And two false wall shapes to discard before placing one:

- **a door drawn open**: its leaf at 90° and its arc form two solid segments that a hurried
  reading takes for a partition. The entrance door of a real plan is drawn like this — its leaf
  was taken for a façade wall. A "wall" with no hatching, no fill, and in line with an existing
  opening, is a leaf first;
- **a dimension chain drawn inside a room**: dimensions are also drawn inside the plan, and a
  thin full-width band is not always a wall. Decide on the page render, not on the line alone.

Six geometric attempts failed on exterior walls and are not worth redoing: pairing parallel
lines (dimension lines are also parallel pairs, 44 walls instead of 25), clustering the
hatching (does not respect wall limits), ink density between the faces (depends on the
thickness: 0.25 for a 34 cm wall, 0.10 for 7 cm, 0.01 for a dimension line), morphology
followed by a flood fill (leaks through doors — a garage came out at 622 m²), dilation (eats
45 cm per room), and zigzag detection (hatching is made of separate strokes).

The drawing is dimensionally faithful: a 34 cm wall measures 0.339 m drawn on a 1/50 plan and
0.340 m on a 1/75 one. The drawing is therefore reliable for positions and thicknesses; it is
_segmentation_ that is hard, not accuracy.

### 0 bis. The outline, derived from closed chains

The outline was the last element written by hand. `scripts/derive_outline.py` derives it in
five layers, and **refuses** instead of guessing:

1. **Extents** — per axis, the largest total of closed chains, cross-checked by a second
   agreeing chain or by the `extract_plan.py` envelope (`--plan`). A chain whose total does not
   equal the extent is **discarded and reported**: it describes the interior, not the envelope
   (the 7.82 of an interior depth does not replace the 8.50 of a footprint).
2. **Cuts** — inner cumulative positions of the anchored chains, in both reading directions.
3. **Ink** (`--pdf`) — each cut is looked for on the rendered page: does wall presence jump on
   either side? A cut where it jumps is a shoulder of the outline; a cut where it does not
   describes the interior and is not tried.
4. **Closure** — every edge must be reproduced by a printed contiguous sequence (0.015 m) or be
   a **filled depth** given by a thickness read in centimetres at the same place. A depth with
   neither dimension nor thickness is refused.
5. **Judgement** — edges must exist in ink, and a façade notch is confirmed by a perpendicular
   sweep.

If several outlines survive, the script **lists** them instead of deciding, and
`load_outline()` then refuses to pass them on: construction does not start on a guessed
outline.

```sh
python scripts/derive_outline.py artifacts/plan-review/registry.json contour.json \
    --pages 8 --pdf reference-documents/plans-emieville.pdf --plan artifacts/plan-review/plan.json
python scripts/derive_plan_decisions.py projet.json registry.json rdc decisions.json \
    --pages 8 --outline contour.json
python scripts/generate_project.py plan.json registry.json modele.json rdc out.json \
    --pages 8 --outline contour.json
```

**Measured state.** Plan A (page 8): the outline comes out exactly
`[[0,0],[12.55,0],[12.55,12.54],[5.55,12.54],[5.55,7],[0,7]]`, and substituting it in the
chain changes no area (9 rooms out of 10 exact, the hall at −0.09 as before). Plan B (page 13):
the script **refuses** — 0 outlines kept, 112 candidates refused. Plan B's outline therefore
stays a decision, and it is written here so that the next session does not take it for a
measurement.

**Why plan B does not close.** Two measured causes, and it is neither the dash-dot line nor
the hatching:

- **The hole in the west façade is an opening, not a notch.** The chain says so itself:
  `0,69 / 2.40/2.15 / 5,41` — 2.40 wide, 2.15 high. The script tries it as a setback and looks
  for a back wall at 2.40 or 3.09 m; the probe finds **0 % ink** there
  (`x=2.40 -> [(0.21,0.35), (4.17,4.82), (7.92,8.30)]`). It refuses to invent that back wall,
  and that is the right behaviour. On plan A the notch is real: its back at x=5.55 holds 2.7 m
  of wall over 5.54 m, i.e. 49 % — above the 40 % threshold — with a 1.71 m opening in the
  middle.
- **Plan B does not dimension its depth.** The z axis has **only one anchored chain, in 3
  segments** (0.69 / 2.40 / 5.41): four boundaries, 12 sequences. The cuts come from the
  openings of the south and north façades (17 and 18 jumps), and none exists on the z axis. The
  closure layer requires every edge to be a printed contiguous sequence _on the perpendicular
  axis_: no rectangle can close. Plan A has 3 anchored chains and 178 sequences on the same
  axis, its façades dimensioned in 10 and 7 segments.

**A dash-dot line is not a wall face.** It is not what blocks plan B — its south façade is
continuous at z=0 — but it is a real trap of the ink layer: a 9 cm dashed line flush with the
façade reads as a continuous wall as soon as nearby strokes are merged. `Ink.solid()` measures
the length of the continuous stroke passing through the probe and rejects anything below
0.45 m. The pattern is in the `tests/fixtures/plan-outline/` fixture and in the self-test, not
only in this paragraph.

### 0 ter. Interior doors, read on the arc

An interior door is not dimensioned, but its **symbol is standardised**: a quarter circle of
radius equal to the leaf width, whose **centre is the hinge**, plus the **leaf drawn open**,
perpendicular to the wall. `scripts/extract_doors.py` measures these three things and nothing
else.

```sh
# The frame is deduced from the closed chains, as for the outline.
python scripts/extract_doors.py plan.pdf 8 doors.json \
    --registry artifacts/plan-review/registry.json --pages 8
# Then compare the doors read with the doors written, and read the gaps.
python scripts/extract_doors.py plan.pdf 8 doors.json \
    --registry artifacts/plan-review/registry.json --pages 8 \
    --compare public/projects/private-maison.json --level rdc
```

**What rules out hatching is not density.** Plan A carries 156 filled paths and 165 dense cells
of six segments or more: counting short segments gives nothing. Three conditions together, and
only them:

1. the path is **not filled** — an arc is a stroke, hatching is a fill;
2. the circle fit leaves a **residual ≤ 0.15 pt** — a cluster of hatching does not sit on a
   circle;
3. the **angular coverage** is 80–100° — a quarter circle, not a half turn.

The **leaf** then decides between the two ends of the arc: the one carrying a segment starting
from the hinge is the **open** position, hence the swing direction; the other is the **closed**
position, hence the opening in the wall. Without that segment, the two ends are
interchangeable and the script does not count the door.

**Measured state on both plans** (19 arcs, 21 leaf doors written):

| plan     | arcs read | doors written | paired | within ±5 cm along the wall |
| -------- | --------- | ------------- | ------ | --------------------------- |
| A, RDC   | 8         | 8             | 8      | 5                           |
| B, RDC   | 6         | 7             | 6      | 5                           |
| B, attic | 5         | 6             | 5      | 5                           |

Gaps are **listed, never silently corrected**:

- **two doors have no arc** — `hall-nord-door-1` (plan B, RDC, 1.36 m) and `p-dressing`
  (attic, 1.00 m). The drawing shows a hatched band and reveal lines there, not a quarter
  circle. The script says `NO ARC READ`; it does not invent them;
- **a two-leaf French window** has only one complete arc: the second is truncated at 37.7°.
  The script reports it as a **partial arc** and only counts the full leaf, hence 0.583 m
  instead of 1.20 m;
- **a door whose `hinge` contradicts the drawing is a blocking error** (`--compare` exits 1 and prints it). Plan A and plan B (RDC) now report 0; the attic of plan B has no frame (`--origin` needed) and was not re-measured. Historically, three doors of plan A and three of plan B had the hinge on the other side of the
  opening compared with the hand-written `hinge` field. The opening itself is in the right
  place: it is the pivot side that is wrong;
- **two project walls are offset** and carry their door with them: `entree-fond` (plan B,
  RDC) by 0.51 m and the north wall of the attic WC by 0.76 m. The position along the wall is
  right to 2 cm; it is the wall that is not where the project says. The report separates the
  two, because fixing the door would not fix the wall;
- **two doors are more than 5 cm off**: `porte-ch2` of plan A (+0.72 m, the project's
  `ch2-nord` partition is offset by 0.44 m and 0.57 m too long) and `wc-ouest-door-1` of plan
  B (−0.76 m, the opening is written on the wrong side of the hinge).

**What the script does not decide.** The swing direction is returned as a **vector**, not as a
sign: the project's `swing` field is a rotation direction in the wall's local frame, and the
two cannot be compared without the viewer's code. The room side stays an interpretation to
confirm on site, and the project must say so.

**The frame, and its refusal.** `--registry` deduces origin and scale from the closed chains,
with the `derive_outline.py` rule. Plan B's attic page has **no closed vertical chain**: the
script refuses and asks for `--origin`, rather than guessing an axis. On that page the z origin
comes from the drawn footprint (the two façades 8.50 m apart), and it is written as a
measurement, not as a deduction.

### 1. Extraction

`scripts/extract_plan_evidence.py` turns a PDF into a deterministic registry: pages, classified
labels (dimensions, openings, sills, room areas, levels, slopes), area tables, and dimension
chains with their closure residual and the scale deduced from the label centres alone. A chain
is only kept as closed if its contiguous segments sum to the printed total; wall thicknesses
and isolated dimensions are reported separately instead of being merged into the sum.

### 2. Decision

One record per wall face and per opening, each carrying an evidence class (`printed`,
`printed-partial`, `derived`, `scaled`, `assumed`) and an `unresolved` flag.
`scripts/derive_plan_decisions.py` writes a conservative skeleton. A printed dimension measures
between **finished faces**, never between axes: the script enumerates the end conventions
(axis, own half-thickness, neighbour half-thickness) and keeps the one that reproduces the
printed span. A length alone proves nothing — two walls of the same length on two different
dimension lines give the same number — so a face is only claimed if something positional
anchors it to that span. Two anchors exist, and the script tries them in this order:

- **`openings`** — the wall's own openings. Their printed positions must imply a single wall
  origin, and the wall must fit in the span.
- **`envelope`** — a closed chain whose sum equals the level outline's extent on its axis.
  Such a chain covers exactly that extent, so its origin is a boundary of the outline and its
  segments become absolute coordinates. The reading direction is unknown: keep the one that
  finds the most model boundaries, and drop the chain on a tie. The chain's line is then placed
  in the model frame — the two axes give each other their origin — which says which side of the
  outline it measures. Only a wall carrying the face on that side can be proven by it; without
  this filter, a west wall gets "proven" by the east façade's chain, which happened on a real
  plan.

Zero offsets give `printed` (or `printed-partial` on an open chain); non-zero offsets give
`derived`, because the length then depends on the declared thicknesses. An envelope wall set
back by half a thickness at both ends of the outline is `derived` from the printed overall
extent.

**Two end conventions often give the same length.** A 3.92 m wall between two 0.34 m walls is
4.09 m whether you start from its north face or its south face. Deciding by an arbitrary rank
discarded the right one and left the face unresolved; every convention is therefore returned,
and the positional anchor chooses. On plan A, this fix alone takes resolved faces from 2 to 4
and removes two `wall origin not declared` warnings.

**What the gate cannot prove, and must be said.** On plan A, after deriving the outline and
this fix, **21 faces out of 25** remain unresolved, so the gate still fails without
`--allow-unresolved`. The count breaks down as follows, and it is not a script defect:

- **11 faces** are walls **without any opening** that do not carry the outline face. No anchor
  reaches them: `openings` has nothing to pair, and `envelope` only proves walls touching the
  measured side. Their length is indeed reproduced by a printed sequence, but nothing says
  _where_ it sits.
- **6 faces** only have **interior doors** (0.73/2.04), which are dimensioned nowhere — see
  below.
- **6 faces** have a printed opening, but the sequence reproducing the length does not contain
  that opening: the façade dimension and the opening dimension are not on the same line.

The 6 unresolved openings are exactly the **interior doors**. A script will never make them
exact: they are read in ink and placed by hand. As long as they stay `scaled`/`unresolved`, the
gate cannot be passed on a real plan, and that is the intended behaviour — construction does
not start on an assumption. Unblocking is a decision to document (class them `assumed` with
their justification), not a tolerance setting.

`scripts/check-plan-decisions.ts` is the gate between layers 2 and 3. It recomputes every claim
instead of believing its prose: the referenced span must sum to the declared length, the wall's
axis length must follow from that length and the declared offsets, an opening's printed width
and height must match its segment, and every chain must come from the level's own pages. An
`envelope` claim is replayed from the declared frame: the chain must still sum to the outline
extent, and the span's world interval must fall on the wall faces or the opening's reveals. It
also rejects a face resting on an unclosed chain, a `printed` claim without a chain reference, a
`printed-partial` claim on a closed chain, a missing decision for a wall or an opening, and an
opening offset that contradicts its chain once the wall origin is declared. It fails as long as
a decision stays unresolved: construction does not start on an assumption. In **merge** mode,
walls come from the model and the decision builds nothing: `--allow-unresolved` then lets an
unresolved face through, never a contradiction. Without that flag, the gate cannot be passed on
a real plan (21 unresolved faces out of 25 on plan A, after deriving the outline) and the
documented pipeline never runs end to end.

```sh
uvx --from pymupdf python scripts/extract_plan_evidence.py plan.pdf artifacts/plan-review/registry.json --pages 13,14
python scripts/derive_outline.py artifacts/plan-review/registry.json artifacts/plan-review/outline.json --pages 13 --pdf plan.pdf
uvx --from pymupdf python scripts/derive_plan_decisions.py project.json artifacts/plan-review/registry.json rdc artifacts/plan-review/decisions.json --pages 13 --outline artifacts/plan-review/outline.json
node --import tsx scripts/check-plan-decisions.ts artifacts/plan-review/decisions.json project.json artifacts/plan-review/registry.json
```

Pass `--pages` with the pages carrying the level. Without it, the script mixes every page of
the registry, and a ground-floor wall gets "proven" by an upper-floor dimension: this single
error produced four false proofs on a real plan.

The registry and the decision file carry real plan data: keep them in the ignored directories,
never in the repository. `tests/fixtures/plan-reference/` contains the synthetic reference plan
(registry, project, decisions) that `python scripts/derive_plan_decisions.py --self-test` and
`tests/plan-reference.test.ts` check in CI; it contains no real data and must stay that way.
`tests/fixtures/plan-outline/` carries the three registries of the outline layer — corner notch
(plan A pattern), façade notch with a depth deduced from a dimension in centimetres (plan B
pattern), and an extent carried by a single chain — that `python scripts/derive_outline.py
--self-test` replays, synthetic PDF included. These fixtures come from real plans: an invented
fixture reassures wrongly.

Classify dimensions as printed, derived, scaled or assumed. Keep for each value its page, its
endpoints, its equation and its uncertainty. Derived values refer to independently transcribed
dimensions, not to the output JSON. Resolve contradictory chains through revisions and
measurement conventions; never average them silently. Never deduce a linear dimension from a
stated area.

### 3. Construction and verification

`scripts/generate_project.py` assembles the project: exterior walls from the outline (each edge
gives a wall whose outer face is the edge, the axis set back by half a thickness), openings
from the closed chains measuring each side, partitions from the geometry layer, and rooms
re-snapped onto the new wall faces. Then `validateProject`, `scripts/audit-plan.ts`, the
overlay, the browser.

Nothing is invented: the **thickness** of each exterior wall is read on the dimension in
centimetres set against it (22, 34, 15), the **sill** on the `All : 1.10 m` dimension, the
opening **height** on its `90/2.15` label. The script says how many walls it read and which
keep a fallback value. On plan A: 7 walls out of 8, sill 1.10 m.

**A façade does not have one thickness.** On plan A the north is 22 cm on the garage side and
34 cm on the bedroom side; taking a single dimension for the whole edge grew chambre-3 by
0.65 m². The script therefore splits each edge where a partition meets it, gives each run the
dimension running along it, and keeps the **outer face** fixed — it is the one on the outline,
not the axis. Openings follow, carried over by their world interval.

Measured effect: the **fully generated** plan, without a single hand-written wall, goes from 6
to **8 rooms out of 10** within ±0.05 m². The two remaining are the hall (inconsistency of the
plan) and the WC (+0.09, raw garage partition at 10.2 cm against 15 cm finished).

Beware of ambiguity: two neighbouring dimensions may describe the same wall (21 and 22 for the
same façade, raw and finished). The script takes the closest; it is a proposal, and an
override decides.

Three things the script does and **reports**, because they are displacements and not
measurements:

- **re-snapping rooms** onto wall faces (`snap_rooms`, 30 cm). A vertex moved by more than a
  few centimetres signals a polygon that was not on the faces;
- **thickness gaps** between the model and the printed dimension;
- **partition thickness gaps** between the model and the drawing's fill.

The last one is the costliest trap. **The drawing's fill is the raw wall; the model carries the
finished wall, lining included.** On plan A, the garage/WC partition is 10.2 cm in the fill and
15 cm finished, and the printed WC area (1.62 m²) decides for 15 cm. Replacing one with the
other shrinks the room by 0.09 m². The merge therefore only takes the thickness if it agrees
within 3 cm, and flags the gap otherwise.

The **type** of an opening is a convention, not a reading: under 1.60 m high it is a window
with a sill, above it is an opening with a threshold. The plan gives the height, not the type.
It is written here so that nobody takes it for a measurement. Three rules follow, and they are
in the script:

- height < 1.60 m → `window`; height ≥ 1.60 m and width ≥ 1.60 m → `sliding` (a door-height
  opening 2.40 m wide is not a leaf); otherwise `door`;
- a full-height opening over 2.00 m giving onto a room of type `garage` is a garage door — the
  room is in the model, so the rule is exact;
- the **sill** is not voted: the plan carries several `All : … m` on the same page (1.10 north,
  1.20 south on plan B). Taking the most frequent put 1.20 under the north windows. Each label
  is paired with the nearest opening, and an opening without a label is reported as
  unresolved.

The script's convention is a default, not a verdict: the owner corrected three types after a 3D
review, and their answers take precedence over the rule.

- a full-height opening printed `1.40/2.15` in a living room may be a **bay** (`sliding`), not a
  hinged door: the script says `door`, the house says bay;
- a kitchen's "double window" **slides sideways**: `sliding` with its sill (1.60/1.05 sill 1.10
  on plan A, 1.80/1.05 on plan B);
- a full-height bedroom opening (1.20/2.15 without a sill) is an **opening French window**:
  `door` with `glazed: true`, not a fixed window with decorative handles;
- every exterior-wall opening carries `exterior: true`: without it, the sliding door renders as
  a solid panel and the garage door starts open — that is what made the owner read "solid
  sliding doors" on plan B. `generate_project.py` sets this flag on every generation pass; an
  older generation does not have it, so check the key before review.

**A façade chain may cover several edges.** On the south of plan B, the living room, the
recessed entrance and the garage are three distinct edges, and a single chain measures them
all. Looking for the edge by side alone put every opening on the first and lost the others:
the entrance and the living room no longer had a single opening, and six rooms out of nine were
unreachable by the walk. Each opening is therefore placed on the edge whose interval contains
it, and at equal distance the one closest to the measured side — the entrance recess is 0.35 m
from the façade face, a tolerance would not tell it apart.

Two limits measured on real plans: **a façade whose openings are only isolated dimensions**
(not a closed chain) gives no opening, and **an interior door without a swing arc** cannot be
read by its symbol. Both are reported as missing, never invented.

**An ink-free range without an arc is not always a door.** Between two piers, a dimensioned gap
with no swing arc and no leaf is an **open bay**: on plan B the hall opens onto the living area
through `87 | 1.41 | 1.26`, and a conversion made it a 1.36 m hinged door, which the owner saw
as a door that does not exist. The schema has no "passage" opening: split the wall at the bay
(two walls, the gap between their ends) instead of declaring a `door`.

Interior doors carrying an arc are read by `extract_doors.py` (see "Interior doors, read on the
arc"). Those that do not are read **in ink**, wall by wall, and the AI places them: the owner
accepts that they are approximated, provided the walls are right. The method that works: sweep
the wall axis every centimetre and record the ink-free ranges of at least 30 cm. A sweep on a
single line is not enough — a 7 cm partition is two pixels, and the hatching of a thick wall
gives holes that are not holes. Three lines within the thickness (the two faces and the axis),
and keep the range where **none** has ink.

`--openings-only` keeps the model's walls and only adds the chains' openings. It is the mode for
a house whose walls are already right: it touches neither partitions nor rooms, so the areas do
not move. On plan B, it added the eleven exterior openings without moving a single room vertex.

`--replace` throws away the model's walls and only keeps what the drawing gives. Do not use it
on a real house: hatched walls and interior doors disappear, and the garage loses about one
square metre. The default is the merge.

The merge keeps the model's walls — they carry the hatched walls and the interior doors — but
it no longer throws away what the drawing computed: **openings** proven by a chain and absent
from the model are carried over, by their world interval and not by their offset (two
neighbouring walls may be six centimetres apart), and **thickness gaps** between the model and
the printed dimension are flagged. On plan A, the model already had the sixteen openings: the
merge adds nothing and says so.

## Building from a common reference

Rebuild finished faces and junctions from a single coordinate reference, then deduce wall axes
and room polygons from it. Metres internally; x to the right, z downwards, y upwards. Thickness
is centred on the axis. Opening offsets follow the wall oriented from its start: explicitly
convert the world coordinates of the dimension chain. Check sill, lintel, floor level and swing
separately.

Preserve identifiers, reference levels and the frame when correcting an existing project. Back
up and inventory identifiers and changes before replacing. Never import a regeneration over the
owner's browser arrangement, nor invent furniture from repository data.

Distinguish the footprint, usable height and declared living area. The schema has a flat
ceiling lowered by declared slopes (`ceilingSlopes`, see
[PROJECT-FORMAT](../../../docs/PROJECT-FORMAT.md)), straight flights (`stairs`), floor openings
(`floorVoids`), and roof windows and dormers on the roof. Roof meshes represent exterior
envelopes; the interior slope is the level's own `ceilingSlopes`, read on the section.
Record the source location of every unsupported element and its effect on fidelity. Never
replace a floor opening with a wall, a roof window with a façade window, nor a sloping level
with a full-height box declared faithful. A winding flight, a landing or a curved flight is
approximated by straight flights: declare the approximation instead of presenting it as the
drawn geometry. A provisional upper level may be supplied separately with its explicit limits.
Extending the schema is a separate implementation decision, not an undocumented JSON field.

## Schema traps that cost iterations

`validateProject` rejects these cases before any geometric check; handle them at entry rather
than discovering them one by one:

- every room needs a `label` and a `viewpoint` inside its polygon (the visitor needs about
  0.17 m of clearance);
- every level needs a `lights` array and a positive `ceilingHeight`, even under a sloping roof
  (document the chosen value);
- identifiers are unique across the whole project: prefix by level (`wc`, `wc-etage`);
- polygons must be simple (no crossing, no repeated edge);
- openings must fit under the wall or ceiling height, doors, sliding doors and garage doors
  start at the floor, and every opening is at least 10 cm wide and high;
- room polygons, labels and viewpoints stay within the level outline;
- room polygons stop at the walls' **finished faces**, never on their axes. A polygon reaching
  the axis overlaps the wall by half a thickness: the audit flags `room-solid-wall` and the
  room's area silently grows. Compute each face as `axis ± thickness / 2` and use it on both
  sides of every partition. This single error explains most of the defects found in three
  distinct reconstructions; check it before reading any area residual;
- `planArea` is optional and positive; it is the printed value, never a target to reach by
  moving walls. Record **which** printed value it is: a room polygon is a floor, so it compares
  to the usable area (SU), not to the living area (SH). Plans often print both, and their
  difference is the part under a slope or a staircase below 1.80 m of headroom. Comparing a
  floor to an SH produces a residual that reads as a geometry error: a hall printed
  `SH 5.19 / SU 6.97` showed +2.08 against the SH and +0.30 against the SU, with nothing wrong
  in the model.
- a polygon sized so that its area lands on the printed value is not evidence: on plan B the
  WC (0.74 × 1.62) and the hall were both exact on their table area and both wrong against the
  printed dimensions (the WC is 0.80 × 1.50, the "80" and the `1.30 | 18 | 2` chain). Read
  the dimensions, then compare the area;
- a thin line labelled `ht. muret` in a WC is the boxing of a wall-hung WC frame (2 cm panel,
  18 cm behind), counted in the room's area: it is a fixture, not a wall. Modelled as a
  full-height partition, it leaves a slit behind it that joins the neighbouring rooms;
- a recessed entrance has its back wall **inside** the outline: on plan B the outline's recess
  face is the wall's outer face (8.15), the inner face is 0.34 further in. A back wall placed
  outside the outline moves the hall, the WC and the shower room with it.

## Verify

### The area gate

The plan prints the area of each room — `SH : 13.03 m²`, `SA : 16.53 m²`. It is the only
measurement in the document that judges the result: a room whose computed area departs from
the printed area is a room whose walls are misplaced, however clean the drawing.

```sh
python scripts/check_plan_surfaces.py registry.json projet.json --level rdc --page 8
```

The script pairs each label with the room containing it, computes the polygon's area and
reports the gap. Tolerance: **0.05 m²**. As long as a room is out of tolerance, the plan is not
finished.

**Which area to compare.** A room polygon is a **floor**, hence an SU. The SH is the floor minus
what is below 1.80 m of headroom. On a level with a flat ceiling the two coincide; under a slope
or a staircase, they do not. When the plan prints both, the script takes the **SU** — on plan B
the hall prints `SH 5,19` and `SU 6,97`, and comparing with the SH would have shown a false
1.78 m² error. Corollary: the SU is what must be stored in `planArea`, otherwise the app shows
« contour à vérifier » (outline to check) on a correct room.

Measured state on plan A's ground floor (page 8, 1/75), tolerance 0.05 m²:

| version                          | out of tolerance | computed total |
| -------------------------------- | ---------------- | -------------- |
| original model                   | 4                | 106.14 m²      |
| corrected model, computed rooms  | 1 (the hall)     | 106.29 m²      |
| generation only, no wall by hand | 2 (hall, wc)     | 106.47 m²      |

Printed: 106.33 m². The four initial gaps were `chambre-1` +0.64, `degagement` −1.26, `sejour`
+0.58, `hall` −0.17. Two printed dimensions resolved them: `chambre-1` because its offset part
is **4.05 m** wide and not 4.77 (3.65 × 2.57 + 4.05 × 0.90 = 13.03), and the corridor because it
extends to z = 5.46 along the bathroom's return (dimension 60). The living room followed.

The hall remains, at −0.09, unresolved and documented: the plan prints 0.60 + 1.73 = 2.33 m²
for a 1.27 × 1.79 = 2.27 m² block. And the WC of the generation-only run, at +0.09, because the
garage/WC partition is 10.2 cm in the fill and 15 cm finished.

**An area is not inherited, it is recomputed** — fixing a wall must move the room, and this
gate is what proves it.

An area gap does not say _which_ wall to fix. It says there is one. The
`compare_plan.py --table` table gives the candidate: `shifted` first, `thickness mismatch`
next.

### A level under a roof slope

An attic level is not read like a ground floor, and four things mislead there.

**Read the floor and the slope on the section first.** The attic floor height, the knee wall
height, the pitch and the flat ceiling are printed or drawn on the section (coupe), not on the
attic plan. On plan B the section gives the attic floor at **+3.02** (the model said 2.75,
guessed, for two sessions), knee walls 1.24 m high at their inner face, 45° slopes and a flat
ceiling at 2.40 m. They become `elevation`, the knee walls' `height`, `ceilingSlopes` (foot line
on the knee walls' inner faces, `height` 1.24, `rise` 1) and `ceilingHeight`. The check is
arithmetic: 1.27 + (1.80 − 1.24) = 1.83 m, the printed `Limite H=1.80m` line. A wrong floor
height moves every dormer sill, every roof window and the stair rise with it.

**The floor does not reach the façade.** The drawing carries a line 1.27 m from each long
façade: that is where the slope meets the floor. That line is the **floor limit**, not a height
limit. Taking it for a 5 cm partition is correct; ignoring it makes the rooms overflow under
the roof. The proof is arithmetic: on plan B, the bathroom is 3.72 × 2.52 = 9.37 m² between that
line and its south partition, against 9.38 printed.

**The H = 1.80 m limit is another line.** It is a dash-dot line, at 1.83 m and 6.67 m on plan B,
and it is not a wall: it separates the SH from the annex. Do not confuse it with the rafter, and
do not place it as a partition.

To find it, beware of the hatching: a dash-dot line is recognised by its short segments, but a
wall's hatching produces them too. Grouping short segments therefore makes false dash-dot lines
appear **within the wall thickness** — a WC of plan B got an invented limit at z = 6.32 that was
only its hatching, and a room was cut in two for nothing. Filter by cumulative length per line,
and confirm on the render before concluding.

**The page prints three tables, not one.** `SURFACES HABITABLES`, `SURFACES ANNEXES`,
`SURFACES GARAGE`. A room's area is **SH + annex** — it is the floor, hence the SU. On plan B:
dressing 5.51 + 1.61 = 7.12, bathroom 7.67 + 1.71 = 9.38. Taking the SH alone shows a false
error on every room.

**The floor extends into the dormers.** A slope pierced by a dormer is not a continuous slope:
the room's floor runs under the dormer up to its back wall. On plan B, two 0.90 m wide dormers
pierce the south slope (alcoves x 2.165..3.065 and 10.185..11.085). The table counts about
**0.77 m²** each (4.55 × 3.37 = 15.33 plus 0.77 = 16.10 printed), which takes the alcove to
z ≈ 8.09; the drawing closes it at the inner face of the dormer piers (7.94), 0.64 m². Keep the
drawing and document the 0.13 m² per bedroom.
The rafter must therefore be **cut** at each opening and the level outline carry the two
projections. A continuous rafter leaves both rooms short by 0.77 m² and suggests a
contradiction in the plan that does not exist.

**And printed areas do not always close.** On plan B, after reconstruction from fills and
lines, tolerance 0.05 m²:

| room           | printed | drawing | gap   | cause                                                   |
| -------------- | ------- | ------- | ----- | ------------------------------------------------------- |
| bathroom       | 9.38    | 9.37    | −0.01 | —                                                       |
| bedroom 2      | 14.44   | 14.44   | 0.00  | —                                                       |
| bedroom 3 west | 16.10   | 15.97   | −0.13 | 4.55 × 3.37 + 0.64 of dormer alcove                     |
| bedroom 3 east | 13.90   | 13.74   | −0.16 | 4.96 × 2.78 − 0.65 of corridor end + 0.64 of dormer     |
| dressing       | 7.12    | 7.05    | −0.07 | technical cupboard: 0.25 in the drawing, 0.19 in table  |
| WC             | 1.24    | 2.01    | +0.77 | the table counts 0.85 × 1.46, the dimension 0.85 × 2.39 |
| corridor       | 4.14    | 3.48    | −0.66 | the table moves 0.77 m² from the WC to the corridor     |

Four rooms land right. The other three are explained by the plan itself, and two are proven by
a **sum**. The WC and the corridor form **a single open region**: no wall between them, only a
0.85 m door. The table splits that region elsewhere than the drawing, but the total lands:
1.24 + 4.14 = 5.38 printed, 2.01 + 3.48 = 5.49 in the drawing, and 0.85 × 2.39 + 3.74 × 0.90 =
5.40 from the plan's dimensions. It is the split that is arbitrary, not the area — and that is
why an area gap never says which wall to fix. The dressing, for its part, stumbles on the
technical cupboard: the table gives it 0.19 m², the drawing 0.25.

**A room is not resized to make the number land**: keep the drawing's geometry, store the
printed area, and write down the cause. A level under a slope therefore needs its own decision
pass, like the ground floor — the chain does not guess it.

Roof windows and dormers belong to the roof (`site.roofs[].windows` and `dormers`, see
[EXTERIOR](../../../docs/EXTERIOR.md)). A roof window drawn on the attic plan is usually drawn
at the knee wall: count **every** symbol on the plan and on the elevations — plan B has a third,
0.55/0.78, on the south slope over the upstairs WC, missed by two conversions. A dormer's back
wall is a wall of the attic level at its **full drawn height**: it pierces the covering, and
validation allows it. Its height and its window sill are not on the plan: read them on the
elevation that faces the dormer, calibrated on the ridge (the drawn gutter sits 15–20 cm above
the dimensioned eave). On plan B, at 1/100: window 0.90 × 1.05 with its frame measuring exactly
1.05 (the calibration check), sill 1.10 m above the +3.02 attic floor (the `All : 1.10 m` of the
attic plan agrees), front top +5.41, so a 2.39 m back wall, rounded to the 2.40 flat ceiling.
The dormer front is **not** on the façade plane: the plan draws it between two 20 cm piers, at
z 7.94–8.14 on plan B, 0.36 m inside the façade, and the façade chain `1.965 | 20 | 90/1.05 |
20` gives the piers. The back wall spans piers and window (1.30 m), the alcove stays 0.90 wide,
and `ceilingSlopes[].gaps` keep the ceiling flat over the alcove; two thin cheek walls beside the
gap close its sides under the slope. Roof windows are placed the same way: their top and bottom
edges on the elevation give heights, which the roof face turns into a plan centre (plan B:
tops at +5.23). The previous rule — cut the back wall to 1.10 m under the covering and drop the sill —
dates from before dormers existed in the roof format, and it buried both windows under the
eave. A dormer roof is flat or single-slope in the format: a two-pitch dormer roof is approximated
flat at its front top, its footprint reaching back to where that height meets the slope.

### The roof and the terrain are read too

A project without `site` has no exterior view at all: the button stays hidden. The roof is not
a decision, it is printed — but on other pages than the level plan.

| what you look for      | where it is printed                                              |
| ---------------------- | ---------------------------------------------------------------- |
| roof pitch             | sections: `PENTE = 45.00 °`                                      |
| eaves and ridge height | sections and site plan: `Egout: +3.43`, `Faitage: +8.11`         |
| finished floor level   | site plan: `RDC: +0.28` on the `±0.00` reference                 |
| plot and setbacks      | site plan: `32.60`, `16.00`, `3.61`, `17.35`, `Surface : 522 m²` |
| colours                | insertion: cream façade, slate roof                              |

**Bring everything back to the level's frame**, not to the title block's reference. The site
plan gives `RDC: +0.28`: the eaves at `+3.43` are therefore **3.15** above the ground floor's
finished floor, and the ridge **7.83**. Forgetting this subtraction puts the roof 28 cm too
high, and the walls go through.

**The roof drop is deduced, not read.** The descent from ridge to eaves is
`7.83 − 3.15 = 4.68`. At 45°, the half-span is `8.50 / 2 = 4.25`. The gap, **0.43 m**, is the
roof overhang. That is what makes the ridge fall in the middle of the building.

**Gables are indices**, not vertices: `gables: [[6, 2, 7], [8, 3, 9]]` points into `vertices`,
like `faces`. A list of vertices is rejected by `validate.ts` with « Géométrie de toiture
invalide ».

**The exterior view is the building's, not the displayed level's.** Façades come from the
lowest level and the roof covers the rest. Building the exterior from the attic only showed the
roof, and put the lawn at its altitude.

**The walls of a level under a slope must stay under the roof.** A wall's maximum height is
`roof(z) − floor`. A flat `ceilingHeight` of 2.5 let the partitions cross the covering by 42 cm,
visible from outside. Declare the slopes in `ceilingSlopes` instead: wall tops, the ceiling and
fixtures then follow them, and the flat `ceilingHeight` is the true flat ceiling of the section.

#### Checking an exterior already in place

A `site` written in a previous session has never been compared with the document. The five
steps below are a script — the site-plan registry is regenerated with
`extract_plan_evidence.py --pages <n>`, then:

```sh
python scripts/check_site.py <site-plan-registry.json> <project.json> --page <n>
```

It returns a printed / computed / gap table per checkpoint, refuses what exceeds the tolerance
by naming the faulty side or level, and flags what is undimensioned. The method stays reading
its report, in this order because each step assumes the previous one:

1. **The plot's four sides and its area.** Compute the lengths and the shoelace area, compare
   with the dimensions and with `Surface :`. A wrong side moves everything else.
2. **The setbacks.** Distance from each side to the level outline. That is what says whether
   the plot is well _placed_, not only well dimensioned: lengths may land right with the house
   in the wrong place.
3. **The levels.** `Egout` and `Faitage` minus `RDC`, compared with the `y` of the roof
   vertices.
4. **The roof topology.** Count the gables and eaves on the four façades, and find them in
   `gables` and `faces`. One gable too many is visible from outside.
5. **The terrain surfaces.** See below: only one is dimensioned.

On plan A, step 2 is the one that paid off. The four sides landed right (32.03 / 19.32 /
28.33 / 14.01 for 496 m²), but it still had to be checked that the house is **9.40 m** from the
14.01 m boundary — the dimension is printed — and flush with the 32.03 m one, where the chain
`10,08 | 12,55 | 9,40` places the 12.55 m façade between two returns. The two other setbacks,
6.40 and 4.04 m, are then deduced and dimensioned nowhere.

**The drawing's eaves are not the dimensioned eaves.** On plan A's south façade, the height
measured between the low edge of the slates and the ridge is 3.13 m, for 3.32 m dimensioned.
It is not a 19 cm error: the drawing's line is the top of the gutter, the `Egout` dimension is
the water line. A 15 to 20 cm gap at that spot is normal — do not "correct" the roof to make it
land.

**Only one terrain surface is dimensioned.** The site plan dimensions the driveway entrance
(`5.00m x 5.00m` on plan A, `6.00x6.00m` on plan B) and nothing else: the rest of the gravel,
the garage access and the path to the entrance are drawn but not measured. Writing them is a
decision, not a reading. Declare them in `site.notes` — the « Terrain et extérieur » panel shows
them — rather than letting them pass for dimensions.

**Garden elements come from the site plan, the same way.** The plan de masse draws the terrace,
the drive, the boundary walls, fences and hedges, and its legend usually gives their heights
(`mur de clôture h=1.80`, `clôture grillagée h=1.20`). A script measures the polygons and
polylines on the drawing; the AI decides the kind: a hatched slab against a French window is a
`terrace`, a stippled access to the garage is `gravel` (tout-venant included), a thick line on
the plot edge is a `wall`, a thin one a `fence`, a row of circles a `hedge`. Write them in
`site.surfaces` and `site.boundaries` ([EXTERIOR](../../../docs/EXTERIOR.md)), the points half a
thickness inside the plot edge. A height read in the legend is a reading; a height the plan
does not give is a decision: say which in `site.notes`, as for the undimensioned surfaces.

### Rooms are computed from the walls

A room polygon entered by hand is an opinion. `plan_faces.py` closes the level, cuts the plan
at the wall faces, fills the free cells and returns the exact area of each region. No cell can
cross a wall, so the area is a computation, not a detection.

```sh
python scripts/plan_faces.py projet.json --level rdc --compare
```

`--apply` replaces the polygon of **closed** rooms with the computed outline, and leaves open
spaces as they are, saying so. That is what removes the partition returns sticking out into a
room: on plan A, seven rooms get back the exact outline and the audit drops from eight warnings
to one.

It answers a question the area gate cannot ask: **do the walls really close the rooms?** On
plan A, before correction, the living room, the corridor and the hall formed a single 45.46 m²
region: no wall separated them. That is normal — they are zones of the same open space — but it
must be known before reading an area gap.

Two consequences:

- an **open zone** has no area of its own. Its limit is a convention, and the plan may
  contradict itself. On plan A, `placard` + `hall` print 0.60 + 1.73 = 2.33 m² for a
  1.27 × 1.79 = 2.27 m² block: the plan's dimensions do not close by 0.06 m². Document the gap,
  do not move a wall to make the number land;
- a room whose polygon differs from the region under its centre is a **wrong polygon**, not a
  wrong wall. `--compare` says so room by room.

### The internal audit

Run `validateProject`, then the deterministic audit. It reports room/room overlaps, room/solid
wall intersections, duplicate collinear walls, wall ends stopping just short of another wall,
partitions floating outside the outline or above a declared floor opening (`wall-over-void`),
rooms no level passage reaches, a spawn point outside every room, the visitor's clearance and
the declared area residuals. Resolve accidental overlaps, doubled partitions, nearly-joined
ends and blocked passages. Investigate area residuals; keep `planArea` separate and explain
differences with evidence. Area agreement is not enough.

```sh
node --import tsx scripts/audit-plan.ts artifacts/plan-review/house.json > artifacts/plan-review/house-audit.json
```

The audit reports polygon intersections, room areas, the openings' world endpoints, wall
clearance, duplicate walls, end gaps and a grid flood fill from the spawn point through the
level-crossable openings (`reachedRooms`). It subtracts level-crossable openings from the wall
footprint; windows stay solid. It establishes neither fidelity to the source, nor leaf swing,
nor thresholds, nor furniture, nor the complete correctness of the junctions. Never adjust the
geometry automatically to turn its report green.

A `reachedRooms` count only makes sense once the walls are closed. A gap left between two rooms
lets the fill through and reports full connectivity when no door serves the zone; close the
wall first, then read the count. A residual that cannot be deduced from the printed dimensions
is a finding, not a rounding: state the range the ambiguity produces and mark it unresolved,
instead of moving a wall until the number lands.

**The symmetric case exists and is nastier**: a room may be reached through a gap that should
not exist. On plan B, the shower room has no door and yet read as reached, because the WC
polygon stopped 24 cm before the south wall and the fill went under the low wall. A complete
`reachedRooms` is therefore not proof of a correct plan: you must read **where** you pass. The
deciding test is to close the missing wall and see whether the room becomes unreachable — if
so, it was indeed a gap.

Read the audit's own flags before reporting. It returns `sourceVerified: false` and
`browserInspected: false` because it checks internal consistency, not fidelity to the plan. A
clean report means "no overlap, no unjoined wall, no unreachable room" — nothing more.
Announcing a corrected level on that basis is the error that hides all the others.

### Comparing with the source

Compare a generated plan with the source using an independently calibrated overlay. Inspect
perimeter steps, partition junctions, reveals and asymmetric anchors that detect a mirror.
Record residuals and uncertainty in source pixels. Never calibrate on the output geometry. Then
make the comparison numeric with
`scripts/compare_plan.py projet.json calibration.json rapport.json`: for each wall it looks for a
dark line at `-thickness/2` and another at `+thickness/2`, and reports the axis offset, the
measured thickness and a verdict. A wall with no counterpart is invented; a wall whose
thickness diverges is declared wrong. This catches in one pass what a visual overlay only
suggests.

```sh
python scripts/overlay-plan.py projet.json calibration.json overlay.png
```

The calibration JSON provides `image`, `level`, three non-collinear `anchors` and independent
`checks`, each with `world: [x,z]` and `pixel: [u,v]`. The tool needs Pillow and writes a
calibration residual report next to the overlay. Rendering the source and interpreting the
anchors stay explicit inputs.

`compare_plan.py --table` prints one line per wall: verdict, measured offset, thickness read,
declared thickness. It is the work list.

- `aligned` — nothing to do.
- `thickness mismatch` — the drawn wall is thicker or thinner than declared. Fix it with an
  override, not by regenerating.
- `partial counterpart` — the wall is interrupted in the drawing (a window frame reads as a
  thinner wall). Check before concluding.
- `shifted` — the wall is in the wrong place. That is the one that counts.
- `no counterpart in the plan` — the wall is invented.

Four tools complement this overlay, in `scripts/`: `grid_page.py` renders a PDF plan page with
a grid in metres, to read a thickness or a dimension against the model; `overlay_page.py` draws
the project's walls and rooms over the sheet; `model_plan.py` renders a level from the JSON
alone, to check what the model says without the drawing; `wall_joins.py` lists the wall ends no
other wall covers. The first three take the page number **from 1** like the rest of the
repository, a frame `(ox, oy, scale)` in displayed points of the rotated page, and print the
page read. `wall_joins.py` revealed a partition floating outside the floor — the audit now
flags it (`interior-wall-outside-outline`) — and stays the work list of free ends, the other way
to find an invented wall or a missing junction.

### The browser

Import into a real browser. Inspect every level in Plan and in overview, the exterior if
provided, and go through the available doors. Check corners, doubled or protruding walls,
floating or blocked openings, floor levels, spawn clearance and ceiling/roof relations. Record
the screenshots and the views actually inspected. NullEngine and DOM tests do not replace the
visual review. Confirm that new geometry reads in the **Plan** projection, not only in 3D: an
orthographic top view lights every horizontal face identically, so a staircase flight sharing
the floor material becomes invisible, like any object whose top face has the colour of the
surface below. Give that geometry a distinct material and check on a screenshot rather than by
reasoning about the scene.

**How to get the screenshot.** The project is git-ignored, so opening the URL is not enough: it
must be injected into local storage before rendering.

```sh
npx vite --host 127.0.0.1 --port <free> --mode private
```

Then a Playwright script that, in this order: injects the project under
`maison-atelier:projects:v1`, sets `maison-atelier:last-project` to its `id`, sets
`maison-atelier:onboarding` to `{version: 1, cardSeen: true}`, reloads, waits three seconds,
closes the « Premiers pas » panel (it hides the bottom of the view), then clicks `Vue 3D`,
`Extérieur`, `Plan`, `Visite`. Cut external requests with `page.route` so that the screenshot
does not depend on the network.

Two traps: a fixed port collides with other agents and with the e2e suite, which takes its own
— draw one at random; and the view state is remembered, so a "Plan" screenshot after a "Visite"
screenshot does not show the same thing as on first launch.

Then fix the registry and the model, and redo the relevant checks. Run the applicable CI and
privacy checks; publish only through the repository's pull request flow.

## Retouching without redoing

A generated wall is not final. `--overrides` takes a small file applied after generation:

```json
{
  "walls": { "ext-4": { "thickness": 0.42, "offset": 0.02 } },
  "openings": { "ext-3-o1": { "offset": 1.5, "width": 0.9 } }
}
```

A correction targets one wall and survives a regeneration. Fixing three walls never means
redoing the twenty others. Keep this file next to the project, not in the repository.

**Interior doors** do not go through this: `--overrides` cannot add an opening, only move or
resize an existing one. They are therefore written directly into the project, after
generation, with their justification as a comment in the script that places them. It is the
only layer not reproducible from the PDF, and that is deliberate: the owner wants to be able to
retouch them by hand in the interface, later. Walls, on the other hand, are not retouched by
hand.

A missing wall is also fixed by hand, and it has to be looked for: neither the area gate nor
the audit flags an absent wall. On plan B, the west wall of the WC did not exist — the WC was
open onto the hall over 1.60 m — and nothing said so. What showed it was the overlay: the model's
walls in orange over the drawing, and a hatched band of the drawing with no orange under it. Do
the overlay on every pass, not only at the end. Short returns are the easiest to lose: the 60 cm
partition return west of bedroom 1's corner on plan B (`60 | 7`, standing free in the open
kitchen) was missing for several passes until the owner noticed it in 3D.

**The symmetric case — a wall the drawing does not carry — slipped through three times.** An
area stays right, `reachedRooms` stays complete and the audit says nothing: none of the three
gates sees a wall **too many**. Four invented walls survived three passes and the owner saw
them, on both plans, in a single review. Two faces to know:

- the wall placed to close an outline: a straight partition invented so that a room rectangle
  lands on the printed area, when the drawing opens the room in an L onto its neighbour (double
  wall, 20 cm dead void on the floor); and a straight partition in an alcove where the drawing
  only carries a dimension and a dotted line (two doors in series into the same room);
- the inherited wall that floats or closes: a partition entirely outside the level's floor,
  whose floor stops at the rafter, hanging under the house in 3D; and a partition that
  hermetically closes a stairwell — a flight goes down from the landing, nothing can wall it
  off.

The attic face of the second case: on plan B, a partition stuck to the east flank of the
flight in the attic — x 5.795, no fill in the extract — when the drawing opens the floor
opening up to the WC wall (x 6.15) and only shows a balustrade there. The trap comes from the
fill: the partition closes the opening so that `reachedRooms` does not go through the void, and
the invention survives because the opening is declared in `floorVoids` and no room borders the
face. The owner's answer, one 3D review later: "one wall too many upstairs".

The floor-opening variant no longer waits for the owner's review to show:
`audit-plan.ts` now flags any solid wall overlapping a declared `floorVoids` (`wall-over-void`,
0.01 m² threshold; a wall flush with the opening's face stays under the threshold). The other
faces remain: `compare_plan.py` (`no counterpart in the plan`) and the orange overlay. An invented outline
wall almost always comes from a polygon fitted to the printed area instead of to the faces: fix
the polygon, keep the printed area in `planArea`, document the residual — never the reverse. A
stairwell open onto its landing is not a hole: as long as `stairs` and `floorVoids` are not
declared, it renders bare, and that is a declared gap, not a defect to wall off.

## Delivering an honest completion state

Provide the local importable JSON, the evidence registry, the before/after changes, the audit
report and the results of the source comparison and browser review. State the maximum measured
residuals and the unresolved elements instead of an invented accuracy percentage. Mark the
result provisional as long as material dimensions, the source comparison or the visual checks
remain unresolved. Name the missing evidence precisely. Never claim perfection, survey accuracy
or a deployment without the corresponding evidence.

Give the breakdown, not a percentage: which walls come from the drawing, which walls come from
the model, which openings are missing, which rooms are out of tolerance and by how much. A plan
whose garage is 1 m² off is a plan to fix, not to present.

## Closing the loop

This skill is a working document, not a finished procedure. After a conversion pass, before
declaring it finished:

1. **Ask the owner what must change.** Name the concrete choices made and ask which are wrong
   or missing: the source file kept, the level's page, the wall thicknesses kept, the openings
   left unresolved, the automation done by hand, the area gap they notice first. The owner
   knows the house and the builder; the AI knows what the scripts did. Neither half is enough
   alone.
2. **Record the answer in this file**, in the section it belongs to, not in a conversation log.
   A correction that stays in an exchange is lost at the next session.
3. **Turn repeated manual work into a script step.** If the same thing was done twice by hand —
   locating the level's page, reading a scale, pairing faces, placing a dimension line — it
   belongs in `scripts/`, with a fixture and a CI step. Only automate what can be verified: a
   step that silently guesses is worse than a manual step written down in black and white.
4. **Keep the failure in the skill.** A wrong conclusion that cost a session (a scan taken for
   the only source, a wall proven by the opposite façade) is worth more than a success,
   provided the trap is written where the next session will read it.

Ask the questions once, at the end of the pass, as a short, precise list. Do not ask for
confirmation at every step: the owner asked for the work, not for a running commentary.

## Backing up personal projects

The reference copy of a personal project is `reference-documents/<id>.json`. A
`public/projects/private-*.json` file is only a working copy, loaded by `dev:private`. It can
go stale: in a real session, an old `private-*.json` was imported into the browser instead of the
reference, and the upper floor's windows and a whole kitchen looked lost. Import into the browser
from `reference-documents/`. When a working copy is needed, copy the reference over it first. If
the two disagree, the reference wins unless you know the working copy carries newer decisions.

```sh
pnpm run backup:private
```

Copies every `public/projects/private-*.json` to `reference-documents/<id>.json`. It refuses
to overwrite a reference that differs and is more recent than the working copy (`--force`
overrides). **Run it after every decision pass**, not only at the end: a copy three passes old is worse than no copy,
because it looks like a backup. In a real session, the two copies had drifted by three keys and
by ten keys — including the whole `site` of the second plan, added after the copy. It happened
again: the plan B fixes of a later session (WC walls, dormers, roof windows) lived only in a
`private-*.json` that was then lost, and the next session found the older copy, redid the
measurements from the PDF and found the same defects. Keep the correction script next to the
copy (`reference-documents/historique/`): it replays the decisions on any older copy.

`reference-documents/` may be a **junction** to a synced folder (kDrive, OneDrive): scripts see
no difference, and PDFs as well as copies leave the repository. The folder is git-ignored, so
git never crosses the junction. After creating it, check that
`reference-documents/plans-emieville.pdf` opens: a broken junction shows on opening, not on
creation.

Keep intermediate states in `reference-documents/historique/` rather than overwriting them: a
wrong provisional model is the evidence of what failed, and it is what made it possible to
understand why the second plan did not hold.
