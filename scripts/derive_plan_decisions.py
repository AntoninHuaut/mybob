"""Couche 2 : décisions dérivées d'un projet et d'un registre d'évidence.

Chaque face de mur et chaque ouverture reçoit une décision. Une longueur n'est
déclarée `printed` que si une suite contiguë de segments imprimés reproduit la
distance entre les **faces finies** du mur *et* que les baies du mur désignent
cette suite sans ambiguïté : une longueur seule ne prouve rien, deux murs de même
longueur sur deux lignes de cote différentes donnent le même nombre. Une chaîne
ouverte donne `printed-partial`. Un mur d'enveloppe en retrait d'une
demi-épaisseur donne `derived`, avec son équation. Sinon la décision reste
`unresolved` avec son motif : c'est au releveur de trancher, pas à ce script.

Les chaînes d'un niveau viennent de ses pages : passer `--pages` pour ne pas
apparier un mur du rez-de-chaussée contre les cotes de l'étage.

Usage :
  uvx --from pymupdf python scripts/derive_plan_decisions.py <projet.json> <registre.json> <niveau> <sortie.json> [--pages 13]
  python scripts/derive_plan_decisions.py --self-test
"""
import json
import math
import re
import sys
from pathlib import Path

TOL = 0.01  # m, tolérance d'appariement
TOUCH_TOL = 0.02  # m, un mur aboutit sur l'axe d'un autre
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
    """Extrémités du mur ordonnées le long de son axe, pour un repère unique."""
    axis = wall_axis(wall)
    along = 0 if axis == "horizontal" else 1
    if wall["start"][along] <= wall["end"][along]:
        return axis, along, wall["start"], wall["end"]
    return axis, along, wall["end"], wall["start"]


def distance_to_axis(point, wall):
    """Distance d'un point au segment d'axe d'un mur."""
    ax, az = wall["start"]
    bx, bz = wall["end"]
    dx, dz = bx - ax, bz - az
    span = dx * dx + dz * dz
    if span <= 0:
        return math.dist(point, wall["start"])
    t = max(0.0, min(1.0, ((point[0] - ax) * dx + (point[1] - az) * dz) / span))
    return math.dist(point, (ax + t * dx, az + t * dz))


def touching_thicknesses(walls, point, exclude):
    """Épaisseurs des murs dont l'axe passe par ce point : l'about mitoyen."""
    return {
        round(other["thickness"], 4)
        for other in walls
        if other["id"] != exclude and distance_to_axis(point, other) <= TOUCH_TOL
    }


def candidate_lengths(wall, walls):
    """Longueurs possibles entre faces finies, et le décalage de chaque extrémité.

    Une cote de plan mesure d'une face finie à une autre. À chaque extrémité, la
    cote peut s'arrêter sur l'axe (0), sur la face du mur lui-même ou sur celle
    du mur mitoyen. On énumère ces conventions au lieu de supposer que la cote
    vaut la longueur d'axe, qui n'est vraie que par accident.
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
                    rank = abs(start_offset) + abs(end_offset)
                    if value not in candidates or rank < candidates[value][2]:
                        candidates[value] = (start_offset, end_offset, rank)
    return {value: (offsets[0], offsets[1]) for value, offsets in candidates.items()}


def contiguous_runs(chain):
    """Toutes les suites contiguës de segments imprimés, avec leur somme."""
    segments = chain["segments"]
    for start in range(len(segments)):
        total = 0.0
        for end in range(start, len(segments)):
            total += segments[end]["value"]
            yield start, end, total


def chain_ref(chain):
    return {"page": chain["page"], "axis": chain["axis"], "perpendicular": chain["perpendicular"]}


def outline_bounds(outline, axis):
    """Bord bas et étendue du contour du niveau le long d'un axe."""
    along = 0 if axis == "horizontal" else 1
    values = [point[along] for point in outline]
    return round(min(values), 4), round(max(values) - min(values), 4)


def chain_cumulative(chain):
    cumulative = [0.0]
    for segment in chain["segments"]:
        cumulative.append(cumulative[-1] + segment["value"])
    return cumulative


def run_interval(chain, start, end, base, sign):
    """Intervalle monde d'une suite, une fois la chaîne calée sur le contour."""
    cumulative = chain_cumulative(chain)
    first = base + sign * cumulative[start]
    last = base + sign * cumulative[end + 1]
    return (min(first, last), max(first, last))


def face_span(wall, start_offset, end_offset):
    """Étendue monde des faces finies d'un mur, le long de son axe."""
    axis, along, low, high = oriented_span(wall)
    return (low[along] + start_offset, high[along] + end_offset)


def opening_span(opening, wall):
    """Étendue monde d'une baie, le long de l'axe de son mur."""
    _, along, low, _ = oriented_span(wall)
    return (low[along] + opening["offset"], low[along] + opening["offset"] + opening["width"])


def model_boundaries(walls, axis):
    """Repères du modèle le long d'un axe : abouts de murs et tableaux de baies."""
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
    """Chaînes refermées qui portent l'emprise, calées sur le bord du contour.

    Une chaîne dont la somme égale l'étendue du niveau le long de son axe couvre
    exactement cette étendue : son origine est donc un bord du contour, et ses
    segments deviennent des coordonnées absolues. Le sens de lecture n'est pas
    connu : on garde celui qui retrouve le plus de repères du modèle, et une
    égalité ne tranche pas — la chaîne est alors écartée.
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
    """Origines du repère de tracé, déduites des chaînes calées sur l'emprise.

    Une chaîne calée donne la position absolue de ses segments le long de son
    axe ; la position de sa ligne de cote, elle, se lit dans le repère de l'autre
    axe. Les deux axes se fournissent donc mutuellement leur origine.
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
    """Côté du contour que mesure une chaîne, ou None si sa ligne n'est pas plaçable."""
    along = 0 if chain["axis"] == "horizontal" else 1
    origin = origins.get(1 - along)
    if origin is None:
        return None
    ppm = chain["printedPointsPerMetre"]
    return round((chain["perpendicular"] - origin) / ppm, 3)


def touches_side(wall, side, outline):
    """Le mur porte-t-il la face du contour que la chaîne mesure ?"""
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
    """Suites d'une chaîne calée dont l'intervalle monde est celui des faces du mur."""
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
            for value, (start_offset, end_offset) in candidates.items():
                if abs(total - value) > TOL:
                    continue
                span = face_span(wall, start_offset, end_offset)
                interval = run_interval(chain, start, end, envelope["base"], envelope["sign"])
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
    """Cotes de baie d'une chaîne calée dont l'intervalle monde est celui de la baie."""
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
    """Suites imprimées qui reproduisent une longueur entre faces du mur."""
    axis = wall_axis(wall)
    candidates = candidate_lengths(wall, walls)
    found = {}
    for chain in chains:
        if chain["axis"] != axis:
            continue
        for start, end, total in contiguous_runs(chain):
            for value, (start_offset, end_offset) in candidates.items():
                if abs(total - value) > TOL:
                    continue
                key = (chain["page"], chain["perpendicular"], start, end)
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
    """Origines possibles du mur, une liste par baie présente dans la suite.

    Une baie imprimée à la position cumulée `c` dans la suite, pour un offset
    `o` depuis le début du mur, implique une origine `c − o`. Plusieurs cotes
    identiques dans la même suite donnent plusieurs origines possibles : c'est
    leur intersection qui désigne le mur, pas la première rencontrée.
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
    """Origine commune aux baies du mur, ou None si elle n'est pas unique.

    Une suite qui commence sur une baie donne toujours une origine cohérente
    avec cette seule baie : le mur doit donc aussi tenir dans la suite, de sa
    première face à sa dernière, sinon la suite ne le mesure pas.
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
    """Suite imprimée qui porte l'emprise, pour un mur d'enveloppe en retrait.

    Le mur doit être en retrait d'une demi-épaisseur aux deux extrémités de
    l'emprise, et une chaîne refermée doit porter cette emprise. La longueur
    n'est alors pas mesurée : elle se déduit, et les décalages sont consignés.
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
                f"cote imprimée {match['length']:.3f} m = segments {match['start']}..{match['end']} "
                f"({match['total']:.3f} m) de la chaîne"
            ),
        }
        if anchor == "envelope":
            evidence["note"] += " ; chaîne calée sur l'emprise du niveau"
        if not exact:
            evidence["note"] += (
                f" ; décalages {match['startOffset']:+.3f}/{match['endOffset']:+.3f} m "
                f"d'épaisseurs déclarées → axe {axis_length:.3f} m"
            )
        if not chain["closed"]:
            evidence["note"] += " ; chaîne ouverte, preuve partielle"
        if origin is not None:
            evidence["wallOrigin"] = round(
                origin + sum(item["value"] for item in chain["segments"][: match["start"]]), 4
            )
            evidence["note"] += f" ; origine du mur {evidence['wallOrigin']:.3f} m sur la chaîne"
        return {"id": wall["id"], "wall": wall["id"], "evidence": evidence, "unresolved": False}

    if not matches:
        reason = f"aucune suite imprimée ne reproduit {length:.3f} m entre faces"
    elif len(anchored) > 1:
        reason = f"{len(anchored)} suites imprimées reproduisent {length:.3f} m et portent les baies"
    else:
        reason = (
            f"{len(matches)} suites imprimées reproduisent {length:.3f} m, "
            "aucune ne porte les baies du mur"
        )
    return {
        "id": wall["id"],
        "wall": wall["id"],
        "evidence": {"class": "scaled", "note": f"longueur mesurée {length:.3f} m, axe {axis}"},
        "unresolved": True,
        "reason": reason,
    }


def opening_candidates(opening, wall, chains):
    """Segments de baie imprimés qui concordent en largeur ou en hauteur."""
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
    # Une cote qui donne largeur et hauteur est une meilleure preuve qu'une cote
    # qui n'en donne qu'une : la convention partielle ne sert qu'à défaut.
    exact = [candidate for candidate in candidates if candidate["convention"] == "both"]
    if exact:
        candidates = exact
    face_chain = face["evidence"].get("chain")
    face_span = face["evidence"].get("span")
    face_origin = face["evidence"].get("wallOrigin")

    def positioned(candidate):
        """La baie tombe-t-elle à l'offset du projet depuis l'origine du mur ?"""
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

    # Une chaîne calée sur l'emprise donne la position absolue de la baie : c'est
    # une preuve plus forte que la seule concordance de largeur et de hauteur.
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
                        f"cote imprimée {width:.2f}/{height:.2f} m, position absolue "
                        "sur une chaîne calée sur l'emprise"
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
                f"cote imprimée {candidate['width']:.2f}/{candidate['height']:.2f} m "
                f"(convention : {candidate['convention']})"
            ),
        }
        if face_chain and face_origin is not None and positioned(candidate) is not None:
            evidence["wallOrigin"] = face_origin
            evidence["note"] += " ; position vérifiée sur la suite du mur"
        return {"id": opening["id"], "wall": wall["id"], "evidence": evidence, "unresolved": False}

    if not candidates:
        reason = (
            f"aucune cote de baie {opening['width']:.2f}/{opening['height']:.2f} m "
            "sur l'axe du mur"
        )
    else:
        reason = f"{len(candidates)} cotes de baie concordent, aucune positionnée sur le mur"
    return {
        "id": opening["id"],
        "wall": wall["id"],
        "evidence": {
            "class": "scaled",
            "note": f"largeur {opening['width']:.2f} m, hauteur {opening['height']:.2f} m",
        },
        "unresolved": True,
        "reason": reason,
    }


def build_decisions(project, registry, level_id, registry_path, pages=None):
    level = next((candidate for candidate in project["levels"] if candidate["id"] == level_id), None)
    if level is None:
        raise SystemExit(f"niveau {level_id} absent du projet")
    selected = [page for page in registry["pages"] if pages is None or page["index"] in pages]
    if not selected:
        raise SystemExit(f"aucune page {pages} dans le registre")
    chains = [chain for page in selected for chain in page["chains"]]
    walls = level["walls"]
    envelopes = envelope_orientations(chains, level["outline"], walls)
    origins = envelope_frame(envelopes)
    faces = [
        face_decision(wall, walls, chains, level["outline"], envelopes, origins)
        for wall in walls
    ]
    by_wall = {decision["wall"]: decision for decision in faces}
    openings = [
        opening_decision(opening, wall, chains, by_wall[wall["id"]], envelopes, origins, level["outline"])
        for wall in walls
        for opening in wall.get("openings", [])
    ]
    return {
        "schemaVersion": 1,
        "project": project["id"],
        "level": level_id,
        "registry": registry_path.replace("\\", "/"),
        "pages": sorted(page["index"] for page in selected),
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
        f"{len(decisions['faces'])} faces, {len(decisions['openings'])} ouvertures : "
        f"{proven} prouvées, {total - proven} à trancher"
    )


def self_test():
    """Non-régression de la couche décision sur le plan de référence synthétique."""
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
            failures.append(f"{kind} : {sorted(set(produced) ^ set(wanted))} d'identifiants")
            continue
        for identifier, decision in wanted.items():
            if produced[identifier] != decision:
                failures.append(f"{kind} {identifier} : décision différente du fichier de référence")
    if any(decision["unresolved"] for decision in decisions["faces"] + decisions["openings"]):
        failures.append("le plan de référence doit être entièrement prouvé")

    # Un mur sans cote imprimée doit rester non résolu : la couche ne devine pas.
    extended = json.loads(json.dumps(project))
    extended["levels"][0]["walls"].append(
        {"id": "refend-bas", "start": [4.5, 0.2], "end": [4.5, 1.4], "thickness": 0.1}
    )
    extended_decisions = build_decisions(extended, registry, "rdc", registry_path, pages=[1])
    added = next(
        decision for decision in extended_decisions["faces"] if decision["id"] == "refend-bas"
    )
    if not added["unresolved"]:
        failures.append("un mur sans cote imprimée a été déclaré prouvé")

    # Une cote d'un autre niveau ne doit pas prouver un mur de celui-ci.
    other_page = build_decisions(project, registry, "rdc", registry_path, pages=[2])
    if any(not decision["unresolved"] for decision in other_page["faces"]):
        failures.append("une page d'un autre niveau a prouvé une face")

    if failures:
        for failure in failures:
            print(f"ECHEC {failure}")
        return 1
    print(f"plan de référence : {summarise(decisions)}")
    print("couche décision : auto-test réussi")
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
    project = json.loads(Path(project_path).read_text(encoding="utf-8"))
    registry = json.loads(Path(registry_path).read_text(encoding="utf-8"))
    decisions = build_decisions(project, registry, level_id, registry_path, pages)
    Path(out).write_text(json.dumps(decisions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(summarise(decisions))
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
