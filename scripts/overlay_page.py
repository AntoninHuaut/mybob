"""Dessine les murs et pièces du projet par-dessus une page PDF rendue.

Le calque de référence : les murs du modèle en orange translucide, les pièces
en bleu, les baies marquées en vert (franchissables) ou bleu (fenêtres), chaque
identifiant écrit à sa place. Une bande hachurée sans orange est un mur du
dessin absent du modèle ; un rectangle orange sans hachure est un mur inventé —
c'est la porte qui voit ce qu'aucune surface ni aucun audit ne voient.

Le repère `(ox, oy, échelle)` donne le point affiché de la page tournée :
point affiché = (ox + échelle * x, oy + échelle * z).

Usage :
  python scripts/overlay_page.py <projet.json> <niveau> <pdf> <page> <ox> <oy> <echelle> <sortie.png> [clip]
  <page> : comptée à partir de 1, comme les autres scripts du dépôt.
  <clip> : x0,y0,x1,y1 en points affichés, facultatif (toute la page sinon).
"""

import json
import sys

import pymupdf
from PIL import Image, ImageDraw

TRAVERSABLE = {"door", "sliding", "garage"}


def page_identity(page):
    """Premiers mots et titres en capitales — la page se repère par son texte."""
    words = page.get_text().split()
    head = " ".join(words[:6])
    caps = [w for w in words if len(w) > 2 and w.isupper()][:6]
    return f"{head} — {', '.join(caps)}"


def main():
    if len(sys.argv) < 9:
        sys.exit(__doc__)
    project_path, level_id, pdf_path, page_number, ox, oy, scale, out = sys.argv[1:9]
    ox, oy, scale = float(ox), float(oy), float(scale)
    clip = [float(v) for v in sys.argv[9].split(",")] if len(sys.argv) > 9 else None

    project = json.loads(open(project_path, encoding="utf-8-sig").read())
    level = next((lv for lv in project["levels"] if lv["id"] == level_id), None)
    if level is None:
        sys.exit(f"niveau {level_id!r} inconnu : {', '.join(lv['id'] for lv in project['levels'])}")

    doc = pymupdf.open(pdf_path)
    index = int(page_number) - 1
    if not 0 <= index < doc.page_count:
        sys.exit(f"page {page_number} inexistante : le document en a {doc.page_count}")
    page = doc[index]
    title = page_identity(page)
    print(f"page {page_number} : {title}")

    dpi = 400
    zoom = dpi / 72
    rect = pymupdf.Rect(*clip) if clip else page.rect
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("RGBA")
    draw = ImageDraw.Draw(img, "RGBA")

    def px(x, z):
        return ((ox + scale * x - rect.x0) * zoom, (oy + scale * z - rect.y0) * zoom)

    for room in level["rooms"]:
        pts = [px(*p) for p in room["polygon"]]
        draw.polygon(pts, outline=(0, 90, 255, 255))
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        draw.text((cx, cy), room["id"], fill=(0, 60, 200, 255))

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
        draw.polygon(
            [px(*c) for c in corners],
            fill=(255, 140, 0, 90),
            outline=(200, 90, 0, 255),
        )
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        draw.text(px(mx, mz), wall["id"], fill=(150, 60, 0, 255))
        for opening in wall.get("openings", []):
            a = opening["offset"]
            b = a + opening["width"]
            colour = (0, 170, 0, 255) if opening["kind"] in TRAVERSABLE else (0, 120, 255, 255)
            for t in (a, b):
                p = px(x0 + ux * t, z0 + uz * t)
                draw.line([p[0] - 6, p[1] - 6, p[0] + 6, p[1] + 6], fill=colour, width=3)
            mid = px(x0 + ux * (a + b) / 2, z0 + uz * (a + b) / 2)
            draw.text(mid, opening["id"], fill=colour)

    img.convert("RGB").save(out)
    print("wrote", out, img.size)


main()
