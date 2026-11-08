"""Layer 0 ter: interior doors, read on the drawing's swing arcs.

An interior door is not dimensioned: no chain carries it, no fill draws it. It is
drawn by **two symbols** — a break in the wall line and a **swing arc** — and the
second is the one that gets measured.

The symbol is standardised, so it is read without interpretation:

- the arc is a **quarter circle** of radius equal to the leaf width;
- its **centre is the hinge**;
- the **leaf** is drawn in the open position, perpendicular to the wall: it is the
  segment starting from the hinge and reaching one of the two ends of the arc;
- the other end gives the **closed position**, hence the opening in the wall.

What the script measures, and what it does not decide:

- it **measures** the hinge, the width and the two directions;
- it **does not decide** which side of the wall the room is on, nor whether the
  leaf really is that one: the swing direction stays an interpretation to
  confirm on site, and the project must say so.

The trap of this layer is noise: hatching and fills also produce clusters of
short segments — 165 dense cells of six segments or more on plan A. Density is
not what rules them out, the fit is: a cluster of hatching does not sit on a
circle (large fit residual) and does not cover 90° of arc. The three conditions —
unfilled path, residual ≤ 0.15 pt, coverage 80–100° — are needed together; the
self-test replays the four decoys so that the rule does not get lost.

Usage:
  python scripts/extract_doors.py <pdf> <page> <output.json> \\
      --scale 37.8 --origin 297.6,159.4
  python scripts/extract_doors.py <pdf> <page> <output.json> \\
      --registry registry.json --pages 8
  python scripts/extract_doors.py <pdf> <page> --compare project.json --level rdc \\
      --scale 37.8 --origin 297.6,159.4
  python scripts/extract_doors.py --self-test

`--origin` is the level's north-west corner in display points, `--scale` the
number of points per metre. `--registry` deduces them from the closed dimension
chains, like `derive_outline.py`; when an axis has no closed chain, the script
says so and refuses to guess.

The result carries real plan data: write it into an ignored folder
(`artifacts/plan-review/`).
"""
import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import pymupdf

MIN_WIDTH = 0.40  # m, below this it is not a leaf
MAX_WIDTH = 1.60  # m, above this it is not a leaf
MIN_POINTS = 6  # an arc is a polyline, not a triangle
FIT_RESIDUAL = 0.15  # pt, maximum gap from a point to the fitted circle
SPAN_MIN, SPAN_MAX = 80.0, 100.0  # degrees, a quarter circle
PARTIAL_MIN = 20.0  # degrees, below this it is no longer a piece of arc
LEAF_TOL = 2.0  # pt, hinge/end pairing of a leaf segment
LEAF_COVER = 0.85  # fraction of the radius the leaf must cover
DUPLICATE_TOL = 1.0  # pt, two arcs at the same centre are the same symbol
MATCH_ACROSS = 1.0  # m, perpendicular gap accepted for pairing, in comparison
WALL_SHIFT = 0.10  # m, beyond this the project wall is shifted, not the door
FIXTURE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "plan-doors"
AXIS_INDEX = {"x": 0, "z": 1}


def display_transform(page):
    """Coordinates brought back to the displayed frame (see /Rotate)."""
    box, rotation = page.mediabox, page.rotation
    if rotation == 90:
        return lambda x, y: (box.height - y, x)
    if rotation == 270:
        return lambda x, y: (y, box.width - x)
    return lambda x, y: (x, y)


def fit_circle(points):
    """Least-squares circle (Kåsa): centre, radius, maximum residual.

    The residual is the maximum gap from a point to the circle, not the mean error:
    it is what separates an arc from a cluster of hatching, and a mean would drown it.
    """
    count = len(points)
    if count < 3:
        return None
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sxx = sum(p[0] ** 2 for p in points)
    syy = sum(p[1] ** 2 for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    sxz = sum(p[0] * (p[0] ** 2 + p[1] ** 2) for p in points)
    syz = sum(p[1] * (p[0] ** 2 + p[1] ** 2) for p in points)
    sz = sum(p[0] ** 2 + p[1] ** 2 for p in points)
    matrix = [[sxx, sxy, sx, sxz], [sxy, syy, sy, syz], [sx, sy, count, sz]]
    for column in range(3):
        pivot = max(range(column, 3), key=lambda row: abs(matrix[row][column]))
        if abs(matrix[pivot][column]) < 1e-9:
            return None
        matrix[column], matrix[pivot] = matrix[pivot], matrix[column]
        for row in range(3):
            if row == column:
                continue
            factor = matrix[row][column] / matrix[column][column]
            for index in range(column, 4):
                matrix[row][index] -= factor * matrix[column][index]
    a = matrix[0][3] / matrix[0][0]
    b = matrix[1][3] / matrix[1][1]
    c = matrix[2][3] / matrix[2][2]
    cx, cy = a / 2, b / 2
    squared = c + cx * cx + cy * cy
    if squared <= 0:
        return None
    radius = math.sqrt(squared)
    residual = max(abs(math.hypot(p[0] - cx, p[1] - cy) - radius) for p in points)
    return cx, cy, radius, residual


def angular_span(points, cx, cy):
    """Angular coverage of the arc, in degrees, without being trapped by 0°."""
    angles = sorted(math.atan2(p[1] - cy, p[0] - cx) for p in points)
    gaps = [
        (angles[(index + 1) % len(angles)] - angles[index]) % (2 * math.pi)
        for index in range(len(angles))
    ]
    return math.degrees(2 * math.pi - max(gaps))


def arc_ends(points, cx, cy):
    """The two ends of the arc: the points bordering the largest gap."""
    angles = [math.atan2(p[1] - cy, p[0] - cx) for p in points]
    order = sorted(range(len(points)), key=lambda index: angles[index])
    gaps = [
        (angles[order[(index + 1) % len(order)]] - angles[order[index]]) % (2 * math.pi)
        for index in range(len(order))
    ]
    cut = gaps.index(max(gaps))
    return [points[order[(cut + 1) % len(order)]], points[order[cut]]]


def corners_of(item, to_point):
    """The four corners of a rectangle or a quadrilateral, in display coordinates."""
    if item[0] == "re":
        rect = item[1]
        return [
            to_point(rect.x0, rect.y0),
            to_point(rect.x1, rect.y0),
            to_point(rect.x1, rect.y1),
            to_point(rect.x0, rect.y1),
        ]
    quad = item[1]
    return [
        to_point(quad.ul.x, quad.ul.y),
        to_point(quad.ur.x, quad.ur.y),
        to_point(quad.lr.x, quad.lr.y),
        to_point(quad.ll.x, quad.ll.y),
    ]


def segments_of(page, to_point):
    """Every segment of the page, in display coordinates.

    A leaf is drawn in two ways depending on the CAD tool: two parallel strokes and
    an end, or a thin quadrilateral. Both shapes must be read, otherwise the swing
    direction is missing on half of the doors.
    """
    segments = []
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] == "l":
                segments.append((to_point(item[1].x, item[1].y), to_point(item[2].x, item[2].y)))
            elif item[0] in ("re", "qu"):
                corners = corners_of(item, to_point)
                for index in range(4):
                    segments.append((corners[index], corners[(index + 1) % 4]))
    return segments


def leaf_length(segments, hinge, end):
    """Length of the longest segment going from the hinge to an arc end.

    The leaf is drawn open, perpendicular to the wall: this segment is what tells
    the swing direction apart from the opening in the wall. Without it, the two ends
    of the arc are interchangeable and the script does not decide.
    """
    best = 0.0
    for start, stop in segments:
        for near, far in ((start, stop), (stop, start)):
            if math.hypot(near[0] - hinge[0], near[1] - hinge[1]) > LEAF_TOL:
                continue
            if math.hypot(far[0] - end[0], far[1] - end[1]) > LEAF_TOL:
                continue
            best = max(best, math.hypot(far[0] - near[0], far[1] - near[1]))
    return best


def unit(vector):
    length = math.hypot(vector[0], vector[1])
    if length == 0:
        return None
    return (vector[0] / length, vector[1] / length)


def detect(page, scale):
    """Swing arcs of the page, in points then in metres.

    Returns (doors, partial arcs, refusals): refusals are counted by reason and
    partial arcs are listed, so that the script says what it discarded instead of
    keeping quiet. A 38° arc is not a quarter circle, but it is still a piece of a
    door: it is reported, it is not counted.
    """
    to_point = display_transform(page)
    segments = segments_of(page, to_point)
    doors, partials = [], []
    refusals = {"filled": 0, "too short": 0, "radius out of bounds": 0, "residual": 0, "coverage": 0}
    for index, drawing in enumerate(page.get_drawings()):
        if drawing.get("fill") is not None:
            refusals["filled"] += 1
            continue
        points = []
        for item in drawing["items"]:
            if item[0] == "l":
                points.append(to_point(item[1].x, item[1].y))
                points.append(to_point(item[2].x, item[2].y))
        if len(points) < MIN_POINTS:
            refusals["too short"] += 1
            continue
        fitted = fit_circle(points)
        if fitted is None:
            refusals["residual"] += 1
            continue
        cx, cy, radius, residual = fitted
        if not MIN_WIDTH * scale <= radius <= MAX_WIDTH * scale:
            refusals["radius out of bounds"] += 1
            continue
        if residual > FIT_RESIDUAL:
            refusals["residual"] += 1
            continue
        span = angular_span(points, cx, cy)
        if not SPAN_MIN <= span <= SPAN_MAX:
            if PARTIAL_MIN <= span < SPAN_MIN:
                partials.append(
                    {
                        "drawing": index,
                        "hinge": (cx, cy),
                        "radius": radius,
                        "span": span,
                        "residual": residual,
                    }
                )
            refusals["coverage"] += 1
            continue
        ends = arc_ends(points, cx, cy)
        lengths = [leaf_length(segments, (cx, cy), end) for end in ends]
        if max(lengths) < LEAF_COVER * radius:
            # A quarter circle without a leaf is not a door: nothing says
            # which side the leaf opens to, and the script does not guess.
            refusals["coverage"] += 1
            continue
        leaf = ends[lengths.index(max(lengths))]
        closed = ends[1 - lengths.index(max(lengths))]
        doors.append(
            {
                "drawing": index,
                "hinge": (cx, cy),
                "radius": radius,
                "residual": residual,
                "span": span,
                "closed": unit((closed[0] - cx, closed[1] - cy)),
                "swing": unit((leaf[0] - cx, leaf[1] - cy)),
            }
        )
    return dedupe(doors), partials, refusals


def dedupe(doors):
    """Two arcs at the same centre and radius are the same symbol."""
    kept = []
    for door in doors:
        twin = next(
            (
                other
                for other in kept
                if math.hypot(other["hinge"][0] - door["hinge"][0], other["hinge"][1] - door["hinge"][1])
                <= DUPLICATE_TOL
                and abs(other["radius"] - door["radius"]) <= DUPLICATE_TOL
            ),
            None,
        )
        if twin is None:
            kept.append(door)
    return kept


def to_metres(doors, origin, scale):
    """Doors brought back to the level frame, in metres."""
    result = []
    for door in doors:
        hinge = ((door["hinge"][0] - origin[0]) / scale, (door["hinge"][1] - origin[1]) / scale)
        width = door["radius"] / scale
        closed, swing = door["closed"], door["swing"]
        far = (hinge[0] + width * closed[0], hinge[1] + width * closed[1])
        result.append(
            {
                "hinge": [round(hinge[0], 4), round(hinge[1], 4)],
                "width": round(width, 4),
                "closed": [round(closed[0], 4), round(closed[1], 4)],
                "swing": [round(swing[0], 4), round(swing[1], 4)],
                "opening": [
                    [round(hinge[0], 4), round(hinge[1], 4)],
                    [round(far[0], 4), round(far[1], 4)],
                ],
                "axis": "x" if abs(closed[0]) >= abs(closed[1]) else "z",
                "fitResidual": round(door["residual"], 4),
                "span": round(door["span"], 2),
            }
        )
    result.sort(key=lambda door: (door["axis"], door["opening"][0][0], door["opening"][0][1]))
    for index, door in enumerate(result):
        door["id"] = f"d{index + 1}"
    return result


def frame_from_registry(registry, pages):
    """Origin and scale of the level, from the closed dimension chains.

    Same rule as `derive_outline.py`: the extent is the axis's largest closed
    total, and the origin is read on the first segment of the first anchored
    chain. An axis without a closed chain is not guessed.
    """
    selected = [page for page in registry["pages"] if pages is None or page["index"] in pages]
    if not selected:
        raise SystemExit("no registry page matches --pages")
    origins, scale, missing = {}, None, []
    for axis in ("x", "z"):
        chains = [
            chain
            for page in selected
            for chain in page["chains"]
            if chain["axis"] == ("horizontal" if axis == "x" else "vertical") and chain["closed"]
        ]
        if not chains:
            missing.append(axis)
            continue
        extent = max(chain["sum"] for chain in chains)
        anchored = [chain for chain in chains if abs(chain["sum"] - extent) <= 0.005]
        chain = anchored[0]
        scale = chain.get("printedPointsPerMetre") or chain.get("impliedPointsPerMetre")
        first = chain["segments"][0]
        origins[axis] = round(first["at"][AXIS_INDEX[axis]] - first["value"] / 2 * scale, 3)
    if missing:
        raise SystemExit(
            "axis/axes "
            + ", ".join(missing)
            + " without a closed dimension chain: pass --origin, the script does not guess"
        )
    return (origins["x"], origins["z"]), scale


def wall_frame(wall):
    """Axis, length and unit vector of a project wall."""
    start, end = wall["start"], wall["end"]
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    if length == 0:
        return None
    return (end[0] - start[0]) / length, (end[1] - start[1]) / length, length


def project_openings(project, level_id):
    """Leaf openings of the level, with their interval along the wall."""
    level = next((item for item in project["levels"] if item["id"] == level_id), None)
    if level is None:
        raise SystemExit(f"level {level_id} missing from the project")
    openings = []
    for wall in level["walls"]:
        frame = wall_frame(wall)
        if frame is None:
            continue
        ux, uz, length = frame
        for opening in wall.get("openings", []):
            if opening.get("kind") not in ("door",):
                continue
            start = opening["offset"]
            stop = start + opening["width"]
            if start < -0.01 or stop > length + 0.01:
                continue
            point = lambda along: (wall["start"][0] + ux * along, wall["start"][1] + uz * along)
            hinge_end = opening.get("hinge", "start") == "end"
            openings.append(
                {
                    "id": opening["id"],
                    "wall": wall["id"],
                    "thickness": wall["thickness"],
                    "axis": "x" if abs(ux) >= abs(uz) else "z",
                    "direction": [round(ux, 4), round(uz, 4)],
                    "start": point(start),
                    "stop": point(stop),
                    "width": opening["width"],
                    "hinge": point(stop if hinge_end else start),
                    "hingeEnd": hinge_end,
                    "swing": opening.get("swing", 1),
                    "exterior": bool(opening.get("exterior")),
                }
            )
    return openings


def along(point, origin, direction):
    return (point[0] - origin[0]) * direction[0] + (point[1] - origin[1]) * direction[1]


def across(point, origin, direction):
    return (point[0] - origin[0]) * -direction[1] + (point[1] - origin[1]) * direction[0]


def compare(doors, openings, tolerance):
    """Pairs the doors read with the doors written, and lists the gaps.

    The position gap is measured **along the wall**: it is the only coordinate
    describing the door. The perpendicular gap is reported separately, because it
    equals half the wall thickness — the hinge is drawn on the face, the project
    carries it on the axis — and counting it as an error would be wrong. Beyond
    `WALL_SHIFT`, it is no longer the door that is shifted but the project wall,
    and the report says so separately.

    Pairing is **one to one**: two written openings cannot designate the same arc,
    otherwise the second is compared with the neighbour and the gap hides. Pairs are
    taken from the closest to the farthest.
    """
    candidates = []
    for opening in openings:
        direction = opening["direction"]
        for door in doors:
            if door["axis"] != opening["axis"]:
                continue
            if abs(door["closed"][0] * direction[0] + door["closed"][1] * direction[1]) < 0.99:
                continue
            offset = abs(across(door["hinge"], opening["start"], direction))
            if offset > MATCH_ACROSS:
                continue
            centre = along(
                (
                    (door["opening"][0][0] + door["opening"][1][0]) / 2,
                    (door["opening"][0][1] + door["opening"][1][1]) / 2,
                ),
                opening["start"],
                direction,
            )
            candidates.append((abs(centre - opening["width"] / 2), opening, door, offset, centre))
    candidates.sort(key=lambda item: item[0])
    taken_openings, taken_doors, pairs = set(), set(), {}
    for distance, opening, door, offset, centre in candidates:
        if opening["id"] in taken_openings or door["id"] in taken_doors:
            continue
        taken_openings.add(opening["id"])
        taken_doors.add(door["id"])
        pairs[opening["id"]] = (door, offset, centre)
    rows = []
    for opening in openings:
        if opening["id"] not in pairs:
            rows.append({"opening": opening["id"], "wall": opening["wall"], "matched": None})
            continue
        door, offset, centre = pairs[opening["id"]]
        direction = opening["direction"]
        hinge_along = along(door["hinge"], opening["start"], direction)
        rows.append(
            {
                "opening": opening["id"],
                "wall": opening["wall"],
                "matched": door["id"],
                "deltaCentre": round(centre - opening["width"] / 2, 4),
                "deltaWidth": round(door["width"] - opening["width"], 4),
                "hingeAt": round(hinge_along, 4),
                "hingeEnd": opening["hingeEnd"],
                "hingeEndAgrees": (hinge_along < opening["width"] / 2) != opening["hingeEnd"],
                "offsetAcross": round(offset, 4),
                "halfThickness": round(opening["thickness"] / 2, 4),
                "wallShifted": offset > opening["thickness"] / 2 + WALL_SHIFT,
                "swing": opening["swing"],
                "swingDirection": door["swing"],
                "within": abs(centre - opening["width"] / 2) <= tolerance,
            }
        )
    extra = [door["id"] for door in doors if door["id"] not in taken_doors]
    return rows, extra


def self_test():
    """Non-regression on a synthetic drawing: a partition, a break, an arc.

    The drawing is rendered on the fly from the JSON fixture: no real data enters
    the repository, and the decoys — hatching, full circle, half arc — are replayed
    so that the rejection rule does not get lost.
    """
    fixture = json.loads((FIXTURE / "drawing.json").read_text(encoding="utf-8"))
    failures = []
    path = render_fixture(fixture)
    document = pymupdf.open(path)
    page = document[0]
    doors, partials, refusals = detect(page, fixture["scale"])
    expected = fixture["expected"]
    if len(doors) != expected["count"]:
        failures.append(f"{len(doors)} door(s) read instead of {expected['count']}: {refusals}")
        return failures
    if len(partials) != expected["partialArcs"]:
        failures.append(
            f"{len(partials)} partial arc(s) instead of {expected['partialArcs']}: {partials}"
        )
    elif abs(partials[0]["span"] - fixture["decoys"]["truncatedArc"][3]) > 1.0:
        failures.append(f"partial arc of {partials[0]['span']:.1f}° instead of 45°")
    door = doors[0]
    origin, scale = fixture["origin"], fixture["scale"]
    hinge = ((door["hinge"][0] - origin[0]) / scale, (door["hinge"][1] - origin[1]) / scale)
    if math.hypot(hinge[0] - expected["hinge"][0], hinge[1] - expected["hinge"][1]) > 0.01:
        failures.append(f"hinge {hinge} instead of {expected['hinge']}")
    if abs(door["radius"] / scale - expected["width"]) > 0.01:
        failures.append(f"width {door['radius'] / scale:.3f} instead of {expected['width']}")
    if abs(door["swing"][0] - expected["swing"][0]) > 0.01 or abs(
        door["swing"][1] - expected["swing"][1]
    ) > 0.01:
        failures.append(f"swing {door['swing']} instead of {expected['swing']}")
    if abs(door["closed"][0] - expected["closed"][0]) > 0.01 or abs(
        door["closed"][1] - expected["closed"][1]
    ) > 0.01:
        failures.append(f"opening {door['closed']} instead of {expected['closed']}")
    if refusals["coverage"] < 2:
        failures.append(f"the coverage decoys were not ruled out: {refusals}")
    if refusals["filled"] < 1:
        failures.append(f"the filled decoy was not ruled out: {refusals}")
    failures += _self_test_frame()
    failures += _self_test_compare()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("interior doors: self-test passed")
    return 0


def render_fixture(fixture):
    """Renders the fixture as a PDF: partitions, leaf, arc and three decoys."""
    scale, origin = fixture["scale"], fixture["origin"]
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)

    def point(x, z):
        return (origin[0] + x * scale, origin[1] + z * scale)

    for x0, z0, x1, z1 in fixture["partitions"]:
        page.draw_rect(
            pymupdf.Rect(*point(x0, z0), *point(x1, z1)),
            color=None,
            fill=tuple(fixture["wallFill"]),
        )
    for door in fixture["doors"]:
        hinge = door["hinge"]
        width = door["width"]
        closed, swing = door["closed"], door["swing"]
        # The leaf, drawn open: a thin rectangle from the hinge to the end,
        # thick along the wall axis and long along the swing axis.
        half = 0.02
        leaf = [
            point(hinge[0] + closed[0] * half, hinge[1] + closed[1] * half),
            point(hinge[0] - closed[0] * half, hinge[1] - closed[1] * half),
            point(
                hinge[0] - closed[0] * half + swing[0] * width,
                hinge[1] - closed[1] * half + swing[1] * width,
            ),
            point(
                hinge[0] + closed[0] * half + swing[0] * width,
                hinge[1] + closed[1] * half + swing[1] * width,
            ),
            point(hinge[0] + closed[0] * half, hinge[1] + closed[1] * half),
        ]
        page.draw_polyline(leaf, color=(0.0, 0.0, 0.0), width=0.48)
        # The arc, as a polyline of small segments like on real plans.
        steps = 12
        arc = []
        for step in range(steps + 1):
            angle = math.atan2(closed[1], closed[0]) + step * (math.pi / 2) / steps
            arc.append(point(hinge[0] + width * math.cos(angle), hinge[1] + width * math.sin(angle)))
        page.draw_polyline(arc, color=(0.0, 0.0, 0.0), width=0.48)
    decoys = fixture["decoys"]
    # Decoy 1: hatching, made of short, dense segments.
    x0, z0, x1, z1 = decoys["hatch"]
    step = 0.06
    offset = 0.0
    while offset < (x1 - x0) + (z1 - z0):
        start = (x0 + offset, z0)
        stop = (x0, z0 + offset)
        page.draw_line(point(*start), point(*stop), color=(0.0, 0.0, 0.0), width=0.24)
        offset += step
    # Decoy 2: a full circle, with a plausible radius.
    cx, cz, radius = decoys["circle"]
    circle = [
        point(cx + radius * math.cos(2 * math.pi * step / 36), cz + radius * math.sin(2 * math.pi * step / 36))
        for step in range(37)
    ]
    page.draw_polyline(circle, color=(0.0, 0.0, 0.0), width=0.48)
    # Decoy 3: a half arc, with a plausible radius, without a leaf.
    hx, hz, half = decoys["halfArc"]
    half_arc = [
        point(hx + half * math.cos(math.pi * step / 24), hz + half * math.sin(math.pi * step / 24))
        for step in range(25)
    ]
    page.draw_polyline(half_arc, color=(0.0, 0.0, 0.0), width=0.48)
    # Decoy 4: a truncated arc, like the second leaf of a French window:
    # it is reported as a partial arc, it is not counted as a door.
    tx, tz, radius, degrees = decoys["truncatedArc"]
    truncated = [
        point(
            tx + radius * math.cos(math.radians(degrees) * step / 12),
            tz + radius * math.sin(math.radians(degrees) * step / 12),
        )
        for step in range(13)
    ]
    page.draw_polyline(truncated, color=(0.0, 0.0, 0.0), width=0.48)
    path = str(Path(tempfile.mkdtemp()) / "self-test-doors.pdf")
    document.save(path)
    return path


def _self_test_frame():
    """The frame is deduced from closed chains, and refuses to guess."""
    failures = []
    registry = {
        "pages": [
            {
                "index": 1,
                "chains": [
                    {
                        "axis": "horizontal",
                        "closed": True,
                        "sum": 10.0,
                        "printedPointsPerMetre": 40.0,
                        "segments": [{"value": 4.0, "at": [180.0, 50.0]}],
                    },
                    {
                        "axis": "vertical",
                        "closed": True,
                        "sum": 8.0,
                        "printedPointsPerMetre": 40.0,
                        "segments": [{"value": 2.0, "at": [40.0, 140.0]}],
                    },
                ],
            }
        ]
    }
    origin, scale = frame_from_registry(registry, [1])
    if origin != (100.0, 100.0) or scale != 40.0:
        failures.append(f"frame {origin} × {scale} instead of (100.0, 100.0) × 40.0")
    registry["pages"][0]["chains"] = registry["pages"][0]["chains"][:1]
    try:
        frame_from_registry(registry, [1])
        failures.append("an axis without a closed chain was guessed")
    except SystemExit as error:
        if "does not guess" not in str(error):
            failures.append(f"unexpected refusal on the axis without a chain: {error}")
    return failures


def _self_test_compare():
    """The comparison measures along the wall and reports the perpendicular gap."""
    failures = []
    project = {
        "levels": [
            {
                "id": "rdc",
                "walls": [
                    {
                        "id": "cloison",
                        "start": [0.0, 3.0],
                        "end": [6.0, 3.0],
                        "thickness": 0.10,
                        "openings": [
                            {"id": "p1", "kind": "door", "offset": 2.0, "width": 0.73, "hinge": "start"},
                            {"id": "p2", "kind": "sliding", "offset": 4.0, "width": 1.2},
                        ],
                    }
                ],
            }
        ]
    }
    openings = project_openings(project, "rdc")
    if len(openings) != 1:
        failures.append(f"{len(openings)} leaf opening(s) instead of one (does the sliding door count?)")
        return failures
    doors = [
        {
            "id": "d1",
            "hinge": [2.0, 3.05],
            "width": 0.73,
            "closed": [1.0, 0.0],
            "swing": [0.0, 1.0],
            "opening": [[2.0, 3.05], [2.73, 3.05]],
            "axis": "x",
        },
        {
            "id": "d2",
            "hinge": [2.0, 5.0],
            "width": 0.73,
            "closed": [1.0, 0.0],
            "swing": [0.0, 1.0],
            "opening": [[2.0, 5.0], [2.73, 5.0]],
            "axis": "x",
        },
    ]
    rows, extra = compare(doors, openings, 0.05)
    if rows[0]["matched"] != "d1":
        failures.append(f"pairing {rows[0]['matched']} instead of d1 (the neighbour 2 m away was taken)")
    if abs(rows[0]["deltaCentre"]) > 0.001:
        failures.append(f"position gap {rows[0]['deltaCentre']} instead of 0")
    if abs(rows[0]["offsetAcross"] - 0.05) > 0.001:
        failures.append(f"perpendicular gap {rows[0]['offsetAcross']} instead of 0.05")
    if extra != ["d2"]:
        failures.append(f"unpaired door {extra} instead of d2")
    return failures


def main(argv):
    if "--self-test" in argv:
        return self_test()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("page", type=int)
    parser.add_argument("out", nargs="?")
    parser.add_argument("--scale", type=float, default=None, help="points per metre")
    parser.add_argument("--origin", default=None, help="x0,y0 of the level's north-west corner, in points")
    parser.add_argument("--registry", default=None, help="evidence registry, to deduce the frame")
    parser.add_argument("--pages", default=None, help="registry pages, e.g. 8 or 13,14")
    parser.add_argument("--compare", default=None, help="project JSON to compare against")
    parser.add_argument("--level", default=None, help="project level to compare against")
    parser.add_argument("--tolerance", type=float, default=0.05, help="accepted position gap, m")
    args = parser.parse_args(argv[1:])
    pages = [int(value) for value in args.pages.split(",")] if args.pages else None
    if args.registry:
        registry = json.loads(Path(args.registry).read_text(encoding="utf-8"))
        origin, scale = frame_from_registry(registry, pages or [args.page])
    else:
        if args.scale is None or args.origin is None:
            parser.error("pass --scale and --origin, or --registry to deduce them")
        origin = tuple(float(value) for value in args.origin.split(","))
        if len(origin) != 2:
            parser.error("--origin attend x0,y0")
        scale = args.scale
    document = pymupdf.open(args.pdf)
    page = document[args.page - 1]
    doors, partials, refusals = detect(page, scale)
    metres = to_metres(doors, origin, scale)
    payload = {
        "schemaVersion": 1,
        "generatedBy": "scripts/extract_doors.py",
        "source": {"file": Path(args.pdf).name, "page": args.page},
        "frame": {"origin": list(origin), "pointsPerMetre": round(scale, 4)},
        "doors": metres,
        "partialArcs": [
            {
                "hinge": [
                    round((arc["hinge"][0] - origin[0]) / scale, 4),
                    round((arc["hinge"][1] - origin[1]) / scale, 4),
                ],
                "width": round(arc["radius"] / scale, 4),
                "span": round(arc["span"], 2),
            }
            for arc in partials
        ],
        "refusals": refusals,
    }
    print(
        f"{len(metres)} door(s) read on page {args.page} "
        f"({refusals['filled']} filled path(s), {refusals['residual']} cluster(s) off the circle, "
        f"{refusals['coverage']} arc(s) out of coverage or without a leaf discarded)"
    )
    for door in metres:
        print(
            f"  {door['id']} hinge ({door['hinge'][0]:.3f}, {door['hinge'][1]:.3f}) "
            f"width {door['width']:.3f} m, opening towards ({door['closed'][0]:+.0f}, "
            f"{door['closed'][1]:+.0f}), swing towards ({door['swing'][0]:+.0f}, "
            f"{door['swing'][1]:+.0f})"
        )
    for arc in payload["partialArcs"]:
        print(
            f"  partial arc ({arc['hinge'][0]:.3f}, {arc['hinge'][1]:.3f}) "
            f"width {arc['width']:.3f} m, coverage {arc['span']:.1f}° — not counted as a door"
        )
    status = 0
    if args.compare:
        if not args.level:
            parser.error("--compare requires --level")
        project = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        openings = project_openings(project, args.level)
        rows, extra = compare(metres, openings, args.tolerance)
        payload["comparison"] = {
            "project": Path(args.compare).name,
            "level": args.level,
            "tolerance": args.tolerance,
            "rows": rows,
            "unmatchedDoors": extra,
        }
        print(f"\ncomparison with level {args.level} of {Path(args.compare).name}:")
        for row in rows:
            if row["matched"] is None:
                print(f"  {row['opening']:22s} ({row['wall']})  NO ARC READ")
                status = 1
                continue
            flag = "ok" if row["within"] else "GAP"
            notes = []
            if not row["hingeEndAgrees"]:
                notes.append("hinge on the other side")
            if row["wallShifted"]:
                notes.append(f"project wall shifted by {row['offsetAcross']:.2f} m")
            print(
                f"  {row['opening']:22s} ({row['wall']})  {row['matched']}  "
                f"position {row['deltaCentre']:+.3f} m  width {row['deltaWidth']:+.3f} m  "
                f"hinge at {row['hingeAt']:.3f} m  off-face {row['offsetAcross']:.3f} m  "
                f"{flag}" + (f"  [{', '.join(notes)}]" if notes else "")
            )
        if extra:
            print(f"  arc(s) without a written door: {', '.join(extra)}")
        matched = sum(1 for row in rows if row["matched"] is not None)
        within = sum(1 for row in rows if row.get("within"))
        shifted = sum(1 for row in rows if row.get("wallShifted"))
        flipped = sum(1 for row in rows if row.get("matched") and not row["hingeEndAgrees"])
        print(
            f"  {matched}/{len(openings)} written door(s) paired, "
            f"{within} within ±{args.tolerance * 100:.0f} cm along the wall, "
            f"{flipped} hinge(s) on the other side, {shifted} project wall(s) shifted"
        )
        if matched != len(openings) or within != len(openings) or extra:
            status = 1
    if args.out:
        Path(args.out).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"-> {args.out}")
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv))
