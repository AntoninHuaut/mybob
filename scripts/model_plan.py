"""Rend un niveau du projet en vue de dessus, depuis le JSON seul.

Pour lire ce que le modèle dit sans le dessin : les pièces en beige, les murs
en gris plein, les baies franchissables découpées, les fenêtres en bleu. Le
rendu est exact et ne dépend d'aucune calibration — c'est le pendant de
`overlay_page.py`, qui superpose le modèle à la planche du plan.

Usage :
  python scripts/model_plan.py <projet.json> <niveau> <sortie.png> <x0,z0,x1,z1> [px_par_m]
"""

import json
import sys

from PIL import Image, ImageDraw

TRAVERSABLE = {"door", "sliding", "garage"}


def main():
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    project_path, level_id, out, box = sys.argv[1:5]
    x0, z0, x1, z1 = [float(v) for v in box.split(",")]
    ppm = float(sys.argv[5]) if len(sys.argv) > 5 else 200

    project = json.loads(open(project_path, encoding="utf-8-sig").read())
    level = next((lv for lv in project["levels"] if lv["id"] == level_id), None)
    if level is None:
        sys.exit(f"niveau {level_id!r} inconnu : {', '.join(lv['id'] for lv in project['levels'])}")

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
        draw.polygon(pts, fill=(232, 222, 205, 255), outline=(120, 120, 120, 255))
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
            draw.polygon([px(*c) for c in corners], fill=(150, 150, 150, 255))
        for opening in wall.get("openings", []):
            if opening["kind"] in TRAVERSABLE:
                continue
            a, b = opening["offset"], opening["offset"] + opening["width"]
            p, q = px(ax + ux * a, az + uz * a), px(ax + ux * b, az + uz * b)
            draw.line([p, q], fill=(60, 120, 220, 255), width=3)
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        draw.text(px(mx, mz), wall["id"], fill=(90, 20, 20, 255))

    img.save(out)
    print("wrote", out, img.size)


main()
