"""Rend une page d'un PDF de plans avec une grille en mètres.

Pour lire une cote ou une épaisseur contre le modèle : le rendu porte des
lignes verticales rouges chaque `pas` mètres en x, horizontales bleues en z,
étiquetées par leur valeur. Le repère `(ox, oy, échelle)` donne le point
affiché de la page tournée : point affiché = (ox + échelle * x, oy + échelle * z).
Il se déduit des chaînes de cotes de la page — voir le skill mybob-plan-conversion.

Usage :
  python scripts/grid_page.py <pdf> <page> <ox> <oy> <echelle> <sortie.png> <x0,z0,x1,z1> [pas] [dpi]
  <page> : comptée à partir de 1, comme les autres scripts du dépôt.
  python scripts/grid_page.py --self-test
"""

import sys

import pymupdf
from PIL import Image, ImageDraw

RED = (255, 0, 0, 70)
BLUE = (0, 0, 255, 70)


def page_identity(page):
    """Premiers mots et titres en capitales — la page se repère par son texte."""
    words = page.get_text().split()
    head = " ".join(words[:6])
    caps = [w for w in words if len(w) > 2 and w.isupper()][:6]
    return f"{head} — {', '.join(caps)}"


def render(pdf_path, page_number, ox, oy, scale, out, box, step, dpi):
    x0, z0, x1, z1 = [float(v) for v in box.split(",")]
    step, dpi = float(step), float(dpi)
    doc = pymupdf.open(pdf_path)
    index = int(page_number) - 1
    if not 0 <= index < doc.page_count:
        sys.exit(f"page {page_number} inexistante : le document en a {doc.page_count}")
    page = doc[index]
    print(f"page {page_number} : {page_identity(page)}")

    zoom = dpi / 72
    rect = pymupdf.Rect(
        ox + scale * x0, oy + scale * z0, ox + scale * x1, oy + scale * z1
    )
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect)
    # Base en RGB : un Draw(img, "RGBA") sur une base RGBA écraserait les
    # pixels au lieu de blonder, et les alphas ne serviraient à rien.
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    draw = ImageDraw.Draw(img, "RGBA")

    def px(x, z):
        return ((ox + scale * x - rect.x0) * zoom, (oy + scale * z - rect.y0) * zoom)

    n = int(round((x1 - x0) / step))
    for i in range(n + 1):
        x = x0 + i * step
        p, q = px(x, z0), px(x, z1)
        draw.line([p, q], fill=RED, width=1)
        draw.text((p[0] + 2, 2), f"{x:g}", fill=(200, 0, 0, 255))
    m = int(round((z1 - z0) / step))
    for i in range(m + 1):
        z = z0 + i * step
        p, q = px(x0, z), px(x1, z)
        draw.line([p, q], fill=BLUE, width=1)
        draw.text((2, p[1] + 1), f"{z:g}", fill=(0, 0, 200, 255))

    img = img.convert("RGB")
    img.save(out)
    print("wrote", out, img.size)
    return img


def self_test():
    """Non-régression sur un PDF synthétique : aucune donnée réelle."""
    from pathlib import Path
    from tempfile import mkdtemp

    doc = pymupdf.open()
    doc.new_page(width=842, height=595)
    folder = mkdtemp()
    pdf_path = str(Path(folder) / "self-test-page.pdf")
    png_path = str(Path(folder) / "self-test-page.png")
    doc.save(pdf_path)
    img = render(pdf_path, 1, 100.0, 100.0, 56.69, png_path, "0,0,3,2", 1, 144)
    colours = set(img.getdata())
    failures = []
    if abs(img.width - int(3 * 56.69 * 2)) > 1 or abs(img.height - int(2 * 56.69 * 2)) > 1:
        failures.append(f"taille {img.size}")
    # Les lignes de grille translucides sur une page blanche rendent ces composés,
    # dans la marge près d'un point : (255,0,0,70) et (0,0,255,70) sur du blanc.
    red_line = any(r > 240 and 160 < g < 210 and 160 < b < 210 for r, g, b in colours)
    blue_line = any(160 < r < 210 and 160 < g < 210 and b > 240 for r, g, b in colours)
    if not red_line:
        failures.append("aucune ligne de grille verticale (rouge)")
    if not blue_line:
        failures.append("aucune ligne de grille horizontale (bleue)")
    if failures:
        for failure in failures:
            print(f"ECHEC {failure}")
        return 1
    print("grille de page : auto-test réussi")
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if "--self-test" in argv:
        return self_test()
    if len(argv) < 7:
        sys.exit(__doc__)
    render(
        argv[0],
        argv[1],
        float(argv[2]),
        float(argv[3]),
        float(argv[4]),
        argv[5],
        argv[6],
        argv[7] if len(argv) > 7 else 0.5,
        argv[8] if len(argv) > 8 else 400,
    )
    return 0


sys.exit(main())
