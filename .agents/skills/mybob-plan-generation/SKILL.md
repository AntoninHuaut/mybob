---
name: mybob-plan-generation
description: Generate a Mybob project JSON from an architectural PDF with the extract/generate/verify/retouch pipeline, and know exactly which parts are automatic, which are approximate and which stay manual.
---

# Generating a plan from a PDF

Operational runbook. `mybob-plan-conversion` holds the theory and the traps;
this file holds the procedure, the commands and the honest split between what
the scripts decide and what a human must decide.

## What the pipeline decides, and what it does not

Measured on two real plans from the same builder (Émiéville 1/75, Sannerville
1/50). Do not promise more than this table.

| element                                            | source                                     | reliability                |
| -------------------------------------------------- | ------------------------------------------ | -------------------------- |
| partitions (filled rectangles)                     | the drawing, by its flat colour            | **exact**, 13 and 11 found |
| exterior walls                                     | the level outline, one wall per edge       | **exact**                  |
| openings on a closed dimension chain               | the printed chain                          | **exact**, 5 and 7 placed  |
| room polygons                                      | the model, snapped onto the new wall faces | inherited, ±3 cm           |
| hatched interior walls                             | **the model**                              | not extracted              |
| interior doors                                     | **the model**                              | not extracted              |
| openings on a façade with only isolated dimensions | **nothing**                                | missing                    |

The two representations matter: partitions are **filled rectangles**, everything
else is a **hatched band**. Six geometric attempts failed on the hatched bands
(pairing strokes, clustering the hatch, ink density, morphology, dilation,
zigzag detection). Do not retry them; the reasons are in
`mybob-plan-conversion`.

## The procedure

```sh
# 1. Geometry: partitions, read by their flat colour, clipped to the envelope.
uvx --from pymupdf python scripts/extract_plan.py plan.pdf 8 plan.json \
    --denominator 75 --envelope x0,y0,x1,y1

# 2. Evidence: dimension chains, for the openings.
uvx --from pymupdf python scripts/extract_plan_evidence.py plan.pdf registry.json --pages 8

# 3. Generation: merge, so the model's hatched walls and doors survive.
python scripts/generate_project.py plan.json registry.json model.json rdc out.json \
    --pages 8 --overrides corrections.json

# 4. Verification: every wall against the drawing.
python scripts/compare_plan.py out.json calibration.json report.json --table
node --import tsx scripts/audit-plan.ts out.json
```

`--envelope` is the level's bounding box **in PDF points**, taken from the closed
chains. Without it the title block's flat colour is read as walls.

`--replace` throws away the model's walls and keeps only what the drawing gives.
Do not use it on a real house: the hatched walls and the interior doors vanish,
and the garage loses about a square metre. The default is `--merge`.

## Reading the verification

`compare_plan.py --table` prints one line per wall: verdict, measured offset,
read thickness, declared thickness. That table is the work list.

- `aligné` — nothing to do.
- `épaisseur divergente` — the drawn wall is thicker or thinner than declared.
  Fix it with an override, not by regenerating.
- `contrepartie partielle` — the wall is interrupted in the drawing (a window
  frame reads as a thinner wall). Check before concluding.
- `décalé` — the wall is in the wrong place. This is the one that matters.
- `aucune contrepartie` — the wall is invented.

`audit-plan.ts` answers a different question: internal consistency. A clean
audit does not mean the plan matches the source.

## Retouching without redoing

A generated wall is not final. `--overrides` takes a small file applied after
generation:

```json
{
  "walls": { "ext-4": { "thickness": 0.42, "offset": 0.02 } },
  "openings": { "ext-3-o1": { "offset": 1.5, "width": 0.9 } }
}
```

A correction targets one wall and survives a regeneration. Fixing three walls
never means redoing the other twenty. Keep that file next to the project, not in
the repository.

## What to tell the owner

State the split plainly: which walls come from the drawing, which come from the
model, which openings are missing. Give the measured residuals, not an accuracy
percentage. A plan whose garage is 1 m² short is a plan to fix, not to present.

## Close the loop

After a generation pass, ask the owner which walls are visibly wrong and which
missing elements matter most. Record the answer here, and turn anything done
twice by hand into a script step with a synthetic self-test. The self-tests in
`extract_plan.py` and `generate_project.py` exist for that reason: they run in CI
without any personal data.
