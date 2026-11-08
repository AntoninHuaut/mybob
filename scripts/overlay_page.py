"""Draws the project's walls and rooms over a rendered PDF page.

The reference overlay: the model's walls in translucent orange, rooms in blue,
openings marked in green (crossable) or blue (windows), each identifier written
in place. A hatched band without orange is a drawing wall missing from the
model; an orange rectangle without hatching is an invented wall — it is the
gate that sees what no area nor audit sees.

The frame `(ox, oy, scale)` gives the displayed point of the rotated page:
displayed point = (ox + scale * x, oy + scale * z).

Usage:
  python scripts/overlay_page.py <project.json> <level> <pdf> <page> <ox> <oy> <scale> <output.png> [clip]
  <page>: counted from 1, like the other repository scripts.
  <clip>: x0,y0,x1,y1 in displayed points, optional (whole page otherwise).
  python scripts/overlay_page.py --self-test
"""

import json
import sys

import pymupdf
from PIL import Image, ImageDraw

TRAVERSABLE = {"door", "sliding", "garage"}
ROOM_OUTLINE = (0, 90, 255, 255)
ROOM_TEXT = (0, 60, 200, 255)
WALL_FILL = (255, 140, 0, 90)
WALL_OUTLINE = (200, 90, 0, 255)
WALL_TEXT = (150, 60, 0, 255)
PASSING = (0, 170, 0, 255)
FIXED = (0, 120, 255, 255)
DPI = 400


def page_identity(page):
    """First words and capitalised titles — a page is located by its text."""
    words = page.get_text().split()
    head = " ".join(words[:6])
    caps = [w for w in words if len(w) > 2 and w.isupper()][:6]
    return f"{head} — {', '.join(caps)}"


def render(project, level_id, pdf_path, page_number, ox, oy, scale, out, clip=None):
    level = next((lv for lv in project["levels"] if lv["id"] == level_id), None)
    if level is None:
        sys.exit(
            f"niveau {level_id!r} inconnu : " + ", ".join(lv["id"] for lv in project["levels"])
        )
    doc = pymupdf.open(pdf_path)
    index = int(page_number) - 1
    if not 0 <= index < doc.page_count:
        sys.exit(f"page {page_number} does not exist: the document has {doc.page_count}")
    page = doc[index]
    print(f"page {page_number}: {page_identity(page)}")

    zoom = DPI / 72
    rect = pymupdf.Rect(*clip) if clip else page.rect
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect)
    # RGB base: a Draw(img, "RGBA") on an RGBA base would overwrite the
    # pixels instead of blending, and the alphas would serve no purpose.
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    draw = ImageDraw.Draw(img, "RGBA")

    def px(x, z):
        return ((ox + scale * x - rect.x0) * zoom, (oy + scale * z - rect.y0) * zoom)

    for room in level["rooms"]:
        pts = [px(*p) for p in room["polygon"]]
        draw.polygon(pts, outline=ROOM_OUTLINE)
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        draw.text((cx, cy), room["id"], fill=ROOM_TEXT)

    for wall in level["walls"]:
        (x0, z0), (x1, z1) = wall["start"], wall["end"]
        dx, dz = x1 - x0, z1 - z0
        length = (dx * dx + dz * dz) ** 0.5
        if length == 0:
            continue
        ux, uz = dx / length, dz / length
        nx, nz = -uz, ux
        half = wall["thickness"] / 2
        corners = [
            (x0 + nx * half, z0 + nz * half),
            (x1 + nx * half, z1 + nz * half),
            (x1 - nx * half, z1 - nz * half),
            (x0 - nx * half, z0 - nz * half),
        ]
        draw.polygon([px(*c) for c in corners], fill=WALL_FILL, outline=WALL_OUTLINE)
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        draw.text(px(mx, mz), wall["id"], fill=WALL_TEXT)
        for opening in wall.get("openings", []):
            a = opening["offset"]
            b = a + opening["width"]
            colour = PASSING if opening["kind"] in TRAVERSABLE else FIXED
            for t in (a, b):
                p = px(x0 + ux * t, z0 + uz * t)
                draw.line([p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6], fill=colour, width=3)
            mid = px(x0 + ux * (a + b) / 2, z0 + uz * (a + b) / 2)
            draw.text(mid, opening["id"], fill=colour)

    img = img.convert("RGB")
    img.save(out)
    print("wrote", out, img.size)
    return img


def self_test():
    """Non-regression on a synthetic PDF and project: no real data."""
    from pathlib import Path
    from tempfile import mkdtemp

    doc = pymupdf.open()
    doc.new_page(width=842, height=595)
    project = {
        "levels": [
            {
                "id": "l",
                "rooms": [
                    {"id": "room", "name": "Room", "polygon": [[0.5, 0.3], [1.5, 0.3], [1.5, 1.5], [0.5, 1.5]]}
                ],
                "walls": [
                    {
                        "id": "wall",
                        "start": [0, 0],
                        "end": [2, 0],
                        "thickness": 0.2,
                        "openings": [{"id": "door", "kind": "door", "offset": 0.5, "width": 0.6}],
                    }
                ],
            }
        ]
    }
    folder = mkdtemp()
    pdf_path = str(Path(folder) / "self-test-page.pdf")
    png_path = str(Path(folder) / "self-test-page.png")
    doc.save(pdf_path)
    img = render(project, "l", pdf_path, 1, 100.0, 100.0, 56.69, png_path)
    colours = set(img.getdata())
    failures = []
    # Solid strokes are exact; the translucent fill is counted, not matched.
    for expected, name in (
        ((200, 90, 0), "the wall outline"),
        ((0, 170, 0), "the crossable opening mark"),
        ((0, 90, 255), "the room outline"),
    ):
        if expected not in colours:
            failures.append(name + " missing from the render")
    # (255,140,0,90) on white renders light orange pixels, not an exact colour.
    orange = sum(1 for r, g, b in colours if 245 <= r <= 255 and 205 <= g <= 225 and 155 <= b <= 175)
    if orange < 10:
        failures.append("the orange wall fill missing from the render")
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("page overlay: self-test passed")
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if "--self-test" in argv:
        return self_test()
    if len(argv) < 8:
        sys.exit(__doc__)
    project = json.loads(open(argv[0], encoding="utf-8-sig").read())
    clip = [float(v) for v in argv[8].split(",")] if len(argv) > 8 else None
    render(
        project,
        argv[1],
        argv[2],
        argv[3],
        float(argv[4]),
        float(argv[5]),
        float(argv[6]),
        argv[7],
        clip,
    )
    return 0


sys.exit(main())
