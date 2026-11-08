"""Extracts the vector drawing of a plan page (walls and dimension lines).

Usage: uvx --from pymupdf python extract_walls.py <pdf> <page-number> [zone x0,x1,y0,y1]
        <page-number>: counted from 1, like the other repository scripts.
Output: black horizontal and vertical lines grouped by ordinate (wall axes),
         with their extent along the axis, in PDF points (after rotation correction).
"""
import sys
import pymupdf
from collections import defaultdict

pdf, page_number = sys.argv[1], int(sys.argv[2])
zone = None
if len(sys.argv) > 3:
    x0, x1, y0, y1 = (float(v) for v in sys.argv[3].split(","))
    zone = (x0, x1, y0, y1)

doc = pymupdf.open(pdf)
if not 1 <= page_number <= doc.page_count:
    sys.exit(f"page {page_number} does not exist: the document has {doc.page_count}")
page_index = page_number - 1
p = doc[page_index]
words = p.get_text().split()
print(f"page {page_number} : {' '.join(words[:6])}")
mb = p.mediabox
# Correct /Rotate 90 pages: (x, y) PDF -> display points (x and y swapped)
def tx(x, y):
    if p.rotation == 90:
        return (mb.height - y, x)
    if p.rotation == 270:
        return (y, mb.width - x)
    return (x, y)

rows = defaultdict(list)
for dr in p.get_drawings():
    if dr.get("color") is None or max(dr["color"]) > 0.35:
        continue
    if (dr.get("width") or 0) > 1.6:
        continue
    for it in dr["items"]:
        if it[0] != "l":
            continue
        a = tx(it[1].x, it[1].y)
        b = tx(it[2].x, it[2].y)
        if abs(a[1] - b[1]) < 0.25 and abs(a[0] - b[0]) > 0.8 * 56.7:
            off = round((a[1] + b[1]) / 2, 2)
            lo, hi = sorted((a[0], b[0]))
            rows[("H", off)].append((round(lo, 2), round(hi, 2)))
        elif abs(a[0] - b[0]) < 0.25 and abs(a[1] - b[1]) > 0.8 * 56.7:
            off = round((a[0] + b[0]) / 2, 2)
            lo, hi = sorted((a[1], b[1]))
            rows[("V", off)].append((round(lo, 2), round(hi, 2)))

for (d, off), v in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1])):
    if zone:
        (zx0, zx1, zy0, zy1) = zone
        inside = (zy0 <= off <= zy1) if d == "H" else (zx0 <= off <= zx1)
        if not inside:
            continue
    spans = sorted(set(v))
    if len(spans) >= 2:
        print(d, off, spans)
