"""Rend une page d'un PDF de plans avec une grille en mètres.

Pour lire une cote ou une épaisseur contre le modèle : le rendu porte des
lignes verticales rouges chaque `pasout` mètres en x, horizontales bleues en z,
étiquetées par leur valeur. Le repère `(ox, oy, échelle)` donne le point
affiché de la page tournée : point affiché = (ox + échelle * x, oy + échelle * z).
Il se déduit des chaînes de cotes de la page — voir le skill mybob-plan-conversion.

Usage :
  python scripts/grid_page.py <pdf> <page> <ox> <oy> <echelle> <sortie.png> <x0,z0,x1,z1> [pas] [dpi]
  <page> : comptée à partir de 1, comme les autres scripts du dépôt.
"""

import sys

import pymupdf
from PIL import Image, ImageDraw


def page_identity(page):
    """Premiers mots et titres en capitales — la page se repère par son texte."""
    words = page.get_text().split()
    head = " ".join(words[:6])
    caps = [w for w in words if len(w) > 2 and w.isupper()][:6]
    return f"{head} — {', '.join(caps)}"


def main():
    if len(sys.argv) < 8:
        sys.exit(__doc__)
    pdf_path, page_number, ox, oy, scale, out, box = sys.argv[1:8]
    ox, oy, scale = float(ox), float(oy), float(scale)
    x0, z0, x1, z1 = [float(v) for v in box.split(",")]
    step = float(sys.argv[8]) if len(sys.argv) > 8 else 0.5
    dpi = float(sys.argv[9]) if len(sys.argv) > 9 else 400
    zoom = dpi / 72

    doc = pymupdf.open(pdf_path)
    index = int(page_number) - 1
    if not 0 <= index < doc.page_count:
        sys.exit(f"page {page_number} inexistante : le document en a {doc.page_count}")
    page = doc[index]
    title = page_identity(page)
    print(f"page {page_number} : {title}")

    rect = pymupdf.Rect(ox + scale * x0, oy + scale * z0, ox + scale * x1, oy + scale * z1)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).convert("RGBA")
    draw = ImageDraw.Draw(img, "RGBA")

    def px(x, z):
        return ((ox + scale * x - rect.x0) * zoom, (oy + scale * z - rect.y0) * zoom)

    n = int(round((x1 - x0) / step))
    for i in range(n + 1):
        x = x0 + i * step
        p, q = px(x, z0), px(x, z1)
        draw.line([p, q], fill=(255, 0, 0, 70), width=1)
        draw.text((p[0] + 2, 2), f"{x:g}", fill=(200, 0, 0, 255))
    m = int(round((z1 - z0) / step))
    for i in range(m + 1):
        z = z0 + i * step
        p, q = px(x0, z), px(x1, z)
        draw.line([p, q], fill=(0, 0, 255, 70), width=1)
        draw.text((2, p[1] + 1), f"{z:g}", fill=(0, 0, 200, 255))

    img.convert("RGB").save(out)
    print("wrote", out, img.size)


main()
