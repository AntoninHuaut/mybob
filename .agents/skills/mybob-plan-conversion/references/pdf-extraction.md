# PDF extraction (pymupdf): verified traps

Recipes for the skill's rendering and extraction steps, as run on real architect plans. Tools,
at the repository root: `scripts/render_pages.py` (page rendering) and
`scripts/extract_walls.py` (candidate axes).

## Rendering and reading pages

Render every page to PNG then read those PNGs with the image-reading tool: it is the main
check, more reliable than interpreting vectors by eye. Assemble contact sheets (4 pages per
sheet, labelled) to quickly spot ground floor, upper floors, sections, site plan and
specification in a 15-page PDF.

Zoom on an area before a detailed reading of the dimensions:

```python
page.get_pixmap(matrix=pymupdf.Matrix(300/72, 300/72), clip=pymupdf.Rect(x0, y0, x1, y1))
```

## Pages with `/Rotate 90`

Landscape A3 sheets are often 842 × 1191 mediaboxes with `/Rotate 90` (or 270). `page.rect`
is already oriented, but `get_text("dict")` returns **unrotated** coordinates: convert them
before any position computation, otherwise the M (labels) and P (dimensions) positions are off
by the whole screen.

```python
import pymupdf
doc = pymupdf.open(pdf)
page = doc[i]
mb = page.mediabox
if page.rotation == 90:      # landscape: x_disp = mediabox_height − y_doc, y_disp = x_doc
    tx = lambda x, y: (mb.height - y, x)
elif page.rotation == 270:
    tx = lambda x, y: (y, mb.width - x)
else:
    tx = lambda x, y: (x, y)
```

`get_pixmap(clip=…)`, on the other hand, expects display coordinates. Check the conversion with
a known label (title-block corner) before concluding.

## Scale and origin

Scale is deduced from a known overall dimension, not from the title-block value:
`pts_per_m = span_px(overall_dimension) / read_length`. Origin: the outer face of the
north-west wall. Check every chain by comparing its vector dimension ticks to the cumulative
sum of the segments.

## Dimension chains and labels

Dimension labels are rotated text (≈90°/270°) set on the line. Extract with
`get_text("dict")`, sort by line angle then by position: the chain reads left to right (or top
to bottom) and must close on the overall dimension; keep the cumulative value at each tick
found. Format `a/b`: width/height; `All : X m` is a sill height (allège).

Check that every room label (`SH : … m²`) falls inside the reconstructed area; a label outside
its area signals a misplaced wall rather than a labelling convention.

## Validation check

`node --import tsx scripts/audit-plan.ts …` and the skill's calibrated overlay stay the check
steps; these two helpers only prepare the inputs (renders, candidate axes).
