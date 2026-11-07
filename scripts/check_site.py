"""Contrôle du site : terrain et toiture contre le plan de masse.

Les pièces ont leur porte (`check_plan_surfaces.py`) ; le terrain et le toit
n'avaient rien. Un `site` écrit sans retour au document peut porter une
parcelle fausse, un toit 28 cm trop haut ou une maison au mauvais endroit sans
qu'aucune commande ne le dise.

Cinq points de contrôle, chacun suppose le précédent :

1. **La parcelle.** Longueurs au lacet des côtés et surface du polygone,
   comparées aux cotes de côté et au « Surface : » imprimés. Une cote peut
   scinder un côté en morceaux : des libellés collinéaires somment.
2. **L'implantation.** Distance de chaque côté au contour du niveau, et chaînes
   de cotes dont la somme vaut un côté : chaque segment de chaîne doit retomber
   sur le morcellement calculé du côté (recul, emprise, recul). C'est ce qui
   attrape une parcelle bien dimensionnée mais mal placée : les longueurs
   peuvent tomber juste avec la maison au mauvais endroit.
3. **Les niveaux.** Égout et Faîtage moins RDC, comparés aux `y` des sommets de
   toiture — tout est ramené au repère du niveau, pas à la référence du
   cartouche : `Egout +3.01` moins `RDC +0.28` vaut 2.73, pas 3.01.
4. **La topologie du toit.** Pignons et égouts retrouvés par façade depuis
   `gables` et `faces`, avec leur débord. Un pignon flottant, ou une façade qui
   porte à la fois pignon et égout, se voit ici.
5. **Les surfaces de terrain.** Une seule est cotée : celle qui se rapporte à
   une surface rectangulaire imprimée. Les autres sont signalées, pour qu'elles
   restent déclarées dans `site.notes` et ne passent pas pour des cotes.

REFUSER : site absent, parcelle non fermée, cote de côté sans côté au modèle,
égout ou faîtage au-delà de la tolérance, côté dont la chaîne de cotes ne
retombe pas sur le morcellement calculé, contour du niveau qui sort de la
parcelle, réserve de topologie.

SIGNALER : côtés sans cote imprimée, reculs non cotés (ils se déduisent),
surfaces de terrain non cotées, niveaux non imprimés, façades sans toiture.

Pièges portés par le script :

- **L'égout du dessin n'est pas l'égout coté.** Le trait du dessin est le
  dessus de la gouttière, la cote est la ligne d'eau : 15 à 20 cm d'écart à
  cet endroit viennent du dessin, pas du modèle. Ne pas « corriger » le toit
  pour le faire tomber sur le dessin : la comparaison se fait sur les cotes,
  et l'écart dessin/cote est nommé quand il apparaît.
- **Les reculs non cotés se déduisent** : le script les rend, sans les juger.
- **Le repère du projet n'est pas celui du dessin** : seules des distances et
  des longueurs sont comparées, jamais des coordonnées.

Usage :
  python scripts/check_site.py <registre.json> <projet.json> [--page 6] \
      [--level rdc] [--tolerance 0.05] [--area-tolerance 0.5] [--json sortie.json]
"""
import argparse
import json
import math
import sys
import unicodedata
from itertools import combinations
from pathlib import Path

DEFAULT_TOLERANCE = 0.05  # m, écart accepté entre cote imprimée et valeur calculée
DEFAULT_AREA_TOLERANCE = 0.5  # m², la surface imprimée est arrondie au m²
DEGENERATE = 0.005  # m, en dessous, un côté, un recul ou un débord est nul
COLLINEAR_TOL = 5.0  # pt, écart entre centres d'étiquettes d'une même ligne
ON_EDGE_TOL = 0.01  # m, un sommet affleurant une limite reste dans la parcelle
TRACE_TOLERANCE = 0.5  # m, écart de tracé accepté pour apparier une surface cotée
EAVE_DRAW_WINDOW = 0.20  # m, écart dessin/cote typique au niveau de la gouttière


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
# géométrie : longueurs, aires, distances — aucune interprétation
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
    """Distance minimale entre deux segments : chaque extrémité sur l'autre."""
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
    """Franchissement franc uniquement : un sommet affleurant une limite n'est
    pas un croisement, sinon toute façade posée sur la limite serait signalée.
    Un tour nul (sommet ou segment sur la limite) exclut le franchissement."""

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
    """Le niveau tient dans la parcelle : sommets dedans ou affleurants,
    aucune arête qui franchit une limite."""
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
# registre : lecture des cotes imprimées
# --------------------------------------------------------------------------


def find_page(registry, page_index):
    pages = registry.get("pages") or []
    if page_index is None:
        if len(pages) == 1:
            return pages[0]
        raise ValueError("le registre couvre plusieurs pages : préciser --page")
    for page in pages:
        if page.get("index") == page_index:
            return page
    raise ValueError(f"page {page_index} absente du registre")


def named_levels(labels, key):
    """Valeurs imprimées d'un libellé nommé (rdc, egout, faitage…)."""
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
    return f"{total} (scindée)"


# --------------------------------------------------------------------------
# point 1 : côtés de parcelle et surface
# --------------------------------------------------------------------------


def model_boundary_sides(boundary):
    sides = []
    for index in range(len(boundary)):
        start = boundary[index]
        end = boundary[(index + 1) % len(boundary)]
        sides.append({"index": index, "start": start, "end": end, "length": distance(start, end)})
    return sides


def match_printed_sides(printed, sides, tolerance):
    """Associe les cotes de côté aux côtés du modèle : valeur seule d'abord,
    puis somme de cotes scindées collinéaires. Chaque cote sert une fois."""
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
        # cote scindée : somme de libellés collinéaires restants
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
                    "label": f"côté {side['index'] + 1}",
                    "printed": round(total, 3),
                    "printedText": printed_side_text(side["printed"]),
                    "computed": round(side["length"], 3),
                    "delta": round(delta, 4),
                    "verdict": "exact" if abs(delta) <= tolerance else "écart",
                    "detail": None,
                }
            )
        else:
            rows.append(
                {
                    "label": f"côté {side['index'] + 1}",
                    "printed": None,
                    "printedText": None,
                    "computed": round(side["length"], 3),
                    "delta": None,
                    "verdict": "sans cote imprimée — se déduit des autres",
                    "detail": None,
                }
            )
    rows.extend(
        {
            "label": "cote sans côté",
            "printed": round(label["value"], 3),
            "printedText": label["text"],
            "computed": None,
            "delta": None,
            "verdict": "cote sans côté au modèle",
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
                "verdict": "parcelle non fermée",
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
                "printedText": "côté de longueur nulle",
                "computed": None,
                "delta": None,
                "verdict": "parcelle non fermée",
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
                "label": "surface parcelle",
                "printed": printed_area,
                "printedText": printed_areas[0]["text"],
                "computed": round(computed_area, 2),
                "delta": round(computed_area - printed_area, 2),
                "verdict": (
                    "exact"
                    if abs(computed_area - printed_area) <= area_tolerance
                    else "écart"
                ),
                "detail": None,
            }
        )
        if site.get("declaredArea") is not None:
            delta = site["declaredArea"] - printed_area
            rows.append(
                {
                    "label": "declaredArea du site",
                    "printed": printed_area,
                    "printedText": None,
                    "computed": site["declaredArea"],
                    "delta": round(delta, 2),
                    "verdict": "exact" if abs(delta) <= area_tolerance else "écart",
                    "detail": None,
                }
            )
    else:
        rows.append(
            {
                "label": "surface parcelle",
                "printed": None,
                "printedText": None,
                "computed": round(computed_area, 2),
                "delta": None,
                "verdict": "sans « Surface » imprimée",
                "detail": None,
            }
        )
    return rows


# --------------------------------------------------------------------------
# point 2 : implantation — morcellement des côtés et reculs
# --------------------------------------------------------------------------


def side_layout(side, outline):
    """Morcellement d'un côté par le contour du niveau, projeté dessus.

    Rend la suite de morceaux depuis le premier sommet du côté : recul,
    emprise, recul. Une distance se compare, jamais une coordonnée : c'est la
    longueur de chaque morceau qui se lit, dans cet ordre.
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
        pieces.append(("recul", low))
    if high - low > DEGENERATE:
        pieces.append(("emprise", high - low))
    if length - high > DEGENERATE:
        pieces.append(("recul", length - high))
    return pieces


def chain_fits(pieces, values, tolerance):
    """Chaque morceau retombe sur une somme de segments consécutifs de la
    chaîne. La chaîne peut être plus fine que le morcellement (elle scinde un
    recul en tronçons), jamais plus grossière : un segment ne franchit pas un
    changement de morceau. L'ordre compte ; le sens de lecture du dessin est
    inconnu, donc la chaîne est essayée dans les deux sens.
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
                    "label": "chaîne hors parcelle",
                    "printed": round(total, 3),
                    "printedText": chain_text(chain),
                    "computed": None,
                    "delta": None,
                    "verdict": "somme sans côté de parcelle — non vérifiée",
                    "detail": None,
                }
            )
            continue
        strong = None
        weak = None
        for side in candidates:
            pieces = side_layout(side, outline)
            if chain_fits(pieces, values, tolerance):
                if any(kind == "emprise" for kind, _ in pieces):
                    strong = side
                    break
                weak = (side, pieces)
        if strong:
            pieces = side_layout(strong, outline)
            verified_gaps.extend(length for kind, length in pieces if kind == "recul")
            rows.append(
                {
                    "label": f"chaîne — côté {strong['index'] + 1}",
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
            verified_gaps.extend(length for kind, length in pieces if kind == "recul")
            rows.append(
                {
                    "label": f"chaîne — côté {side['index'] + 1}",
                    "printed": round(total, 3),
                    "printedText": chain_text(chain),
                    "computed": None,
                    "delta": None,
                    "verdict": "vérifiée en longueur — niveau non adjacent à ce côté",
                    "detail": None,
                }
            )
        else:
            names = ", ".join(
                f"côté {side['index'] + 1} ({side['length']:.2f} m)" for side in candidates
            )
            computed_pieces = side_layout(candidates[0], outline)
            rows.append(
                {
                    "label": f"chaîne — {names}",
                    "printed": round(total, 3),
                    "printedText": chain_text(chain),
                    "computed": None,
                    "delta": None,
                    "verdict": "recul coté qui ne tombe pas",
                    "detail": "morcellement calculé : "
                    + ", ".join(f"{kind} {length:.2f}" for kind, length in computed_pieces),
                }
            )
    # recul de chaque côté au contour du niveau
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
                verdict = "coté par chaîne"
                printed = round(min(matches), 3)
            else:
                verdict = "non coté — se déduit"
        rows.append(
            {
                "label": f"recul côté {side['index'] + 1} ({side['length']:.2f} m)",
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
                "label": "niveau dans la parcelle",
                "printed": None,
                "printedText": None,
                "computed": None,
                "delta": None,
                "verdict": "le contour du niveau sort de la parcelle",
                "detail": None,
            }
        )
    return rows, verified_gaps


# --------------------------------------------------------------------------
# point 3 : niveaux — égout et faîtage ramenés au repère du niveau
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
                "label": "RDC (repère)",
                "printed": reference[0],
                "printedText": None,
                "computed": None,
                "delta": None,
                "verdict": "repère : cotes ramenées au sol fini du RDC",
                "detail": None,
            }
        )
    lowest, highest = roof_extents(site)
    for key, kind, computed in (("egout", "égout", lowest), ("faitage", "faîtage", highest)):
        printed = named_levels(labels, key)
        if not printed:
            rows.append(
                {
                    "label": kind,
                    "printed": None,
                    "printedText": None,
                    "computed": None if computed is None else round(computed, 3),
                    "delta": None,
                    "verdict": "non imprimé",
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
                    "verdict": "aucune toiture dans le site",
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
                    "verdict": "RDC non imprimé — repère du niveau inconnu",
                    "detail": None,
                }
            )
            continue
        expected = printed[0] - reference[0]
        delta = computed - expected
        detail = None
        if key == "egout" and tolerance < abs(delta) <= EAVE_DRAW_WINDOW:
            detail = (
                "écart compatible avec l'égout du dessin (dessus de gouttière) : "
                "la cote est la ligne d'eau — ne pas « corriger » le toit pour le "
                "faire tomber sur le dessin, décider sur la cote."
            )
        rows.append(
            {
                "label": kind,
                "printed": round(expected, 3),
                "printedText": f"{printed[0]:.2f} − RDC {reference[0]:.2f}",
                "computed": round(computed, 3),
                "delta": round(delta, 3),
                "verdict": "exact" if abs(delta) <= tolerance else "écart",
                "detail": detail,
            }
        )
    return rows


# --------------------------------------------------------------------------
# point 4 : topologie de toiture — pignons et égouts par façade
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
                reserves.append(f"{roof['id']} : pignon {gable} posé sur aucune façade")
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
                    f"pignon {gable} aligné sur plusieurs façades"
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
                continue  # sommet de croupe : pas d'égout de façade
            unit = ((end[0] - start[0]) / span, (end[1] - start[1]) / span)
            candidates = []
            for edge in edges:
                if edge["length"] <= 0:
                    continue
                if abs(unit[0] * edge["unit"][1] - unit[1] * edge["unit"][0]) > 0.01:
                    continue  # pas parallèle : croupe, noue…
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
            verdict = "réserve : pignon et égout sur la même façade"
        elif entry["pignons"]:
            verdict = f"{entry['pignons']} pignon(s)"
        elif entry["egouts"]:
            debords = sorted({f"{value:.2f}" for value in entry["egouts"]})
            verdict = "égout (débord " + ", ".join(debords) + " m)"
        else:
            verdict = "sans toiture"
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
            "label": "toiture",
            "printed": None,
            "printedText": None,
            "computed": None,
            "delta": None,
            "verdict": f"réserve : {reserve}",
            "detail": None,
        }
        for reserve in reserves
    )
    return rows


# --------------------------------------------------------------------------
# point 5 : surfaces de terrain cotées ou non
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
                    "verdict": "cotée" if error <= DEGENERATE else "cotée — écart de tracé",
                    "detail": "signalement seulement : la cote ne se reporte pas au polygone",
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
                    "verdict": "non cotée — décision à garder dans site.notes",
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
                "verdict": f"{uncoted} surface(s) non cotée(s) et aucune note : "
                "les déclarer dans site.notes",
                "detail": None,
            }
        )
    return rows


# --------------------------------------------------------------------------
# assemblage
# --------------------------------------------------------------------------


FAILURE_VERDICTS = (
    "écart",
    "cote sans côté au modèle",
    "recul coté qui ne tombe pas",
    "parcelle non fermée",
    "le contour du niveau sort de la parcelle",
)

SIGNAL_PREFIXES = (
    "sans cote imprimée",
    "non coté",
    "cotée — écart de tracé",
    "sans toiture",
    "non imprimé",
    "sans « Surface »",
    "somme sans côté",
    "surface(s) non cotée",
    "RDC non imprimé",
    "aucune toiture",
    "vérifiée en longueur",
)


def verdict_class(verdict):
    """off : refus ; signal : à garder dans site.notes ; info : rendu sans juge."""
    if verdict in FAILURE_VERDICTS or verdict.startswith("réserve"):
        return "off"
    if verdict.startswith(SIGNAL_PREFIXES):
        return "signal"
    return "info"


def build(registry, project, level_id, page_index, tolerance, area_tolerance):
    site = project.get("site")
    if not site:
        raise ValueError("site absent du projet — terrain et toiture invérifiables")
    page = find_page(registry, page_index)
    level = None
    for candidate in project.get("levels") or []:
        if candidate.get("id") == level_id:
            level = candidate
            break
    if level is None:
        raise ValueError(f"niveau {level_id} absent du projet")
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
        ("1. parcelle — côtés et surface", rows_parcel),
        ("2. implantation — chaînes de côté et reculs", rows_implantation),
        ("3. niveaux — égout et faîtage ramenés au RDC", rows_levels),
        ("4. topologie de toiture — pignons et égouts par façade", rows_topology),
        ("5. surfaces de terrain — cotées ou signalées", rows_surfaces),
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
        f"site : projet {result['project']}, niveau {result['level']}, "
        f"page {result['page']} du registre"
    )
    for section in result["sections"]:
        print()
        print(section["title"])
        width = max([len(row["label"]) for row in section["rows"]] + [12])
        print(f"{'':{width}s}  {'imprimé':>16s} {'calculé':>16s} {'écart':>7s}  verdict")
        for row in section["rows"]:
            printed = "—" if row["printed"] is None else formatted(row["printed"])
            computed = "—" if row["computed"] is None else formatted(row["computed"])
            delta = "—" if row["delta"] is None else f"{row['delta']:+.2f}"
            print(
                f"{row['label']:{width}s}  {printed:>16s} {computed:>16s} {delta:>7s}  {row['verdict']}"
            )
            if row.get("printedText"):
                print(f"{'':{width}s}  imprimé : {row['printedText']}")
            if row.get("detail"):
                print(f"{'':{width}s}  {row['detail']}")
    summary = result["summary"]
    print()
    if summary["off"]:
        print(
            f"{summary['off']} écart(s) au-delà de la tolérance "
            f"({result['tolerance']:.2f} m, {result['areaTolerance']:.2f} m²) :"
        )
        for section in result["sections"]:
            for row in section["rows"]:
                if verdict_class(row["verdict"]) == "off":
                    detail = (
                        f" — écart {row['delta']:+.2f}"
                        if row.get("delta") is not None
                        else ""
                    )
                    print(f"  {row['label']}{detail} : {row['verdict']}")
        return 1
    print(f"aucun écart au-delà de la tolérance ({result['tolerance']:.2f} m)")
    if summary["signals"]:
        print(f"{summary['signals']} signalement(s) — non cotés, à déclarer dans site.notes ou à décider :")
        for section in result["sections"]:
            for row in section["rows"]:
                if verdict_class(row["verdict"]) == "signal":
                    computed = (
                        f" {row['computed']}" if row.get("computed") is not None else ""
                    )
                    print(f"  {row['label']}{computed} : {row['verdict']}")
    return 0


# --------------------------------------------------------------------------
# auto-test : registre et projet synthétiques, aucune donnée réelle
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
                "reculs est et ouest non cotés, ils se déduisent ; "
                "accès est une surface indicative non cotée"
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
    """Non-régression sur un registre et un projet synthétiques : aucune donnée réelle."""
    failures = []
    registry = synthetic_registry()
    result = build(
        registry, synthetic_project(), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE
    )
    if result["summary"]["off"] != 0:
        failures.append(f"le projet exact devrait passer : {result['summary']}")
    écarts = [
        row
        for section in result["sections"]
        for row in section["rows"]
        if verdict_class(row["verdict"]) == "off"
    ]
    if écarts:
        failures.append(f"écarts inattendus sur le projet exact : {écarts}")
    sides = [
        row
        for row in rows_of(result, "côté")
        if row["verdict"] not in ("sans cote imprimée — se déduit des autres",)
    ]
    if len(sides) != 4 or any(row["verdict"] != "exact" for row in sides):
        failures.append(f"quatre côtés attendus exacts : {sides}")
    surface_row = verdict_of(result, "surface parcelle")
    if not surface_row or surface_row["verdict"] != "exact":
        failures.append(f"surface de parcelle : {surface_row}")
    egout = verdict_of(result, "égout")
    if not egout or abs(egout["printed"] - 3.00) > 0.001 or egout["verdict"] != "exact":
        failures.append(f"égout mal ramené au RDC : {egout}")
    faitage = verdict_of(result, "faîtage")
    if not faitage or faitage["verdict"] != "exact" or abs(faitage["delta"]) > 0.001:
        failures.append(f"faîtage : {faitage}")
    topology = [
        row
        for section in result["sections"]
        if section["title"].startswith("4.")
        for row in section["rows"]
    ]
    pignons = [row for row in topology if row["verdict"] == "1 pignon(s)"]
    egouts = [row for row in topology if row["verdict"].startswith("égout")]
    if len(pignons) != 2 or len(egouts) != 2:
        failures.append(f"topologie attendue : 2 pignons et 2 égouts — {topology}")
    entree = verdict_of(result, "entree-test")
    if not entree or entree["verdict"] not in ("cotée", "cotée — écart de tracé"):
        failures.append(f"entrée cotée : {entree}")
    acces = verdict_of(result, "acces-est")
    if not acces or acces["verdict"] != "non cotée — décision à garder dans site.notes":
        failures.append(f"accès non coté : {acces}")
    reculs = rows_of(result, "recul côté")
    cotés = [row for row in reculs if row["verdict"] == "coté par chaîne"]
    if len(cotés) != 3:
        failures.append(f"trois reculs cotés attendus (est, nord, ouest) : {reculs}")
    affleurant = [row for row in reculs if row["verdict"] == "affleurant"]
    if len(affleurant) != 0:
        failures.append(f"aucun côté affleurant attendu dans la fixture : {reculs}")
    chain_row = next(
        (row for row in rows_of(result, "chaîne —") if "côté 1" in row["label"]), None
    )
    if not chain_row or chain_row["verdict"] != "exact":
        failures.append(f"la chaîne du côté 1 devrait retomber exactement : {chain_row}")

    # un site décalé d'un mètre le long du côté coté : la chaîne ne retombe pas,
    # et le script nomme le côté fautif
    shifted = build(
        registry, synthetic_project(shift=1.0), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE
    )
    refus = [
        row
        for section in shifted["sections"]
        for row in section["rows"]
        if verdict_class(row["verdict"]) == "off"
    ]
    if not any("côté" in row["label"] and "côté 1" in row["label"] for row in refus):
        failures.append(f"le site décalé devrait nommer le côté 1 : {[r['label'] for r in refus]}")

    # un faîtage 20 cm trop haut : refusé
    wrong = build(
        registry, synthetic_project(faitage=6.20), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE
    )
    faîtage_row = verdict_of(wrong, "faîtage")
    if not faîtage_row or faîtage_row["verdict"] != "écart" or abs(faîtage_row["delta"] - 0.20) > 0.005:
        failures.append(f"faîtage faux : {faîtage_row}")

    # l'égout du dessin (gouttière), 10 cm sous la cote : refusé, piège nommé
    drawn = build(
        registry, synthetic_project(egout=2.90), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE
    )
    egout_row = verdict_of(drawn, "égout")
    if not egout_row or egout_row["verdict"] != "écart" or "gouttière" not in (egout_row.get("detail") or ""):
        failures.append(f"égout du dessin : {egout_row}")

    # un pignon flottant : réserve nommée
    floated = synthetic_project()
    floated["site"]["roofs"][0]["gables"] = [[0, 4, 1], [1, 2, 5]]
    floated = build(registry, floated, "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE)
    reserves = [
        row["verdict"]
        for section in floated["sections"]
        for row in section["rows"]
        if row["verdict"].startswith("réserve")
    ]
    if not reserves:
        failures.append("un pignon flottant devrait produire une réserve")

    # site absent : refus immédiat
    try:
        build(registry, {"id": "vide", "levels": []}, "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE)
        failures.append("un projet sans site devrait être refusé")
    except ValueError as error:
        if "site absent" not in str(error):
            failures.append(f"message inattendu : {error}")
    except (TypeError, KeyError) as error:
        failures.append(f"un projet sans site doit produire un refus propre : {error!r}")

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
        if row["verdict"] == "parcelle non fermée"
    ]
    if not parcel_verdicts:
        failures.append("une parcelle de deux sommets devrait être refusée")

    # cote scindée : deux libellés collinéaires somment à un côté
    split = synthetic_registry()
    split["pages"][0]["labels"]["parcelSides"] = [
        {"kind": "parcelSide", "text": "- 30.00 m -", "value": 30.00, "at": [110.0, 30.0], "horizontal": True},
        {"kind": "parcelSide", "text": "- 30.00 m -", "value": 30.00, "at": [110.0, 230.0], "horizontal": True},
        {"kind": "parcelSide", "text": "- 20.00 m -", "value": 20.00, "at": [10.0, 130.0], "horizontal": False},
        {"kind": "parcelSide", "text": "- 12.00 m -", "value": 12.00, "at": [201.0, 100.0], "horizontal": False},
        {"kind": "parcelSide", "text": "- 8.00 m -", "value": 8.00, "at": [202.0, 160.0], "horizontal": False},
    ]
    split_result = build(split, synthetic_project(), "rdc", 3, DEFAULT_TOLERANCE, DEFAULT_AREA_TOLERANCE)
    split_sides = rows_of(split_result, "côté")
    sans_cote = [row for row in split_sides if row["verdict"] == "sans cote imprimée — se déduit des autres"]
    if sans_cote:
        failures.append(f"cotes scindées non appariées : {sans_cote}")
    if not any("scindée" in (row.get("printedText") or "") for row in split_sides):
        failures.append(f"le côté 4 devrait porter la cote scindée : {split_sides}")

    if failures:
        for failure in failures:
            print(f"ECHEC {failure}")
        return 1
    print("contrôle du site : auto-test réussi")
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
        parser.error("registre et projet sont requis")
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
        print(f"ECHEC {error}")
        return 1
    except OSError as error:
        print(f"ECHEC fichier illisible : {error}")
        return 1
    code = print_report(result)
    if args.json:
        Path(args.json).write_text(
            json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
