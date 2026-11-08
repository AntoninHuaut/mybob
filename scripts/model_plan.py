"""Renders a project level as a top view, from the JSON alone.

To read what the model says without the drawing: rooms in beige, walls in
solid grey, crossable openings cut out, windows in blue. The rendering is
exact and depends on no calibration — it is the counterpart of
`overlay_page.py`, which overlays the model on the plan sheet.

Usage:
  python scripts/model_plan.py <project.json> <level> <output.png> <x0,z0,x1,z1> [px_per_m]
  python scripts/model_plan.py --self-test
"""

import json
import sys

from PIL import Image, ImageDraw

TRAVERSABLE = {"door", "sliding", "garage"}
ROOM_COLOUR = (232, 222, 205, 255)
WALL_COLOUR = (150, 150, 150, 255)
WINDOW_COLOUR = (60, 120, 220, 255)


def render(project, level_id, out, box, ppm):
    x0, z0, x1, z1 = [float(v) for v in box.split(",")]
    ppm = float(ppm)
    level = next((lv for lv in project["levels"] if lv["id"] == level_id), None)
    if level is None:
        sys.exit(
            f"niveau {level_id!r} inconnu : " + ", ".join(lv["id"] for lv in project["levels"])
        )
    width = int(round((x1 - x0) * ppm))
    height = int(round((z1 - z0) * ppm))
    if width < 1 or height < 1:
        sys.exit(f"cadre vide : {box}")
    img = Image.new("RGB", (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(img, "RGBA")

    def px(x, z):
        return ((x - x0) * ppm, (z - z0) * ppm)

    for room in level["rooms"]:
        pts = [px(*p) for p in room["polygon"]]
        draw.polygon(pts, fill=ROOM_COLOUR, outline=(120, 120, 120, 255))
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        draw.text((cx - 20, cy - 4), room["id"], fill=(20, 20, 20, 255))

    for wall in level["walls"]:
        (ax, az), (bx, bz) = wall["start"], wall["end"]
        dx, dz = bx - ax, bz - az
        length = (dx * dx + dz * dz) ** 0.5
        if length == 0:
            continue
        ux, uz = dx / length, dz / length
        nx, nz = -uz, ux
        half = wall["thickness"] / 2
        cuts = sorted(
            (o["offset"], o["offset"] + o["width"])
            for o in wall.get("openings", [])
            if o["kind"] in TRAVERSABLE
        )
        spans, cursor = [], 0.0
        for a, b in cuts:
            if a > cursor:
                spans.append((cursor, a))
            cursor = max(cursor, b)
        if cursor < length:
            spans.append((cursor, length))
        for a, b in spans:
            corners = [
                (ax + ux * a + nx * half, az + uz * a + nz * half),
                (ax + ux * b + nx * half, az + uz * b + nz * half),
                (ax + ux * b - nx * half, az + uz * b - nz * half),
                (ax + ux * a - nx * half, az + uz * a - nz * half),
            ]
            draw.polygon([px(*c) for c in corners], fill=WALL_COLOUR)
        for opening in wall.get("openings", []):
            if opening["kind"] in TRAVERSABLE:
                continue
            a, b = opening["offset"], opening["offset"] + opening["width"]
            p, q = px(ax + ux * a, az + uz * a), px(ax + ux * b, az + uz * b)
            draw.line([p, q], fill=WINDOW_COLOUR, width=3)
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        draw.text(px(mx, mz), wall["id"], fill=(90, 20, 20, 255))

    img.save(out)
    print("wrote", out, img.size)
    return img


def self_test():
    """Non-regression on a synthetic project: no real data."""
    from tempfile import NamedTemporaryFile

    project = {
        "levels": [
            {
                "id": "l",
                "rooms": [
                    {"id": "room", "name": "Room", "polygon": [[0, 0], [2, 0], [2, 2], [0, 2]]}
                ],
                "walls": [
                    {
                        "id": "wall",
                        "start": [2, 0],
                        "end": [2, 2],
                        "thickness": 0.1,
                        "openings": [
                            {"id": "door", "kind": "door", "offset": 0.5, "width": 0.6},
                            {"id": "win", "kind": "window", "offset": 1.4, "width": 0.4},
                        ],
                    }
                ],
            }
        ]
    }
    with NamedTemporaryFile(suffix=".png", delete=False) as handle:
        out = handle.name
    img = render(project, "l", out, "0,0,3,2", 100)
    colours = set(img.getdata())
    failures = []
    if img.size != (300, 200):
        failures.append(f"taille {img.size}")
    for expected, name in (
        ((232, 222, 205), "the room fill"),
        ((150, 150, 150), "the solid wall"),
        ((60, 120, 220), "the non-crossable opening"),
        ((255, 255, 255), "the background outside rooms"),
    ):
        if expected not in colours:
            failures.append(name + " missing from the render")
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("level render: self-test passed")
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if "--self-test" in argv:
        return self_test()
    if len(argv) < 4:
        sys.exit(__doc__)
    project = json.loads(open(argv[0], encoding="utf-8-sig").read())
    ppm = argv[4] if len(argv) > 4 else 200
    render(project, argv[1], argv[2], argv[3], ppm)
    return 0


sys.exit(main())
