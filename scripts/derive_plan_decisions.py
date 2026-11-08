"""Layer 2: decisions derived from a project and an evidence registry.

Every wall face and every opening receives a decision. A length is only declared
`printed` if a contiguous sequence of printed segments reproduces the distance
between the wall's **finished faces** *and* the wall's openings designate that
sequence unambiguously: a length alone proves nothing, two walls of the same
length on two different dimension lines give the same number. An open chain
gives `printed-partial`. An envelope wall set back by half a thickness gives
`derived`, with its equation. Otherwise the decision stays `unresolved` with its
reason: the surveyor decides, not this script.

A level's chains come from its pages: pass `--pages` so as not to pair a
ground-floor wall against the upper floor's dimensions.

The level outline comes from the project, unless `--outline` points to the output
of `scripts/derive_outline.py`: the derived outline then replaces the hand-written
one, and the frame of the chains fitted to the footprint becomes its frame.

Usage:
  uvx --from pymupdf python scripts/derive_plan_decisions.py <project.json> <registry.json> <level> <output.json> [--pages 13] [--outline outline.json]
  python scripts/derive_plan_decisions.py --self-test
"""
import json
import math
import re
import sys
from pathlib import Path

from derive_outline import load_outline

TOL = 0.01  # m, pairing tolerance
TOUCH_TOL = 0.02  # m, a wall ends on another wall's axis
OPENING_TEXT = re.compile(r"^(\d+(?:[.,]\d+)?)/(\d+(?:[.,]\d+)?)$")
FIXTURE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "plan-reference"


def metres(token):
    return float(token.replace(",", ".")) if re.search(r"[.,]", token) else float(token) / 100


def wall_axis(wall):
    dx = abs(wall["end"][0] - wall["start"][0])
    dz = abs(wall["end"][1] - wall["start"][1])
    return "horizontal" if dx >= dz else "vertical"


def wall_length(wall):
    return math.dist(wall["start"], wall["end"])


def oriented_span(wall):
    """Wall ends ordered along its axis, for a single frame."""
    axis = wall_axis(wall)
    along = 0 if axis == "horizontal" else 1
    if wall["start"][along] <= wall["end"][along]:
        return axis, along, wall["start"], wall["end"]
    return axis, along, wall["end"], wall["start"]


def distance_to_axis(point, wall):
    """Distance from a point to a wall's axis segment."""
    ax, az = wall["start"]
    bx, bz = wall["end"]
    dx, dz = bx - ax, bz - az
    span = dx * dx + dz * dz
    if span <= 0:
        return math.dist(point, wall["start"])
    t = max(0.0, min(1.0, ((point[0] - ax) * dx + (point[1] - az) * dz) / span))
    return math.dist(point, (ax + t * dx, az + t * dz))


def touching_thicknesses(walls, point, exclude):
    """Thicknesses of the walls whose axis passes through this point: the adjoining end."""
    return {
        round(other["thickness"], 4)
        for other in walls
        if other["id"] != exclude and distance_to_axis(point, other) <= TOUCH_TOL
    }


def candidate_lengths(wall, walls):
    """Possible lengths between finished faces, and the offsets of each end.

    A plan dimension measures from one finished face to another. At each end, the
    dimension may stop on the axis (0), on the wall's own face or on that of the
    adjoining wall. These conventions are enumerated instead of assuming the
    dimension equals the axis length, which is only true by accident.

    Two opposite conventions often give **the same length**: a 3.92 m wall between
    two 0.34 m walls is 4.09 m whether you start from its north face or its south
    face. Deciding by an arbitrary rank discarded the right one; every convention is
    therefore returned, and the positional anchor — the wall's openings, or a chain
    fitted to the footprint — chooses.
    """
    _, _, low, high = oriented_span(wall)
    length = wall_length(wall)
    own = round(wall["thickness"], 4)
    low_thicknesses = touching_thicknesses(walls, low, wall["id"]) | {own}
    high_thicknesses = touching_thicknesses(walls, high, wall["id"]) | {own}
    candidates = {}
    for first in sorted(low_thicknesses):
        for last in sorted(high_thicknesses):
            for sign_start in (-1, 0, 1):
                for sign_end in (-1, 0, 1):
                    start_offset = round(sign_start * first / 2, 4)
                    end_offset = round(sign_end * last / 2, 4)
                    value = round(length + end_offset - start_offset, 4)
                    candidates.setdefault(value, [])
                    if (start_offset, end_offset) not in candidates[value]:
                        candidates[value].append((start_offset, end_offset))
    return {
        value: sorted(offsets, key=lambda pair: abs(pair[0]) + abs(pair[1]))
        for value, offsets in candidates.items()
    }


def contiguous_runs(chain):
    """Every contiguous sequence of printed segments, with its sum."""
    segments = chain["segments"]
    for start in range(len(segments)):
        total = 0.0
        for end in range(start, len(segments)):
            total += segments[end]["value"]
            yield start, end, total


def chain_ref(chain):
    return {"page": chain["page"], "axis": chain["axis"], "perpendicular": chain["perpendicular"]}


def outline_bounds(outline, axis):
    """Low edge and extent of the level outline along an axis."""
    along = 0 if axis == "horizontal" else 1
    values = [point[along] for point in outline]
    return round(min(values), 4), round(max(values) - min(values), 4)


def chain_cumulative(chain):
    cumulative = [0.0]
    for segment in chain["segments"]:
        cumulative.append(cumulative[-1] + segment["value"])
    return cumulative


def run_interval(chain, start, end, base, sign):
    """World interval of a sequence, once the chain is fitted to the outline."""
    cumulative = chain_cumulative(chain)
    first = base + sign * cumulative[start]
    last = base + sign * cumulative[end + 1]
    return (min(first, last), max(first, last))


def face_span(wall, start_offset, end_offset):
    """World extent of a wall's finished faces, along its axis."""
    axis, along, low, high = oriented_span(wall)
    return (low[along] + start_offset, high[along] + end_offset)


def opening_span(opening, wall):
    """World extent of an opening, along its wall's axis."""
    _, along, low, _ = oriented_span(wall)
    return (low[along] + opening["offset"], low[along] + opening["offset"] + opening["width"])


def model_boundaries(walls, axis):
    """Model ticks along an axis: wall ends and opening reveals."""
    along = 0 if axis == "horizontal" else 1
    points = []
    for wall in walls:
        if wall_axis(wall) != axis:
            continue
        _, _, low, high = oriented_span(wall)
        points.extend([low[along], high[along]])
        for opening in wall.get("openings", []):
            points.extend(opening_span(opening, wall))
    return points


def envelope_orientations(chains, outline, walls):
    """Closed chains carrying the footprint, fitted to the outline's edge.

    A chain whose sum equals the level's extent along its axis covers exactly that
    extent: its origin is therefore an edge of the outline, and its segments become
    absolute coordinates. The reading direction is unknown: the one finding the most
    model ticks is kept, and a tie decides nothing — the chain is then discarded.
    """
    found = []
    for axis in ("horizontal", "vertical"):
        low, extent = outline_bounds(outline, axis)
        boundaries = model_boundaries(walls, axis)
        for chain in chains:
            if chain["axis"] != axis or not chain["closed"]:
                continue
            if abs(chain["sum"] - extent) > TOL:
                continue
            cumulative = chain_cumulative(chain)
            scores = []
            for sign, base in ((1, low), (-1, low + extent)):
                score = sum(
                    1
                    for value in cumulative
                    if any(abs(base + sign * value - point) <= TOL for point in boundaries)
                )
                scores.append((score, sign, base))
            scores.sort(key=lambda item: -item[0])
            if scores[0][0] > scores[1][0]:
                found.append({"chain": chain, "sign": scores[0][1], "base": scores[0][2]})
    return found


def envelope_frame(envelopes):
    """Origins of the drawing frame, deduced from the chains fitted to the footprint.

    A fitted chain gives the absolute position of its segments along its axis; the
    position of its dimension line, however, is read in the other axis's frame. The
    two axes therefore give each other their origin.
    """
    origins = {}
    for envelope in envelopes:
        chain = envelope["chain"]
        along = 0 if chain["axis"] == "horizontal" else 1
        ppm = chain["printedPointsPerMetre"]
        first = chain["segments"][0]
        start_pt = first["at"][along] - first["value"] / 2 * ppm
        origins[along] = round(start_pt - envelope["base"] * ppm, 3)
    return origins


def chain_side(chain, origins):
    """Side of the outline a chain measures, or None if its line cannot be placed."""
    along = 0 if chain["axis"] == "horizontal" else 1
    origin = origins.get(1 - along)
    if origin is None:
        return None
    ppm = chain["printedPointsPerMetre"]
    return round((chain["perpendicular"] - origin) / ppm, 3)


def touches_side(wall, side, outline):
    """Does the wall carry the outline face the chain measures?"""
    axis = wall_axis(wall)
    across = 1 if axis == "horizontal" else 0
    values = [point[across] for point in outline]
    low, high = min(values), max(values)
    centre = wall["start"][across]
    half = wall["thickness"] / 2
    if side > high:
        return abs(centre + half - high) <= TOL
    if side < low:
        return abs(centre - half - low) <= TOL
    return False


def positional_face_matches(wall, walls, envelopes, origins, outline):
    """Sequences of a fitted chain whose world interval is that of the wall's faces."""
    axis = wall_axis(wall)
    candidates = candidate_lengths(wall, walls)
    found = []
    for envelope in envelopes:
        chain = envelope["chain"]
        if chain["axis"] != axis:
            continue
        side = chain_side(chain, origins)
        if side is None or not touches_side(wall, side, outline):
            continue
        for start, end, total in contiguous_runs(chain):
            for value, conventions in candidates.items():
                if abs(total - value) > TOL:
                    continue
                interval = run_interval(chain, start, end, envelope["base"], envelope["sign"])
                for start_offset, end_offset in conventions:
                    span = face_span(wall, start_offset, end_offset)
                    if abs(interval[0] - span[0]) <= TOL and abs(interval[1] - span[1]) <= TOL:
                        found.append(
                            {
                                "chain": chain,
                                "start": start,
                                "end": end,
                                "total": total,
                                "length": value,
                                "startOffset": start_offset,
                                "endOffset": end_offset,
                            }
                        )
    return found


def positional_opening_matches(opening, wall, envelopes, origins, outline):
    """Opening dimensions of a fitted chain whose world interval is that of the opening."""
    axis = wall_axis(wall)
    span = opening_span(opening, wall)
    found = []
    for envelope in envelopes:
        chain = envelope["chain"]
        if chain["axis"] != axis:
            continue
        side = chain_side(chain, origins)
        if side is None or not touches_side(wall, side, outline):
            continue
        for index, segment in enumerate(chain["segments"]):
            if segment["kind"] != "opening":
                continue
            interval = run_interval(chain, index, index, envelope["base"], envelope["sign"])
            if abs(interval[0] - span[0]) <= TOL and abs(interval[1] - span[1]) <= TOL:
                found.append({"chain": chain, "index": index, "segment": segment})
    return found


def length_matches(chains, wall, walls):
    """Printed sequences reproducing a length between the wall's faces."""
    axis = wall_axis(wall)
    candidates = candidate_lengths(wall, walls)
    found = {}
    for chain in chains:
        if chain["axis"] != axis:
            continue
        for start, end, total in contiguous_runs(chain):
            for value, conventions in candidates.items():
                if abs(total - value) > TOL:
                    continue
                for start_offset, end_offset in conventions:
                    key = (
                        chain["page"],
                        chain["perpendicular"],
                        start,
                        end,
                        start_offset,
                        end_offset,
                    )
                    previous = found.get(key)
                    if previous is None or abs(total - value) < abs(total - previous["length"]):
                        found[key] = {
                            "chain": chain,
                            "start": start,
                            "end": end,
                            "total": total,
                            "length": value,
                            "startOffset": start_offset,
                            "endOffset": end_offset,
                        }
    return list(found.values())


def opening_origin_options(wall, match):
    """Possible wall origins, one list per opening present in the sequence.

    An opening printed at cumulative position `c` in the sequence, for an offset
    `o` from the start of the wall, implies an origin `c − o`. Several identical
    dimensions in the same sequence give several possible origins: their
    intersection designates the wall, not the first one met.
    """
    chain, start, end = match["chain"], match["start"], match["end"]
    options = []
    for opening in wall.get("openings", []):
        found = []
        for index in range(start, end + 1):
            segment = chain["segments"][index]
            if segment["kind"] != "opening":
                continue
            parsed = OPENING_TEXT.match(segment["text"])
            if not parsed:
                continue
            width, height = metres(parsed.group(1)), metres(parsed.group(2))
            if abs(width - opening["width"]) > TOL or abs(height - opening["height"]) > TOL:
                continue
            cumulative = sum(item["value"] for item in chain["segments"][start:index])
            found.append(round(cumulative - opening["offset"], 4))
        if found:
            options.append(found)
    return options


def anchored_origin(wall, match):
    """Origin common to the wall's openings, or None if it is not unique.

    A sequence starting on an opening always gives an origin consistent with that
    single opening: the wall must therefore also fit within the sequence, from its
    first face to its last, otherwise the sequence does not measure it.
    """
    options = opening_origin_options(wall, match)
    if not options:
        return None
    consistent = [
        candidate
        for candidate in options[0]
        if all(any(abs(option - candidate) <= TOL for option in group) for group in options[1:])
    ]
    length = wall_length(wall)
    fitting = [
        candidate
        for candidate in consistent
        if candidate + match["startOffset"] >= -TOL
        and candidate + match["startOffset"] + length <= match["total"] + TOL
    ]
    return fitting[0] if len(fitting) == 1 else None


def envelope_match(wall, chains, outline):
    """Printed sequence carrying the footprint, for a recessed envelope wall.

    The wall must be set back by half a thickness at both ends of the footprint,
    and a closed chain must carry that footprint. The length is then not measured:
    it is deduced, and the offsets are recorded.
    """
    axis, along, low, high = oriented_span(wall)
    values = [point[along] for point in outline]
    extent = round(max(values) - min(values), 4)
    thickness = round(wall["thickness"], 4)
    if abs(low[along] - (min(values) + thickness / 2)) > TOL:
        return None
    if abs(high[along] - (max(values) - thickness / 2)) > TOL:
        return None
    chain = next(
        (
            candidate
            for candidate in chains
            if candidate["axis"] == axis
            and candidate["closed"]
            and candidate["declaredTotal"]
            and abs(candidate["declaredTotal"]["value"] - extent) <= TOL
        ),
        None,
    )
    if chain is None:
        return None
    if abs(extent - thickness - wall_length(wall)) > TOL:
        return None
    return {
        "chain": chain,
        "start": 0,
        "end": len(chain["segments"]) - 1,
        "total": extent,
        "length": extent,
        "startOffset": round(-thickness / 2, 4),
        "endOffset": round(thickness / 2, 4),
    }


def face_decision(wall, walls, chains, outline, envelopes, origins):
    length = wall_length(wall)
    axis = wall_axis(wall)
    matches = length_matches(chains, wall, walls)
    anchored = []
    for match in matches:
        origin = anchored_origin(wall, match)
        if origin is not None:
            anchored.append((match, origin))

    if len(anchored) == 1:
        match, origin = anchored[0]
        anchor = "openings"
    else:
        match, origin, anchor = None, None, None
    if match is None:
        positioned = positional_face_matches(wall, walls, envelopes, origins, outline)
        if len(positioned) == 1:
            match, origin, anchor = positioned[0], None, "envelope"
    if match is None:
        match = envelope_match(wall, chains, outline)
        origin = None
        anchor = "envelope" if match is not None else None

    if match is not None:
        chain = match["chain"]
        exact = abs(match["startOffset"]) <= TOL and abs(match["endOffset"]) <= TOL
        if exact:
            evidence_class = "printed" if chain["closed"] else "printed-partial"
        else:
            evidence_class = "derived"
        axis_length = round(match["length"] - match["endOffset"] + match["startOffset"], 4)
        evidence = {
            "class": evidence_class,
            "chain": chain_ref(chain),
            "span": {"start": match["start"], "end": match["end"]},
            "length": round(match["length"], 4),
            "startOffset": match["startOffset"],
            "endOffset": match["endOffset"],
            "anchor": anchor,
            "note": (
                f"printed dimension {match['length']:.3f} m = segments {match['start']}..{match['end']} "
                f"({match['total']:.3f} m) of the chain"
            ),
        }
        if anchor == "envelope":
            evidence["note"] += "; chain fitted to the level footprint"
        if not exact:
            evidence["note"] += (
                f"; offsets {match['startOffset']:+.3f}/{match['endOffset']:+.3f} m "
                f"from declared thicknesses → axis {axis_length:.3f} m"
            )
        if not chain["closed"]:
            evidence["note"] += "; open chain, partial proof"
        if origin is not None:
            evidence["wallOrigin"] = round(
                origin + sum(item["value"] for item in chain["segments"][: match["start"]]), 4
            )
            evidence["note"] += f"; wall origin {evidence['wallOrigin']:.3f} m on the chain"
        return {"id": wall["id"], "wall": wall["id"], "evidence": evidence, "unresolved": False}

    if not matches:
        reason = f"no printed sequence reproduces {length:.3f} m between faces"
    elif len(anchored) > 1:
        reason = f"{len(anchored)} printed sequences reproduce {length:.3f} m and carry the openings"
    else:
        reason = (
            f"{len(matches)} printed sequences reproduce {length:.3f} m, "
            "none carries the wall's openings"
        )
    return {
        "id": wall["id"],
        "wall": wall["id"],
        "evidence": {"class": "scaled", "note": f"measured length {length:.3f} m, axis {axis}"},
        "unresolved": True,
        "reason": reason,
    }


def opening_candidates(opening, wall, chains):
    """Printed opening segments agreeing in width or in height."""
    axis = wall_axis(wall)
    found = []
    for chain in chains:
        if chain["axis"] != axis:
            continue
        for index, segment in enumerate(chain["segments"]):
            if segment["kind"] != "opening":
                continue
            parsed = OPENING_TEXT.match(segment["text"])
            if not parsed:
                continue
            width, height = metres(parsed.group(1)), metres(parsed.group(2))
            width_ok = abs(width - opening["width"]) <= TOL
            height_ok = abs(height - opening["height"]) <= TOL
            if not (width_ok or height_ok):
                continue
            convention = "both" if width_ok and height_ok else ("width" if width_ok else "height")
            found.append(
                {
                    "chain": chain,
                    "index": index,
                    "width": width,
                    "height": height,
                    "convention": convention,
                }
            )
    return found


def opening_decision(opening, wall, chains, face, envelopes, origins, outline):
    candidates = opening_candidates(opening, wall, chains)
    # A dimension giving width and height is a better proof than a dimension
    # giving only one: the partial convention only serves as a fallback.
    exact = [candidate for candidate in candidates if candidate["convention"] == "both"]
    if exact:
        candidates = exact
    face_chain = face["evidence"].get("chain")
    face_span = face["evidence"].get("span")
    face_origin = face["evidence"].get("wallOrigin")

    def positioned(candidate):
        """Does the opening land at the project offset from the wall origin?"""
        if not face_chain or not face_span or face_origin is None:
            return None
        if candidate["chain"]["page"] != face_chain["page"]:
            return None
        if candidate["chain"]["axis"] != face_chain["axis"]:
            return None
        if abs(candidate["chain"]["perpendicular"] - face_chain["perpendicular"]) > 0.5:
            return None
        if not face_span["start"] <= candidate["index"] <= face_span["end"]:
            return None
        cumulative = sum(
            item["value"] for item in candidate["chain"]["segments"][: candidate["index"]]
        )
        return cumulative if abs(cumulative - (face_origin + opening["offset"])) <= TOL else None

    # A chain fitted to the footprint gives the absolute position of the opening: it is
    # a stronger proof than mere width and height agreement.
    placed_by_envelope = positional_opening_matches(opening, wall, envelopes, origins, outline)
    if len(placed_by_envelope) == 1:
        candidate = placed_by_envelope[0]
        chain = candidate["chain"]
        parsed = OPENING_TEXT.match(candidate["segment"]["text"])
        width, height = metres(parsed.group(1)), metres(parsed.group(2))
        width_ok = abs(width - opening["width"]) <= TOL
        height_ok = abs(height - opening["height"]) <= TOL
        if width_ok or height_ok:
            cumulative = sum(item["value"] for item in chain["segments"][: candidate["index"]])
            return {
                "id": opening["id"],
                "wall": wall["id"],
                "evidence": {
                    "class": "printed",
                    "chain": chain_ref(chain),
                    "segmentIndex": candidate["index"],
                    "cumulativeOffset": round(cumulative, 4),
                    "printedWidth": width,
                    "printedHeight": height,
                    "convention": "both" if width_ok and height_ok else ("width" if width_ok else "height"),
                    "anchor": "envelope",
                    "note": (
                        f"printed dimension {width:.2f}/{height:.2f} m, absolute position "
                        "on a chain fitted to the footprint"
                    ),
                },
                "unresolved": False,
            }

    if len(candidates) > 1:
        placed = [candidate for candidate in candidates if positioned(candidate) is not None]
        if len(placed) == 1:
            candidates = placed

    if len(candidates) == 1:
        candidate = candidates[0]
        chain = candidate["chain"]
        cumulative = sum(item["value"] for item in chain["segments"][: candidate["index"]])
        evidence = {
            "class": "printed",
            "chain": chain_ref(chain),
            "segmentIndex": candidate["index"],
            "cumulativeOffset": round(cumulative, 4),
            "printedWidth": candidate["width"],
            "printedHeight": candidate["height"],
            "convention": candidate["convention"],
            "anchor": "openings",
            "note": (
                f"printed dimension {candidate['width']:.2f}/{candidate['height']:.2f} m "
                f"(convention : {candidate['convention']})"
            ),
        }
        if face_chain and face_origin is not None and positioned(candidate) is not None:
            evidence["wallOrigin"] = face_origin
            evidence["note"] += "; position checked on the wall's sequence"
        return {"id": opening["id"], "wall": wall["id"], "evidence": evidence, "unresolved": False}

    if not candidates:
        reason = (
            f"no opening dimension {opening['width']:.2f}/{opening['height']:.2f} m "
            "on the wall axis"
        )
    else:
        reason = f"{len(candidates)} opening dimensions agree, none positioned on the wall"
    return {
        "id": opening["id"],
        "wall": wall["id"],
        "evidence": {
            "class": "scaled",
            "note": f"width {opening['width']:.2f} m, height {opening['height']:.2f} m",
        },
        "unresolved": True,
        "reason": reason,
    }


def build_decisions(project, registry, level_id, registry_path, pages=None, outline=None):
    level = next((candidate for candidate in project["levels"] if candidate["id"] == level_id), None)
    if level is None:
        raise SystemExit(f"level {level_id} missing from the project")
    # The hand-written outline is only an opinion: when layer 3 has derived
    # one, it gives the frame, and the chains fitted to the
    # footprint become absolute coordinates.
    outline = level["outline"] if outline is None else outline
    selected = [page for page in registry["pages"] if pages is None or page["index"] in pages]
    if not selected:
        raise SystemExit(f"no page {pages} in the registry")
    chains = [chain for page in selected for chain in page["chains"]]
    walls = level["walls"]
    envelopes = envelope_orientations(chains, outline, walls)
    origins = envelope_frame(envelopes)
    faces = [
        face_decision(wall, walls, chains, outline, envelopes, origins)
        for wall in walls
    ]
    by_wall = {decision["wall"]: decision for decision in faces}
    openings = [
        opening_decision(opening, wall, chains, by_wall[wall["id"]], envelopes, origins, outline)
        for wall in walls
        for opening in wall.get("openings", [])
    ]
    return {
        "schemaVersion": 1,
        "project": project["id"],
        "level": level_id,
        "registry": registry_path.replace("\\", "/"),
        "pages": sorted(page["index"] for page in selected),
        "outline": outline,
        "envelopes": [
            {
                "page": envelope["chain"]["page"],
                "axis": envelope["chain"]["axis"],
                "perpendicular": envelope["chain"]["perpendicular"],
                "base": envelope["base"],
                "sign": envelope["sign"],
            }
            for envelope in envelopes
        ],
        "faces": faces,
        "openings": openings,
    }


def summarise(decisions):
    proven = sum(
        1 for decision in decisions["faces"] + decisions["openings"] if not decision["unresolved"]
    )
    total = len(decisions["faces"]) + len(decisions["openings"])
    return (
        f"{len(decisions['faces'])} faces, {len(decisions['openings'])} openings: "
        f"{proven} proven, {total - proven} to decide"
    )


def self_test():
    """Non-regression of the decision layer on the synthetic reference plan."""
    project = json.loads((FIXTURE / "project.json").read_text(encoding="utf-8"))
    registry = json.loads((FIXTURE / "registry.json").read_text(encoding="utf-8"))
    expected = json.loads((FIXTURE / "decisions.json").read_text(encoding="utf-8"))
    registry_path = "tests/fixtures/plan-reference/registry.json"
    decisions = build_decisions(project, registry, "rdc", registry_path, pages=[1])
    failures = []
    for kind in ("faces", "openings"):
        produced = {decision["id"]: decision for decision in decisions[kind]}
        wanted = {decision["id"]: decision for decision in expected[kind]}
        if set(produced) != set(wanted):
            failures.append(f"{kind}: {sorted(set(produced) ^ set(wanted))} identifiers")
            continue
        for identifier, decision in wanted.items():
            if produced[identifier] != decision:
                failures.append(f"{kind} {identifier}: decision differs from the reference file")
    if any(decision["unresolved"] for decision in decisions["faces"] + decisions["openings"]):
        failures.append("the reference plan must be entirely proven")

    # A wall without a printed dimension must stay unresolved: the layer does not guess.
    extended = json.loads(json.dumps(project))
    extended["levels"][0]["walls"].append(
        {"id": "refend-bas", "start": [4.5, 0.2], "end": [4.5, 1.4], "thickness": 0.1}
    )
    extended_decisions = build_decisions(extended, registry, "rdc", registry_path, pages=[1])
    added = next(
        decision for decision in extended_decisions["faces"] if decision["id"] == "refend-bas"
    )
    if not added["unresolved"]:
        failures.append("a wall without a printed dimension was declared proven")

    # A dimension from another level must not prove a wall of this one.
    other_page = build_decisions(project, registry, "rdc", registry_path, pages=[2])
    if any(not decision["unresolved"] for decision in other_page["faces"]):
        failures.append("a page from another level proved a face")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print(f"reference plan: {summarise(decisions)}")
    print("decision layer: self-test passed")
    return 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    if len(argv) < 5:
        print(__doc__)
        return 2
    project_path, registry_path, level_id, out = argv[1:5]
    pages = None
    if "--pages" in argv:
        pages = [int(value) for value in argv[argv.index("--pages") + 1].split(",")]
    outline = None
    if "--outline" in argv:
        outline = load_outline(argv[argv.index("--outline") + 1])
    project = json.loads(Path(project_path).read_text(encoding="utf-8"))
    registry = json.loads(Path(registry_path).read_text(encoding="utf-8"))
    decisions = build_decisions(project, registry, level_id, registry_path, pages, outline)
    Path(out).write_text(json.dumps(decisions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(summarise(decisions))
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
