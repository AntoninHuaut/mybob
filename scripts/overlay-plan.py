"""Render a private source/model overlay from independently supplied pixel anchors.

Usage: python scripts/overlay-plan.py project.json calibration.json output.png
Calibration: {image, level, anchors: [{world:[x,z],pixel:[u,v]}], checks:[...]}
Pillow is required. Source rendering and anchor interpretation are deliberate inputs.
"""

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw


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


def main():
    project_path, calibration_path, output_path = map(Path, sys.argv[1:])
    project = json.loads(project_path.read_text(encoding="utf-8-sig"))
    config = json.loads(calibration_path.read_text(encoding="utf-8-sig"))
    anchors = config["anchors"]
    if len(anchors) < 3 or not config.get("checks"):
        raise ValueError("Supply at least three calibration anchors and independent checks")
    if not any(abs((b['world'][0]-a['world'][0])*(c['world'][1]-a['world'][1])-(b['world'][1]-a['world'][1])*(c['world'][0]-a['world'][0])) > 1e-8
               for a in anchors for b in anchors for c in anchors):
        raise ValueError("Calibration anchors must be non-collinear")
    sx, ox = fit([(a["world"][0], a["pixel"][0]) for a in anchors])
    sz, oz = fit([(a["world"][1], a["pixel"][1]) for a in anchors])

    def pixel(p):
        return ox + sx * p[0], oz + sz * p[1]

    image = Image.open(config["image"]).convert("RGBA")
    layer = Image.new("RGBA", image.size)
    draw = ImageDraw.Draw(layer)
    level = next(l for l in project["levels"] if l["id"] == config["level"])
    for room in level["rooms"]:
        points = [pixel(p) for p in room["polygon"]]
        draw.line(points + points[:1], fill=(0, 140, 255, 190), width=2)
    for wall in level["walls"]:
        a, b = wall["start"], wall["end"]
        length = math.dist(a, b)
        dx, dz = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        cursor = 0
        for opening in sorted(wall.get("openings", []), key=lambda o: o["offset"]) + [{"offset": length, "width": 0}]:
            end = opening["offset"]
            if end > cursor:
                half = wall["thickness"] / 2
                points = [pixel([a[0] + dx*t - dz*n, a[1] + dz*t + dx*n])
                          for t,n in [(cursor,-half),(end,-half),(end,half),(cursor,half)]]
                draw.polygon(points, fill=(255, 60, 10, 85), outline=(255, 40, 0, 180))
            if opening["width"]:
                for t in [end, end + opening["width"]]:
                    u,v = pixel([a[0] + dx*t, a[1] + dz*t])
                    draw.ellipse((u-4,v-4,u+4,v+4), fill=(0, 180, 50, 255))
            cursor = end + opening["width"]
    Image.alpha_composite(image, layer).convert("RGB").save(output_path)
    residuals = []
    for anchor in anchors + config["checks"]:
        u,v = pixel(anchor["world"])
        du,dv = u-anchor["pixel"][0], v-anchor["pixel"][1]
        residuals.append({**anchor, "residualPixels": math.hypot(du,dv), "residualMetres": math.hypot(du/sx,dv/sz)})
    output_path.with_suffix(".calibration.json").write_text(json.dumps({
        "scalePixelsPerMetre": [sx,sz], "originPixels": [ox,oz],
        "anchorsAndChecks": residuals,
        "note": "Anchor residuals only, not a certificate for all partitions and jambs. Orange: model wall footprint; blue: room boundaries; green: jambs."
    }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
