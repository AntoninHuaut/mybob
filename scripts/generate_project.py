"""Layer 3: assembling a project from the geometry read on the plan.

Inputs:
- the extracted plan (`extract_plan.py`): the partitions, with their thickness;
- the evidence registry: the closed dimension chains, which give the exact
  position of the openings along each façade;
- a model project: the level outline, rooms, lights and the starting point,
  which cannot be deduced from the drawing.

Output: a complete project, where walls and openings come from the plan.

Exterior walls follow the outline: each edge gives a wall whose outer face is the
edge, the axis being set back by half a thickness. A façade's openings are placed
from the dimension chain measuring that side, never from the drawn symbol.

The level outline comes from the model, unless `--outline` points to the output of
`scripts/derive_outline.py`: the derived outline then replaces the hand-written
one, and it is the one carrying the exterior wall edges.

Usage:
  uvx --from pymupdf python scripts/generate_project.py <plan.json> <registry.json> \
      <model.json> <level> <output.json> [--pages 8] [--thickness 0.34] \
      [--outline outline.json]
"""
import argparse
import json
import math
import sys
from pathlib import Path

from derive_outline import load_outline

TOL = 0.01  # m
DEFAULT_THICKNESS = 0.34  # m, thickness of an exterior wall without a dimension
MIN_THICKNESS = 0.06  # m, below this it is not a wall thickness
MAX_THICKNESS = 0.45  # m, above this neither
DOOR_HEIGHT = 1.6  # m, below this an opening cannot be a door
BAY_WIDTH = 1.6  # m, above this a door-height opening is a bay
GARAGE_WIDTH = 2.0  # m, above this a full-height opening onto a garage is its door
SILL_RADIUS = 130.0  # pt, pairing radius of an « All : … m » label
MAX_HOST_DISTANCE = 0.6  # m, beyond this the opening does not belong to this wall


def outline_edges(outline):
    """Outline edges, with their inward normal."""
    edges = []
    for index, start in enumerate(outline):
        end = outline[(index + 1) % len(outline)]
        dx, dz = end[0] - start[0], end[1] - start[1]
        length = math.hypot(dx, dz)
        if length < TOL:
            continue
        # Candidate normal, oriented towards the inside of the polygon.
        nx, nz = -dz / length, dx / length
        middle = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        probe = (middle[0] + nx * 0.05, middle[1] + nz * 0.05)
        if not inside(probe, outline):
            nx, nz = -nx, -nz
        edges.append(
            {
                "start": start,
                "end": end,
                "length": length,
                "normal": (nx, nz),
                "axis": "horizontal" if abs(dx) >= abs(dz) else "vertical",
            }
        )
    return edges


def inside(point, polygon):
    """Test d'appartenance, ray casting."""
    x, z = point
    result = False
    for index, (x0, z0) in enumerate(polygon):
        x1, z1 = polygon[(index + 1) % len(polygon)]
        if (z0 > z) != (z1 > z):
            crossing = x0 + (z - z0) * (x1 - x0) / (z1 - z0)
            if x < crossing:
                result = not result
    return result


def envelope_frame(chains, outline):
    """Origin of the drawing frame per axis, deduced from the chains carrying the footprint."""
    origins = {}
    for axis in ("horizontal", "vertical"):
        along = 0 if axis == "horizontal" else 1
        values = [point[along] for point in outline]
        extent = max(values) - min(values)
        for chain in chains:
            if chain["axis"] != axis or not chain["closed"]:
                continue
            if abs(chain["sum"] - extent) > TOL:
                continue
            ppm = chain["printedPointsPerMetre"]
            first = chain["segments"][0]
            start_pt = first["at"][along] - first["value"] / 2 * ppm
            origins[along] = start_pt - min(values) * ppm
            break
    return origins


def chain_side(chain, origins):
    """Side of the outline a chain measures, in metres, or None."""
    along = 0 if chain["axis"] == "horizontal" else 1
    origin = origins.get(1 - along)
    if origin is None:
        return None
    return (chain["perpendicular"] - origin) / chain["printedPointsPerMetre"]


def edge_for_interval(edges, axis, side, low, high):
    """Outline edge containing a world interval, on the measured side.

    A façade chain may measure several edges at once: on the south of plan B, the
    living room, the recessed entrance and the garage are three distinct edges, and a
    single chain covers them all. Looking for the edge by side alone put every opening
    on the first one and lost the others — the entrance and the living room no longer
    had a single opening.

    The edges whose interval along the axis contains the opening are therefore kept,
    then the one closest to the measured side. The entrance recess is 0.35 m from the
    façade face: distance decides, a tolerance would not.
    """
    along = 0 if axis == "horizontal" else 1
    best = None
    best_distance = None
    for edge in edges:
        if edge["axis"] != axis:
            continue
        edge_low, edge_high = sorted((edge["start"][along], edge["end"][along]))
        if low < edge_low - TOL or high > edge_high + TOL:
            continue
        coordinate = edge["start"][1] if axis == "horizontal" else edge["start"][0]
        distance = abs(coordinate - side)
        if best_distance is None or distance < best_distance:
            best, best_distance = edge, distance
    return best


def chain_start(chain, origins):
    """World position of the start of a chain, in metres."""
    along = 0 if chain["axis"] == "horizontal" else 1
    origin = origins.get(along)
    if origin is None:
        return None
    ppm = chain["printedPointsPerMetre"]
    first = chain["segments"][0]
    return (first["at"][along] - first["value"] / 2 * ppm - origin) / ppm


def parse_measure(text):
    """An opening dimension: « 1.80 » in metres, « 95 » in centimetres."""
    text = text.strip().replace(",", ".")
    return float(text) if "." in text else float(text) / 100


def opening_kind(width, height):
    """Window, door or bay, from the printed geometry alone.

    An opening lower than a door is a window. A door-height opening wider than
    1.60 m is not a leaf: it is a bay. The plan does not say "door" or "window"; it
    gives two numbers.
    """
    if height < DOOR_HEIGHT:
        return "window"
    return "sliding" if width >= BAY_WIDTH else "door"


def sill_for(at, sills, fallback):
    """Sill of the nearest label, or a flagged fallback.

    The plan carries several sills on the same page — 1.10 m north, 1.20 m south.
    Taking the most frequent for the whole level put 1.20 under the north windows.
    The label is written next to its opening: distance pairs it, not a vote.
    """
    if not sills:
        return (fallback if fallback is not None else 0.0), fallback is not None
    best = min(sills, key=lambda sill: math.hypot(sill["at"][0] - at[0], sill["at"][1] - at[1]))
    distance = math.hypot(best["at"][0] - at[0], best["at"][1] - at[1])
    if distance <= SILL_RADIUS:
        return best["value"], False
    return (fallback if fallback is not None else 0.0), True


def point_in_polygon(point, polygon):
    """Point-in-polygon test, by crossing parity."""
    x, z = point
    inside = False
    for index, start in enumerate(polygon):
        end = polygon[(index + 1) % len(polygon)]
        if (start[1] > z) != (end[1] > z):
            cross = start[0] + (z - start[1]) * (end[0] - start[0]) / (end[1] - start[1])
            if x < cross:
                inside = not inside
    return inside


def garage_opening(opening, wall, rooms):
    """True if the opening is a garage door.

    The plan does not name openings: it gives a width and a height. A full-height
    opening over two metres giving onto a room of type garage is a garage door — the
    only thing telling it apart from a glazed bay is the room it serves, and the
    model knows it.
    """
    if opening["height"] < DOOR_HEIGHT or opening["width"] < GARAGE_WIDTH:
        return False
    along = 0 if abs(wall["start"][1] - wall["end"][1]) < 1e-9 else 1
    across = 1 - along
    centre = (opening["low"] + opening["high"]) / 2
    for side in (-1, 1):
        probe = [0.0, 0.0]
        probe[along] = centre
        probe[across] = wall["start"][across] + side * (wall["thickness"] / 2 + 0.3)
        for room in rooms:
            if room.get("kind") == "garage" and point_in_polygon(probe, room["polygon"]):
                return True
    return False


def chain_openings(chain, origins, sills=None, fallback_sill=None):
    """Openings of a chain, as world intervals along its axis.

    A chain's segments are ordered by increasing abscissa: their world interval is
    read directly. The height comes from the dimension text (« 1.80/1.05 »), the
    sill from the nearest label. A door-height opening has no sill: it starts at
    the floor.
    """
    start_world = chain_start(chain, origins)
    if start_world is None:
        return []
    cursor = start_world
    found = []
    for segment in chain["segments"]:
        low, high = cursor, cursor + segment["value"]
        cursor = high
        if segment["kind"] != "opening" or "/" not in segment["text"]:
            continue
        width_text, height_text = segment["text"].split("/", 1)
        width = parse_measure(width_text)
        height = parse_measure(height_text)
        if height >= DOOR_HEIGHT:
            sill, guessed = 0.0, False
        else:
            sill, guessed = sill_for(segment["at"], sills, fallback_sill)
        found.append(
            {
                "low": round(low, 4),
                "high": round(high, 4),
                "width": round(width, 4),
                "height": round(height, 4),
                "kind": opening_kind(width, height),
                "sill": sill,
                "sillGuessed": guessed,
            }
        )
    return found


def place_opening(opening, wall):
    """Brings a world opening back to the offset of the wall carrying it.

    The offset counts from the start of the wall, which may run the other way.
    """
    along = 0 if abs(wall["start"][1] - wall["end"][1]) < 1e-9 else 1
    wall_start = wall["start"][along]
    wall_end = wall["end"][along]
    if wall_end >= wall_start:
        offset = opening["low"] - wall_start
    else:
        offset = wall_start - opening["high"]
    return {
        "offset": round(max(0.0, offset), 4),
        "width": opening["width"],
        "height": opening["height"],
        "kind": opening["kind"],
        "sill": opening["sill"],
    }


def wall_faces(walls):
    """Abscissas and ordinates of the wall faces, to re-snap the rooms."""
    xs, zs = set(), set()
    for wall in walls:
        half = wall["thickness"] / 2
        if abs(wall["start"][0] - wall["end"][0]) >= abs(wall["start"][1] - wall["end"][1]):
            zs.update({round(wall["start"][1] - half, 4), round(wall["start"][1] + half, 4)})
        else:
            xs.update({round(wall["start"][0] - half, 4), round(wall["start"][0] + half, 4)})
    return sorted(xs), sorted(zs)


def snap(value, candidates, tolerance):
    """Closest value in a list, if it is within reach."""
    if not candidates:
        return value
    nearest = min(candidates, key=lambda candidate: abs(candidate - value))
    return nearest if abs(nearest - value) <= tolerance else value


def snap_rooms(rooms, walls, outline=None, tolerance=0.30):
    """Re-snaps rooms onto the wall faces: a room stops at the finished face.

    Re-snapping is a **displacement**, not a measurement: it is reported so that
    nobody confuses it with a reading of the plan. A vertex moved by more than a
    few centimetres signals a polygon that was not on the faces.
    """
    xs, zs = wall_faces(walls)
    moves = []
    for room in rooms:
        snapped = []
        for point in room["polygon"]:
            x = round(snap(point[0], xs, tolerance), 4)
            z = round(snap(point[1], zs, tolerance), 4)
            # A re-snap must not take the room out of the level: on an L-shaped
            # outline, a wall face may lie outside. The original is then kept.
            if outline and not inside((x, z), outline):
                x, z = point[0], point[1]
            if abs(x - point[0]) > 1e-6 or abs(z - point[1]) > 1e-6:
                moves.append(
                    {
                        "room": room["id"],
                        "from": [point[0], point[1]],
                        "to": [x, z],
                        "distance": round(((x - point[0]) ** 2 + (z - point[1]) ** 2) ** 0.5, 4),
                    }
                )
            snapped.append([x, z])
        room["polygon"] = snapped
        # The label point and the walk point stay where they are: re-snapping them
        # would put them on a wall face, hence on the polygon's edge.
    return moves


def apply_overrides(walls, overrides):
    """Applies the retouches entered after generation.

    A retouch targets a specific wall: shift it perpendicularly, or change its
    thickness. It survives a regeneration, so fixing three walls does not require
    redoing the twenty others.
    """
    patches = overrides.get("walls", {})
    for wall in walls:
        patch = patches.get(wall["id"])
        if not patch:
            continue
        horizontal = abs(wall["start"][0] - wall["end"][0]) >= abs(
            wall["start"][1] - wall["end"][1]
        )
        across = 1 if horizontal else 0
        if "offset" in patch:
            wall["start"][across] = round(wall["start"][across] + patch["offset"], 4)
            wall["end"][across] = round(wall["end"][across] + patch["offset"], 4)
        if "thickness" in patch:
            wall["thickness"] = patch["thickness"]
        for opening in wall.get("openings", []):
            opening_patch = overrides.get("openings", {}).get(opening["id"])
            if not opening_patch:
                continue
            for key in ("offset", "width", "height"):
                if key in opening_patch:
                    opening[key] = opening_patch[key]


def close_walls(walls, tolerance=0.45):
    """Extends a wall end up to the face of the wall it aims at.

    A plan often draws a partition that stops at a beam or at a line, not at the
    wall face. The gap lets the fill through and the room no longer exists: on plan
    B, three partitions stopped 34 cm before the south wall and the whole level
    formed a single region.

    The end is extended up to the nearest face, along the wall axis, and every
    extension is reported: it is a displacement, not a reading.
    """
    moves = []
    for wall in walls:
        # An exterior wall stops at the outline: extending it would take it outside.
        if wall.get("exterior"):
            continue
        along_x = abs(wall["start"][0] - wall["end"][0]) >= abs(
            wall["start"][1] - wall["end"][1]
        )
        along, across = (0, 1) if along_x else (1, 0)
        for end in ("start", "end"):
            point = wall[end]
            direction = 1 if point[along] >= wall["start" if end == "end" else "end"][along] else -1
            best = None
            for other in walls:
                if other is wall:
                    continue
                other_along_x = abs(other["start"][0] - other["end"][0]) >= abs(
                    other["start"][1] - other["end"][1]
                )
                if other_along_x == along_x:
                    continue
                half = other["thickness"] / 2
                for face in (other["start"][across] - half, other["start"][across] + half):
                    gap = (face - point[along]) * direction
                    if gap <= 1e-6 or gap > tolerance:
                        continue
                    # The other wall is perpendicular: its extent is read on
                    # the current wall's `across` axis.
                    low, high = sorted((other["start"][across], other["end"][across]))
                    if not (low - 1e-6 <= point[across] <= high + 1e-6):
                        continue
                    if best is None or gap < best[0]:
                        best = (gap, face)
            if best is None:
                continue
            moves.append(
                {
                    "wall": wall["id"],
                    "end": end,
                    "from": round(point[along], 4),
                    "to": round(best[1], 4),
                    "gap": round(best[0], 4),
                }
            )
            point[along] = round(best[1], 4)
    return moves


def merge_collinear(walls, tolerance=0.02, max_gap=1.5):
    """Rejoins the partitions a drawing cuts at every door.

    A plan draws a partition in pieces: the line stops at the door reveal and
    resumes afterwards. For the fill, these pieces are separate walls, the gap lets
    it through and rooms merge — on plan A in generated mode, the whole level formed
    a single 107.93 m² region.

    Aligned pieces are rejoined and the gap becomes an opening. The height of that
    opening is not read: it is set at the usual door height and reported as such.
    """
    exterior = [wall for wall in walls if wall.get("exterior")]
    partitions = [wall for wall in walls if not wall.get("exterior")]
    groups = {}
    for wall in partitions:
        along_x = abs(wall["start"][0] - wall["end"][0]) >= abs(
            wall["start"][1] - wall["end"][1]
        )
        across = 1 if along_x else 0
        key = (along_x, round(wall["start"][across], 2))
        groups.setdefault(key, []).append(wall)
    merged = []
    added = []
    for (along_x, _), group in groups.items():
        along, across = (0, 1) if along_x else (1, 0)
        group.sort(key=lambda wall: min(wall["start"][along], wall["end"][along]))
        current = None
        for wall in group:
            low, high = sorted((wall["start"][along], wall["end"][along]))
            if current is None:
                current = {
                    "id": wall["id"],
                    "start": [wall["start"][0], wall["start"][1]],
                    "end": [wall["end"][0], wall["end"][1]],
                    "thickness": wall["thickness"],
                    "openings": list(wall.get("openings") or []),
                    "_low": low,
                    "_high": high,
                }
                continue
            gap = low - current["_high"]
            if gap > max_gap:
                merged.append(current)
                current = {
                    "id": wall["id"],
                    "start": [wall["start"][0], wall["start"][1]],
                    "end": [wall["end"][0], wall["end"][1]],
                    "thickness": wall["thickness"],
                    "openings": list(wall.get("openings") or []),
                    "_low": low,
                    "_high": high,
                }
                continue
            if gap > tolerance:
                added.append(
                    {
                        "wall": current["id"],
                        "offset": round(current["_high"] - current["_low"], 4),
                        "width": round(gap, 4),
                    }
                )
                current["openings"].append(
                    {
                        "id": f"{current['id']}-gap{len(current['openings']) + 1}",
                        "kind": "door",
                        "offset": round(current["_high"] - current["_low"], 4),
                        "width": round(gap, 4),
                        "height": 2.1,
                        "sill": 0.0,
                    }
                )
            current["_high"] = max(current["_high"], high)
        if current is not None:
            merged.append(current)
    result = list(exterior)
    for wall in merged:
        low, high = wall.pop("_low"), wall.pop("_high")
        wall["start"][along_of(wall)] = low
        wall["end"][along_of(wall)] = high
        result.append(wall)
    return result, added


def along_of(wall):
    return 0 if abs(wall["start"][1] - wall["end"][1]) < 1e-9 else 1


def split_exterior(walls, registry, pages, frame, outline, tolerance=0.15):
    """Splits an exterior wall where a partition meets it.

    A façade does not have one thickness: on plan A the north is 22 cm on the garage
    side and 34 cm on the bedroom side. Taking a single dimension for the whole edge
    grows the rooms — 0.65 m² on chambre-3. It is split at the junctions, then each
    run takes the dimension running along it.

    Openings follow: each is carried over to the run containing it, by its world
    interval, never by a copied offset.
    """
    exterior = [wall for wall in walls if wall.get("exterior")]
    others = [wall for wall in walls if not wall.get("exterior")]
    result = [wall for wall in walls if not wall.get("exterior")]
    for wall in exterior:
        along_x = abs(wall["start"][0] - wall["end"][0]) >= abs(
            wall["start"][1] - wall["end"][1]
        )
        along, across = (0, 1) if along_x else (1, 0)
        axis = wall["start"][across]
        low, high = sorted((wall["start"][along], wall["end"][along]))
        # The outer face is the one lying on the outline: it is the one that
        # stays fixed when the thickness changes, not the axis.
        outline_values = {round(point[across], 4) for point in outline}
        half = wall["thickness"] / 2
        if round(axis - half, 4) in outline_values:
            outer, sign = axis - half, 1
        elif round(axis + half, 4) in outline_values:
            outer, sign = axis + half, -1
        else:
            outer, sign = axis - half, 1
        cuts = {round(low, 4), round(high, 4)}
        for other in others:
            for point in (other["start"], other["end"]):
                if abs(point[across] - axis) > tolerance:
                    continue
                if low - tolerance <= point[along] <= high + tolerance:
                    cuts.add(round(min(max(point[along], low), high), 4))
        ordered = sorted(cuts)
        forward = wall["end"][along] >= wall["start"][along]
        segments = []
        for index in range(len(ordered) - 1):
            start, end = ordered[index], ordered[index + 1]
            if end - start < 0.05:
                continue
            # The first run keeps the wall's identifier: an override that
            # targeted this wall keeps targeting it.
            segment = {
                "id": wall["id"] if index == 0 else f"{wall['id']}-{index + 1}",
                "start": [0.0, 0.0],
                "end": [0.0, 0.0],
                "exterior": True,
                "openings": [],
            }
            # The original wall's direction is kept: opening offsets and the
            # opening direction of doors depend on it.
            if forward:
                segment["start"][along], segment["end"][along] = start, end
            else:
                segment["start"][along], segment["end"][along] = end, start
            segment["start"][across] = segment["end"][across] = axis
            edge = {
                "axis": "horizontal" if along_x else "vertical",
                "start": segment["start"],
                "end": segment["end"],
            }
            measured = printed_thickness(registry, pages, edge, frame)
            segment["thickness"] = wall["thickness"] if measured is None else measured
            segment["start"][across] = segment["end"][across] = round(
                outer + sign * segment["thickness"] / 2, 4
            )
            segments.append(segment)
        for opening in wall.get("openings") or []:
            if forward:
                world_low = low + opening["offset"]
            else:
                world_low = high - opening["offset"] - opening["width"]
            world_high = world_low + opening["width"]
            for segment in segments:
                seg_low, seg_high = sorted(
                    (segment["start"][along], segment["end"][along])
                )
                if world_low < seg_low - 1e-6 or world_high > seg_high + 1e-6:
                    continue
                copy = json.loads(json.dumps(opening))
                copy["offset"] = round(
                    world_low - seg_low if forward else seg_high - world_high, 4
                )
                copy["id"] = f"{segment['id']}-o{len(segment['openings']) + 1}"
                segment["openings"].append(copy)
                break
        result.extend(segments)
    return result


def merge_partitions(model_walls, partitions, tolerance=0.15, thickness_gap=0.03):
    """Replaces the model's partitions with those read on the drawing.

    Hatched walls cannot be extracted: they stay the model's, with their openings.
    Only partitions — the filled rectangles — are taken from the drawing, because
    that is where they are exact. A partition with no counterpart in the model is
    added.

    The thickness is only taken if it agrees. The drawing's fill is the **raw**
    wall; the model carries the **finished** wall, lining included. Replacing one
    with the other shrinks the room: on plan A, the garage/WC partition is 10.2 cm
    in the fill and 15 cm finished, and the printed WC area (1.62 m²) decides for
    15 cm. The gap is reported, not absorbed.
    """
    merged = [json.loads(json.dumps(wall)) for wall in model_walls]
    added = 0
    gaps = []
    for partition in partitions:
        along = 0 if partition["axis"] == "horizontal" else 1
        across = 1 - along
        centre = (partition["low"] + partition["high"]) / 2
        best, best_gap = None, tolerance
        for wall in merged:
            horizontal = abs(wall["start"][0] - wall["end"][0]) >= abs(
                wall["start"][1] - wall["end"][1]
            )
            if (0 if horizontal else 1) != along:
                continue
            gap = abs(wall["start"][across] - centre)
            if gap > best_gap:
                continue
            low = min(wall["start"][along], wall["end"][along])
            high = max(wall["start"][along], wall["end"][along])
            if min(high, partition["to"]) - max(low, partition["from"]) <= 0:
                continue
            best, best_gap = wall, gap
        if best is None:
            start = [0.0, 0.0]
            end = [0.0, 0.0]
            start[along], end[along] = partition["from"], partition["to"]
            start[across] = end[across] = centre
            merged.append(
                {
                    "id": f"clo-{len(merged) + 1}",
                    "start": [round(start[0], 4), round(start[1], 4)],
                    "end": [round(end[0], 4), round(end[1], 4)],
                    "thickness": partition["thickness"],
                    "openings": [],
                }
            )
            added += 1
            continue
        # The model's identifier, extent and openings are kept: a partition
        # read stops at a door reveal, the model wall crosses it. Only
        # the position and the thickness come from the drawing.
        if abs(best["thickness"] - partition["thickness"]) <= thickness_gap:
            best["start"][across] = best["end"][across] = round(centre, 4)
            best["thickness"] = partition["thickness"]
        else:
            gaps.append(
                {
                    "wall": best["id"],
                    "model": best["thickness"],
                    "drawn": partition["thickness"],
                }
            )
    return merged, added, gaps


def world_frame(chains, outline):
    """Points -> metres frame, from the chains carrying the footprint."""
    origins = envelope_frame(chains, outline)
    ppm = None
    for chain in chains:
        if chain.get("closed") and chain.get("printedPointsPerMetre"):
            ppm = chain["printedPointsPerMetre"]
            break
    if len(origins) < 2 or ppm is None:
        return None
    return {"originX": origins[0], "originZ": origins[1], "ppm": ppm}


def printed_thickness(registry, pages, edge, frame, tolerance=0.6):
    """Thickness read on a dimension in centimetres set against the wall.

    A dimension of 22, 34 or 15 against a façade gives its thickness. Only
    dimensions perpendicular to the wall whose label falls within its extent are
    kept: it is a reading, not a deduction. Without a dimension found, the wall
    keeps the fallback thickness and the script says so.
    """
    if frame is None:
        return None
    along_x = edge["axis"] == "horizontal"
    want_horizontal = not along_x
    low, high = (
        sorted((edge["start"][0], edge["end"][0]))
        if along_x
        else sorted((edge["start"][1], edge["end"][1]))
    )
    axis = edge["start"][1] if along_x else edge["start"][0]
    best = None
    for page in registry.get("pages") or []:
        if pages is not None and page.get("index") not in pages:
            continue
        for dimension in (page.get("labels") or {}).get("dimensions") or []:
            if dimension.get("kind") != "centimetres":
                continue
            if bool(dimension.get("horizontal")) != want_horizontal:
                continue
            if not MIN_THICKNESS <= dimension["value"] <= MAX_THICKNESS:
                continue
            x = (dimension["at"][0] - frame["originX"]) / frame["ppm"]
            z = (dimension["at"][1] - frame["originZ"]) / frame["ppm"]
            along, across = (x, z) if along_x else (z, x)
            if not (low - tolerance <= along <= high + tolerance):
                continue
            distance = abs(across - axis)
            if distance <= tolerance and (best is None or distance < best[0]):
                best = (distance, dimension["value"])
    return None if best is None else best[1]


def printed_sills(registry, pages):
    """Every printed sill, with its position on the page."""
    found = []
    for page in registry.get("pages") or []:
        if pages is not None and page.get("index") not in pages:
            continue
        for sill in (page.get("labels") or {}).get("sills") or []:
            if sill.get("value") is not None and sill.get("at"):
                found.append(sill)
    return found


def printed_sill(registry, pages):
    """Most frequent printed sill, or None if the plan gives none."""
    counts = {}
    for page in registry.get("pages") or []:
        if pages is not None and page.get("index") not in pages:
            continue
        for sill in (page.get("labels") or {}).get("sills") or []:
            value = sill.get("value")
            if value is not None:
                counts[value] = counts.get(value, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


def stamp_exterior_openings(walls):
    """Marks every opening of an exterior wall as exterior.

    It is a fact of the wall, not a decision: the wall already carries
    ``exterior``. Without the flag, the renderer slides a solid panel instead of
    the glazing and a garage door starts open — that is what an owner review cost
    on a complete plan.
    """
    stamped = 0
    for wall in walls:
        if not wall.get("exterior"):
            continue
        for opening in wall.get("openings", []):
            if not opening.get("exterior"):
                opening["exterior"] = True
                stamped += 1
    return stamped


def merge_openings(model_walls, generated_walls, tolerance=0.12):
    """Carries over to the model the openings the chains prove and it lacks.

    The merge keeps the model's walls, which carry the hatched walls and the
    interior doors. It must not, for all that, throw away the openings read on the
    chains: an opening proven by a dimension and absent from the model is a gap,
    not a choice.

    An opening is carried over by its **world** interval, not by its offset: two
    neighbouring walls may be six centimetres apart, and an offset copied from one
    wall to another would put the opening outside the wall. The opening must fit
    within the host wall's extent, otherwise it is not carried over.

    The host wall is the one whose extent contains the opening and whose axis is
    the closest, not the first under a tolerance: the model's entrance wall is
    0.33 m from the outline edge, and a fixed tolerance lost the three entrance
    openings there.
    """
    added = []
    for generated in generated_walls:
        if not generated["openings"]:
            continue
        along_x = abs(generated["start"][0] - generated["end"][0]) >= abs(
            generated["start"][1] - generated["end"][1]
        )
        g_start = generated["start"][0] if along_x else generated["start"][1]
        g_end = generated["end"][0] if along_x else generated["end"][1]
        g_axis = generated["start"][1] if along_x else generated["start"][0]
        g_low, g_high = sorted((g_start, g_end))
        for opening in generated["openings"]:
            if g_end >= g_start:
                world_low = g_low + opening["offset"]
            else:
                world_low = g_high - opening["offset"] - opening["width"]
            world_high = world_low + opening["width"]
            best = None
            for wall in model_walls:
                wall_along_x = abs(wall["start"][0] - wall["end"][0]) >= abs(
                    wall["start"][1] - wall["end"][1]
                )
                if wall_along_x != along_x:
                    continue
                w_start = wall["start"][0] if along_x else wall["start"][1]
                w_end = wall["end"][0] if along_x else wall["end"][1]
                w_low, w_high = sorted((w_start, w_end))
                if world_low < w_low - tolerance or world_high > w_high + tolerance:
                    continue
                wall_axis = wall["start"][1] if along_x else wall["start"][0]
                distance = abs(wall_axis - g_axis)
                if distance > MAX_HOST_DISTANCE:
                    continue
                if best is None or distance < best[0]:
                    best = (distance, wall, w_start, w_end)
            if best is None:
                continue
            _, wall, w_start, w_end = best
            offset = world_low - w_start if w_end >= w_start else w_start - world_high
            duplicate = any(
                abs(existing["offset"] - offset) <= tolerance
                and abs(existing["width"] - opening["width"]) <= tolerance
                for existing in wall["openings"]
            )
            if duplicate:
                continue
            copy = json.loads(json.dumps(opening))
            copy["offset"] = round(max(0.0, offset), 4)
            wall["openings"].append(copy)
            added.append({"wall": wall["id"], "offset": copy["offset"]})
    return added


def compare_thickness(model_walls, generated_walls, tolerance=0.12, gap=0.02):
    """Thickness gaps between the model's walls and the plan's dimensions.

    The merge keeps the model's walls, but it must not hide what else the plan
    says: a wall whose declared thickness departs from the printed dimension is
    flagged, and an override fixes it, not a regeneration.
    """
    rows = []
    for generated in generated_walls:
        along_x = abs(generated["start"][0] - generated["end"][0]) >= abs(
            generated["start"][1] - generated["end"][1]
        )
        g_start = generated["start"][0] if along_x else generated["start"][1]
        g_end = generated["end"][0] if along_x else generated["end"][1]
        g_axis = generated["start"][1] if along_x else generated["start"][0]
        g_low, g_high = sorted((g_start, g_end))
        for wall in model_walls:
            wall_along_x = abs(wall["start"][0] - wall["end"][0]) >= abs(
                wall["start"][1] - wall["end"][1]
            )
            if wall_along_x != along_x:
                continue
            wall_axis = wall["start"][1] if along_x else wall["start"][0]
            if abs(wall_axis - g_axis) > tolerance:
                continue
            w_start = wall["start"][0] if along_x else wall["start"][1]
            w_end = wall["end"][0] if along_x else wall["end"][1]
            w_low, w_high = sorted((w_start, w_end))
            if abs(w_low - g_low) > 0.3 or abs(w_high - g_high) > 0.3:
                continue
            if abs(wall["thickness"] - generated["thickness"]) > gap:
                rows.append(
                    {
                        "wall": wall["id"],
                        "model": wall["thickness"],
                        "printed": generated["thickness"],
                    }
                )
            break
    return rows


def build(
    plan,
    registry,
    template,
    level_id,
    pages,
    thickness,
    overrides=None,
    merge=True,
    report=None,
    openings_only=False,
    outline=None,
):
    level = next(candidate for candidate in template["levels"] if candidate["id"] == level_id)
    # The hand-written outline is only an opinion: when layer 3 has
    # derived one, it is the one carrying the exterior wall edges.
    outline = level["outline"] if outline is None else outline
    chains = [
        chain
        for page in registry["pages"]
        if pages is None or page["index"] in pages
        for chain in page["chains"]
    ]
    edges = outline_edges(outline)
    origins = envelope_frame(chains, outline)
    frame = world_frame(chains, outline)
    sills = printed_sills(registry, pages)
    sill = printed_sill(registry, pages)

    walls = []
    read = []
    for index, edge in enumerate(edges):
        measured = printed_thickness(registry, pages, edge, frame)
        wall_thickness = thickness if measured is None else measured
        read.append(
            {
                "wall": f"ext-{index + 1}",
                "thickness": wall_thickness,
                "printed": measured is not None,
            }
        )
        walls.append(
            {
                "id": f"ext-{index + 1}",
                "start": [
                    round(edge["start"][0] + edge["normal"][0] * wall_thickness / 2, 4),
                    round(edge["start"][1] + edge["normal"][1] * wall_thickness / 2, 4),
                ],
                "end": [
                    round(edge["end"][0] + edge["normal"][0] * wall_thickness / 2, 4),
                    round(edge["end"][1] + edge["normal"][1] * wall_thickness / 2, 4),
                ],
                "thickness": wall_thickness,
                "exterior": True,
                "openings": [],
            }
        )

    dropped = []
    guessed = []
    for chain in chains:
        if not chain["closed"]:
            continue
        side = chain_side(chain, origins)
        if side is None:
            continue
        for opening in chain_openings(chain, origins, sills, sill):
            edge = edge_for_interval(
                edges, chain["axis"], side, opening["low"], opening["high"]
            )
            if edge is None:
                dropped.append(
                    {
                        "axis": chain["axis"],
                        "low": opening["low"],
                        "high": opening["high"],
                        "width": opening["width"],
                    }
                )
                continue
            wall = walls[edges.index(edge)]
            placed = place_opening(opening, wall)
            if garage_opening(opening, wall, level["rooms"]):
                placed["kind"] = "garage"
            placed["id"] = f"{wall['id']}-o{len(wall['openings']) + 1}"
            wall["openings"].append(placed)
            if opening["sillGuessed"]:
                guessed.append({"wall": wall["id"], "opening": placed["id"]})

    generated = walls
    added = []
    thickness_gaps = []
    partition_gaps = []
    closed = []
    rejoined = []
    if openings_only:
        # The model's walls are kept as they are: only the openings read on
        # the chains are carried over. It is the case of a house whose walls
        # are already right and which only lacks the openings.
        walls = json.loads(json.dumps(level["walls"]))
        added = merge_openings(walls, generated)
    elif merge:
        # The model's hatched walls are kept: only the partitions change.
        walls, _, partition_gaps = merge_partitions(level["walls"], plan["walls"])
        added = merge_openings(walls, generated)
        thickness_gaps = compare_thickness(walls, generated)
    else:
        for index, partition in enumerate(plan["walls"]):
            along = 0 if partition["axis"] == "horizontal" else 1
            across = 1 - along
            centre = (partition["low"] + partition["high"]) / 2
            start = [0.0, 0.0]
            end = [0.0, 0.0]
            start[along], end[along] = partition["from"], partition["to"]
            start[across] = end[across] = centre
            walls.append(
                {
                    "id": f"clo-{index + 1}",
                    "start": [round(start[0], 4), round(start[1], 4)],
                    "end": [round(end[0], 4), round(end[1], 4)],
                    "thickness": partition["thickness"],
                    "openings": [],
                }
            )
        walls, rejoined = merge_collinear(walls)
        walls = split_exterior(walls, registry, pages, frame, outline)
        closed = close_walls(walls)

    result = json.loads(json.dumps(template))
    target = next(candidate for candidate in result["levels"] if candidate["id"] == level_id)
    if overrides:
        apply_overrides(walls, overrides)
    stamped = stamp_exterior_openings(walls)
    target["walls"] = walls
    target["outline"] = outline
    # In "openings only" mode, the model's rooms are already right:
    # re-snapping them onto the faces would move them for nothing and break the areas.
    moves = [] if openings_only else snap_rooms(target["rooms"], walls, outline)
    if report is not None:
        report["thickness"] = read
        report["openingsAdded"] = added
        report["thicknessGaps"] = thickness_gaps
        report["roomMoves"] = moves
        report["partitionGaps"] = partition_gaps
        report["closed"] = closed
        report["rejoined"] = rejoined
        report["sill"] = sill
        report["openingsDropped"] = dropped
        report["sillGuessed"] = guessed
        report["exteriorOpenings"] = stamped
    return result


def self_test():
    """Non-regression on a synthetic case: no real data."""
    outline = [[0, 0], [6, 0], [6, 4], [0, 4]]
    template = {
        "schemaVersion": 1,
        "id": "maison-test",
        "name": "Test",
        "description": "",
        "units": "m",
        "source": {"title": "synthetique", "status": "provisional", "notes": []},
        "levels": [
            {
                "id": "rdc",
                "name": "RDC",
                "elevation": 0,
                "ceilingHeight": 2.5,
                "outline": outline,
                "walls": [],
                "rooms": [
                    {
                        "id": "sejour",
                        "name": "Séjour",
                        "kind": "living",
                        "polygon": [[0.34, 0.34], [5.66, 0.34], [5.66, 3.66], [0.34, 3.66]],
                        "label": [3, 2],
                        "viewpoint": [3, 2.5],
                    }
                ],
                "lights": [],
                "spawn": {"position": [3, 2], "yaw": 0},
            }
        ],
    }
    plan = {
        "walls": [
            {
                "id": "p1",
                "axis": "vertical",
                "low": 2.965,
                "high": 3.035,
                "from": 0.34,
                "to": 3.66,
                "thickness": 0.07,
            }
        ]
    }
    # A closed chain on the south façade, with a 0.90 m door.
    ppm = 2834.6457 / 75
    segments = [
        {"text": "2.00", "kind": "linear", "value": 2.0, "at": [100 + 1.0 * ppm, 400]},
        {"text": "0.90/2.10", "kind": "opening", "value": 0.9, "at": [100 + 2.45 * ppm, 400]},
        {"text": "3.10", "kind": "linear", "value": 3.1, "at": [100 + 4.45 * ppm, 400]},
    ]
    registry = {
        "schemaVersion": 1,
        "pages": [
            {
                "index": 1,
                "chains": [
                    {
                        "page": 1,
                        "axis": "horizontal",
                        "perpendicular": 400,
                        "segments": segments,
                        "sum": 6.0,
                        "declaredTotal": {"text": "6.00", "value": 6.0, "at": [100, 390]},
                        "residual": 0.0,
                        "closed": True,
                        "printedPointsPerMetre": ppm,
                    },
                    {
                        "page": 1,
                        "axis": "vertical",
                        "perpendicular": 100,
                        "segments": [
                            {"text": "4.00", "kind": "linear", "value": 4.0, "at": [100, 100 + 2.0 * ppm]}
                        ],
                        "sum": 4.0,
                        "declaredTotal": {"text": "4.00", "value": 4.0, "at": [90, 100]},
                        "residual": 0.0,
                        "closed": True,
                        "printedPointsPerMetre": ppm,
                    },
                ],
            }
        ],
    }
    # Replace mode: everything comes from the drawing and the outline.
    result = build(plan, registry, template, "rdc", [1], 0.34, merge=False)
    level = result["levels"][0]
    failures = []
    if len(level["walls"]) != 5:
        failures.append(f"{len(level['walls'])} walls instead of 4 exterior walls + 1 partition")
    exterior = [wall for wall in level["walls"] if wall.get("exterior")]
    if len(exterior) != 4:
        failures.append(f"{len(exterior)} exterior walls instead of 4")
    openings = [opening for wall in level["walls"] for opening in wall.get("openings", [])]
    if len(openings) != 1:
        failures.append(f"{len(openings)} openings instead of 1")
    # The south edge runs from x=6 to x=0: the door at x 2.00..2.90 is 3.10 from the start.
    elif abs(openings[0]["width"] - 0.9) > 0.01 or abs(openings[0]["offset"] - 3.1) > 0.01:
        failures.append(f"opening misplaced: {openings[0]}")
    elif not openings[0].get("exterior"):
        failures.append("an exterior-wall opening is not marked exterior")
    # The merge keeps the model walls the drawing does not give.
    with_model = json.loads(json.dumps(template))
    with_model["levels"][0]["walls"] = [
        {
            "id": "hachure",
            "start": [0.34, 1.0],
            "end": [5.66, 1.0],
            "thickness": 0.34,
            "openings": [
                {"id": "porte", "kind": "door", "offset": 2.0, "width": 0.9, "height": 2.1}
            ],
        }
    ]
    merged = build(plan, registry, with_model, "rdc", [1], 0.34)
    merged_walls = merged["levels"][0]["walls"]
    kept = next((wall for wall in merged_walls if wall["id"] == "hachure"), None)
    if kept is None:
        failures.append("the merge removed a hatched wall of the model")
    elif len(kept.get("openings", [])) != 1:
        failures.append("the merge lost an opening of the model")
    # The merge only keeps the model walls and the partitions read: the hatched
    # wall and the partition, no regenerated exterior walls.
    if len(merged_walls) != 2:
        failures.append(f"{len(merged_walls)} walls after merge instead of 2")

    # A retouch survives regeneration and only touches the targeted wall.
    patched = build(
        plan,
        registry,
        template,
        "rdc",
        [1],
        0.34,
        {"walls": {"ext-3": {"offset": 0.05, "thickness": 0.30}}},
        merge=False,
    )
    patched_walls = patched["levels"][0]["walls"]
    target = next(wall for wall in patched_walls if wall["id"] == "ext-3")
    untouched = next(wall for wall in patched_walls if wall["id"] == "ext-1")
    if abs(target["thickness"] - 0.30) > 1e-9:
        failures.append(f"thickness retouch not applied: {target['thickness']}")
    if abs(untouched["thickness"] - 0.34) > 1e-9:
        failures.append(f"retouch applied to the wrong wall: {untouched['thickness']}")

    # A façade chain may cover several edges: on the south, an entrance recess
    # separates two runs. Each opening must land on the edge containing it,
    # otherwise those of the other edges are lost.
    notched = [[0, 0], [6, 0], [6, 4], [4, 4], [4, 3.6], [2, 3.6], [2, 4], [0, 4]]
    notched_template = json.loads(json.dumps(template))
    notched_template["levels"][0]["outline"] = notched
    notched_template["levels"][0]["rooms"] = []
    notched_segments = [
        {"text": "1.00", "kind": "linear", "value": 1.0, "at": [100 + 0.5 * ppm, 400]},
        {"text": "0.90/2.10", "kind": "opening", "value": 0.9, "at": [100 + 1.45 * ppm, 400]},
        {"text": "1.10", "kind": "linear", "value": 1.1, "at": [100 + 2.45 * ppm, 400]},
        {"text": "1.00/2.10", "kind": "opening", "value": 1.0, "at": [100 + 3.5 * ppm, 400]},
        {"text": "2.00", "kind": "linear", "value": 2.0, "at": [100 + 5.0 * ppm, 400]},
    ]
    notched_registry = json.loads(json.dumps(registry))
    notched_registry["pages"][0]["chains"][0]["segments"] = notched_segments
    notched_result = build(
        {"walls": []}, notched_registry, notched_template, "rdc", [1], 0.34, merge=False
    )
    notched_openings = [
        opening
        for wall in notched_result["levels"][0]["walls"]
        for opening in wall.get("openings", [])
    ]
    if len(notched_openings) != 2:
        failures.append(
            f"{len(notched_openings)} openings on a recessed outline instead of 2"
        )
    else:
        widths = sorted(round(opening["width"], 2) for opening in notched_openings)
        if widths != [0.9, 1.0]:
            failures.append(f"recess openings badly distributed: {widths}")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("project generation: self-test passed")
    return 0


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan")
    parser.add_argument("registry")
    parser.add_argument("template")
    parser.add_argument("level")
    parser.add_argument("out")
    parser.add_argument("--pages", default=None)
    parser.add_argument("--thickness", type=float, default=DEFAULT_THICKNESS)
    parser.add_argument(
        "--replace",
        action="store_true",
        help="replace every wall with those of the drawing, instead of merging",
    )
    parser.add_argument(
        "--openings-only",
        action="store_true",
        help="keep the model's walls and only add the openings read on the chains",
    )
    parser.add_argument(
        "--overrides",
        default=None,
        help="file of retouches applied after generation (walls and openings)",
    )
    parser.add_argument(
        "--outline",
        default=None,
        help="outline derived by derive_outline.py, instead of the model's",
    )
    if "--self-test" in argv:
        return self_test()
    args = parser.parse_args(argv[1:])
    pages = [int(value) for value in args.pages.split(",")] if args.pages else None
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    registry = json.loads(Path(args.registry).read_text(encoding="utf-8"))
    template = json.loads(Path(args.template).read_text(encoding="utf-8"))
    overrides = (
        json.loads(Path(args.overrides).read_text(encoding="utf-8")) if args.overrides else None
    )
    outline = load_outline(args.outline) if args.outline else None
    report = {}
    result = build(
        plan,
        registry,
        template,
        args.level,
        pages,
        args.thickness,
        overrides,
        merge=not args.replace,
        report=report,
        openings_only=args.openings_only,
        outline=outline,
    )
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    level = next(candidate for candidate in result["levels"] if candidate["id"] == args.level)
    openings = sum(len(wall.get("openings", [])) for wall in level["walls"])
    print(f"{len(level['walls'])} walls, {openings} openings -> {args.out}")
    read = report.get("thickness") or []
    printed = sum(1 for item in read if item["printed"])
    print(f"thicknesses read on the plan: {printed}/{len(read)}")
    fallback = [item["wall"] for item in read if not item["printed"]]
    if fallback:
        print(f"  no dimension, fallback thickness: {', '.join(fallback)}")
    if report.get("sill") is None:
        print("  sill: no printed dimension, window openings set at 0")
    else:
        print(f"  most frequent printed sill: {report['sill']} m")
    for item in report.get("sillGuessed") or []:
        print(f"  sill not paired, fallback applied: {item['opening']} ({item['wall']})")
    for item in report.get("openingsDropped") or []:
        print(
            f"  opening without a host edge: {item['axis']} "
            f"{item['low']:.2f}..{item['high']:.2f} ({item['width']:.2f} m)"
        )
    if report.get("openingsAdded"):
        print(f"  openings added from the chains: {len(report['openingsAdded'])}")
    moves = report.get("roomMoves") or []
    if moves:
        worst = max(moves, key=lambda move: move["distance"])
        print(
            f"  rooms re-snapped onto the faces: {len(moves)} vertex/vertices, "
            f"the largest by {worst['distance']:.3f} m ({worst['room']})"
        )
    if report.get("rejoined"):
        print(
            f"  partitions rejoined: {len(report['rejoined'])} door(s) "
            f"closed into an opening"
        )
    for move in report.get("closed") or []:
        print(
            f"  {move['wall']}: end extended by {move['gap']} m "
            f"({move['from']} -> {move['to']})"
        )
    for gap in report.get("partitionGaps") or []:
        print(
            f"  {gap['wall']}: model partition {gap['model']} m, "
            f"drawing fill {gap['drawn']} m — model thickness kept"
        )
    for gap in report.get("thicknessGaps") or []:
        print(
            f"  {gap['wall']}: model thickness {gap['model']} m, "
            f"printed dimension {gap['printed']} m"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
