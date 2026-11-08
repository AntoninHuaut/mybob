"""The rooms of a level, computed from its walls.

A room polygon entered by hand is an opinion. Walls are the geometry: a room is
what the walls leave free. This script closes the level, cuts the plan into
cells at the wall faces, fills the free cells and reports each region with its
exact area.

It is not a detection: it is a computation. The cut coordinates are the wall
faces and the outline vertices, so no cell can cross a wall, and a region's area
is the sum of its cells.

Openings are not subtracted: a door is a passage, not an absence of wall. Two
rooms linked by a door stay two rooms.

Usage:
  python scripts/plan_faces.py <project.json> [--level rdc] [--json output.json]
  python scripts/plan_faces.py <project.json> --compare   # regions against rooms
"""
import argparse
import json
import sys
from pathlib import Path

MIN_AREA = 0.05  # m², below this it is not a room but a gap
EPSILON = 1e-9


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def polygon_area(points):
    total = 0.0
    for index, a in enumerate(points):
        b = points[(index + 1) % len(points)]
        total += a[0] * b[1] - b[0] * a[1]
    return abs(total) / 2


def polygon_centroid(points):
    area = 0.0
    cx = cz = 0.0
    for index, a in enumerate(points):
        b = points[(index + 1) % len(points)]
        cross = a[0] * b[1] - b[0] * a[1]
        area += cross
        cx += (a[0] + b[0]) * cross
        cz += (a[1] + b[1]) * cross
    if abs(area) < 1e-12:
        return (points[0][0], points[0][1])
    return (cx / (3 * area), cz / (3 * area))


def contains(points, x, z):
    inside = False
    for index, a in enumerate(points):
        b = points[(index + 1) % len(points)]
        if (a[1] > z) != (b[1] > z):
            crossing = a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x < crossing:
                inside = not inside
    return inside


def wall_rect(wall):
    """Footprint of a straight wall, or None if it is oblique."""
    (x1, z1), (x2, z2) = wall["start"], wall["end"]
    half = wall["thickness"] / 2
    if abs(z1 - z2) < EPSILON:
        return (min(x1, x2), max(x1, x2), z1 - half, z1 + half)
    if abs(x1 - x2) < EPSILON:
        return (x1 - half, x1 + half, min(z1, z2), max(z1, z2))
    return None


def region_polygon(cells, xs, zs):
    """Outline of a region, traced on the edges of its cells.

    A region is a union of cells: its outline is the set of sides that have no
    neighbour in the region. They are all oriented the same way, chained, and
    aligned points are removed. The result is exact — it is the outline of what
    the walls leave free, including the partition returns sticking out into the
    room.
    """
    inside = set(cells)
    edges = []
    for i, j in cells:
        if (i - 1, j) not in inside:
            edges.append(((xs[i], zs[j]), (xs[i], zs[j + 1])))
        if (i + 1, j) not in inside:
            edges.append(((xs[i + 1], zs[j + 1]), (xs[i + 1], zs[j])))
        if (i, j - 1) not in inside:
            edges.append(((xs[i + 1], zs[j]), (xs[i], zs[j])))
        if (i, j + 1) not in inside:
            edges.append(((xs[i], zs[j + 1]), (xs[i + 1], zs[j + 1])))
    if not edges:
        return []
    following = {}
    for start, end in edges:
        following.setdefault((round(start[0], 6), round(start[1], 6)), []).append(end)
    start = edges[0][0]
    loop = [start]
    current = edges[0][1]
    guard = 0
    while guard < len(edges) + 4:
        guard += 1
        key = (round(current[0], 6), round(current[1], 6))
        if key == (round(start[0], 6), round(start[1], 6)):
            break
        loop.append(current)
        candidates = following.get(key)
        if not candidates:
            break
        current = candidates.pop(0)
    simplified = []
    for point in loop:
        if len(simplified) >= 2:
            a, b = simplified[-2], simplified[-1]
            if abs((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) < 1e-9:
                simplified[-1] = point
                continue
        simplified.append(point)
    if len(simplified) >= 3:
        a, b = simplified[-2], simplified[-1]
        if abs((b[0] - a[0]) * (simplified[0][1] - a[1]) - (b[1] - a[1]) * (simplified[0][0] - a[0])) < 1e-9:
            simplified.pop()
    return [[round(point[0], 4), round(point[1], 4)] for point in simplified]


def build(level):
    """Free regions of the level, as cells then as areas."""
    rects = []
    oblique = []
    for wall in level.get("walls") or []:
        rect = wall_rect(wall)
        if rect is None:
            oblique.append(wall.get("id"))
        else:
            rects.append(rect)
    outline = level.get("outline") or []
    if not outline:
        raise ValueError("the level has no outline")

    xs = sorted({round(value, 6) for rect in rects for value in (rect[0], rect[1])})
    zs = sorted({round(value, 6) for rect in rects for value in (rect[2], rect[3])})
    xs = sorted(set(xs) | {round(point[0], 6) for point in outline})
    zs = sorted(set(zs) | {round(point[1], 6) for point in outline})

    columns, rows = len(xs) - 1, len(zs) - 1
    if columns < 1 or rows < 1:
        raise ValueError("degenerate geometry: no cell")

    free = [[False] * rows for _ in range(columns)]
    for i in range(columns):
        cx = (xs[i] + xs[i + 1]) / 2
        for j in range(rows):
            cz = (zs[j] + zs[j + 1]) / 2
            if not contains(outline, cx, cz):
                continue
            if any(
                rect[0] - EPSILON <= cx <= rect[1] + EPSILON
                and rect[2] - EPSILON <= cz <= rect[3] + EPSILON
                for rect in rects
            ):
                continue
            free[i][j] = True

    seen = [[False] * rows for _ in range(columns)]
    regions = []
    for i in range(columns):
        for j in range(rows):
            if not free[i][j] or seen[i][j]:
                continue
            stack = [(i, j)]
            seen[i][j] = True
            cells = []
            while stack:
                ci, cj = stack.pop()
                cells.append((ci, cj))
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ni, nj = ci + di, cj + dj
                    if 0 <= ni < columns and 0 <= nj < rows:
                        if free[ni][nj] and not seen[ni][nj]:
                            seen[ni][nj] = True
                            stack.append((ni, nj))
            area = sum(
                (xs[ci + 1] - xs[ci]) * (zs[cj + 1] - zs[cj]) for ci, cj in cells
            )
            if area < MIN_AREA:
                continue
            x0 = min(xs[ci] for ci, _ in cells)
            x1 = max(xs[ci + 1] for ci, _ in cells)
            z0 = min(zs[cj] for _, cj in cells)
            z1 = max(zs[cj + 1] for _, cj in cells)
            weight = sum(
                (xs[ci + 1] - xs[ci]) * (zs[cj + 1] - zs[cj]) for ci, cj in cells
            )
            cx = sum(
                (xs[ci] + xs[ci + 1]) / 2 * (xs[ci + 1] - xs[ci]) * (zs[cj + 1] - zs[cj])
                for ci, cj in cells
            ) / weight
            cz = sum(
                (zs[cj] + zs[cj + 1]) / 2 * (xs[ci + 1] - xs[ci]) * (zs[cj + 1] - zs[cj])
                for ci, cj in cells
            ) / weight
            regions.append(
                {
                    "area": round(area, 4),
                    "polygon": region_polygon(cells, xs, zs),
                    "cells": len(cells),
                    "bbox": [round(x0, 3), round(z0, 3), round(x1, 3), round(z1, 3)],
                    "centroid": [round(cx, 3), round(cz, 3)],
                }
            )
    regions.sort(key=lambda region: -region["area"])
    return {
        "level": level.get("id"),
        "walls": len(rects),
        "obliqueWalls": oblique,
        "grid": [columns, rows],
        "regions": regions,
        "total": round(sum(region["area"] for region in regions), 4),
    }


def compare(result, level):
    """Pairs each project room with the region containing its centre."""
    rooms = [room for room in level.get("rooms") or [] if room.get("polygon")]
    rows = []
    used = set()
    for room in rooms:
        cx, cz = polygon_centroid(room["polygon"])
        holder = None
        for index, region in enumerate(result["regions"]):
            if index in used:
                continue
            if contains(region["polygon"], cx, cz):
                holder = index
                break
        declared = polygon_area(room["polygon"])
        if holder is None:
            rows.append(
                {
                    "room": room["id"],
                    "polygon": round(declared, 3),
                    "face": None,
                    "delta": None,
                    "verdict": "no region under the centre",
                }
            )
            continue
        used.add(holder)
        face = result["regions"][holder]["area"]
        delta = declared - face
        rows.append(
            {
                "room": room["id"],
                "polygon": round(declared, 3),
                "face": round(face, 3),
                "delta": round(delta, 3),
                "verdict": "consistent" if abs(delta) <= 0.02 else "wrong polygon",
            }
        )
    orphans = [
        {"area": region["area"], "centroid": region["centroid"]}
        for index, region in enumerate(result["regions"])
        if index not in used
    ]
    return rows, orphans


def apply(result, level):
    """Replaces the polygon of closed rooms with the computed outline.

    A region carrying a single room gives its exact outline, partition returns
    included. A region carrying several is an open space: its split is a
    convention, it is left untouched and that is said.
    """
    rooms = [room for room in level.get("rooms") or [] if room.get("polygon")]
    holders = {}
    for room in rooms:
        cx, cz = polygon_centroid(room["polygon"])
        for index, region in enumerate(result["regions"]):
            if contains(region["polygon"], cx, cz):
                holders.setdefault(index, []).append(room)
                break
    applied, skipped = [], []
    for index, region in enumerate(result["regions"]):
        owners = holders.get(index, [])
        if len(owners) != 1:
            skipped.append(
                {"area": region["area"], "rooms": [room["id"] for room in owners]}
            )
            continue
        room = owners[0]
        before = polygon_area(room["polygon"])
        room["polygon"] = region["polygon"]
        applied.append(
            {"room": room["id"], "before": round(before, 3), "after": region["area"]}
        )
    return applied, skipped


def self_test():
    """Non-regression: two rooms separated by a 7 cm partition."""
    level = {
        "id": "rdc",
        "outline": [[0, 0], [6, 0], [6, 4], [0, 4]],
        "walls": [
            {"id": "n", "start": [0, 0], "end": [6, 0], "thickness": 0.3},
            {"id": "s", "start": [0, 4], "end": [6, 4], "thickness": 0.3},
            {"id": "o", "start": [0, 0], "end": [0, 4], "thickness": 0.3},
            {"id": "e", "start": [6, 0], "end": [6, 4], "thickness": 0.3},
            {"id": "cloison", "start": [3, 0.15], "end": [3, 3.85], "thickness": 0.07},
        ],
        "rooms": [
            {"id": "a", "polygon": [[0.15, 0.15], [2.965, 0.15], [2.965, 3.85], [0.15, 3.85]]},
            {"id": "b", "polygon": [[3.035, 0.15], [5.85, 0.15], [5.85, 3.85], [3.035, 3.85]]},
        ],
    }
    result = build(level)
    failures = []
    if len(result["regions"]) != 2:
        failures.append(f"{len(result['regions'])} regions instead of 2")
    else:
        expected = (3 - 0.15 - 0.035) * (3.85 - 0.15)
        for region in result["regions"]:
            if abs(region["area"] - expected) > 0.01:
                failures.append(f"area {region['area']} instead of {expected:.3f}")
    rows, orphans = compare(result, level)
    if orphans:
        failures.append(f"{len(orphans)} region(s) without a room")
    if any(row["verdict"] != "consistent" for row in rows):
        failures.append(f"appariement {rows}")
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("rooms from walls: self-test passed")
    return 0


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", nargs="?")
    parser.add_argument("--level", default="rdc")
    parser.add_argument("--compare", action="store_true")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="replace the polygon of closed rooms with the computed outline",
    )
    parser.add_argument("--write", default=None, help="write the corrected project")
    parser.add_argument("--json", default=None)
    parser.add_argument("--self-test", action="store_true")
    if "--self-test" in argv:
        return self_test()
    args = parser.parse_args(argv)
    if not args.project:
        parser.error("projet requis")
    project = load(args.project)
    level = next(
        (candidate for candidate in project.get("levels") or [] if candidate.get("id") == args.level),
        None,
    )
    if level is None:
        parser.error(f"level {args.level} missing from the project")
    result = build(level)
    print(
        f"{result['walls']} walls, grid {result['grid'][0]}x{result['grid'][1]}, "
        f"{len(result['regions'])} regions, total {result['total']:.2f} m²"
    )
    if result["obliqueWalls"]:
        print(f"oblique walls ignored: {', '.join(result['obliqueWalls'])}")
    for region in result["regions"]:
        print(
            f"  {region['area']:7.3f} m²  centre {region['centroid']}  "
            f"emprise {region['bbox']}"
        )
    if args.compare:
        rows, orphans = compare(result, level)
        print()
        print(f"{'room':14s} {'polygon':>9s} {'walls':>9s} {'gap':>7s}  verdict")
        for row in rows:
            face = "—" if row["face"] is None else f"{row['face']:.3f}"
            delta = "—" if row["delta"] is None else f"{row['delta']:+.3f}"
            print(f"{row['room']:14s} {row['polygon']:9.3f} {face:>9s} {delta:>7s}  {row['verdict']}")
        for orphan in orphans:
            print(f"  region without a room: {orphan['area']:.3f} m² at {orphan['centroid']}")
        result["compare"] = {"rows": rows, "orphans": orphans}
    if args.apply:
        applied, skipped = apply(result, level)
        print()
        for item in applied:
            print(
                f"  {item['room']:14s} {item['before']:7.3f} -> {item['after']:7.3f} m²"
            )
        for item in skipped:
            print(
                f"  open space left as is: {item['area']:.3f} m² "
                f"({', '.join(item['rooms']) or 'no room'})"
            )
        result["applied"] = applied
        result["skipped"] = skipped
        if args.write:
            project["levels"] = [
                level if candidate.get("id") == args.level else candidate
                for candidate in project["levels"]
            ]
            Path(args.write).write_text(
                json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            print(f"-> {args.write}")
    if args.json:
        Path(args.json).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
