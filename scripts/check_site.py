"""Site check: terrain and roof against the site plan.

Rooms have their gate (`check_plan_surfaces.py`); terrain and roof had nothing. A
`site` written without going back to the document may carry a wrong plot, a roof
28 cm too high or a house in the wrong place without any command saying so.

Five checkpoints, each assuming the previous one:

1. **The plot.** Shoelace side lengths and polygon area, compared with the printed
   side dimensions and « Surface : ». A dimension may split a side into pieces:
   collinear labels add up.
2. **The siting.** Distance from each side to the level outline, and dimension
   chains whose sum equals a side: every chain segment must land on the computed
   split of the side (setback, footprint, setback). That is what catches a plot
   that is well dimensioned but misplaced: lengths may land right with the house
   in the wrong place.
3. **The levels.** Egout (eaves) and Faitage (ridge) minus RDC, compared with the
   `y` of the roof vertices — everything is brought back to the level's frame, not
   to the title block's reference: `Egout +3.01` minus `RDC +0.28` is 2.73, not
   3.01.
4. **The roof topology.** Gables and eaves found per façade from `gables` and
   `faces`, with their overhang. A floating gable, or a façade carrying both a
   gable and eaves, shows here.
5. **The terrain surfaces.** Only one is dimensioned: the one matching a printed
   rectangular area. The others are flagged, so that they stay declared in
   `site.notes` and do not pass for dimensions.

REFUSE: missing site, unclosed plot, side dimension without a side in the model,
eaves or ridge beyond the tolerance, side whose dimension chain does not land on
the computed split, level outline leaving the plot, topology issue.

FLAG: sides without a printed dimension, undimensioned setbacks (they are
deduced), undimensioned terrain surfaces, unprinted levels, façades without a roof.

Traps carried by the script:

- **The drawing's eaves are not the dimensioned eaves.** The drawing's line is the
  top of the gutter, the dimension is the water line: a 15 to 20 cm gap at that
  spot comes from the drawing, not from the model. Do not « correct » the roof to
  make it land on the drawing: the comparison is made on the dimensions, and the
  drawing/dimension gap is named when it appears.
- **Undimensioned setbacks are deduced**: the script returns them, without
  judging them.
- **The project's frame is not the drawing's**: only distances and lengths are
  compared, never coordinates.

Usage:
  python scripts/check_site.py <registry.json> <project.json> [--page 6] \
      [--level rdc] [--tolerance 0.05] [--area-tolerance 0.5] [--json output.json]
"""
import argparse
import json
import math
import sys
import unicodedata
from itertools import combinations
from pathlib import Path

DEFAULT_TOLERANCE = 0.05  # m, accepted gap between printed dimension and computed value
DEFAULT_AREA_TOLERANCE = 0.5  # m², the printed area is rounded to the m²
DEGENERATE = 0.005  # m, below this, a side, a setback or an overhang is zero
COLLINEAR_TOL = 5.0  # pt, gap between label centres on the same line
ON_EDGE_TOL = 0.01  # m, a vertex flush with a boundary stays within the plot
TRACE_TOLERANCE = 0.5  # m, drawing gap accepted to pair a dimensioned surface
EAVE_DRAW_WINDOW = 0.20  # m, typical drawing/dimension gap at the gutter


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def fold(text):
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", str(text))
        if not unicodedata.combining(character)
    ).lower()


def formatted(value):
    if isinstance(value, str):
        return value
    return f"{value:.2f}"


# --------------------------------------------------------------------------
# geometry: lengths, areas, distances — no interpretation
# --------------------------------------------------------------------------


def distance(a, b):
    return math.dist(a, b)


def point_segment_distance(point, start, end):
    span = distance(start, end)
    if span <= 0:
        return distance(point, start)
    along = (
        (point[0] - start[0]) * (end[0] - start[0])
        + (point[1] - start[1]) * (end[1] - start[1])
    ) / (span * span)
    along = max(0.0, min(1.0, along))
    return distance(
        point, (start[0] + along * (end[0] - start[0]), start[1] + along * (end[1] - start[1]))
    )


def segments_distance(a, b, c, d):
    """Minimum distance between two segments: each end against the other."""
    return min(
        point_segment_distance(a, c, d),
        point_segment_distance(b, c, d),
        point_segment_distance(c, a, b),
        point_segment_distance(d, a, b),
    )


def polygon_area(points):
    total = 0.0
    for index, a in enumerate(points):
        b = points[(index + 1) % len(points)]
        total += a[0] * b[1] - b[0] * a[1]
    return abs(total) / 2


def contains_point(points, x, z):
    inside = False
    for index, a in enumerate(points):
        b = points[(index + 1) % len(points)]
        if (a[1] > z) != (b[1] > z):
            crossing = a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x < crossing:
                inside = not inside
    return inside


def on_boundary(boundary, point, tolerance):
    return any(
        point_segment_distance(point, boundary[i], boundary[(i + 1) % len(boundary)]) <= tolerance
        for i in range(len(boundary))
    )


def segments_cross(p1, p2, p3, p4):
    """Clear crossing only: a vertex flush with a boundary is not a crossing,
    otherwise every façade set on the boundary would be flagged. A zero turn
    (vertex or segment on the boundary) rules out crossing."""

    def turn(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    d1 = turn(p3, p4, p1)
    d2 = turn(p3, p4, p2)
    d3 = turn(p1, p2, p3)
    d4 = turn(p1, p2, p4)
    if min(abs(d1), abs(d2), abs(d3), abs(d4)) < 1e-9:
        return False
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def polygon_inside(boundary, outline):
    """The level fits in the plot: vertices inside or flush, no edge crossing a
    boundary."""
    for point in outline:
        if not contains_point(boundary, point[0], point[1]) and not on_boundary(
            boundary, point, ON_EDGE_TOL
        ):
            return False
    for i in range(len(outline)):
        for j in range(len(boundary)):
            if segments_cross(
                outline[i], outline[(i + 1) % len(outline)],
                boundary[j], boundary[(j + 1) % len(boundary)],
            ):
                return False
    return True


# --------------------------------------------------------------------------
# registry: reading the printed dimensions
# --------------------------------------------------------------------------


def find_page(registry, page_index):
    pages = registry.get("pages") or []
    if page_index is None:
        if len(pages) == 1:
            return pages[0]
        raise ValueError("the registry covers several pages: pass --page")
    for page in pages:
        if page.get("index") == page_index:
            return page
    raise ValueError(f"page {page_index} missing from the registry")


def named_levels(labels, key):
    """Printed values of a named label (rdc, egout, faitage…)."""
    return [
        label["value"]
        for label in labels.get("namedLevels") or []
        if fold(label.get("name")) == key
    ]


def chain_values(chain):
    return [segment.get("value") or 0.0 for segment in chain.get("segments") or []]


def chain_text(chain):
    return " | ".join(f"{value:.2f}" for value in chain_values(chain))


def collinear(label_a, label_b):
    if bool(label_a.get("horizontal")) != bool(label_b.get("horizontal")):
        return False
    axis = 1 if label_a.get("horizontal") else 0
    return abs(label_a["at"][axis] - label_b["at"][axis]) <= COLLINEAR_TOL


def collinear_group(labels):
    for label_a in labels:
        for label_b in labels:
            if label_a is not label_b and not collinear(label_a, label_b):
                return False
    return True


def printed_side_text(labels):
    if len(labels) == 1:
        return f"{labels[0]['value']:.2f}"
    total = " + ".join(f"{label['value']:.2f}" for label in labels)
    return f"{total} (split)"


# --------------------------------------------------------------------------
# checkpoint 1: plot sides and area
# --------------------------------------------------------------------------


def model_boundary_sides(boundary):
    sides = []
    for index in range(len(boundary)):
        start = boundary[index]
        end = boundary[(index + 1) % len(boundary)]
        sides.append({"index": index, "start": start, "end": end, "length": distance(start, end)})
    return sides


def match_printed_sides(printed, sides, tolerance):
    """Pairs side dimensions with the model's sides: single value first, then the
    sum of collinear split dimensions. Each dimension is used once."""
    available = [dict(label, used=False) for label in printed]
    for side in sides:
        candidates = [
            label
            for label in available
            if not label["used"] and abs(label["value"] - side["length"]) <= tolerance
        ]
        if candidates:
            best = min(candidates, key=lambda label: abs(label["value"] - side["length"]))
            best["used"] = True
            side["printed"] = [best]
            continue
        # split dimension: sum of the remaining collinear labels
        pool = [label for label in available if not label["used"]]
        chosen = None
        for size in (2, 3):
            if chosen or len(pool) < size:
                continue
            for group in combinations(pool, size):
                if collinear_group(group) and abs(
                    sum(label["value"] for label in group) - side["length"]
                ) <= tolerance:
                    chosen = group
                    break
            if chosen:
                break
        side["printed"] = list(chosen) if chosen else None
        if chosen:
            for label in chosen:
                label["used"] = True
    rows = []
    for side in sides:
        if side.get("printed"):
            total = sum(label["value"] for label in side["printed"])
            delta = side["length"] - total
            rows.append(
                {
                    "label": f"side {side['index'] + 1}",
                    "printed": round(total, 3),
                    "printedText": printed_side_text(side["printed"]),
                    "computed": round(side["length"], 3),
                    "delta": round(delta, 4),
                    "verdict": "exact" if abs(delta) <= tolerance else "gap",
                    "detail": None,
                }
            )
        else:
            rows.append(
                {
                    "label": f"side {side['index'] + 1}",
                    "printed": None,
                    "printedText": None,
                    "computed": round(side["length"], 3),
                    "delta": None,
                    "verdict": "no printed dimension — deduced from the others",
                    "detail": None,
                }
            )
    rows.extend(
        {
            "label": "dimension without a side",
            "printed": round(label["value"], 3),
            "printedText": label["text"],
            "computed": None,
            "delta": None,
            "verdict": "dimension without a side in the model",
            "detail": None,
        }
        for label in available
        if not label["used"]
    )
    return rows


def parcel_rows(page, site, tolerance, area_tolerance):
    labels = page.get("labels") or {}
    printed_sides = labels.get("parcelSides") or []
    boundary = site["boundary"]
    rows = []
    if len(boundary) < 3:
        rows.append(
            {
                "label": "parcelle",
                "printed": None,
                "printedText": f"{len(boundary)} sommet(s)",
                "computed": None,
                "delta": None,
                "verdict": "plot not closed",
                "detail": None,
            }
        )
        return rows
    sides = model_boundary_sides(boundary)
    if any(side["length"] < DEGENERATE for side in sides):
        rows.append(
            {
                "label": "parcelle",
                "printed": None,
                "printedText": "zero-length side",
                "computed": None,
                "delta": None,
                "verdict": "plot not closed",
                "detail": None,
            }
        )
    else:
        rows.extend(match_printed_sides(printed_sides, sides, tolerance))
    printed_areas = labels.get("parcelAreas") or []
    computed_area = polygon_area(boundary)
    if printed_areas:
        printed_area = printed_areas[0]["area"]
        rows.append(
            {
                "label": "plot area",
                "printed": printed_area,
                "printedText": printed_areas[0]["text"],
                "computed": round(computed_area, 2),
                "delta": round(computed_area - printed_area, 2),
                "verdict": (
                    "exact"
                    if abs(computed_area - printed_area) <= area_tolerance
                    else "gap"
                ),
                "detail": None,
            }
        )
        if site.get("declaredArea") is not None:
            delta = site["declaredArea"] - printed_area
            rows.append(
                {
                    "label": "site declaredArea",
                    "printed": printed_area,
                    "printedText": None,
                    "computed": site["declaredArea"],
                    "delta": round(delta, 2),
                    "verdict": "exact" if abs(delta) <= area_tolerance else "gap",
                    "detail": None,
                }
            )
    else:
        rows.append(
            {
                "label": "plot area",
                "printed": None,
                "printedText": None,
                "computed": round(computed_area, 2),
                "delta": None,
                "verdict": "no « Surface » printed",
                "detail": None,
            }
        )
    return rows


# --------------------------------------------------------------------------
# checkpoint 2: siting — split of the sides and setbacks
# --------------------------------------------------------------------------


def side_layout(side, outline):
    """Split of a side by the level outline, projected onto it.

    Returns the sequence of pieces from the side's first vertex: setback,
    footprint, setback. A distance is compared, never a coordinate: it is the length
    of each piece that is read, in that order.
    """
    start = side["start"]
    length = side["length"]
    direction = (
        (side["end"][0] - start[0]) / length,
        (side["end"][1] - start[1]) / length,
    )
    positions = [
        (point[0] - start[0]) * direction[0] + (point[1] - start[1]) * direction[1]
        for point in outline
    ]
    low = max(0.0, min(positions))
    high = min(length, max(positions))
    pieces = []
    if low > DEGENERATE:
        pieces.append(("setback", low))
    if high - low > DEGENERATE:
        pieces.append(("footprint", high - low))
    if length - high > DEGENERATE:
        pieces.append(("setback", length - high))
    return pieces


def chain_fits(pieces, values, tolerance):
    """Every piece lands on a sum of consecutive segments of the chain. The chain
    may be finer than the split (it splits a setback into runs), never coarser: a
    segment does not cross a change of piece. Order matters; the drawing's reading
    direction is unknown, so the chain is tried both ways.
    """

    def consume(piece_index, value_index, chain):
        if piece_index == len(pieces) and value_index == len(chain):
            return True
        if piece_index == len(pieces) or value_index == len(chain):
            return False
        target = pieces[piece_index][1]
        total = 0.0
        index = value_index
        while index < len(chain):
            total += chain[index]
            if abs(total - target) <= tolerance and consume(piece_index + 1, index + 1, chain):
                return True
            if total > target + tolerance:
                return False
            index += 1
        return False

    return consume(0, 0, values) or consume(0, 0, list(reversed(values)))


def implantation_rows(page, sides, outline, boundary, tolerance):
    rows = []
    verified_gaps = []
    for chain in page.get("chains") or []:
        values = chain_values(chain)
        if not values:
            continue
        total = sum(values)
        candidates = [side for side in sides if abs(side["length"] - total) <= tolerance]
        if not candidates:
            rows.append(
                {
                    "label": "chain outside the plot",
                    "printed": round(total, 3),
                    "printedText": chain_text(chain),
                    "computed": None,
                    "delta": None,
                    "verdict": "sum without a plot side — not checked",
                    "detail": None,
                }
            )
            continue
        strong = None
        weak = None
        for side in candidates:
            pieces = side_layout(side, outline)
            if chain_fits(pieces, values, tolerance):
                if any(kind == "footprint" for kind, _ in pieces):
                    strong = side
                    break
                weak = (side, pieces)
        if strong:
            pieces = side_layout(strong, outline)
            verified_gaps.extend(length for kind, length in pieces if kind == "setback")
            rows.append(
                {
                    "label": f"chain — side {strong['index'] + 1}",
                    "printed": round(total, 3),
                    "printedText": chain_text(chain),
                    "computed": round(strong["length"], 3),
                    "delta": round(strong["length"] - total, 4),
                    "verdict": "exact",
                    "detail": "morcellement : "
                    + ", ".join(f"{kind} {length:.2f}" for kind, length in pieces),
                }
            )
        elif weak:
            side, pieces = weak
            verified_gaps.extend(length for kind, length in pieces if kind == "setback")
            rows.append(
                {
                    "label": f"chain — side {side['index'] + 1}",
                    "printed": round(total, 3),
                    "printedText": chain_text(chain),
                    "computed": None,
                    "delta": None,
                    "verdict": "checked in length — level not adjacent to this side",
                    "detail": None,
                }
            )
        else:
            names = ", ".join(
                f"side {side['index'] + 1} ({side['length']:.2f} m)" for side in candidates
            )
            computed_pieces = side_layout(candidates[0], outline)
            rows.append(
                {
                    "label": f"chain — {names}",
                    "printed": round(total, 3),
                    "printedText": chain_text(chain),
                    "computed": None,
                    "delta": None,
                    "verdict": "dimensioned setback that does not land",
                    "detail": "computed split: "
                    + ", ".join(f"{kind} {length:.2f}" for kind, length in computed_pieces),
                }
            )
    # setback from each side to the level outline
    outline_edges = list(zip(outline, list(outline[1:]) + [outline[0]]))
    for side in sides:
        recul = min(
            segments_distance(side["start"], side["end"], edge_start, edge_end)
            for edge_start, edge_end in outline_edges
        )
        printed = None
        if recul <= DEGENERATE:
            verdict = "affleurant"
        else:
            matches = [gap for gap in verified_gaps if abs(recul - gap) <= DEGENERATE]
            if matches:
                verdict = "dimensioned by a chain"
                printed = round(min(matches), 3)
            else:
                verdict = "not dimensioned — deduced"
        rows.append(
            {
                "label": f"setback side {side['index'] + 1} ({side['length']:.2f} m)",
                "printed": printed,
                "printedText": None,
                "computed": round(recul, 3),
                "delta": None,
                "verdict": verdict,
                "detail": None,
            }
        )
    if outline and not polygon_inside(boundary, outline):
        rows.append(
            {
                "label": "level within the plot",
                "printed": None,
                "printedText": None,
                "computed": None,
                "delta": None,
                "verdict": "the level outline leaves the plot",
                "detail": None,
            }
        )
    return rows, verified_gaps


# --------------------------------------------------------------------------
# checkpoint 3: levels — eaves and ridge brought back to the level frame
# --------------------------------------------------------------------------


def roof_extents(site):
    lowest = None
    highest = None
    for roof in site.get("roofs") or []:
        for _, y, _ in roof.get("vertices") or []:
            lowest = y if lowest is None else min(lowest, y)
            highest = y if highest is None else max(highest, y)
    return lowest, highest


def level_rows(page, site, tolerance):
    labels = page.get("labels") or {}
    reference = named_levels(labels, "rdc")
    rows = []
    if reference:
        rows.append(
            {
                "label": "RDC (frame)",
                "printed": reference[0],
                "printedText": None,
                "computed": None,
                "delta": None,
                "verdict": "frame: dimensions brought back to the RDC finished floor",
                "detail": None,
            }
        )
    lowest, highest = roof_extents(site)
    for key, kind, computed in (("egout", "eaves", lowest), ("faitage", "ridge", highest)):
        printed = named_levels(labels, key)
        if not printed:
            rows.append(
                {
                    "label": kind,
                    "printed": None,
                    "printedText": None,
                    "computed": None if computed is None else round(computed, 3),
                    "delta": None,
                    "verdict": "not printed",
                    "detail": None,
                }
            )
            continue
        if computed is None:
            rows.append(
                {
                    "label": kind,
                    "printed": round(printed[0], 3),
                    "printedText": None,
                    "computed": None,
                    "delta": None,
                    "verdict": "no roof in the site",
                    "detail": None,
                }
            )
            continue
        if not reference:
            rows.append(
                {
                    "label": kind,
                    "printed": round(printed[0], 3),
                    "printedText": None,
                    "computed": round(computed, 3),
                    "delta": None,
                    "verdict": "RDC not printed — level frame unknown",
                    "detail": None,
                }
            )
            continue
        expected = printed[0] - reference[0]
        delta = computed - expected
        detail = None
        if key == "egout" and tolerance < abs(delta) <= EAVE_DRAW_WINDOW:
            detail = (
                "gap consistent with the drawing's eaves (top of the gutter): "
                "the dimension is the water line — do not « correct » the roof to make it "
                "land on the drawing, decide on the dimension."
            )
        rows.append(
            {
                "label": kind,
                "printed": round(expected, 3),
                "printedText": f"{printed[0]:.2f} − RDC {reference[0]:.2f}",
                "computed": round(computed, 3),
                "delta": round(delta, 3),
                "verdict": "exact" if abs(delta) <= tolerance else "gap",
                "detail": detail,
            }
        )
    return rows


# --------------------------------------------------------------------------
# checkpoint 4: roof topology — gables and eaves per façade
# --------------------------------------------------------------------------


def model_edges(outline):
    edges = []
    for index in range(len(outline)):
        start = outline[index]
        end = outline[(index + 1) % len(outline)]
        length = distance(start, end)
        edges.append(
            {
                "index": index,
                "start": start,
                "end": end,
                "length": length,
                "unit": (
                    (end[0] - start[0]) / length,
                    (end[1] - start[1]) / length,
                )
                if length > 0
                else (0.0, 0.0),
            }
        )
    return edges


def line_offset(point, start, unit):
    return abs((point[0] - start[0]) * unit[1] - (point[1] - start[1]) * unit[0])


def along_line(point, start, unit):
    return (point[0] - start[0]) * unit[0] + (point[1] - start[1]) * unit[1]


def analyze_topology(outline, roofs, tolerance):
    edges = model_edges(outline)
    per_edge = {
        edge["index"]: {"pignons": 0, "egouts": [], "notes": []} for edge in edges
    }
    reserves = []
    for roof in roofs or []:
        vertices = roof.get("vertices") or []
        for gable in roof.get("gables") or []:
            if len(gable) != 3 or any(i >= len(vertices) for i in gable):
                reserves.append(f"{roof['id']} : pignon {gable} hors sommets")
                continue
            apex = max(gable, key=lambda i: vertices[i][1])
            base = [i for i in gable if i is not apex]
            points = [(vertices[i][0], vertices[i][2]) for i in base]
            holders = [
                edge
                for edge in edges
                if all(
                    line_offset(point, edge["start"], edge["unit"]) <= tolerance
                    and -tolerance
                    <= along_line(point, edge["start"], edge["unit"])
                    <= edge["length"] + tolerance
                    for point in points
                )
            ]
            if not holders:
                reserves.append(f"{roof['id']}: gable {gable} set on no façade")
                continue
            best = max(holders, key=lambda edge: sum(
                min(
                    along_line(point, edge["start"], edge["unit"]),
                    edge["length"] - along_line(point, edge["start"], edge["unit"]),
                )
                for point in points
            ))
            per_edge[best["index"]]["pignons"] += 1
            if len(holders) > 1:
                per_edge[best["index"]]["notes"].append(
                    f"gable {gable} aligned with several façades"
                )
        for face in roof.get("faces") or []:
            if len(face) < 3 or any(i >= len(vertices) for i in face):
                reserves.append(f"{roof['id']} : face {face} hors sommets")
                continue
            ordered = sorted(face, key=lambda i: vertices[i][1])
            a, b = ordered[0], ordered[1]
            start = (vertices[a][0], vertices[a][2])
            end = (vertices[b][0], vertices[b][2])
            span = distance(start, end)
            if span <= DEGENERATE:
                continue  # hip apex: no façade eaves
            unit = ((end[0] - start[0]) / span, (end[1] - start[1]) / span)
            candidates = []
            for edge in edges:
                if edge["length"] <= 0:
                    continue
                if abs(unit[0] * edge["unit"][1] - unit[1] * edge["unit"][0]) > 0.01:
                    continue  # not parallel: hip, valley…
                offset = (line_offset(start, edge["start"], edge["unit"]) + line_offset(end, edge["start"], edge["unit"])) / 2
                lo = min(
                    along_line(start, edge["start"], edge["unit"]),
                    along_line(end, edge["start"], edge["unit"]),
                )
                hi = max(
                    along_line(start, edge["start"], edge["unit"]),
                    along_line(end, edge["start"], edge["unit"]),
                )
                overlap = max(0.0, min(hi, edge["length"]) - max(lo, 0.0))
                if overlap > DEGENERATE:
                    candidates.append((offset, overlap, edge))
            if not candidates:
                continue
            best_offset = min(offset for offset, _, _ in candidates)
            for offset, overlap, edge in candidates:
                if abs(offset - best_offset) <= DEGENERATE:
                    per_edge[edge["index"]]["egouts"].append(round(offset, 3))
    rows = []
    for edge in edges:
        entry = per_edge[edge["index"]]
        if entry["pignons"] and entry["egouts"]:
            verdict = "issue: gable and eaves on the same façade"
        elif entry["pignons"]:
            verdict = f"{entry['pignons']} gable(s)"
        elif entry["egouts"]:
            debords = sorted({f"{value:.2f}" for value in entry["egouts"]})
            verdict = "eaves (overhang " + ", ".join(debords) + " m)"
        else:
            verdict = "no roof"
        if entry["notes"]:
            verdict += " — " + "; ".join(entry["notes"])
        rows.append(
            {
                "label": f"façade {edge['index'] + 1} ({edge['length']:.2f} m)",
                "printed": None,
                "printedText": None,
                "computed": entry["pignons"] + len(entry["egouts"]),
                "delta": None,
                "verdict": verdict,
                "detail": None,
            }
        )
    rows.extend(
        {
            "label": "roof",
            "printed": None,
            "printedText": None,
            "computed": None,
            "delta": None,
            "verdict": f"issue: {reserve}",
            "detail": None,
        }
        for reserve in reserves
    )
    return rows


# --------------------------------------------------------------------------
# checkpoint 5: terrain surfaces, dimensioned or not
# --------------------------------------------------------------------------


def surface_extents(polygon):
    xs = [point[0] for point in polygon]
    zs = [point[1] for point in polygon]
    return max(xs) - min(xs), max(zs) - min(zs)


def surface_rows(page, site, tolerance):
    labels = page.get("labels") or {}
    rects = labels.get("rectAreas") or []
    rows = []
    uncoted = 0
    for surface in site.get("surfaces") or []:
        width, depth = surface_extents(surface.get("polygon") or [])
        best = None
        for rect in rects:
            for rect_width, rect_depth in (
                (rect["width"], rect["depth"]),
                (rect["depth"], rect["width"]),
            ):
                error = max(
                    abs(width - rect_width), abs(depth - rect_depth)
                )
                if best is None or error < best[0]:
                    best = (error, rect)
        if best and best[0] <= TRACE_TOLERANCE:
            error, rect = best
            rows.append(
                {
                    "label": f"{surface['id']} ({width:.2f} x {depth:.2f} m)",
                    "printed": f"{rect['width']:.2f} x {rect['depth']:.2f}",
                    "printedText": rect["text"],
                    "computed": f"{width:.2f} x {depth:.2f}",
                    "delta": round(error, 3),
                    "verdict": "dimensioned" if error <= DEGENERATE else "dimensioned — drawing gap",
                    "detail": "flag only: the dimension is not carried over to the polygon",
                }
            )
        else:
            uncoted += 1
            rows.append(
                {
                    "label": f"{surface['id']} ({width:.2f} x {depth:.2f} m)",
                    "printed": None,
                    "printedText": None,
                    "computed": f"{width:.2f} x {depth:.2f}",
                    "delta": None,
                    "verdict": "not dimensioned — decision to keep in site.notes",
                    "detail": None,
                }
            )
    if uncoted and not (site.get("notes") or []):
        rows.append(
            {
                "label": "site.notes",
                "printed": None,
                "printedText": None,
                "computed": None,
                "delta": None,
                "verdict": f"{uncoted} undimensioned surface(s) and no note: "
                "declare them in site.notes",
                "detail": None,
            }
        )
    return rows


# --------------------------------------------------------------------------
# assemblage
# --------------------------------------------------------------------------


FAILURE_VERDICTS = (
    "gap",
    "dimension without a side in the model",
    "dimensioned setback that does not land",
    "plot not closed",
    "the level outline leaves the plot",
)

SIGNAL_PREFIXES = (
    "no printed dimension",
    "not dimensioned",
    "dimensioned — drawing gap",
    "no roof",
    "not printed",
    "no « Surface »",
    "sum without a plot side",
    "undimensioned surface(s)",
    "RDC not printed",
    "no roof in the site",
    "checked in length",
)


def verdict_class(verdict):
    """off: refusal; signal: to keep in site.notes; info: shown without judgement."""
    if verdict in FAILURE_VERDICTS or verdict.startswith("issue"):
        return "off"
    if verdict.startswith(SIGNAL_PREFIXES):
        return "signal"
    return "info"


def build(registry, project, level_id, page_index, tolerance, area_tolerance):
    site = project.get("site")
    if not site:
        raise ValueError("site missing from the project — terrain and roof cannot be checked")
    page = find_page(registry, page_index)
    level = None
    for candidate in project.get("levels") or []:
        if candidate.get("id") == level_id:
            level = candidate
            break
    if level is None:
        raise ValueError(f"level {level_id} missing from the project")
    outline = level.get("outline") or []
    boundary = site.get("boundary") or []
    rows_parcel = parcel_rows(page, site, tolerance, area_tolerance)
    sides = model_boundary_sides(boundary)
    rows_implantation, verified_gaps = implantation_rows(
        page, sides, outline, boundary, tolerance
    )
    rows_levels = level_rows(page, site, tolerance)
    rows_topology = analyze_topology(outline, site.get("roofs") or [], tolerance)
    rows_surfaces = surface_rows(page, site, tolerance)
    sections = [
        ("1. plot — sides and area", rows_parcel),
        ("2. siting — side chains and setbacks", rows_implantation),
        ("3. levels — eaves and ridge brought back to the RDC", rows_levels),
        ("4. roof topology — gables and eaves per façade", rows_topology),
        ("5. terrain surfaces — dimensioned or flagged", rows_surfaces),
    ]
    all_rows = [row for _, rows in sections for row in rows]
    failure_rows = [row for row in all_rows if verdict_class(row["verdict"]) == "off"]
    signal_rows = [row for row in all_rows if verdict_class(row["verdict"]) == "signal"]
    info_rows = [row for row in all_rows if verdict_class(row["verdict"]) == "info"]
    return {
        "project": project.get("id"),
        "level": level_id,
        "page": page.get("index"),
        "tolerance": tolerance,
        "areaTolerance": area_tolerance,
        "sections": [{"title": title, "rows": rows} for title, rows in sections],
        "summary": {
            "off": len(failure_rows),
            "signals": len(signal_rows),
            "infos": len(info_rows),
        },
    }


def print_report(result):
    print(
        f"site: project {result['project']}, level {result['level']}, "
        f"registry page {result['page']}"
    )
    for section in result["sections"]:
        print()
        print(section["title"])
        width = max([len(row["label"]) for row in section["rows"]] + [12])
        print(f"{'':{width}s}  {'printed':>16s} {'computed':>16s} {'gap':>7s}  verdict")
        for row in section["rows"]:
            printed = "—" if row["printed"] is None else formatted(row["printed"])
            computed = "—" if row["computed"] is None else formatted(row["computed"])
            delta = "—" if row["delta"] is None else f"{row['delta']:+.2f}"
            print(
                f"{row['label']:{width}s}  {printed:>16s} {computed:>16s} {delta:>7s}  {row['verdict']}"
            )
            if row.get("printedText"):
                print(f"{'':{width}s}  printed: {row['printedText']}")
            if row.get("detail"):
                print(f"{'':{width}s}  {row['detail']}")
    summary = result["summary"]
    print()
    if summary["off"]:
        print(
            f"{summary['off']} gap(s) beyond the tolerance "
            f"({result['tolerance']:.2f} m, {result['areaTolerance']:.2f} m²):"
        )
        for section in result["sections"]:
            for row in section["rows"]:
                if verdict_class(row["verdict"]) == "off":
                    detail = (
                        f" — gap {row['delta']:+.2f}"
                        if row.get("delta") is not None
                        else ""
                    )
                    print(f"  {row['label']}{detail}: {row['verdict']}")
        return 1
    print(f"no gap beyond the tolerance ({result['tolerance']:.2f} m)")
    if summary["signals"]:
        print(f"{summary['signals']} flag(s) — undimensioned, to declare in site.notes or to decide:")
        for section in result["sections"]:
            for row in section["rows"]:
                if verdict_class(row["verdict"]) == "signal":
                    computed = (
                        f" {row['computed']}" if row.get("computed") is not None else ""
                    )
                    print(f"  {row['label']}{computed}: {row['verdict']}")
    return 0


# --------------------------------------------------------------------------
# self-test: synthetic registry and project, no real data
# --------------------------------------------------------------------------


def synthetic_registry():
    return {
        "pages": [
            {
                "index": 3,
                "chains": [
                    {
                        "axis": "horizontal",
                        "segments": [
                            {"value": 10.00, "at": [50.0, 20.0]},
                            {"value": 8.50, "at": [110.0, 20.0]},
                            {"value": 11.50, "at": [170.0, 20.0]},
                        ],
                    }
                ],
                "labels": {
                    "parcelSides": [
                        {"kind": "parcelSide", "text": "- 30.00 m -", "value": 30.00, "at": [110.0, 30.0], "horizontal": True},
                        {"kind": "parcelSide", "text": "- 30.00 m -", "value": 30.00, "at": [110.0, 230.0], "horizontal": True},
                        {"kind": "parcelSide", "text": "- 20.00 m -", "value": 20.00, "at": [10.0, 130.0], "horizontal": False},
                        {"kind": "parcelSide", "text": "- 20.00 m -", "value": 20.00, "at": [210.0, 130.0], "horizontal": False},
                    ],
                    "parcelAreas": [
                        {"kind": "parcelArea", "text": "Surface :  600 m²", "area": 600.0, "at": [100.0, 250.0]}
                    ],
                    "namedLevels": [
                        {"kind": "namedLevel", "text": "RDC: +0.30", "name": "RDC", "value": 0.30, "at": [100.0, 260.0]},
                        {"kind": "namedLevel", "text": "Egout: +3.30", "name": "Egout", "value": 3.30, "at": [100.0, 261.0]},
                        {"kind": "namedLevel", "text": "Faitage: +6.30", "name": "Faitage", "value": 6.30, "at": [100.0, 262.0]},
                    ],
                    "rectAreas": [
                        {"kind": "rectArea", "text": "Entree test 5.00mx5.00m, non close,", "name": "Entree test", "width": 5.00, "depth": 5.00, "at": [100.0, 270.0]}
                    ],
                },
            }
        ]
    }


def synthetic_project(shift=0.0, faitage=6.00, egout=3.00):
    x0 = 10.0 + shift
    return {
        "id": "auto-test-site",
        "levels": [
            {
                "id": "rdc",
                "elevation": 0,
                "outline": [[x0, 5.0], [x0 + 8.5, 5.0], [x0 + 8.5, 10.0], [x0, 10.0]],
                "rooms": [],
                "lights": [],
                "spawn": {"position": [12.0, 6.0], "yaw": 0},
            }
        ],
        "site": {
            "boundary": [[0, 0], [30, 0], [30, 20], [0, 20]],
            "elevation": 0,
            "declaredArea": 600,
            "notes": [
                "east and west setbacks undimensioned, they are deduced; "
                "east access is an indicative, undimensioned surface"
            ],
            "surfaces": [
                {"id": "entree-test", "kind": "gravel", "polygon": [[0, 20], [5, 20], [5, 15], [0, 15]]},
                {"id": "acces-est", "kind": "path", "polygon": [[25, 0], [29, 0], [29, 4], [25, 4]]},
            ],
            "roofs": [
                {
                    "id": "toiture-test",
                    "vertices": [
                        [x0, egout, 5.0],
                        [x0 + 8.5, egout, 5.0],
                        [x0 + 8.5, egout, 10.0],
                        [x0, egout, 10.0],
                        [x0, faitage, 7.5],
                        [x0 + 8.5, faitage, 7.5],
                    ],
                    "faces": [[0, 1, 5, 4], [3, 2, 5, 4]],
                    "gables": [[0, 4, 3], [1, 2, 5]],
                }
            ],
        },
    }


def rows_of(result, prefix):
    return [
        row for section in result["sections"] for row in section["rows"] if row["label"].startswith(prefix)
    ]


def verdict_of(result, label):
    for section in result["sections"]:
        for row in section["rows"]:
            if row["label"].startswith(label):
                return row
    return None


def self_test():
    """Non-regression on a synthetic registry and project: no real data."""
    failures = []
    registry = synthetic_registry()
    result = build(
        registry, synthetic_project(), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE
    )
    if result["summary"]["off"] != 0:
        failures.append(f"the exact project should pass: {result['summary']}")
    gaps = [
        row
        for section in result["sections"]
        for row in section["rows"]
        if verdict_class(row["verdict"]) == "off"
    ]
    if gaps:
        failures.append(f"unexpected gaps on the exact project: {gaps}")
    sides = [
        row
        for row in rows_of(result, "side")
        if row["verdict"] not in ("no printed dimension — deduced from the others",)
    ]
    if len(sides) != 4 or any(row["verdict"] != "exact" for row in sides):
        failures.append(f"four sides expected exact: {sides}")
    surface_row = verdict_of(result, "plot area")
    if not surface_row or surface_row["verdict"] != "exact":
        failures.append(f"plot area: {surface_row}")
    egout = verdict_of(result, "eaves")
    if not egout or abs(egout["printed"] - 3.00) > 0.001 or egout["verdict"] != "exact":
        failures.append(f"eaves badly brought back to the RDC: {egout}")
    faitage = verdict_of(result, "ridge")
    if not faitage or faitage["verdict"] != "exact" or abs(faitage["delta"]) > 0.001:
        failures.append(f"ridge: {faitage}")
    topology = [
        row
        for section in result["sections"]
        if section["title"].startswith("4.")
        for row in section["rows"]
    ]
    pignons = [row for row in topology if row["verdict"] == "1 gable(s)"]
    egouts = [row for row in topology if row["verdict"].startswith("eaves")]
    if len(pignons) != 2 or len(egouts) != 2:
        failures.append(f"expected topology: 2 gables and 2 eaves — {topology}")
    entree = verdict_of(result, "entree-test")
    if not entree or entree["verdict"] not in ("dimensioned", "dimensioned — drawing gap"):
        failures.append(f"dimensioned entrance: {entree}")
    acces = verdict_of(result, "acces-est")
    if not acces or acces["verdict"] != "not dimensioned — decision to keep in site.notes":
        failures.append(f"undimensioned access: {acces}")
    reculs = rows_of(result, "setback side")
    dimensioned = [row for row in reculs if row["verdict"] == "dimensioned by a chain"]
    if len(dimensioned) != 3:
        failures.append(f"three dimensioned setbacks expected (east, north, west): {reculs}")
    affleurant = [row for row in reculs if row["verdict"] == "affleurant"]
    if len(affleurant) != 0:
        failures.append(f"no flush side expected in the fixture: {reculs}")
    chain_row = next(
        (row for row in rows_of(result, "chain —") if "side 1" in row["label"]), None
    )
    if not chain_row or chain_row["verdict"] != "exact":
        failures.append(f"the side 1 chain should land exactly: {chain_row}")

    # a site shifted by one metre along the dimensioned side: the chain does not land,
    # and the script names the faulty side
    shifted = build(
        registry, synthetic_project(shift=1.0), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE
    )
    refus = [
        row
        for section in shifted["sections"]
        for row in section["rows"]
        if verdict_class(row["verdict"]) == "off"
    ]
    if not any("side" in row["label"] and "side 1" in row["label"] for row in refus):
        failures.append(f"the shifted site should name side 1: {[r['label'] for r in refus]}")

    # a ridge 20 cm too high: refused
    wrong = build(
        registry, synthetic_project(faitage=6.20), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE
    )
    ridge_row = verdict_of(wrong, "ridge")
    if not ridge_row or ridge_row["verdict"] != "gap" or abs(ridge_row["delta"] - 0.20) > 0.005:
        failures.append(f"wrong ridge: {ridge_row}")

    # the drawing's eaves (gutter), 10 cm under the dimension: refused, trap named
    drawn = build(
        registry, synthetic_project(egout=2.90), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE
    )
    egout_row = verdict_of(drawn, "eaves")
    if not egout_row or egout_row["verdict"] != "gap" or "gutter" not in (egout_row.get("detail") or ""):
        failures.append(f"drawing eaves: {egout_row}")

    # a floating gable: issue named
    floated = synthetic_project()
    floated["site"]["roofs"][0]["gables"] = [[0, 4, 1], [1, 2, 5]]
    floated = build(registry, floated, "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE)
    reserves = [
        row["verdict"]
        for section in floated["sections"]
        for row in section["rows"]
        if row["verdict"].startswith("issue")
    ]
    if not reserves:
        failures.append("a floating gable should produce an issue")

    # missing site: immediate refusal
    try:
        build(registry, {"id": "vide", "levels": []}, "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE)
        failures.append("a project without a site should be refused")
    except ValueError as error:
        if "site missing" not in str(error):
            failures.append(f"unexpected message: {error}")
    except (TypeError, KeyError) as error:
        failures.append(f"a project without a site must produce a clean refusal: {error!r}")

    # parcelle ouverte : refus
    opened = synthetic_registry()
    opened["pages"][0]["labels"]["parcelSides"] = []
    opened_project = synthetic_project()
    opened_project["site"]["boundary"] = [[0, 0], [30, 0]]
    opened_result = build(opened, opened_project, "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE)
    parcel_verdicts = [
        row["verdict"]
        for section in opened_result["sections"]
        for row in section["rows"]
        if row["verdict"] == "plot not closed"
    ]
    if not parcel_verdicts:
        failures.append("a two-vertex plot should be refused")

    # split dimension: two collinear labels add up to a side
    split = synthetic_registry()
    split["pages"][0]["labels"]["parcelSides"] = [
        {"kind": "parcelSide", "text": "- 30.00 m -", "value": 30.00, "at": [110.0, 30.0], "horizontal": True},
        {"kind": "parcelSide", "text": "- 30.00 m -", "value": 30.00, "at": [110.0, 230.0], "horizontal": True},
        {"kind": "parcelSide", "text": "- 20.00 m -", "value": 20.00, "at": [10.0, 130.0], "horizontal": False},
        {"kind": "parcelSide", "text": "- 12.00 m -", "value": 12.00, "at": [201.0, 100.0], "horizontal": False},
        {"kind": "parcelSide", "text": "- 8.00 m -", "value": 8.00, "at": [202.0, 160.0], "horizontal": False},
    ]
    split_result = build(split, synthetic_project(), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE)
    split_sides = rows_of(split_result, "side")
    undimensioned = [row for row in split_sides if row["verdict"] == "no printed dimension — deduced from the others"]
    if undimensioned:
        failures.append(f"split dimensions not paired: {undimensioned}")
    if not any("split" in (row.get("printedText") or "") for row in split_sides):
        failures.append(f"side 4 should carry the split dimension: {split_sides}")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("site check: self-test passed")
    return 0


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry", nargs="?")
    parser.add_argument("project", nargs="?")
    parser.add_argument("--level", default="rdc")
    parser.add_argument("--page", type=int, default=None)
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    parser.add_argument("--area-tolerance", type=float, default=DEFAULT_AREA_TOLERANCE)
    parser.add_argument("--json", default=None)
    parser.add_argument("--self-test", action="store_true")
    if "--self-test" in argv:
        return self_test()
    args = parser.parse_args(argv)
    if not args.registry or not args.project:
        parser.error("registry and project are required")
    try:
        result = build(
            load(args.registry),
            load(args.project),
            args.level,
            args.page,
            args.tolerance,
            args.area_tolerance,
        )
    except ValueError as error:
        print(f"FAIL {error}")
        return 1
    except OSError as error:
        print(f"FAIL unreadable file: {error}")
        return 1
    code = print_report(result)
    if args.json:
        Path(args.json).write_text(
            json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
