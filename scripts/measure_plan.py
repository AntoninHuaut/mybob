"""Measures the wall bands of a rendered plan, in the plan's frame.

Used to compare a model with the source plan without going through the model's
geometry: the render is swept and the real walls are read. The two strokes of a
hatched partition are merged, and thin strokes (dimensions, slope lines) are
discarded by a thickness threshold.

Usage:
  python scripts/measure_plan.py <image> <origin_x_px> <origin_z_px> <px_per_metre> \
      --z 1.0,2.0,3.0 --x 2.5,6.0 [--merge 0.26] [--min 0.05] [--max 0.55]

The origin is the outer north-west corner of the plan in the image. `--z` sweeps
horizontal lines (vertical walls), `--x` vertical lines (horizontal walls).
Everything is returned in metres.

Beware: a window interrupts the wall and shows its frame in place of the face.
Measure in several places before concluding on a thickness.
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
    parser.add_argument("scale", type=float, help="pixels per metre")
    parser.add_argument("--z", default="", help="z values to sweep horizontally")
    parser.add_argument("--x", default="", help="x values to sweep vertically")
    parser.add_argument("--merge", type=float, default=0.26)
    parser.add_argument("--min", type=float, default=0.05)
    parser.add_argument("--max", type=float, default=0.55)
    parser.add_argument("--span", type=float, default=12.6, help="swept width, in metres")
    parser.add_argument("--depth", type=float, default=8.7, help="swept height, in metres")
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
