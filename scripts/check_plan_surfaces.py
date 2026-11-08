"""Area check: what the plan prints against what the project computes.

The plan carries the area of each room (« SH : 13.03 m² », « SA : 16.53 m² »).
It is the only measurement in the document that judges the result: a room whose
computed area departs from the printed area is a room whose walls are misplaced,
however clean the drawing.

This script decides nothing and corrects nothing. It reads the printed areas in
the dimension registry, computes the area of the project's polygons, pairs each
label with the room containing it and reports the gap. Correction stays with the
model.

The frame is deduced from the document, not supplied: the dimension chains give
the scale and the origin by least squares over all their segments. A plan at
another scale, or from another builder, is read without any setting.

Usage:
  python scripts/check_plan_surfaces.py <registry.json> <project.json> \
      [--level rdc] [--page 8] [--tolerance 0.05] [--json output.json]
"""
import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

DEFAULT_TOLERANCE = 0.05  # m², accepted gap between computed and printed area
NEAREST_LIMIT = 2.0  # m, maximum distance to pair an orphan label
POINTS_PER_METRE = 2834.6457  # 1000 mm at 1:1, in PostScript points
STANDARD_SCALES = (20, 25, 33.333, 50, 75, 100, 125, 200, 250, 500)
SCALE_TOLERANCE = 0.01  # 1 %, beyond this the file is not at 1:1 scale


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


def chain_pairs(chains, axis):
    """(cumulative metres at the segment middle, position in points) for an axis."""
    pairs = []
    for chain in chains:
        if chain.get("axis") != axis:
            continue
        cumulative = 0.0
        for segment in chain.get("segments") or []:
            value = segment.get("value")
            at = segment.get("at")
            if value is None or not at:
                continue
            pairs.append((cumulative + value / 2, at[0] if axis == "horizontal" else at[1]))
            cumulative += value
    return pairs


def fit(pairs):
    """position = origin + scale * cumulative, by least squares."""
    if len(pairs) < 2:
        raise ValueError("at least two dimension segments are needed")
    mean_c = sum(c for c, _ in pairs) / len(pairs)
    mean_p = sum(p for _, p in pairs) / len(pairs)
    denominator = sum((c - mean_c) ** 2 for c, _ in pairs)
    if denominator < 1e-9:
        raise ValueError("the dimensions do not cover the axis")
    scale = sum((c - mean_c) * (p - mean_p) for c, p in pairs) / denominator
    if scale <= 0:
        raise ValueError("negative scale: the plan is oriented upside down")
    return scale, mean_p - scale * mean_c


def axis_frame(chains, axis, extent=None, dimensions=None):
    """Median scale of the chains, origin from the chain covering the whole axis.

    Partial chains do not start at the same place: they cannot be merged into a
    single fit. Each gives a scale; the longest gives the origin, because it is the
    only one starting from the level's edge.

    Except when no chain covers the axis. Page 14 of plan B only has a partial
    vertical chain (2.78 + 1.27) for an 8.50 m footprint: the origin fell 3.5 m
    too low and every area label projected to negative z. The overall dimension
    « 8.50 » is then the only source — it is centred on the footprint, so its
    middle gives the origin.
    """
    fitted = []
    for chain in chains:
        if chain.get("axis") != axis:
            continue
        pairs = chain_pairs([chain], axis)
        if len(pairs) < 2:
            continue
        scale, _ = fit(pairs)
        fitted.append((chain.get("sum") or 0.0, scale, chain))
    if not fitted:
        raise ValueError(f"no dimension chain on axis {axis}")
    scales = sorted(scale for _, scale, _ in fitted)
    scale = scales[len(scales) // 2]
    _, _, longest = max(fitted, key=lambda item: item[0])
    span = longest.get("sum") or 0.0
    if extent is not None and span < extent - 0.05:
        overall = overall_dimension(dimensions, axis, extent)
        if overall is not None:
            along = 0 if axis == "horizontal" else 1
            # The overall dimension measures the building, not the level's floor:
            # a recessed level (attic between rafters) has a smaller footprint
            # than the dimension. The origin is the building's corner, so it is
            # the dimension's value that gives it, not the level footprint.
            origin = overall["at"][along] - overall["value"] * scale / 2
            return scale, origin, scales[0], scales[-1], extent
    first = longest["segments"][0]
    origin = first["at"][0 if axis == "horizontal" else 1] - first["value"] * scale / 2
    return scale, origin, scales[0], scales[-1], span


def overall_dimension(dimensions, axis, extent, tolerance=0.02):
    """Overall dimension of an axis: the one equal to the level footprint.

    Failing that, the axis's largest dimension: it is the building's, and a
    recessed level still hangs off it.
    """
    horizontal = axis == "horizontal"
    candidates = [
        dimension
        for dimension in dimensions or []
        if bool(dimension.get("horizontal")) == horizontal
    ]
    for dimension in candidates:
        if abs((dimension.get("value") or 0.0) - extent) <= tolerance:
            return dimension
    if not candidates:
        return None
    return max(candidates, key=lambda dimension: dimension.get("value") or 0.0)


def scale_hint(scale):
    """Nearest standard scale, and the relative deviation.

    A vector PDF exported at 1:1 lands exactly on 2834.6457 / N points per
    metre. A clear deviation means the file was resized on export: the printed
    dimension stays right, the title-block ratio does not.
    """
    denominator = min(STANDARD_SCALES, key=lambda n: abs(POINTS_PER_METRE / n - scale))
    expected = POINTS_PER_METRE / denominator
    return {
        "denominator": denominator,
        "expected": round(expected, 3),
        "deviation": round(scale / expected - 1, 4),
    }


def transform(page, level=None):
    """Points -> metres frame, deduced from the page's dimension chains."""
    chains = page.get("chains") or []
    dimensions = (page.get("labels") or {}).get("dimensions") or []
    outline = (level or {}).get("outline") or []
    extents = {}
    for axis, along in (("horizontal", 0), ("vertical", 1)):
        values = [point[along] for point in outline]
        extents[axis] = (max(values) - min(values)) if values else None
    scale_x, origin_x, low_x, high_x, span_x = axis_frame(
        chains, "horizontal", extents["horizontal"], dimensions
    )
    scale_z, origin_z, low_z, high_z, span_z = axis_frame(
        chains, "vertical", extents["vertical"], dimensions
    )
    return {
        "scaleX": round(scale_x, 4),
        "scaleZ": round(scale_z, 4),
        "originX": round(origin_x, 4),
        "originZ": round(origin_z, 4),
        "scaleSpread": [round(min(low_x, low_z), 3), round(max(high_x, high_z), 3)],
        "span": [span_x, span_z],
        "scale": scale_hint((scale_x + scale_z) / 2),
    }


def to_world(frame, at):
    return (
        (at[0] - frame["originX"]) / frame["scaleX"],
        (at[1] - frame["originZ"]) / frame["scaleZ"],
    )


def printed_surfaces(page, frame):
    surfaces = []
    for label in (page.get("labels") or {}).get("rooms") or []:
        at = label.get("at")
        area = label.get("area")
        if not at or area is None:
            continue
        x, z = to_world(frame, at)
        surfaces.append(
            {
                "text": label.get("text"),
                "kind": label.get("surface"),
                "area": area,
                "at": [round(x, 3), round(z, 3)],
            }
        )
    return surfaces


def match(surfaces, rooms):
    """Pairs each label with a room: containment, then nearest centroid."""
    centroids = {room["id"]: polygon_centroid(room["polygon"]) for room in rooms}
    used = set()
    pairs = []
    for surface in surfaces:
        x, z = surface["at"]
        holders = [room for room in rooms if contains(room["polygon"], x, z)]
        if len(holders) > 1:
            holders.sort(key=lambda room: math.dist(centroids[room["id"]], (x, z)))
        if holders:
            room = holders[0]
            pairs.append((surface, room, "contenu"))
            used.add(room["id"])
            continue
        nearest = min(rooms, key=lambda room: math.dist(centroids[room["id"]], (x, z)))
        distance = math.dist(centroids[nearest["id"]], (x, z))
        if distance <= NEAREST_LIMIT:
            pairs.append((surface, nearest, f"centroid at {distance:.2f} m"))
            used.add(nearest["id"])
        else:
            pairs.append((surface, None, f"no room within {NEAREST_LIMIT} m"))
    orphans = [room for room in rooms if room["id"] not in used]
    return pairs, orphans


def reference(surfaces):
    """Reference area of a room: SU if the plan prints it, otherwise SH, otherwise SA.

    A room polygon is a floor. When the plan prints both, it is the usable area
    (SU) that compares to the floor: the living area (SH) excludes the part under
    1.80 m of headroom, so it is smaller without anything being wrong. Comparing a
    floor to an SH produces a gap that does not exist.
    """
    order = {"SU": 0, "SH": 1, "SA": 2}
    return min(surfaces, key=lambda surface: order.get(surface["kind"], 3))


def report(pairs, orphans, tolerance):
    rows = []
    grouped = {}
    for surface, room, how in pairs:
        if room is None:
            rows.append(
                {
                    "room": None,
                    "printed": surface["area"],
                    "computed": None,
                    "delta": None,
                    "verdict": "label without a room",
                    "how": how,
                    "text": surface["text"],
                }
            )
            continue
        grouped.setdefault(room["id"], {"room": room, "surfaces": [], "how": how})
        grouped[room["id"]]["surfaces"].append(surface)
    for entry in grouped.values():
        room = entry["room"]
        surfaces = entry["surfaces"]
        chosen = reference(surfaces)
        computed = polygon_area(room["polygon"])
        delta = computed - chosen["area"]
        declared = room.get("planArea")
        rows.append(
            {
                "room": room["id"],
                "name": room.get("name"),
                "printed": chosen["area"],
                "printedKind": chosen["kind"],
                "alsoPrinted": [
                    {"kind": surface["kind"], "area": surface["area"]}
                    for surface in surfaces
                    if surface is not chosen
                ],
                "computed": round(computed, 3),
                "delta": round(delta, 3),
                "declared": declared,
                "declaredDelta": None if declared is None else round(declared - chosen["area"], 3),
                "verdict": "exact" if abs(delta) <= tolerance else "gap",
                "how": entry["how"],
                "text": chosen["text"],
            }
        )
    for room in orphans:
        rows.append(
            {
                "room": room["id"],
                "name": room.get("name"),
                "printed": None,
                "computed": round(polygon_area(room["polygon"]), 3),
                "delta": None,
                "declared": room.get("planArea"),
                "declaredDelta": None,
                "verdict": "room without a label",
                "how": None,
                "text": None,
            }
        )
    return rows


def print_table(rows, tolerance):
    print(f"{'room':14s} {'printed':>8s} {'computed':>8s} {'gap':>7s}  verdict")
    for row in rows:
        printed = "—" if row["printed"] is None else f"{row['printed']:.2f}"
        if row.get("printedKind"):
            printed = f"{printed} {row['printedKind']}"
        computed = "—" if row["computed"] is None else f"{row['computed']:.2f}"
        delta = "—" if row["delta"] is None else f"{row['delta']:+.2f}"
        name = row["room"] or "?"
        print(f"{name:14s} {printed:>8s} {computed:>8s} {delta:>7s}  {row['verdict']}")
    off = [row for row in rows if row["verdict"] != "exact"]
    print()
    if off:
        print(f"{len(off)} room(s) out of tolerance ({tolerance:.2f} m²):")
        for row in off:
                print(f"  {row['room']}: {row['delta']:+.2f} m² — {row['how']}")
                print(f"  {row['room']} : {row['delta']:+.2f} m² — {row['how']}")
                print(f"  {row['room']}: {row['verdict']}")
                print(f"  {row['room']} : {row['verdict']}")
    else:
        print(f"every room is within ±{tolerance:.2f} m² of the printed area")


def build(registry, project, level_id, page_index, tolerance):
    pages = registry.get("pages") or []
    page = None
    for candidate in pages:
        if page_index is None or candidate.get("index") == page_index:
            page = candidate
            break
    if page is None:
        raise ValueError(f"page {page_index} missing from the registry")
    level = None
    for candidate in project.get("levels") or []:
        if candidate.get("id") == level_id:
            level = candidate
            break
    if level is None:
        raise ValueError(f"level {level_id} missing from the project")
    rooms = [room for room in level.get("rooms") or [] if room.get("polygon")]
    frame = transform(page, level)
    surfaces = printed_surfaces(page, frame)
    pairs, orphans = match(surfaces, rooms)
    rows = report(pairs, orphans, tolerance)
    return {
        "project": project.get("id"),
        "level": level_id,
        "page": page.get("index"),
        "frame": frame,
        "tolerance": tolerance,
        "rows": rows,
        "summary": {
            "printed": len(surfaces),
            "rooms": len(rooms),
            "exact": sum(1 for row in rows if row["verdict"] == "exact"),
            "off": sum(1 for row in rows if row["verdict"] != "exact"),
            "printedTotal": round(sum(surface["area"] for surface in surfaces), 2),
            "computedTotal": round(sum(polygon_area(room["polygon"]) for room in rooms), 2),
        },
    }


def self_test():
    """Non-regression on a synthetic registry and project."""
    scale, origin = POINTS_PER_METRE / 50, 100.0
    registry = {
        "pages": [
            {
                "index": 1,
                "chains": [
                    {
                        "axis": "horizontal",
                        "segments": [
                            {"value": 4.0, "at": [origin + 4 * scale / 2, 0]},
                            {"value": 6.0, "at": [origin + 4 * scale + 6 * scale / 2, 0]},
                        ],
                    },
                    {
                        "axis": "vertical",
                        "segments": [
                            {"value": 3.0, "at": [0, origin + 3 * scale / 2]},
                            {"value": 5.0, "at": [0, origin + 3 * scale + 5 * scale / 2]},
                        ],
                    },
                ],
                "labels": {
                    "rooms": [
                        {
                            "text": "SH : 12.00 m²",
                            "surface": "SH",
                            "area": 12.0,
                            "at": [origin + 2 * scale, origin + 1.5 * scale],
                        },
                        {
                            "text": "SH : 30.50 m²",
                            "surface": "SH",
                            "area": 30.5,
                            "at": [origin + 7 * scale, origin + 2.5 * scale],
                        },
                    ]
                },
            }
        ]
    }
    project = {
        "id": "auto-test",
        "levels": [
            {
                "id": "rdc",
                "rooms": [
                    {
                        "id": "a",
                        "name": "A",
                        "polygon": [[0, 0], [4, 0], [4, 3], [0, 3]],
                        "planArea": 12.0,
                    },
                    {
                        "id": "b",
                        "name": "B",
                        "polygon": [[4, 0], [10, 0], [10, 5], [4, 5]],
                        "planArea": 30.5,
                    },
                ],
            }
        ],
    }
    result = build(registry, project, "rdc", 1, DEFAULT_TOLERANCE)
    failures = []
    frame = result["frame"]
    if abs(frame["scaleX"] - scale) > 0.01 or abs(frame["scaleZ"] - scale) > 0.01:
        failures.append(f"scale {frame['scaleX']}/{frame['scaleZ']} instead of {scale}")
    if abs(frame["originX"] - origin) > 0.01 or abs(frame["originZ"] - origin) > 0.01:
        failures.append(f"origin {frame['originX']}/{frame['originZ']} instead of {origin}")
    if frame["scale"]["denominator"] != 50 or abs(frame["scale"]["deviation"]) > 0.001:
        failures.append(f"recognised scale {frame['scale']} instead of exact 1/50")
    by_room = {row["room"]: row for row in result["rows"]}
    if by_room["a"]["verdict"] != "exact":
        failures.append(f"room a {by_room['a']}")
    if by_room["b"]["verdict"] != "gap" or abs(by_room["b"]["delta"] + 0.5) > 0.01:
        failures.append(f"room b {by_room['b']}")
    if result["summary"]["printed"] != 2 or result["summary"]["rooms"] != 2:
        failures.append(f"appariement {result['summary']}")

    # A partial chain does not give the origin: the overall dimension does.
    # Without it, the origin fell at the start of the partial chain and every
    # label projected outside the level.
    partial = {
        "pages": [
            {
                "index": 2,
                "chains": [
                    {
                        "axis": "horizontal",
                        "segments": [
                            {"value": 4.0, "at": [origin + 4 * scale / 2, 0]},
                            {"value": 6.0, "at": [origin + 4 * scale + 6 * scale / 2, 0]},
                        ],
                    },
                    {
                        "axis": "vertical",
                        "segments": [
                            {"value": 2.0, "at": [0, origin + 4 * scale + 2 * scale / 2]},
                            {"value": 2.0, "at": [0, origin + 6 * scale + 2 * scale / 2]},
                        ],
                    },
                ],
                "labels": {
                    "dimensions": [
                        {
                            "kind": "linear",
                            "text": "8.00",
                            "value": 8.0,
                            "horizontal": False,
                            "at": [0, origin + 4 * scale],
                        }
                    ],
                    "rooms": [
                        {
                            "text": "SH : 12.00 m²",
                            "surface": "SH",
                            "area": 12.0,
                            "at": [origin + 2 * scale, origin + 1.5 * scale],
                        }
                    ],
                },
            }
        ]
    }
    partial_project = {
        "id": "auto-test-partiel",
        "levels": [
            {
                "id": "rdc",
                "outline": [[0, 0], [10, 0], [10, 8], [0, 8]],
                "rooms": [
                    {
                        "id": "a",
                        "name": "A",
                        "polygon": [[0, 0], [4, 0], [4, 3], [0, 3]],
                        "planArea": 12.0,
                    }
                ],
            }
        ],
    }
    partial_result = build(partial, partial_project, "rdc", 2, DEFAULT_TOLERANCE)
    partial_frame = partial_result["frame"]
    if abs(partial_frame["originZ"] - origin) > 0.01:
        failures.append(
            f"vertical origin {partial_frame['originZ']} instead of {origin} "
            "on a partial chain"
        )
    if partial_result["rows"][0]["verdict"] != "exact":
        failures.append(f"label projected wrongly: {partial_result['rows'][0]}")

    # A recessed level — an attic between rafters — has a smaller footprint
    # than the overall dimension. The origin stays the building's corner:
    # computing it with the level footprint shifted everything by half the gap.
    retreat_project = {
        "id": "auto-test-retrait",
        "levels": [
            {
                "id": "combles",
                "outline": [[0, 1], [10, 1], [10, 7], [0, 7]],
                "rooms": [
                    {
                        "id": "a",
                        "name": "A",
                        "polygon": [[0, 1], [4, 1], [4, 4], [0, 4]],
                        "planArea": 12.0,
                    }
                ],
            }
        ],
    }
    retreat_result = build(partial, retreat_project, "combles", 2, DEFAULT_TOLERANCE)
    retreat_frame = retreat_result["frame"]
    if abs(retreat_frame["originZ"] - origin) > 0.01:
        failures.append(
            f"vertical origin {retreat_frame['originZ']} instead of {origin} "
            "on a recessed level"
        )
    if retreat_result["rows"][0]["verdict"] != "exact":
        failures.append(
            f"label projected wrongly on a recessed level: {retreat_result['rows'][0]}"
        )

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("area check: self-test passed")
    return 0


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry", nargs="?")
    parser.add_argument("project", nargs="?")
    parser.add_argument("--level", default="rdc")
    parser.add_argument("--page", type=int, default=None)
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument("--json", default=None)
    parser.add_argument("--self-test", action="store_true")
    if "--self-test" in argv:
        return self_test()
    args = parser.parse_args(argv)
    if not args.registry or not args.project:
        parser.error("registry and project are required")
    result = build(
        load(args.registry), load(args.project), args.level, args.page, args.tolerance
    )
    print_table(result["rows"], args.tolerance)
    print()
    frame = result["frame"]
    hint = frame["scale"]
    print(
        f"frame: {frame['scaleX']:.2f} pt/m, "
        f"origin {frame['originX']:.2f}/{frame['originZ']:.2f}, "
        f"1/{hint['denominator']:g} expected {hint['expected']:.3f} "
        f"({hint['deviation'] * 100:+.1f} %)"
    )
    if abs(hint["deviation"]) > SCALE_TOLERANCE:
        print(
            "warning: the file is not at 1:1 scale, it was "
            "resized on export. Printed dimensions stay right, the "
            "title-block ratio does not."
        )
    print(
        f"printed total {result['summary']['printedTotal']:.2f} m², "
        f"computed total {result['summary']['computedTotal']:.2f} m²"
    )
    if args.json:
        Path(args.json).write_text(
            json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    return 0 if result["summary"]["off"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
