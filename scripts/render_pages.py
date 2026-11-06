"""Rend les pages d'un PDF de plans en PNG individuels + planches-contact.

Usage : uvx --from pymupdf python render_pages.py <pdf> <dossier-sortie> [dpi]
Produit : <dossier>-NN.png par page et <dossier>-plate-N.png (4 pages par planche).
"""
import sys, glob
import pymupdf

pdf, outdir = sys.argv[1], sys.argv[2]
dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 140
prefix = pdf.split("/")[-1]

import os
os.makedirs(outdir, exist_ok=True)
doc = pymupdf.open(pdf)
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=dpi)
    pix.save(f"{outdir}/{prefix}-{i+1:02d}.png")
    print(f"{outdir}/{prefix}-{i+1:02d}.png", pix.width, "x", pix.height)

# planches-contact (4 pages par planche, étiquettes rouges)
from PIL import Image, ImageDraw
files = sorted(glob.glob(f"{outdir}/{prefix}-*.png"))
W = 900
sheets = [files[g:g+4] for g in range(0, len(files), 4)]
for n, group in enumerate(sheets):
    thumbs = []
    for f in group:
        im = Image.open(f)
        r = W / im.width
        thumbs.append(im.resize((W, int(im.height * r))))
    h = max(t.height for t in thumbs)
    canvas = Image.new("RGB", (2 * (W + 10), ((len(thumbs) + 1) // 2) * (h + 30)), "white")
    d = ImageDraw.Draw(canvas)
    for k, (t, f) in enumerate(zip(thumbs, group)):
        x, y = (k % 2) * (W + 10), (k // 2) * (h + 30)
        d.text((x + 4, y + 4), f.split("/")[-1], fill="red")
        canvas.paste(t, (x, y + 28))
    canvas.save(f"{outdir}/{prefix}-plate-{n+1}.png")
    print(f"{outdir}/{prefix}-plate-{n+1}.png", canvas.size)
