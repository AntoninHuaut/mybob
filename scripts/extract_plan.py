"""Layer 0: geometry of a vector plan, read on the drawing.

The plan is drawn to scale: the PDF coordinates are exact to the millimetre.
Walls are therefore read **on the drawing**, and the printed dimensions act as
the arbiter, not the source.

A plan from this builder draws walls in two ways:

- **partitions** are rectangles filled with a fill colour specific to the CAD
  tool. It is a semantic marker: the rectangle gives the exact thickness and
  ends, with no ambiguity with dimension lines;
- **exterior walls** are hatched bands between two faces, unfilled. Their
  position comes from the closed dimension chains, which give it to the
  millimetre.

The partitions' fill colour is not hardcoded: it is the most frequent
non-white, non-black fill of the page. Another builder will have another
colour, the rule holds.

Usage:
  uvx --from pymupdf python scripts/extract_plan.py <pdf> <page> <output.json> \
      [--denominator 75] [--scale 37.7953]
"""
import argparse
import collections
import json
import sys
import tempfile
from pathlib import Path

import pymupdf

MIN_THICKNESS = 0.04  # m, below this it is not a wall
MAX_THICKNESS = 0.45  # m, above this it is not a wall
MIN_LENGTH = 0.40  # m, below this it is not a wall
WHITE = 0.95  # luminance above which a fill is a background
BLACK = 0.05  # luminance below which a fill is a stroke


def display_transform(page):
    """Coordinates brought back to the displayed frame (see /Rotate)."""
    box, rotation = page.mediabox, page.rotation
    if rotation == 90:
        return lambda x, y: (box.height - y, x)
    if rotation == 270:
        return lambda x, y: (y, box.width - x)
    return lambda x, y: (x, y)


def luminance(colour):
    return sum(colour) / len(colour)


def filled_shapes(page):
    """Filled rectangles of the page: colour, width, height, corner, in points."""
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
    """Partition fill: the most frequent fill that is neither white nor black."""
    counts = collections.Counter(
        shape["fill"] for shape in shapes if BLACK < shape["luminance"] < WHITE
    )
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def partitions(shapes, colour, scale, envelope):
    """Partitions: thin rectangles filled with the wall colour, inside the envelope.

    The title block and the legend sometimes use the same fill as the walls:
    the level envelope, given by the closed dimensions, rules them out.
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
        # Along the axis of a horizontal wall it is x, for a vertical one it is z.
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
    """Non-regression on a synthetic PDF: no real data."""
    scale = 2834.6457 / 75
    document = pymupdf.open()
    page = document.new_page(width=842, height=595)
    wall = (0.609, 0.555, 0.555)
    origin = (100.0, 100.0)
    # A horizontal 4 m x 0.10 m partition and a vertical 2 m x 0.07 m one.
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
    # A title-block fill, outside the envelope, with the same colour.
    page.draw_rect(
        pymupdf.Rect(600, 20, 600 + 2 * scale, 20 + 0.10 * scale), color=None, fill=wall
    )
    path = str(Path(tempfile.mkdtemp()) / "self-test-plan.pdf")
    document.save(path)
    envelope = (origin[0], origin[1], origin[0] + 6 * scale, origin[1] + 5 * scale)
    result = build(path, 1, scale, envelope)
    failures = []
    if result["wallFill"] != [round(channel, 3) for channel in wall]:
        failures.append(f"wall fill {result['wallFill']}")
    if len(result["walls"]) != 2:
        failures.append(f"{len(result['walls'])} partitions instead of 2 (title block not ruled out?)")
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
            print(f"FAIL {failure}")
        return 1
    print("plan extraction: self-test passed")
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
        help="x0,y0,x1,y1 in points: north-west corner and south-east corner of the level",
    )
    if "--self-test" in argv:
        return self_test()
    args = parser.parse_args(argv[1:])
    scale = args.scale
    if scale is None:
        if args.denominator is None:
            parser.error(
                "pass --scale (points per metre, deduced from the dimension chains) "
                "or --denominator (title-block ratio, to be checked)"
            )
        scale = 2834.6457 / args.denominator
        print(
            "warning: --denominator is the title-block ratio, a claim "
            "about the original printed sheet. Prefer --scale, deduced from the dimension "
            "chains, and check with check_plan_surfaces.py.",
            file=sys.stderr,
        )
    envelope = tuple(float(value) for value in args.envelope.split(","))
    if len(envelope) != 4:
        parser.error("--envelope attend x0,y0,x1,y1")
    result = build(args.pdf, args.page, scale, envelope)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    print(f"wall fill {result['wallFill']}: {len(result['walls'])} partitions -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
