"""Mesure les bandes de murs d'un plan rendu, dans le repère du plan.

Sert à confronter un modèle au plan source sans passer par la géométrie du
modèle : on balaye le rendu et on lit les murs réels. Les deux traits d'une
cloison hachurée sont fusionnés, et les traits fins (cotes, lignes de pente)
sont écartés par un seuil d'épaisseur.

Usage :
  python scripts/measure_plan.py <image> <origine_x_px> <origine_z_px> <px_par_metre> \
      --z 1.0,2.0,3.0 --x 2.5,6.0 [--merge 0.26] [--min 0.05] [--max 0.55]

L'origine est le coin nord-ouest extérieur du plan dans l'image. `--z` balaye
des lignes horizontales (murs verticaux), `--x` des lignes verticales (murs
horizontaux). Tout est rendu en mètres.

Attention : une fenêtre interrompt le mur et fait apparaître le cadre à la place
de la face. Mesurer à plusieurs endroits avant de conclure sur une épaisseur.
"""
import argparse
import sys

from PIL import Image

THRESHOLD = 120


def raw_bands(pixels, fixed, lo, hi, vertical):
    runs, start = [], None
    for step in range(lo, hi):
        x, y = (fixed, step) if vertical else (step, fixed)
        dark = pixels[x, y] < THRESHOLD
        if dark and start is None:
            start = step
        elif not dark and start is not None:
            runs.append((start, step - 1))
            start = None
    if start is not None:
        runs.append((start, hi - 1))
    return runs


def walls(pixels, fixed, lo, hi, vertical, origin, scale, merge, low, high):
    merged = []
    for a, b in raw_bands(pixels, fixed, lo, hi, vertical):
        start, end = (a - origin) / scale, (b - origin) / scale
        if merged and start - merged[-1][1] <= merge:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return [(a, b) for a, b in merged if low <= b - a <= high]


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image")
    parser.add_argument("origin_x", type=float)
    parser.add_argument("origin_z", type=float)
    parser.add_argument("scale", type=float, help="pixels par mètre")
    parser.add_argument("--z", default="", help="altitudes à balayer horizontalement")
    parser.add_argument("--x", default="", help="abscisses à balayer verticalement")
    parser.add_argument("--merge", type=float, default=0.26)
    parser.add_argument("--min", type=float, default=0.05)
    parser.add_argument("--max", type=float, default=0.55)
    parser.add_argument("--span", type=float, default=12.6, help="largeur balayée, en mètres")
    parser.add_argument("--depth", type=float, default=8.7, help="hauteur balayée, en mètres")
    args = parser.parse_args(argv[1:])

    pixels = Image.open(args.image).convert("L").load()
    options = (args.merge, args.min, args.max)

    for z_m in [float(v) for v in args.z.split(",") if v]:
        py = int(args.origin_z + z_m * args.scale)
        found = walls(
            pixels, py, int(args.origin_x) - 20, int(args.origin_x + args.span * args.scale),
            False, args.origin_x, args.scale, *options,
        )
        print(f"z={z_m:5.2f} : " + "  ".join(f"{a:.2f}..{b:.2f}" for a, b in found))

    for x_m in [float(v) for v in args.x.split(",") if v]:
        px = int(args.origin_x + x_m * args.scale)
        found = walls(
            pixels, px, int(args.origin_z) - 20, int(args.origin_z + args.depth * args.scale),
            True, args.origin_z, args.scale, *options,
        )
        print(f"x={x_m:5.2f} : " + "  ".join(f"{a:.2f}..{b:.2f}" for a, b in found))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
