"""Couche 0 ter : portes intérieures, lues sur les arcs de débattement du dessin.

Une porte intérieure n'est pas cotée : aucune chaîne ne la porte, aucun aplat ne
la dessine. Elle est dessinée par **deux symboles** — une interruption dans le
trait du mur et un **arc de débattement** — et c'est le second qui se mesure.

Le symbole est normalisé, donc il se lit sans interprétation :

- l'arc est un **quart de cercle** de rayon égal à la largeur du vantail ;
- son **centre est la charnière** ;
- le **vantail** est tracé en position ouverte, perpendiculaire au mur : c'est le
  segment qui part de la charnière et rejoint une des deux extrémités de l'arc ;
- l'autre extrémité donne la **position fermée**, donc l'ouverture dans le mur.

Ce que le script mesure, et ce qu'il ne décide pas :

- il **mesure** la charnière, la largeur et les deux directions ;
- il **ne décide pas** de quel côté du mur se trouve la pièce, ni si le vantail
  est bien celui-là : le sens de débattement reste une interprétation à
  confirmer sur place, et le projet doit le dire.

Le piège de cette couche est le bruit : les hachures et les remplissages
produisent eux aussi des amas de segments courts — 165 cellules denses de six
segments ou plus sur le plan A. Ce n'est pas la densité qui les écarte, c'est
l'ajustement : un amas de hachure ne se pose pas sur un cercle (résidu d'ajustement
grand) et ne couvre pas 90° d'arc. Les trois conditions — tracé non rempli,
résidu ≤ 0,15 pt, couverture 80–100° — sont nécessaires ensemble ; l'auto-test
rejoue les quatre leurres pour que la règle ne se perde pas.

Usage :
  python scripts/extract_doors.py <pdf> <page> <sortie.json> \\
      --scale 37.8 --origin 297.6,159.4
  python scripts/extract_doors.py <pdf> <page> <sortie.json> \\
      --registry registre.json --pages 8
  python scripts/extract_doors.py <pdf> <page> --compare projet.json --level rdc \\
      --scale 37.8 --origin 297.6,159.4
  python scripts/extract_doors.py --self-test

`--origin` est le coin nord-ouest du niveau en points d'affichage, `--scale` le
nombre de points par mètre. `--registry` les déduit des chaînes de cotes
refermées, comme `derive_outline.py` ; quand un axe n'a pas de chaîne refermée,
le script le dit et refuse de deviner.

Le résultat porte des données de plan réelles : l'écrire dans un dossier ignoré
(`artifacts/plan-review/`).
"""
import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import pymupdf

MIN_WIDTH = 0.40  # m, en dessous ce n'est pas un vantail
MAX_WIDTH = 1.60  # m, au-dessus ce n'est pas un vantail
MIN_POINTS = 6  # un arc est une polyligne, pas un triangle
FIT_RESIDUAL = 0.15  # pt, écart maximal d'un point au cercle ajusté
SPAN_MIN, SPAN_MAX = 80.0, 100.0  # degrés, un quart de cercle
PARTIAL_MIN = 20.0  # degrés, en dessous ce n'est plus un morceau d'arc
LEAF_TOL = 2.0  # pt, appariement charnière/extrémité d'un segment de vantail
LEAF_COVER = 0.85  # fraction du rayon que le vantail doit couvrir
DUPLICATE_TOL = 1.0  # pt, deux arcs au même centre sont le même symbole
MATCH_ACROSS = 1.0  # m, écart perpendiculaire accepté pour apparier, en comparaison
WALL_SHIFT = 0.10  # m, au-delà le mur du projet est décalé, pas la porte
FIXTURE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "plan-doors"
AXIS_INDEX = {"x": 0, "z": 1}


def display_transform(page):
    """Coordonnées ramenées au repère affiché (cf. /Rotate)."""
    box, rotation = page.mediabox, page.rotation
    if rotation == 90:
        return lambda x, y: (box.height - y, x)
    if rotation == 270:
        return lambda x, y: (y, box.width - x)
    return lambda x, y: (x, y)


def fit_circle(points):
    """Cercle des moindres carrés (Kåsa) : centre, rayon, résidu maximal.

    Le résidu est l'écart maximal d'un point au cercle, pas l'erreur moyenne :
    c'est lui qui sépare un arc d'un amas de hachure, et une moyenne le noierait.
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
    """Couverture angulaire de l'arc, en degrés, sans se laisser piéger par 0°."""
    angles = sorted(math.atan2(p[1] - cy, p[0] - cx) for p in points)
    gaps = [
        (angles[(index + 1) % len(angles)] - angles[index]) % (2 * math.pi)
        for index in range(len(angles))
    ]
    return math.degrees(2 * math.pi - max(gaps))


def arc_ends(points, cx, cy):
    """Les deux extrémités de l'arc : les points qui bordent le plus grand vide."""
    angles = [math.atan2(p[1] - cy, p[0] - cx) for p in points]
    order = sorted(range(len(points)), key=lambda index: angles[index])
    gaps = [
        (angles[order[(index + 1) % len(order)]] - angles[order[index]]) % (2 * math.pi)
        for index in range(len(order))
    ]
    cut = gaps.index(max(gaps))
    return [points[order[(cut + 1) % len(order)]], points[order[cut]]]


def corners_of(item, to_point):
    """Les quatre coins d'un rectangle ou d'un quadrilatère, en coordonnées affichées."""
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
    """Tous les segments de la page, en coordonnées affichées.

    Un vantail est tracé de deux façons selon le CAO : deux traits parallèles et
    un about, ou un quadrilatère fin. Les deux formes doivent être lues, sinon le
    sens de débattement manque sur la moitié des portes.
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
    """Longueur du plus long segment qui va de la charnière à une extrémité d'arc.

    Le vantail est tracé ouvert, perpendiculaire au mur : c'est ce segment qui
    distingue le sens de débattement de l'ouverture dans le mur. Sans lui, les
    deux extrémités de l'arc sont interchangeables et le script ne tranche pas.
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
    """Arcs de débattement de la page, en points puis en mètres.

    Retourne (portes, arcs partiels, refus) : les refus sont comptés par motif et
    les arcs partiels sont listés, pour que le script dise ce qu'il a écarté au
    lieu de le taire. Un arc de 38° n'est pas un quart de cercle, mais c'est
    quand même un morceau de porte : il se rapporte, il ne se compte pas.
    """
    to_point = display_transform(page)
    segments = segments_of(page, to_point)
    doors, partials = [], []
    refusals = {"rempli": 0, "trop court": 0, "rayon hors bornes": 0, "résidu": 0, "couverture": 0}
    for index, drawing in enumerate(page.get_drawings()):
        if drawing.get("fill") is not None:
            refusals["rempli"] += 1
            continue
        points = []
        for item in drawing["items"]:
            if item[0] == "l":
                points.append(to_point(item[1].x, item[1].y))
                points.append(to_point(item[2].x, item[2].y))
        if len(points) < MIN_POINTS:
            refusals["trop court"] += 1
            continue
        fitted = fit_circle(points)
        if fitted is None:
            refusals["résidu"] += 1
            continue
        cx, cy, radius, residual = fitted
        if not MIN_WIDTH * scale <= radius <= MAX_WIDTH * scale:
            refusals["rayon hors bornes"] += 1
            continue
        if residual > FIT_RESIDUAL:
            refusals["résidu"] += 1
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
            refusals["couverture"] += 1
            continue
        ends = arc_ends(points, cx, cy)
        lengths = [leaf_length(segments, (cx, cy), end) for end in ends]
        if max(lengths) < LEAF_COVER * radius:
            # Un quart de cercle sans vantail n'est pas une porte : rien ne dit
            # de quel côté s'ouvre le battant, et le script ne devine pas.
            refusals["couverture"] += 1
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
    """Deux arcs au même centre et au même rayon sont le même symbole."""
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
    """Portes ramenées au repère du niveau, en mètres."""
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
    """Origine et échelle du niveau, par les chaînes de cotes refermées.

    Même règle que `derive_outline.py` : l'étendue est le plus grand total
    refermé de l'axe, et l'origine se lit sur le premier segment de la première
    chaîne ancrée. Un axe sans chaîne refermée n'est pas deviné.
    """
    selected = [page for page in registry["pages"] if pages is None or page["index"] in pages]
    if not selected:
        raise SystemExit("aucune page du registre ne correspond à --pages")
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
            "axe(s) "
            + ", ".join(missing)
            + " sans chaîne de cotes refermée : donner --origin, le script ne devine pas"
        )
    return (origins["x"], origins["z"]), scale


def wall_frame(wall):
    """Axe, longueur et vecteur unitaire d'un mur du projet."""
    start, end = wall["start"], wall["end"]
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    if length == 0:
        return None
    return (end[0] - start[0]) / length, (end[1] - start[1]) / length, length


def project_openings(project, level_id):
    """Ouvertures à vantail du niveau, avec leur intervalle le long du mur."""
    level = next((item for item in project["levels"] if item["id"] == level_id), None)
    if level is None:
        raise SystemExit(f"niveau {level_id} absent du projet")
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
    """Apparie les portes lues aux portes écrites, et liste les écarts.

    L'écart de position est mesuré **le long du mur** : c'est la seule
    coordonnée qui décrit la porte. L'écart perpendiculaire est rapporté à part,
    parce qu'il vaut la demi-épaisseur du mur — la charnière est dessinée sur le
    nu, le projet la porte à l'axe — et le compter comme une erreur serait faux.
    Au-delà de `WALL_SHIFT`, ce n'est plus la porte qui est décalée mais le mur
    du projet, et le rapport le dit séparément.

    L'appariement est **un pour un** : deux ouvertures écrites ne peuvent pas
    désigner le même arc, sinon la seconde se compare au voisin et l'écart se
    cache. Les couples sont pris du plus proche au plus loin.
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
    """Non-régression sur un dessin synthétique : une cloison, une interruption, un arc.

    Le dessin est rendu à la volée depuis la fixture JSON : aucune donnée réelle
    n'entre dans le dépôt, et les leurres — hachure, cercle complet, demi-arc —
    sont rejoués pour que la règle de rejet ne se perde pas.
    """
    fixture = json.loads((FIXTURE / "drawing.json").read_text(encoding="utf-8"))
    failures = []
    path = render_fixture(fixture)
    document = pymupdf.open(path)
    page = document[0]
    doors, partials, refusals = detect(page, fixture["scale"])
    expected = fixture["expected"]
    if len(doors) != expected["count"]:
        failures.append(f"{len(doors)} porte(s) lue(s) au lieu de {expected['count']} : {refusals}")
        return failures
    if len(partials) != expected["partialArcs"]:
        failures.append(
            f"{len(partials)} arc(s) partiel(s) au lieu de {expected['partialArcs']} : {partials}"
        )
    elif abs(partials[0]["span"] - fixture["decoys"]["truncatedArc"][3]) > 1.0:
        failures.append(f"arc partiel de {partials[0]['span']:.1f}° au lieu de 45°")
    door = doors[0]
    origin, scale = fixture["origin"], fixture["scale"]
    hinge = ((door["hinge"][0] - origin[0]) / scale, (door["hinge"][1] - origin[1]) / scale)
    if math.hypot(hinge[0] - expected["hinge"][0], hinge[1] - expected["hinge"][1]) > 0.01:
        failures.append(f"charnière {hinge} au lieu de {expected['hinge']}")
    if abs(door["radius"] / scale - expected["width"]) > 0.01:
        failures.append(f"largeur {door['radius'] / scale:.3f} au lieu de {expected['width']}")
    if abs(door["swing"][0] - expected["swing"][0]) > 0.01 or abs(
        door["swing"][1] - expected["swing"][1]
    ) > 0.01:
        failures.append(f"débattement {door['swing']} au lieu de {expected['swing']}")
    if abs(door["closed"][0] - expected["closed"][0]) > 0.01 or abs(
        door["closed"][1] - expected["closed"][1]
    ) > 0.01:
        failures.append(f"ouverture {door['closed']} au lieu de {expected['closed']}")
    if refusals["couverture"] < 2:
        failures.append(f"les leurres de couverture n'ont pas été écartés : {refusals}")
    if refusals["rempli"] < 1:
        failures.append(f"le leurre rempli n'a pas été écarté : {refusals}")
    failures += _self_test_frame()
    failures += _self_test_compare()
    if failures:
        for failure in failures:
            print(f"ECHEC {failure}")
        return 1
    print("portes intérieures : auto-test réussi")
    return 0


def render_fixture(fixture):
    """Rend la fixture en PDF : cloisons, vantail, arc et trois leurres."""
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
        # Le vantail, tracé ouvert : un rectangle fin de la charnière au bout,
        # épais dans l'axe du mur et long dans l'axe de débattement.
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
        # L'arc, en polyligne de petits segments comme sur les vrais plans.
        steps = 12
        arc = []
        for step in range(steps + 1):
            angle = math.atan2(closed[1], closed[0]) + step * (math.pi / 2) / steps
            arc.append(point(hinge[0] + width * math.cos(angle), hinge[1] + width * math.sin(angle)))
        page.draw_polyline(arc, color=(0.0, 0.0, 0.0), width=0.48)
    decoys = fixture["decoys"]
    # Leurre 1 : une hachure, faite de segments courts et denses.
    x0, z0, x1, z1 = decoys["hatch"]
    step = 0.06
    offset = 0.0
    while offset < (x1 - x0) + (z1 - z0):
        start = (x0 + offset, z0)
        stop = (x0, z0 + offset)
        page.draw_line(point(*start), point(*stop), color=(0.0, 0.0, 0.0), width=0.24)
        offset += step
    # Leurre 2 : un cercle complet, de rayon plausible.
    cx, cz, radius = decoys["circle"]
    circle = [
        point(cx + radius * math.cos(2 * math.pi * step / 36), cz + radius * math.sin(2 * math.pi * step / 36))
        for step in range(37)
    ]
    page.draw_polyline(circle, color=(0.0, 0.0, 0.0), width=0.48)
    # Leurre 3 : un demi-arc, de rayon plausible, sans vantail.
    hx, hz, half = decoys["halfArc"]
    half_arc = [
        point(hx + half * math.cos(math.pi * step / 24), hz + half * math.sin(math.pi * step / 24))
        for step in range(25)
    ]
    page.draw_polyline(half_arc, color=(0.0, 0.0, 0.0), width=0.48)
    # Leurre 4 : un arc tronqué, comme le second vantail d'une porte-fenêtre :
    # il se rapporte comme arc partiel, il ne se compte pas comme porte.
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
    """Le cadre se déduit des chaînes refermées, et refuse de deviner."""
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
        failures.append(f"cadre {origin} × {scale} au lieu de (100.0, 100.0) × 40.0")
    registry["pages"][0]["chains"] = registry["pages"][0]["chains"][:1]
    try:
        frame_from_registry(registry, [1])
        failures.append("un axe sans chaîne refermée a été deviné")
    except SystemExit as error:
        if "ne devine pas" not in str(error):
            failures.append(f"refus inattendu sur l'axe sans chaîne : {error}")
    return failures


def _self_test_compare():
    """La comparaison mesure le long du mur et rapporte l'écart perpendiculaire."""
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
        failures.append(f"{len(openings)} ouverture(s) à vantail au lieu d'une (le coulissant compte ?)")
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
        failures.append(f"appariement {rows[0]['matched']} au lieu de d1 (le voisin à 2 m a été pris)")
    if abs(rows[0]["deltaCentre"]) > 0.001:
        failures.append(f"écart de position {rows[0]['deltaCentre']} au lieu de 0")
    if abs(rows[0]["offsetAcross"] - 0.05) > 0.001:
        failures.append(f"écart perpendiculaire {rows[0]['offsetAcross']} au lieu de 0,05")
    if extra != ["d2"]:
        failures.append(f"porte non appariée {extra} au lieu de d2")
    return failures


def main(argv):
    if "--self-test" in argv:
        return self_test()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("page", type=int)
    parser.add_argument("out", nargs="?")
    parser.add_argument("--scale", type=float, default=None, help="points par mètre")
    parser.add_argument("--origin", default=None, help="x0,y0 du coin nord-ouest du niveau, en points")
    parser.add_argument("--registry", default=None, help="registre d'évidence, pour déduire le cadre")
    parser.add_argument("--pages", default=None, help="pages du registre, ex. 8 ou 13,14")
    parser.add_argument("--compare", default=None, help="projet JSON à confronter")
    parser.add_argument("--level", default=None, help="niveau du projet à confronter")
    parser.add_argument("--tolerance", type=float, default=0.05, help="écart de position accepté, m")
    args = parser.parse_args(argv[1:])
    pages = [int(value) for value in args.pages.split(",")] if args.pages else None
    if args.registry:
        registry = json.loads(Path(args.registry).read_text(encoding="utf-8"))
        origin, scale = frame_from_registry(registry, pages or [args.page])
    else:
        if args.scale is None or args.origin is None:
            parser.error("indiquer --scale et --origin, ou --registry pour les déduire")
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
        f"{len(metres)} porte(s) lue(s) sur la page {args.page} "
        f"({refusals['rempli']} tracé(s) rempli(s), {refusals['résidu']} amas hors cercle, "
        f"{refusals['couverture']} arc(s) hors couverture ou sans vantail écartés)"
    )
    for door in metres:
        print(
            f"  {door['id']} charnière ({door['hinge'][0]:.3f}, {door['hinge'][1]:.3f}) "
            f"largeur {door['width']:.3f} m, ouverture vers ({door['closed'][0]:+.0f}, "
            f"{door['closed'][1]:+.0f}), débattement vers ({door['swing'][0]:+.0f}, "
            f"{door['swing'][1]:+.0f})"
        )
    for arc in payload["partialArcs"]:
        print(
            f"  arc partiel ({arc['hinge'][0]:.3f}, {arc['hinge'][1]:.3f}) "
            f"largeur {arc['width']:.3f} m, couverture {arc['span']:.1f}° — pas compté comme porte"
        )
    status = 0
    if args.compare:
        if not args.level:
            parser.error("--compare demande --level")
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
        print(f"\ncomparaison au niveau {args.level} de {Path(args.compare).name} :")
        for row in rows:
            if row["matched"] is None:
                print(f"  {row['opening']:22s} ({row['wall']})  AUCUN ARC LU")
                status = 1
                continue
            flag = "ok" if row["within"] else "ÉCART"
            notes = []
            if not row["hingeEndAgrees"]:
                notes.append("charnière de l'autre côté")
            if row["wallShifted"]:
                notes.append(f"mur du projet décalé de {row['offsetAcross']:.2f} m")
            print(
                f"  {row['opening']:22s} ({row['wall']})  {row['matched']}  "
                f"position {row['deltaCentre']:+.3f} m  largeur {row['deltaWidth']:+.3f} m  "
                f"charnière à {row['hingeAt']:.3f} m  hors-nu {row['offsetAcross']:.3f} m  "
                f"{flag}" + (f"  [{', '.join(notes)}]" if notes else "")
            )
        if extra:
            print(f"  arc(s) sans porte écrite : {', '.join(extra)}")
        matched = sum(1 for row in rows if row["matched"] is not None)
        within = sum(1 for row in rows if row.get("within"))
        shifted = sum(1 for row in rows if row.get("wallShifted"))
        flipped = sum(1 for row in rows if row.get("matched") and not row["hingeEndAgrees"])
        print(
            f"  {matched}/{len(openings)} porte(s) écrite(s) appariée(s), "
            f"{within} dans ±{args.tolerance * 100:.0f} cm le long du mur, "
            f"{flipped} charnière(s) de l'autre côté, {shifted} mur(s) du projet décalé(s)"
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
