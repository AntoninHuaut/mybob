"""Render a private source/model overlay from independently supplied pixel anchors.

Usage: python scripts/overlay-plan.py project.json calibration.json output.png
Calibration: {image, level, anchors: [{world:[x,z],pixel:[u,v]}], checks:[...]}
Pillow is required. Source rendering and anchor interpretation are deliberate inputs.

The overlay draws wall footprints (orange), room contours (blue), floor-level
traversable openings (green ticks), windows and other raised openings (blue
ticks), room and wall identifiers, a legend and a one-metre scale bar. Only
floor-level traversable openings are cut out of the wall footprint: a window is
still a wall at floor level, so cutting it would hide a real defect.
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

TRAVERSABLE = {"door", "sliding", "garage"}


def fit(pairs):
    mean_x = sum(x for x, _ in pairs) / len(pairs)
    mean_y = sum(y for _, y in pairs) / len(pairs)
    denominator = sum((x - mean_x) ** 2 for x, _ in pairs)
    if denominator < 1e-12:
        raise ValueError("Calibration must span both world axes")
    scale = sum((x - mean_x) * (y - mean_y) for x, y in pairs) / denominator
    if scale <= 0:
        raise ValueError("Source must be oriented x right and z down before calibration")
    return scale, mean_y - scale * mean_x


def centroid(points):
    area = 0.0
    cx = cz = 0.0
    for i, a in enumerate(points):
        b = points[(i + 1) % len(points)]
        cross = a[0] * b[1] - b[0] * a[1]
        area += cross
        cx += (a[0] + b[0]) * cross
        cz += (a[1] + b[1]) * cross
    if abs(area) < 1e-12:
        return points[0]
    return cx / (3 * area), cz / (3 * area)


def main():
    project_path, calibration_path, output_path = map(Path, sys.argv[1:])
    project = json.loads(project_path.read_text(encoding="utf-8-sig"))
    config = json.loads(calibration_path.read_text(encoding="utf-8-sig"))
    anchors = config["anchors"]
    if len(anchors) < 3 or not config.get("checks"):
        raise ValueError("Supply at least three calibration anchors and independent checks")
    if not any(
        abs(
            (b["world"][0] - a["world"][0]) * (c["world"][1] - a["world"][1])
            - (b["world"][1] - a["world"][1]) * (c["world"][0] - a["world"][0])
        )
        > 1e-8
        for a in anchors
        for b in anchors
        for c in anchors
    ):
        raise ValueError("Calibration anchors must be non-collinear")
    sx, ox = fit([(a["world"][0], a["pixel"][0]) for a in anchors])
    sz, oz = fit([(a["world"][1], a["pixel"][1]) for a in anchors])

    def pixel(p):
        return ox + sx * p[0], oz + sz * p[1]

    image = Image.open(config["image"]).convert("RGBA")
    for anchor in anchors + config["checks"]:
        u, v = anchor["pixel"]
        if not (0 <= u < image.width and 0 <= v < image.height):
            raise ValueError(f"Anchor pixel outside the source image: {anchor}")
    layer = Image.new("RGBA", image.size)
    draw = ImageDraw.Draw(layer)
    level = next(l for l in project["levels"] if l["id"] == config["level"])
    for room in level["rooms"]:
        points = [pixel(p) for p in room["polygon"]]
        draw.line(points + points[:1], fill=(0, 140, 255, 190), width=2)
        u, v = pixel(centroid(room["polygon"]))
        draw.text((u + 3, v - 3), room["id"], fill=(0, 90, 200, 255))
    for wall in level["walls"]:
        a, b = wall["start"], wall["end"]
        length = math.dist(a, b)
        dx, dz = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        cursor = 0
        openings = sorted(wall.get("openings", []), key=lambda o: o["offset"])
        for opening in openings + [{"offset": length, "width": 0}]:
            end = opening["offset"]
            if end > cursor:
                half = wall["thickness"] / 2
                points = [
                    pixel([a[0] + dx * t - dz * n, a[1] + dz * t + dx * n])
                    for t, n in [(cursor, -half), (end, -half), (end, half), (cursor, half)]
                ]
                draw.polygon(points, fill=(255, 60, 10, 85), outline=(255, 40, 0, 180))
            if opening["width"]:
                floor_level = (opening.get("sill") or 0) == 0
                traversable = opening.get("kind") in TRAVERSABLE and floor_level
                colour = (0, 180, 50, 255) if traversable else (0, 90, 220, 255)
                for t in [end, end + opening["width"]]:
                    u, v = pixel([a[0] + dx * t, a[1] + dz * t])
                    draw.ellipse((u - 4, v - 4, u + 4, v + 4), fill=colour)
                if not traversable:
                    u0, v0 = pixel([a[0] + dx * end, a[1] + dz * end])
                    u1, v1 = pixel([a[0] + dx * (end + opening["width"]), a[1] + dz * (end + opening["width"])])
                    draw.line((u0, v0, u1, v1), fill=colour, width=2)
            cursor = end + opening["width"]
        u, v = pixel([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
        draw.text((u + 2, v + 2), wall["id"], fill=(150, 30, 0, 255))
    # Legend and one-metre scale bar, in the top-left corner of the source image.
    draw.rectangle((8, 8, 250, 74), fill=(255, 255, 255, 220), outline=(0, 0, 0, 255))
    draw.text((14, 12), "orange: wall footprint", fill=(255, 40, 0, 255))
    draw.text((14, 26), "blue: room contour / raised opening", fill=(0, 90, 220, 255))
    draw.text((14, 40), "green: floor-level passage", fill=(0, 150, 40, 255))
    draw.line((14, 62, 14 + sx, 62), fill=(0, 0, 0, 255), width=3)
    draw.text((14 + sx + 6, 56), "1 m", fill=(0, 0, 0, 255))
    Image.alpha_composite(image, layer).convert("RGB").save(output_path)
    residuals = []
    for anchor in anchors + config["checks"]:
        u, v = pixel(anchor["world"])
        du, dv = u - anchor["pixel"][0], v - anchor["pixel"][1]
        residuals.append(
            {
                **anchor,
                "residualPixels": math.hypot(du, dv),
                "residualMetres": math.hypot(du / sx, dv / sz),
            }
        )
    anisotropy = abs(sx / sz - 1)
    report = {
        "scalePixelsPerMetre": [sx, sz],
        "originPixels": [ox, oz],
        "anisotropy": anisotropy,
        "warnings": (
            ["X/Z scales differ by more than 2 %: check for a skewed or non-square scan"]
            if anisotropy > 0.02
            else []
        ),
        "anchorsAndChecks": residuals,
        "note": (
            "Anchor residuals only, not a certificate for all partitions and jambs. "
            "Orange: model wall footprint; blue: room boundaries and raised openings; "
            "green: floor-level passages. Only floor-level traversable openings are cut "
            "out of the wall footprint."
        ),
    }
    output_path.with_suffix(".calibration.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
