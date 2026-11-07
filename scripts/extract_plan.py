"""Couche 0 : géométrie d'un plan vectoriel, lue sur le dessin.

Le plan est dessiné à l'échelle : les coordonnées du PDF sont exactes au
millimètre. On lit donc les murs **sur le dessin**, et les cotes imprimées
servent d'arbitre, pas de source.

Un plan de ce constructeur dessine les murs de deux façons :

- les **cloisons** sont des rectangles remplis d'une couleur d'aplat propre au
  CAO. C'est un marqueur sémantique : le rectangle donne l'épaisseur et les
  abouts exacts, sans ambiguïté avec les lignes de cote ;
- les **murs extérieurs** sont des bandes hachurées entre deux faces, non
  remplies. Leur position vient des chaînes de cotes refermées, qui la donnent
  au millimètre.

La couleur d'aplat des cloisons n'est pas codée en dur : c'est le remplissage
non blanc et non noir le plus fréquent de la page. Un autre constructeur aura
une autre couleur, la règle tient.

Usage :
  uvx --from pymupdf python scripts/extract_plan.py <pdf> <page> <sortie.json> \
      [--denominator 75] [--scale 37.7953]
"""
import argparse
import collections
import json
import sys
import tempfile
from pathlib import Path

import pymupdf

MIN_THICKNESS = 0.04  # m, en dessous ce n'est pas un mur
MAX_THICKNESS = 0.45  # m, au-dessus ce n'est pas un mur
MIN_LENGTH = 0.40  # m, en dessous ce n'est pas un mur
WHITE = 0.95  # luminance au-dessus de laquelle un aplat est un fond
BLACK = 0.05  # luminance en dessous de laquelle un aplat est un trait


def display_transform(page):
    """Coordonnées ramenées au repère affiché (cf. /Rotate)."""
    box, rotation = page.mediabox, page.rotation
    if rotation == 90:
        return lambda x, y: (box.height - y, x)
    if rotation == 270:
        return lambda x, y: (y, box.width - x)
    return lambda x, y: (x, y)


def luminance(colour):
    return sum(colour) / len(colour)


def filled_shapes(page):
    """Rectangles remplis de la page : couleur, largeur, hauteur, coin, en points."""
    to_point = display_transform(page)
    shapes = []
    for drawing in page.get_drawings():
        fill = drawing.get("fill")
        if fill is None:
            continue
        xs, ys = [], []
        for item in drawing["items"]:
            if item[0] == "l":
                for point in (item[1], item[2]):
                    x, y = to_point(point.x, point.y)
                    xs.append(x)
                    ys.append(y)
            elif item[0] == "re":
                rect = item[1]
                for point in ((rect.x0, rect.y0), (rect.x1, rect.y1)):
                    x, y = to_point(*point)
                    xs.append(x)
                    ys.append(y)
        if not xs:
            continue
        shapes.append(
            {
                "fill": tuple(round(channel, 3) for channel in fill),
                "luminance": round(luminance(fill), 3),
                "x0": min(xs),
                "x1": max(xs),
                "y0": min(ys),
                "y1": max(ys),
            }
        )
    return shapes


def wall_colour(shapes):
    """Aplat des cloisons : le remplissage ni blanc ni noir le plus fréquent."""
    counts = collections.Counter(
        shape["fill"] for shape in shapes if BLACK < shape["luminance"] < WHITE
    )
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def partitions(shapes, colour, scale, envelope):
    """Cloisons : rectangles fins remplis de la couleur de mur, dans l'emprise.

    Le cartouche et la légende utilisent parfois le même aplat que les murs :
    l'emprise du niveau, donnée par les cotes refermées, les écarte.
    """
    x0, y0, x1, y1 = envelope
    found = []
    for shape in shapes:
        if shape["fill"] != colour:
            continue
        if not (x0 <= shape["x0"] and shape["x1"] <= x1):
            continue
        if not (y0 <= shape["y0"] and shape["y1"] <= y1):
            continue
        width = (shape["x1"] - shape["x0"]) / scale
        height = (shape["y1"] - shape["y0"]) / scale
        thin, long = min(width, height), max(width, height)
        if not MIN_THICKNESS <= thin <= MAX_THICKNESS:
            continue
        if long < MIN_LENGTH:
            continue
        found.append(
            {
                "axis": "horizontal" if width >= height else "vertical",
                "low": round(shape["y0"] if width >= height else shape["x0"], 3),
                "high": round(shape["y1"] if width >= height else shape["x1"], 3),
                "from": round(shape["x0"] if width >= height else shape["y0"], 3),
                "to": round(shape["x1"] if width >= height else shape["y1"], 3),
                "thickness": round(thin, 4),
                "source": "fill",
            }
        )
    found.sort(key=lambda wall: (wall["axis"], wall["low"], wall["from"]))
    for index, wall in enumerate(found):
        wall["id"] = f"p{index + 1}"
    return found


def build(pdf, page_index, scale, envelope):
    document = pymupdf.open(pdf)
    page = document[page_index - 1]
    shapes = filled_shapes(page)
    colour = wall_colour(shapes)
    walls = partitions(shapes, colour, scale, envelope) if colour else []
    for wall in walls:
        # Le long de l'axe d'un mur horizontal c'est x, pour un vertical c'est z.
        along, across = (0, 1) if wall["axis"] == "horizontal" else (1, 0)
        wall["from"] = round((wall["from"] - envelope[along]) / scale, 4)
        wall["to"] = round((wall["to"] - envelope[along]) / scale, 4)
        wall["low"] = round((wall["low"] - envelope[across]) / scale, 4)
        wall["high"] = round((wall["high"] - envelope[across]) / scale, 4)
    return {
        "schemaVersion": 1,
        "source": {"file": pdf.replace("\\", "/").split("/")[-1], "page": page_index},
        "rotation": page.rotation,
        "scale": {"pointsPerMetre": round(scale, 4)},
        "envelope": [
            round((envelope[2] - envelope[0]) / scale, 4),
            round((envelope[3] - envelope[1]) / scale, 4),
        ],
        "wallFill": list(colour) if colour else None,
        "walls": walls,
    }


def self_test():
    """Non-régression sur un PDF synthétique : aucune donnée réelle."""
    scale = 2834.6457 / 75
    document = pymupdf.open()
    page = document.new_page(width=842, height=595)
    wall = (0.609, 0.555, 0.555)
    origin = (100.0, 100.0)
    # Une cloison horizontale de 4 m x 0,10 m et une verticale de 2 m x 0,07 m.
    page.draw_rect(
        pymupdf.Rect(origin[0], origin[1], origin[0] + 4 * scale, origin[1] + 0.10 * scale),
        color=None,
        fill=wall,
    )
    page.draw_rect(
        pymupdf.Rect(
            origin[0] + 1 * scale,
            origin[1] + 1 * scale,
            origin[0] + 1.07 * scale,
            origin[1] + 3 * scale,
        ),
        color=None,
        fill=wall,
    )
    # Un aplat de cartouche, hors emprise, avec la même couleur.
    page.draw_rect(
        pymupdf.Rect(600, 20, 600 + 2 * scale, 20 + 0.10 * scale), color=None, fill=wall
    )
    path = str(Path(tempfile.mkdtemp()) / "self-test-plan.pdf")
    document.save(path)
    envelope = (origin[0], origin[1], origin[0] + 6 * scale, origin[1] + 5 * scale)
    result = build(path, 1, scale, envelope)
    failures = []
    if result["wallFill"] != [round(channel, 3) for channel in wall]:
        failures.append(f"aplat de mur {result['wallFill']}")
    if len(result["walls"]) != 2:
        failures.append(f"{len(result['walls'])} cloisons au lieu de 2 (cartouche non écarté ?)")
    else:
        horizontal, vertical = result["walls"]
        if horizontal["axis"] != "horizontal" or abs(horizontal["thickness"] - 0.10) > 0.01:
            failures.append(f"cloison horizontale {horizontal}")
        if abs(horizontal["from"]) > 0.01 or abs(horizontal["to"] - 4) > 0.01:
            failures.append(f"emprise horizontale {horizontal['from']}..{horizontal['to']}")
        if vertical["axis"] != "vertical" or abs(vertical["thickness"] - 0.07) > 0.01:
            failures.append(f"cloison verticale {vertical}")
        if abs(vertical["from"] - 1) > 0.01 or abs(vertical["to"] - 3) > 0.01:
            failures.append(f"emprise verticale {vertical['from']}..{vertical['to']}")
    if failures:
        for failure in failures:
            print(f"ECHEC {failure}")
        return 1
    print("extraction de plan : auto-test réussi")
    return 0


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("page", type=int)
    parser.add_argument("out")
    parser.add_argument("--denominator", type=float, default=None)
    parser.add_argument("--scale", type=float, default=None)
    parser.add_argument(
        "--envelope",
        required=True,
        help="x0,y0,x1,y1 en points : coin nord-ouest et coin sud-est du niveau",
    )
    if "--self-test" in argv:
        return self_test()
    args = parser.parse_args(argv[1:])
    scale = args.scale
    if scale is None:
        if args.denominator is None:
            parser.error(
                "indiquer --scale (points par mètre, déduit des chaînes de cotes) "
                "ou --denominator (ratio du cartouche, à vérifier)"
            )
        scale = 2834.6457 / args.denominator
        print(
            "attention : --denominator est le ratio du cartouche, une affirmation "
            "sur la feuille imprimée d'origine. Préférer --scale, déduit des chaînes "
            "de cotes, et vérifier avec check_plan_surfaces.py.",
            file=sys.stderr,
        )
    envelope = tuple(float(value) for value in args.envelope.split(","))
    if len(envelope) != 4:
        parser.error("--envelope attend x0,y0,x1,y1")
    result = build(args.pdf, args.page, scale, envelope)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    print(f"aplat de mur {result['wallFill']} : {len(result['walls'])} cloisons -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
