"""Couche 3 : contour du niveau déduit des chaînes de cotes fermées.

Le contour du niveau est dérivé du registre d'évidence au lieu d'être écrit à
la main, règle par règle — un script mesure, il ne décide pas :

1. **Étendues** — par axe, total maximal des chaînes fermées, recoupé autant
   que possible (plusieurs chaînes d'accord) ou confronté à l'enveloppe lue
   par `extract_plan.py` (`--plan`). Une chaîne fermée dont le total ne vaut
   pas l'étendue est ÉCARTÉE et rapportée : elle décrit l'intérieur du
   bâtiment, pas son enveloppe (le 7,82 d'une profondeur intérieure ne
   remplace pas les 8,50 d'une emprise).
2. **Découpes** — positions cumulées intérieures des chaînes ancrées, dans
   les deux sens de lecture (base sur le bord bas ou haut de l'étendue).
3. **Encre** (si `--pdf`) — chaque découpe cherchée sur la page rendue : une
   bande sombre, épaisse comme un mur extérieur et posée face au nu de la
   façade, de chaque côté de la découpe. Une découpe où cette présence
   **saute** est un épaulement du contour ; une découpe où elle ne saute pas
   décrit l'intérieur (chambre, cloison, tableau de baie) et n'est pas
   essayée. Le rectangle n'est retenu que si aucune découpe ne saute.
4. **Fermeture** — chaque arête du contour doit être reproduite par une suite
   contiguë d'une chaîne ancrée (tolérance 0,015 m) ou être une **profondeur
   comblée** : épaisseur de mur lue en centimètres au même endroit, ou suite
   imprimée qui la couvre. Une profondeur sans cote ni épaisseur est refusée.
5. **Jugement** — les arêtes du contour retenu doivent exister à l'encre
   (une face de mur, bande à l'appui), et une encoche de façade est confirmée
   par un balayage perpendiculaire : la profondeur où l'enveloppe saute doit
   confirmer la profondeur comblée, sinon le candidat est refusé.

Si plusieurs contours survivent, le script les liste au lieu de trancher :
ce qui reste un jugement est dit, jamais deviné.

Usage :
  python scripts/derive_outline.py <registre.json> <sortie.json> [--pages 13] \
      [--pdf plan.pdf] [--plan plan.json]
  python scripts/derive_outline.py --self-test

Sans `--pdf`, les couches registre + fermeture s'exécutent seules : le
rectangle et les quatre sens de lecture des encoches sont essayés, et le
résultat — s'il n'est pas unique — est rapporté comme un jugement à prendre,
jamais départagé par le script.
"""
import argparse
import json
import sys
from pathlib import Path

TOL = 0.015  # m, appariement d'une suite imprimée à une arête
EXTENT_TOL = 0.05  # m, recoupe avec l'enveloppe d'extract_plan.py
SUPPORT_MIN = 0.4  # fraction d'une arête qui doit exister à l'encre
PROBE_STEP = 0.5  # m, pas d'échantillonnage le long d'une arête
PROBE_MARGIN = 0.15  # m, distance aux abouts avant de sonder une arête
JUMP_OFFSETS = (0.15, 0.30, 0.45)  # m, distances de mesure autour d'une découpe
INK_FLOOR = 0.15  # une arête doit tenir un peu de mur à l'encre, baies mises à part
FACE_TOL_OUT, FACE_TOL_IN = 0.12, 0.08  # m, écart maximal de la face au nu
WALL_BAND_MIN, WALL_BAND_MAX = 0.15, 0.75  # m, épaisseur d'une bande de mur
OUT_MARGIN = 0.15  # m, la sonde part juste au-dehors du nu
IN_MARGIN = 0.55  # m, et traverse l'épaisseur possible du mur
DEPTH_MEASURE_TOL = 0.05  # m, écart accepté entre balayage et profondeur
THICKNESS_MIN, THICKNESS_MAX = 0.12, 0.45  # m, cote en cm qu'une épaisseur porte
SOLID_MIN = 0.45  # m, longueur minimale du trait qui porte une face de mur
SOLID_WINDOW = 0.6  # m, demi-fenêtre de lecture du trait le long de la façade
FIXTURE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "plan-outline"

AXIS_INDEX = {"x": 0, "z": 1}
SIDES = ("north", "south", "west", "east")


def chain_ref(chain):
    return {
        "page": chain["page"],
        "axis": chain["axis"],
        "perpendicular": chain["perpendicular"],
    }


def chain_ppm(chain):
    return chain.get("printedPointsPerMetre")


def close(a, b, tol=TOL):
    return abs(a - b) <= tol


def cumulative(chain, extent, backward):
    values = [0.0]
    for segment in chain["segments"]:
        values.append(values[-1] + segment["value"])
    if backward:
        values = [round(extent - value, 4) for value in values]
    return [round(value, 4) for value in values]


def runs_of(chain, extent, backward):
    """Toutes les suites contiguës imprimées de la chaîne, une fois calée."""
    values = cumulative(chain, extent, backward)
    runs = []
    for start in range(len(values) - 1):
        for end in range(start + 1, len(values)):
            runs.append(
                {
                    "low": round(min(values[start], values[end]), 4),
                    "high": round(max(values[start], values[end]), 4),
                    "chain": chain,
                    "backward": backward,
                    "span": [start, end - 1],
                }
            )
    return runs


def interior_cuts(chain, extent):
    cuts = []
    for backward in (False, True):
        for value in cumulative(chain, extent, backward)[1:-1]:
            if not (TOL < value < extent - TOL):
                continue
            cuts.append({"value": value, "chain": chain, "backward": backward})
    return cuts


def build_axes(registry, pages, plan_envelope=None):
    """Étendues par axe, chaînes ancrées, découpes, suites, chaînes écartées."""
    selected = [page for page in registry["pages"] if pages is None or page["index"] in pages]
    if not selected:
        raise SystemExit(f"aucune page {pages} dans le registre")
    chains = [chain for page in selected for chain in page["chains"]]
    axes = {}
    for axis, name in (("x", "horizontal"), ("z", "vertical")):
        closed = [chain for chain in chains if chain["axis"] == name and chain["closed"]]
        if not closed:
            raise SystemExit(f"axe {axis} : aucune chaîne fermée, contour non dérivable")
        totals = {}
        for chain in closed:
            totals.setdefault(round(chain["sum"], 2), []).append(chain)
        extent = max(totals)
        running = totals[extent]
        discarded = [
            {
                "chain": chain_ref(chain),
                "sum": round(chain["sum"], 4),
                "reason": (
                    f"total {chain['sum']:.2f} m ne vaut pas l'étendue {extent:.2f} m : "
                    "chaîne écartée (elle décrit l'intérieur, pas l'enveloppe)"
                ),
            }
            for value, group in sorted(totals.items())
            if value != extent
            for chain in group
        ]
        cross = None
        if plan_envelope:
            expected = plan_envelope[AXIS_INDEX[axis]]
            cross = {"envelope": expected, "ok": abs(expected - extent) <= EXTENT_TOL}
            if not cross["ok"]:
                raise SystemExit(
                    f"axe {axis} : étendue {extent:.2f} m contredite par l'enveloppe "
                    f"extraite {expected:.2f} m"
                )
        if len(running) < 2 and not (cross and cross["ok"]):
            raise SystemExit(
                f"axe {axis} : une seule chaîne porte {extent:.2f} m sans recoupement "
                "(aucune seconde chaîne d'accord, aucun --plan) : étendue non prouvée"
            )
        anchored = sorted(running, key=lambda chain: (chain["page"], chain["perpendicular"]))
        for chain in anchored:
            if chain_ppm(chain) is None:
                raise SystemExit("chaîne ancrée sans échelle imprimée")
        cuts, seen = [], set()
        for chain in anchored:
            for cut in interior_cuts(chain, extent):
                near = next((value for value in seen if close(value, cut["value"])), None)
                if near is None:
                    seen.add(cut["value"])
                    cuts.append(cut)
        runs = [
            run
            for chain in anchored
            for backward in (False, True)
            for run in runs_of(chain, extent, backward)
        ]
        axes[axis] = {
            "extent": extent,
            "anchored": anchored,
            "cuts": cuts,
            "runs": runs,
            "discarded": discarded,
            "crossCheck": cross,
        }
    return axes


def frame_of(axes):
    """Origines pt de chaque axe et échelle, par la première chaîne ancrée."""
    origins, ppm = {}, None
    for axis in ("x", "z"):
        chain = axes[axis]["anchored"][0]
        ppm = chain_ppm(chain)
        first = chain["segments"][0]
        along = AXIS_INDEX[axis]
        origins[axis] = round(first["at"][along] - first["value"] / 2 * ppm, 3)
    return origins, ppm


def run_matching(axes, axis, low, high):
    return [
        run for run in axes[axis]["runs"] if close(run["low"], low) and close(run["high"], high)
    ]


def thickness_candidates(registry, pages, origins, ppm):
    """Cotes en centimètres du registre, positionnées dans le repère du monde."""
    found = []
    for page in registry["pages"]:
        if pages is not None and page["index"] not in pages:
            continue
        for label in (page.get("labels") or {}).get("dimensions") or []:
            if label.get("kind") != "centimetres":
                continue
            value = label.get("value")
            if value is None or not THICKNESS_MIN <= value <= THICKNESS_MAX:
                continue
            found.append(
                {
                    "value": round(value, 4),
                    "text": label["text"],
                    "x": round((label["at"][0] - origins["x"]) / ppm, 3),
                    "z": round((label["at"][1] - origins["z"]) / ppm, 3),
                    "horizontal": bool(label.get("horizontal")),
                    "page": page["index"],
                }
            )
    return found


# ---------------------------------------------------------------------------
# Candidats : rectangle, encoche de coin, encoche de façade
# ---------------------------------------------------------------------------


def edges_of(vertices, roles=None):
    """Arêtes d'un polygone rectiligne fermé, avec leur normale rentrante.

    Les sommets sont dans l'ordre de parcours (nord puis est puis sud…) ; la
    normale rentrante est (−dz, +dx) pour ce sens. `roles` marque les flancs
    d'encoche, dont la profondeur sera comblée à la fermeture.
    """
    edges = []
    for index, start in enumerate(vertices):
        end = vertices[(index + 1) % len(vertices)]
        dx, dz = end[0] - start[0], end[1] - start[1]
        if abs(dx) < 1e-9 and abs(dz) < 1e-9:
            continue
        along_x = abs(dx) >= abs(dz)
        low, high = sorted((start[0], end[0])) if along_x else sorted((start[1], end[1]))
        norm = (abs(dx) + abs(dz)) or 1.0
        edges.append(
            {
                "axis": "x" if along_x else "z",
                "at": round(start[1] if along_x else start[0], 4),
                "low": round(low, 4),
                "high": round(high, 4),
                "inward": (-dz / norm, dx / norm),
                "role": (roles or {}).get(index, "wall"),
            }
        )
    return edges


def rectangle_candidate(axes):
    W, D = axes["x"]["extent"], axes["z"]["extent"]
    vertices = [[0.0, 0.0], [W, 0.0], [W, D], [0.0, D]]
    return {
        "vertices": vertices,
        "edges": edges_of(vertices),
        "notch": None,
        "side": None,
        "depth": None,
        "depthSource": None,
    }


def corner_candidate(axes, x_cut, z_cut, dx_minus, dz_minus):
    """Encoche de coin : le quadrant x≺x* et z≺z* est sorti du contour."""
    W, D = axes["x"]["extent"], axes["z"]["extent"]
    x, z = round(x_cut, 4), round(z_cut, 4)
    if not (TOL < x < W - TOL and TOL < z < D - TOL):
        return None
    vertices = {
        (False, False): [[0, z], [x, z], [x, 0], [W, 0], [W, D], [0, D]],
        (False, True): [[0, 0], [x, 0], [x, z], [W, z], [W, D], [0, D]],
        (True, False): [[0, 0], [W, 0], [W, D], [x, D], [x, z], [0, z]],
        (True, True): [[0, 0], [W, 0], [W, z], [x, z], [x, D], [0, D]],
    }[(dx_minus, dz_minus)]
    vertices = [[round(pair[0], 4), round(pair[1], 4)] for pair in vertices]
    return {
        "vertices": vertices,
        "edges": edges_of(vertices),
        "notch": {"kind": "corner", "x": x, "z": z},
        "side": None,
        "depth": None,
        "depthSource": None,
    }


def facade_candidate(axes, side, a, b, depth, source):
    """Encoche de façade : [a, b] sorti du contour, profondeur vers l'intérieur."""
    W, D = axes["x"]["extent"], axes["z"]["extent"]
    a, b, depth = round(a, 4), round(b, 4), round(depth, 4)
    along_limit = W if side in ("north", "south") else D
    depth_limit = D if side in ("north", "south") else W
    if not (TOL < a < b - TOL) or b > along_limit - TOL:
        return None
    if not (2 * TOL < depth < depth_limit - 2 * TOL):
        return None
    if side == "south":
        vertices = [[0, 0], [W, 0], [W, D], [b, D], [b, D - depth],
                    [a, D - depth], [a, D], [0, D]]
        roles = {3: "depth", 5: "depth"}
    elif side == "north":
        vertices = [[0, depth], [a, depth], [a, 0], [b, 0], [b, depth],
                    [W, depth], [W, D], [0, D]]
        roles = {1: "depth", 3: "depth"}
    elif side == "west":
        vertices = [[0, 0], [W, 0], [W, D], [0, D], [0, b], [depth, b],
                    [depth, a], [0, a]]
        roles = {4: "depth", 6: "depth"}
    elif side == "east":
        vertices = [[0, 0], [W, 0], [W, a], [W - depth, a], [W - depth, b],
                    [W, b], [W, D], [0, D]]
        roles = {1: "depth", 5: "depth"}
    vertices = [[round(pair[0], 4), round(pair[1], 4)] for pair in vertices]
    return {
        "vertices": vertices,
        "edges": edges_of(vertices, roles),
        "notch": {"kind": "facade", "side": side, "a": a, "b": b},
        "side": side,
        "depth": depth,
        "depthSource": source,
    }


def candidate_id(candidate):
    return " ".join(
        f"{item['role'][0]}{item['axis']}@{item['at']:.2f}[{item['low']:.2f},{item['high']:.2f}]"
        for item in candidate["edges"]
    )


def outline_of(vertices):
    """Sommet suivants, arrondis au centimètre du plan."""
    return [[round(point[0], 2), round(point[1], 2)] for point in vertices]


def load_outline(path):
    """Contour dérivé, lu depuis la sortie de ce script.

    Un contour ambigu n'est pas un contour : le fichier doit en porter un
    seul, sinon la couche suivante refuse de construire sur un jugement que
    le script n'a pas pris. C'est la règle du dépôt — un script mesure, il ne
    décide pas — appliquée à la frontière entre la couche 3 et la couche 2.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    outline = payload.get("outline")
    if not outline:
        pending = payload.get("candidates") or []
        raise SystemExit(
            f"{path} : aucun contour unique — {len(pending)} candidat(s) restent à "
            "trancher, la construction ne commence pas sur un contour deviné"
        )
    return [[round(float(point[0]), 4), round(float(point[1]), 4)] for point in outline]


# ---------------------------------------------------------------------------
# Fermeture : suites imprimées ou profondeur comblée
# ---------------------------------------------------------------------------


def run_depths(axes, side):
    """Profondeurs imprimées : suites de l'axe de profondeur, calées au nu."""
    depth_axis = "z" if side in ("north", "south") else "x"
    extent = axes[depth_axis]["extent"]
    anchor = extent if side in ("south", "east") else 0.0
    depths = []
    for run in axes[depth_axis]["runs"]:
        if close(run["low"], anchor) or close(run["high"], anchor):
            inner = run["high"] if close(run["low"], anchor) else run["low"]
            depth = round(abs(anchor - inner), 4)
            if 2 * TOL < depth < extent - 2 * TOL and not any(
                close(item["value"], depth) for item in depths
            ):
                depths.append(
                    {
                        "value": depth,
                        "origin": "printed-run",
                        "chain": chain_ref(run["chain"]),
                        "backward": run["backward"],
                        "span": run["span"],
                    }
                )
    return depths


def thickness_depths(axes, thicknesses, side, a, b):
    """Épaisseurs lues en centimètres, proches de l'encoche et orientées comme elle."""
    depth_axis = "z" if side in ("north", "south") else "x"
    along_axis = "x" if side in ("north", "south") else "z"
    D, W = axes["z"]["extent"], axes["x"]["extent"]
    nu = {"north": 0.0, "south": D, "west": 0.0, "east": W}[side]
    found = []
    for index, cote in enumerate(thicknesses):
        if cote["horizontal"] != (depth_axis == "x"):
            continue
        along_pos = cote["x"] if along_axis == "x" else cote["z"]
        if not (a - 0.1 <= along_pos <= b + 0.1):
            continue
        depth_pos = cote["z"] if along_axis == "x" else cote["x"]
        if abs(depth_pos - nu) > 0.7:
            continue
        found.append({"value": cote["value"], "origin": "thickness", "index": index})
    return found


def close_candidate(candidate, axes, thicknesses):
    """Fermeture : chaque arête imprimée ou profondeur comblée."""
    proof = []
    for item in candidate["edges"]:
        runs = run_matching(axes, item["axis"], item["low"], item["high"])
        if runs:
            run = runs[0]
            proof.append(
                {
                    "edge": f"{item['axis']}@{item['at']:.2f}[{item['low']:.2f},{item['high']:.2f}]",
                    "class": "printed",
                    "chain": chain_ref(run["chain"]),
                    "reading": "backward" if run["backward"] else "forward",
                    "span": run["span"],
                    "length": round(run["high"] - run["low"], 4),
                }
            )
            continue
        if item["role"] == "depth":
            if candidate.get("depthSource") == "printed-run":
                anchor = next(
                    entry
                    for entry in run_depths(axes, candidate["side"])
                    if close(entry["value"], candidate["depth"])
                )
                proof.append(
                    {
                        "edge": f"{item['axis']}@{item['at']:.2f}[{item['low']:.2f},{item['high']:.2f}]",
                        "class": "printed",
                        "chain": anchor["chain"],
                        "reading": "backward" if anchor["backward"] else "forward",
                        "span": anchor["span"],
                        "length": candidate["depth"],
                    }
                )
                continue
            if candidate.get("depthSource") == "thickness":
                source = candidate.get("thicknessSource")
                proof.append(
                    {
                        "edge": f"{item['axis']}@{item['at']:.2f}[{item['low']:.2f},{item['high']:.2f}]",
                        "class": "derived",
                        "note": (
                            f"profondeur comblée par l'épaisseur {source['value']:.2f} m "
                            f"lue en centimètres (« {source['text']} »)"
                        ),
                        "length": candidate["depth"],
                    }
                )
                continue
            return None, {
                "reason": (
                    f"arête {item['axis']}@{item['at']:.2f} [{item['low']:.2f},{item['high']:.2f}] : "
                    "profondeur sans cote ni épaisseur"
                )
            }
        return None, {
            "reason": (
                f"arête {item['axis']}@{item['at']:.2f} [{item['low']:.2f},{item['high']:.2f}] : "
                "aucune suite imprimée ne la reproduit"
            )
        }
    return {"edges": proof}, None


# ---------------------------------------------------------------------------
# Encre : bandes de murs de la page rendue
# ---------------------------------------------------------------------------


class Ink:
    """Bandes sombres de la page rendue, dans le repère du monde.

    Un mur extérieur se dessine en traits de face plus du hachurage ; en
    fusionnant les runs proches (0,26 m), il devient une bande de l'épaisseur
    du mur, posée au nu de la façade et tournée vers l'intérieur du contour.
    Un trait de cote, un seuil ou un vantail ne mesurent que quelques
    centimètres : en dessous de 15 cm, une bande n'est pas un mur.
    """

    def __init__(self, pdf, page_index, origins, ppm, zoom=4.0, threshold=140, merge=0.26):
        import pymupdf

        document = pymupdf.open(pdf)
        self.pix = document[page_index - 1].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        self.samples, self.width, self.height, self.components = (
            self.pix.samples, self.pix.width, self.pix.height, self.pix.n
        )
        self.zoom, self.threshold, self.merge = zoom, threshold, merge
        self.origins, self.ppm = origins, ppm

    def dark(self, world_x, world_z):
        u = world_x * self.ppm + self.origins["x"]
        v = world_z * self.ppm + self.origins["z"]
        x, y = int(u * self.zoom), int(v * self.zoom)
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return False
        offset = (y * self.width + x) * self.components
        return (
            self.samples[offset] < self.threshold
            and self.samples[offset + 1] < self.threshold
            and self.samples[offset + 2] < self.threshold
        )

    def bands(self, ax, az, bx, bz, step_m=0.005, merge=None):
        """Runs sombres fusionnés, en mètres depuis le début du segment."""
        dx, dz = bx - ax, bz - az
        length = (dx * dx + dz * dz) ** 0.5
        if length < 1e-9:
            return []
        runs, started = [], None
        steps = int(length / step_m)
        for index in range(steps + 1):
            t = index * step_m
            if self.dark(ax + dx * t / length, az + dz * t / length):
                if started is None:
                    started = t
            else:
                if started is not None:
                    runs.append([started, t])
                    started = None
        if started is not None:
            runs.append([started, length])
        gap = self.merge if merge is None else merge
        merged = []
        for low, high in runs:
            if merged and low - merged[-1][1] <= gap:
                merged[-1][1] = high
            else:
                merged.append([low, high])
        return merged

    def solid(self, x, z, along):
        """Longueur du trait continu qui passe par (x, z), le long de `along`.

        Une face de mur est un trait **plein**. Un trait mixte — limite de
        hauteur, arête de plancher haut, débord de toiture — est dessiné en
        tirets de quelques centimètres : le prendre pour une face pose une
        façade là où le plan n'en porte pas. Sur le plan B, la façade sud est
        tracée en tirets au droit de l'encoche d'entrée, et la sonde
        perpendiculaire y lisait un mur continu.

        La sonde essaie le point exact puis deux écarts d'un pixel de chaque
        côté : le trait d'une face tombe rarement pile sur la coordonnée
        déduite des cotes.
        """
        for offset in (0.0, 0.02, -0.02, 0.04, -0.04):
            if along == "x":
                start, end = (x - SOLID_WINDOW, z + offset), (x + SOLID_WINDOW, z + offset)
            else:
                start, end = (x + offset, z - SOLID_WINDOW), (x + offset, z + SOLID_WINDOW)
            for low, high in self.bands(start[0], start[1], end[0], end[1],
                                        step_m=0.005, merge=0.0):
                if low - 0.01 <= SOLID_WINDOW <= high + 0.01:
                    if high - low >= SOLID_MIN:
                        return round(high - low, 4)
        return 0.0

    def wall_at(self, x, z, inward):
        """Mur dont la face extérieure est posée au nu (x, z), vers l'intérieur.

        Renvoie (écart de la face au nu, épaisseur lue) si un mur s'y
        trouve, None sinon. Un mur n'est reconnu que comme une bande : face
        au nu, **trait plein**, et épaisseur de mur à la fusion des traits.
        """
        length = (inward[0] ** 2 + inward[1] ** 2) ** 0.5
        if length < 1e-9:
            return None
        ux, uz = inward[0] / length, inward[1] / length
        along = "x" if abs(ux) < 1e-9 else "z"
        bands = self.bands(x - ux * OUT_MARGIN, z - uz * OUT_MARGIN,
                           x + ux * IN_MARGIN, z + uz * IN_MARGIN)
        for low, high in bands:
            width = high - low
            if not WALL_BAND_MIN <= width <= WALL_BAND_MAX:
                continue
            face = low - OUT_MARGIN
            if not (-FACE_TOL_OUT <= face <= FACE_TOL_IN):
                continue
            if self.solid(x, z, along) < SOLID_MIN:
                continue
            return (round(face, 4), round(width, 4))
        return None

    def side_probe(self, side, q, nu, extent):
        """Présence du mur au nu `nu`, côté `side`, à la position q."""
        if side in ("north", "south"):
            inward = (0.0, 1.0 if side == "north" else -1.0)
            return self.wall_at(q, nu, inward)
        inward = (1.0 if side == "west" else -1.0, 0.0)
        return self.wall_at(nu, q, inward)

    def edge_support(self, item, credits=None):
        """Fraction d'une arête où un mur a sa face au nu.

        Retourne (encre, baies) : la fraction de sondes où un mur tient
        l'arête, et la fraction des sondes restantes qu'une baie imprimée
        explique — une fenêtre ou une porte interrompt le trait de face, et
        le plan le dit : segment de chaîne ouverte, ou cote de baie posée
        contre le mur. L'arête doit tenir un peu de mur par elle-même : une
        baie explique un manque, elle ne remplace pas un mur.
        """
        hits, credited, total, found = 0, 0, 0, []
        span = item["high"] - item["low"]
        count = max(2, int(span / PROBE_STEP) + 1)
        margin = min(PROBE_MARGIN, span / 3)
        step = (span - 2 * margin) / (count - 1) if count > 1 else 0.0
        intervals = (credits or {}).get(item["axis"], [])
        for index in range(count):
            position = item["low"] + margin + step * index
            if item["axis"] == "x":
                x, z = position, item["at"]
            else:
                x, z = item["at"], position
            hit = self.wall_at(x, z, item["inward"])
            total += 1
            if hit:
                hits += 1
                found.append([round(position, 3), hit[0], hit[1]])
            elif any(low - TOL <= position <= high + TOL for low, high in intervals):
                credited += 1
                found.append([round(position, 3), "baie", None])
        inked = hits / total if total else 0.0
        support = (hits + credited) / total if total else 0.0
        return {"ink": round(inked, 4), "total": round(support, 4),
                "openings": round(credited / total if total else 0.0, 4)}, found


def classify_cuts(axes, ink):
    """Découpes classées par l'encre : épaulement là où la présence saute.

    Pour chaque découpe candidate et chaque façade la contenant, la présence
    du mur est mesurée de part et d'autre, à trois distances : une ligne de
    sonde tombe parfois entre deux hachures d'un même mur, et une lecture
    unique ferait d'une absence de lecture une absence de mur — le vote de
    majorité par suite de sondes est ce qui distingue les deux. Une découpe
    n'est retenue que si la présence saute : c'est un épaulement du
    contour, et la direction de la saute prescrit le quadrant de l'encoche
    ou son encoche de façade — le sens de lecture de la chaîne n'est plus
    une inconnue.
    """
    refusals = []
    jumps = {side: [] for side in SIDES}
    W, D = axes["x"]["extent"], axes["z"]["extent"]

    def present(side, position, nu, direction):
        votes = sum(
            1
            for offset in JUMP_OFFSETS
            if ink.side_probe(side, position + direction * offset, nu, 0.0) is not None
        )
        return votes > len(JUMP_OFFSETS) / 2

    for side in SIDES:
        if side in ("north", "south"):
            along_axis, nu = "x", 0.0 if side == "north" else D
        else:
            along_axis, nu = "z", 0.0 if side == "west" else W
        ruler = axes[along_axis]
        limit = max(JUMP_OFFSETS)
        for cut in ruler["cuts"]:
            value = cut["value"]
            if not (limit < value < ruler["extent"] - limit):
                continue
            before = present(side, value, nu, -1)
            after = present(side, value, nu, +1)
            if before and after:
                continue
            if not before and not after:
                refusals.append(
                    {
                        "candidate": f"découpe {value:.2f} sur {side}",
                        "reason": "aucun mur de part et d'autre : ni épaulement ni façade",
                    }
                )
                continue
            jumps[side].append(
                {
                    "at": round(value, 4),
                    "presence": "after" if after else "before",
                }
            )
    return jumps, refusals


def merged_jumps(jumps, tolerance=0.06):
    """Épaulements proches fusionnés : plusieurs chaînes mesurent le même.

    Deux chaînes lisent souvent le même épaulement à quelques centimètres
    près, dans des sens de lecture opposés ; leurs découpe restent des
    valeurs distinctes du registre. Une saute de présence par côté et par
    direction est gardée une seule, à la médiane des valeurs qui la portent.
    """
    merged = {}
    for side, entries in jumps.items():
        kept = []
        for entry in sorted(entries, key=lambda item: item["at"]):
            near = next(
                (
                    other
                    for other in kept
                    if abs(other["at"] - entry["at"]) <= tolerance
                    and other["presence"] == entry["presence"]
                ),
                None,
            )
            if near is None:
                kept.append({"at": entry["at"], "presence": entry["presence"], "values": [entry["at"]]})
            else:
                near["values"].append(entry["at"])
                near["at"] = sorted(near["values"])[len(near["values"]) // 2]
        merged[side] = kept
    return merged


def corner_from_jumps(x_jump, z_jump):
    """Quadrant d'encoche prescrit par deux sautes cohérentes.

    La saute x dit de quel côté l'absence s'étend (« after » : le mur vit
    au-delà de la découpe, l'absence est en-deçà) ; la saute z, pareil. Un
    coin n'existe que si les deux sautes se répondent : l'absence basée à
    la façade sud coupe celle-ci, et la saute doit donc s'y être fait voir
    — une saute z mesurée côté est, cachée derrière une fenêtre, ne dit
    rien du coin sud-ouest.
    """
    if x_jump["presence"] == "after":
        absent_x, side_x = "min", "min"
    else:
        absent_x, side_x = "max", "max"
    if z_jump["presence"] == "after":
        absent_z, side_z = "min", "min"
    else:
        absent_z, side_z = "max", "max"
    # l'absence de la saute x doit joindre la façade mesurée par la saute z
    if side_z == "max" and not (absent_z == "max"):
        pass
    return absent_x, absent_z, side_x, side_z


QUADRANT_KEYS = {
    # (absent_x, absent_z) -> drapeaux (dx_minus, dz_minus) du constructeur
    ("min", "min"): (False, False),
    ("max", "min"): (False, True),
    ("min", "max"): (True, False),
    ("max", "max"): (True, True),
}
JUMP_SIDES = {
    # (absent_z, absent_x) -> la façade où chaque saute doit s'être montrée
    ("max", "min"): ("south", "west"),
    ("min", "min"): ("north", "west"),
    ("max", "max"): ("south", "east"),
    ("min", "max"): ("north", "east"),
}


def enumerate_from_jumps(axes, jumps, thicknesses):
    """Contours prescrits par les épaulements validés.

    Une encoche de coin vient d'une saute x et d'une saute z **répondantes** :
    l'absence qu'elles mesurent doit joindre la façade où l'autre saute s'est
    montrée — le coin (x<x*, z>z*) coupe les façades sud et ouest, et rien
    d'autre. Une encoche de façade vient de deux sautes d'une même façade
    avec l'absence entre elles. Le rectangle n'est retenu que si aucune
    saute n'existe nulle part.
    """
    jumps = merged_jumps(jumps)
    candidates = []
    for x_side in ("south", "north"):
        for z_side in ("west", "east"):
            for x_jump in jumps[x_side]:
                for z_jump in jumps[z_side]:
                    absent_x = "min" if x_jump["presence"] == "after" else "max"
                    absent_z = "max" if z_jump["presence"] == "before" else "min"
                    if absent_z == "max" and x_side != "south":
                        continue
                    if absent_z == "min" and x_side != "north":
                        continue
                    if absent_x == "min" and z_side != "west":
                        continue
                    if absent_x == "max" and z_side != "east":
                        continue
                    dx_minus, dz_minus = QUADRANT_KEYS[(absent_x, absent_z)]
                    candidate = corner_candidate(axes, x_jump["at"], z_jump["at"],
                                                  dx_minus, dz_minus)
                    if candidate is not None:
                        candidate["jumps"] = {
                            "x": x_jump, "z": z_jump, "quadrant": (absent_x, absent_z)
                        }
                        candidates.append(candidate)
    if not any(jumps[side] for side in SIDES):
        candidates.append(rectangle_candidate(axes))
    for side in SIDES:
        ordered = sorted(jumps[side], key=lambda item: item["at"])
        for index in range(len(ordered) - 1):
            first, second = ordered[index], ordered[index + 1]
            # l'absence doit être entre les deux épaulements
            if first["presence"] != "before" or second["presence"] != "after":
                continue
            a, b = first["at"], second["at"]
            depths = run_depths(axes, side)
            for item in thickness_depths(axes, thicknesses, side, a, b):
                if not any(close(entry["value"], item["value"]) for entry in depths):
                    depths.append(item)
            for depth in depths:
                if depth["origin"] == "thickness":
                    candidate = facade_candidate(axes, side, a, b, depth["value"], "thickness")
                    if candidate is not None:
                        candidate["thicknessSource"] = thicknesses[depth.get("index")]
                else:
                    candidate = facade_candidate(axes, side, a, b, depth["value"], "printed-run")
                if candidate is not None:
                    candidates.append(candidate)
    return candidates


def enumerate_all(axes, thicknesses):
    """Sans page rendue : rectangle, quatre quadrants et profondeurs comblées."""
    candidates = [rectangle_candidate(axes)]
    for x_cut in axes["x"]["cuts"]:
        for z_cut in axes["z"]["cuts"]:
            for dx_minus in (False, True):
                for dz_minus in (False, True):
                    candidate = corner_candidate(axes, x_cut["value"], z_cut["value"],
                                                 dx_minus, dz_minus)
                    if candidate is not None:
                        candidates.append(candidate)
    for side in SIDES:
        along = "x" if side in ("north", "south") else "z"
        cuts = sorted({cut["value"] for cut in axes[along]["cuts"]})
        for index, a in enumerate(cuts):
            for b in cuts[index + 1:]:
                depths = run_depths(axes, side)
                for item in thickness_depths(axes, thicknesses, side, a, b):
                    if not any(close(entry["value"], item["value"]) for entry in depths):
                        depths.append(item)
                for depth in depths:
                    if depth["origin"] == "thickness":
                        candidate = facade_candidate(axes, side, a, b, depth["value"], "thickness")
                        if candidate is not None:
                            candidate["thicknessSource"] = thicknesses[depth.get("index")]
                    else:
                        candidate = facade_candidate(axes, side, a, b, depth["value"], "printed-run")
                    if candidate is not None:
                        candidates.append(candidate)
    return candidates


def measured_depth(ink, candidate):
    """Balayage perpendiculaire au milieu de l'encoche : où l'enveloppe saute.

    La sonde part juste au-dehors du nu de façade et traverse vers
    l'intérieur sur 75 cm. La première bande épaisse comme un mur est
    l'enveloppe : la distance de sa face au nu est la profondeur réelle de
    l'encoche. Seuils et traits de cote, trop fins, ne l'interrompent pas.
    """
    notch = candidate["notch"]
    side = candidate["side"]
    edges = candidate["edges"]
    a, b = notch["a"], notch["b"]
    margin = min(0.3, (b - a) / 3)
    depth_is_z = side in ("north", "south")
    if side == "south":
        nu, inside = max(item["at"] for item in edges if item["axis"] == "x"), -1.0
    elif side == "north":
        nu, inside = min(item["at"] for item in edges if item["axis"] == "x"), 1.0
    elif side == "west":
        nu, inside = min(item["at"] for item in edges if item["axis"] == "z"), 1.0
    else:
        nu, inside = max(item["at"] for item in edges if item["axis"] == "z"), -1.0
    depths = []
    for index in range(5):
        position = a + margin + (b - a - 2 * margin) * (index + 1) / 6
        if depth_is_z:
            bands = ink.bands(position, nu - inside * OUT_MARGIN,
                              position, nu + inside * 0.75, step_m=0.01)
        else:
            bands = ink.bands(nu - inside * OUT_MARGIN, position,
                              nu + inside * 0.75, position, step_m=0.01)
        for low, high in bands:
            if high - low >= WALL_BAND_MIN:
                depths.append(round(low - OUT_MARGIN, 4))
                break
    if not depths:
        return None
    depths.sort()
    return depths[len(depths) // 2]


def opening_credits(axes, registry, pages, origins, ppm):
    """Baies imprimées, par axe : chaînes ouvertes et cotes de baie.

    Le plan interrompt le trait de face d'une façade à chaque baie, et il
    l'imprime : segment de chaîne « 1.40/1.05 », cote isolée « 0.90/2.15 »
    posée contre le mur. Ces intervalles créditent l'absence de trait à
    l'encre — sans eux, une fenêblinde une façade la briserait.
    """
    credits = {"x": [], "z": []}
    for axis in ("x", "z"):
        for chain in axes[axis]["anchored"]:
            for backward in (False, True):
                values = cumulative(chain, axes[axis]["extent"], backward)
                for index, segment in enumerate(chain["segments"]):
                    if segment["kind"] != "opening":
                        continue
                    low = min(values[index], values[index + 1])
                    high = max(values[index], values[index + 1])
                    credits[axis].append((round(low, 4), round(high, 4)))
    import re

    opening_text = re.compile(r"^(\d+(?:[.,]\d+)?)/(\d+(?:[.,]\d+)?)$")
    for page in registry["pages"]:
        if pages is not None and page["index"] not in pages:
            continue
        for label in (page.get("labels") or {}).get("openings") or []:
            match = opening_text.match(label.get("text", ""))
            if not match:
                continue
            width = float(match.group(1).replace(",", "."))
            if not width:
                continue
            if label.get("horizontal"):
                axis, center = "x", (label["at"][0] - origins["x"]) / ppm
            else:
                axis, center = "z", (label["at"][1] - origins["z"]) / ppm
            credits[axis].append((round(center - width / 2, 4), round(center + width / 2, 4)))
    return credits


# ---------------------------------------------------------------------------
# Déroulement
# ---------------------------------------------------------------------------


def derive(registry, pages, plan_envelope=None, pdf=None):
    refusals = []
    axes = build_axes(registry, pages, plan_envelope)
    origins, ppm = frame_of(axes)
    thicknesses = thickness_candidates(registry, pages, origins, ppm)
    ink = None
    if pdf:
        page_index = pages[0] if pages else registry["pages"][0]["index"]
        ink = Ink(pdf, page_index, origins, ppm)
    if ink is not None:
        jumps, jump_refusals = classify_cuts(axes, ink)
        refusals.extend(jump_refusals)
        candidates = enumerate_from_jumps(axes, jumps, thicknesses)
    else:
        candidates = enumerate_all(axes, thicknesses)
    closed = []
    for candidate in candidates:
        proof, refusal = close_candidate(candidate, axes, thicknesses)
        if proof is not None:
            closed.append({"candidate": candidate, "proof": proof, "supports": None})
        else:
            refusals.append({"candidate": candidate_id(candidate), "reason": refusal["reason"]})
    if ink is not None:
        credits = opening_credits(axes, registry, pages, origins, ppm)
        kept = []
        for entry in closed:
            supports = []
            passed = True
            for item in entry["candidate"]["edges"]:
                fractions, found = ink.edge_support(item, credits)
                supports.append(
                    {
                        "edge": f"{item['axis']}@{item['at']:.2f}[{item['low']:.2f},{item['high']:.2f}]",
                        "role": item["role"],
                        "support": fractions["total"],
                        "ink": fractions["ink"],
                        "openings": fractions["openings"],
                        "probes": found,
                    }
                )
                if fractions["total"] < SUPPORT_MIN or fractions["ink"] < INK_FLOOR:
                    passed = False
                    refusals.append(
                        {
                            "candidate": candidate_id(entry["candidate"]),
                            "reason": (
                                f"arête {item['axis']}@{item['at']:.2f} "
                                f"[{item['low']:.2f},{item['high']:.2f}] sans mur à l'encre "
                                f"(mur {fractions['ink']:.0%}, baies {fractions['openings']:.0%})"
                            ),
                        }
                    )
                    break
            entry["supports"] = supports
            if not passed:
                continue
            if entry["candidate"]["side"] is not None:
                measure = measured_depth(ink, entry["candidate"])
                entry["measuredDepth"] = measure
                if measure is None or not close(measure, entry["candidate"]["depth"],
                                                DEPTH_MEASURE_TOL):
                    refusals.append(
                        {
                            "candidate": candidate_id(entry["candidate"]),
                            "reason": (
                                "balayage d'encre sans enveloppe sous l'encoche"
                                if measure is None
                                else (
                                    f"profondeur {entry['candidate']['depth']:.2f} m contredite "
                                    f"par le balayage d'encre ({measure:.2f} m)"
                                )
                            ),
                        }
                    )
                    continue
            kept.append(entry)
        closed = kept
    ambiguous = len(closed) != 1
    return {
        "axes": axes,
        "origins": origins,
        "candidates": closed,
        "refusals": refusals,
        "ambiguous": ambiguous,
        "ink": ink is not None,
    }


def self_test():
    """Non-régression des cinq couches sur des fixtures synthétiques.

    Les fixtures rejouent deux motifs relevés sur de vrais plans — l'encoche
    de coin du plan A et l'encoche de façade du plan B — sur une emprise
    synthétique : aucune donnée réelle n'entre dans le dépôt. Le PDF de la
    couche encre est dessiné à la volée, pour que le test couvre aussi le
    rejet d'un trait mixte.
    """
    failures = []
    failures += _self_test_corner()
    failures += _self_test_facade()
    failures += _self_test_refusals()
    failures += _self_test_ink()
    if failures:
        for failure in failures:
            print(f"ECHEC {failure}")
        return 1
    print("contour dérivé : auto-test réussi")
    return 0


def _fixture(name):
    return json.loads((FIXTURE / name).read_text(encoding="utf-8"))


def _self_test_corner():
    """Encoche de coin : étendues recoupées, chaîne écartée, contour ambigu."""
    failures = []
    registry = _fixture("registry-corner.json")
    result = derive(registry, [1])
    axes = result["axes"]
    if not close(axes["x"]["extent"], 10.0) or not close(axes["z"]["extent"], 8.0):
        failures.append(
            f"étendues {axes['x']['extent']:.2f} x {axes['z']['extent']:.2f} au lieu de 10.00 x 8.00"
        )
    discarded = axes["x"]["discarded"] + axes["z"]["discarded"]
    if len(discarded) != 1 or not close(discarded[0]["sum"], 7.6):
        failures.append(f"chaîne écartée {discarded} au lieu de la seule chaîne à 7,60 m")
    if not result["ambiguous"]:
        failures.append("sans page rendue, quatre quadrants restent possibles : le script a tranché")
    wanted = [[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [4.0, 8.0], [4.0, 5.0], [0.0, 5.0]]
    outlines = [outline_of(entry["candidate"]["vertices"]) for entry in result["candidates"]]
    if wanted not in outlines:
        failures.append(f"le quadrant (x<4, z>5) manque aux {len(outlines)} contour(s) fermé(s)")
    return failures


def _self_test_facade():
    """Encoche de façade : profondeur déduite d'une cote en centimètres."""
    failures = []
    registry = _fixture("registry-facade.json")
    result = derive(registry, [1])
    wanted = [[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [5.0, 8.0], [5.0, 7.65], [3.0, 7.65], [3.0, 8.0], [0.0, 8.0]]
    found = [
        entry
        for entry in result["candidates"]
        if outline_of(entry["candidate"]["vertices"]) == wanted
    ]
    if not found:
        failures.append(
            f"l'encoche de façade 3,00..5,00 profonde de 0,35 m manque aux "
            f"{len(result['candidates'])} contour(s) fermé(s)"
        )
        return failures
    entry = found[0]
    if entry["candidate"]["depthSource"] != "thickness":
        failures.append(f"profondeur attribuée à {entry['candidate']['depthSource']}")
    depth_edges = [item for item in entry["proof"]["edges"] if item["class"] == "derived"]
    if len(depth_edges) != 2:
        failures.append(
            f"{len(depth_edges)} arête(s) dérivée(s) au lieu des deux flancs de l'encoche"
        )
    if any(item["class"] == "printed" for item in entry["proof"]["edges"] if "profondeur" in item.get("note", "")):
        failures.append("une profondeur non cotée a été déclarée imprimée")
    return failures


def _self_test_refusals():
    """Une étendue non recoupée, ou contredite par l'enveloppe, ne se dérive pas."""
    failures = []
    registry = _fixture("registry-unproven.json")
    try:
        derive(registry, [1])
        failures.append("une étendue portée par une seule chaîne a été acceptée")
    except SystemExit as error:
        if "non prouvée" not in str(error):
            failures.append(f"refus inattendu sur l'étendue non recoupée : {error}")
    try:
        derive(_fixture("registry-corner.json"), [1], plan_envelope=[10.0, 9.0])
        failures.append("une étendue contredite par l'enveloppe extraite a été acceptée")
    except SystemExit as error:
        if "contredite" not in str(error):
            failures.append(f"refus inattendu sur l'étendue contredite : {error}")
    return failures


def _self_test_ink():
    """Couche encre : le contour se dérive du dessin, un trait mixte ne fait pas un mur."""
    import tempfile

    import pymupdf

    failures = []
    ppm, origin = 40.0, (100.0, 100.0)
    outline = [[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [4.0, 8.0], [4.0, 5.0], [0.0, 5.0]]
    thickness = 0.30
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)

    def point(x, z):
        return (origin[0] + x * ppm, origin[1] + z * ppm)

    for item in edges_of(outline):
        along = item["axis"]
        ux, uz = item["inward"]
        if along == "x":
            start, end = (item["low"], item["at"]), (item["high"], item["at"])
        else:
            start, end = (item["at"], item["low"]), (item["at"], item["high"])
        corners = [
            point(start[0], start[1]),
            point(end[0], end[1]),
            point(end[0] + ux * thickness, end[1] + uz * thickness),
            point(start[0] + ux * thickness, start[1] + uz * thickness),
        ]
        page.draw_polyline(corners + [corners[0]], color=None, fill=(0.0, 0.0, 0.0), width=0)
    # Un trait mixte au nu de la façade sud, là où le contour n'a pas de mur,
    # doublé d'un trait plein juste derrière : sans le rejet du mixte, la sonde
    # perpendiculaire y lirait un mur de 20 cm.
    for step in range(0, 40):
        low = 0.0 + step * 0.10
        page.draw_line(point(low, 8.0), point(low + 0.06, 8.0), color=(0.0, 0.0, 0.0), width=1)
    page.draw_line(point(0.0, 7.80), point(4.0, 7.80), color=(0.0, 0.0, 0.0), width=1)

    path = str(Path(tempfile.mkdtemp()) / "self-test-outline.pdf")
    document.save(path)
    result = derive(_fixture("registry-corner.json"), [1], None, path)
    if result["ambiguous"]:
        failures.append(
            f"{len(result['candidates'])} contour(s) retenu(s) avec la page rendue au lieu d'un seul"
        )
        return failures
    produced = outline_of(result["candidates"][0]["candidate"]["vertices"])
    if produced != outline:
        failures.append(f"contour dérivé {produced} au lieu de {outline}")
    ink = Ink(path, 1, result["origins"], 40.0)
    if ink.wall_at(2.0, 8.0, (0.0, -1.0)) is not None:
        failures.append("un trait mixte au nu de la façade a été lu comme un mur")
    if ink.wall_at(2.0, 5.0, (0.0, -1.0)) is None:
        failures.append("le mur de l'encoche, dessiné plein, n'a pas été lu")
    return failures


def main(argv):
    if "--self-test" in argv:
        return self_test()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry")
    parser.add_argument("out")
    parser.add_argument("--pages", default=None, help="pages du registre, ex. 8 ou 13,14")
    parser.add_argument("--pdf", default=None, help="page rendue pour le classifieur d'encre")
    parser.add_argument(
        "--plan", default=None, help="sortie d'extract_plan.py, pour recouper les étendues"
    )
    args = parser.parse_args(argv[1:])
    pages = [int(value) for value in args.pages.split(",")] if args.pages else None
    registry = json.loads(Path(args.registry).read_text(encoding="utf-8"))
    plan_envelope = None
    if args.plan:
        plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
        plan_envelope = plan.get("envelope")
    result = derive(registry, pages, plan_envelope, args.pdf)
    axes = result["axes"]
    unique = len(result["candidates"]) == 1
    payload = {
        "schemaVersion": 1,
        "generatedBy": "scripts/derive_outline.py",
        "pages": pages,
        "extent": {"x": axes["x"]["extent"], "z": axes["z"]["extent"]},
        "anchoredChains": {
            axis: [chain_ref(chain) for chain in axes[axis]["anchored"]] for axis in ("x", "z")
        },
        "discardedChains": axes["x"]["discarded"] + axes["z"]["discarded"],
        "outline": outline_of(result["candidates"][0]["candidate"]["vertices"]) if unique else None,
        "edges": result["candidates"][0]["proof"]["edges"] if unique else None,
        "notch": result["candidates"][0]["candidate"].get("notch") if unique else None,
        "measuredDepth": result["candidates"][0].get("measuredDepth") if unique else None,
        "supports": result["candidates"][0].get("supports") if unique else None,
        "ambiguous": result["ambiguous"],
        "candidates": (
            None if unique else [candidate_id(entry["candidate"]) for entry in result["candidates"]]
        ),
        "refusals": result["refusals"],
    }
    Path(args.out).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for axis in ("x", "z"):
        extent = axes[axis]["extent"]
        print(
            f"axe {axis} : étendue {extent:.2f} m, "
            f"{len(axes[axis]['anchored'])} chaîne(s) ancrée(s), "
            f"{len(axes[axis]['cuts'])} découpe(s), {len(axes[axis]['runs'])} suite(s)"
        )
        for item in axes[axis]["discarded"]:
            print(f"  écartée : {item['reason']}")
    if unique:
        outline = payload["outline"]
        print("contour dérivé : " + " ".join(f"[{x},{z}]" for x, z in outline))
        entry = result["candidates"][0]
        notch = entry["candidate"].get("notch")
        if notch and notch["kind"] == "facade":
            derived = next((item for item in payload["edges"] if item["class"] == "derived"), None)
            claim = "DÉDUITE d'une épaisseur imprimée, pas lue" if derived else "imprimée"
            print(
                f"  encoche {notch['a']:.2f}..{notch['b']:.2f} sur {notch['side']}, "
                f"profondeur {entry['candidate']['depth']:.2f} m {claim}"
            )
    else:
        print(f"{len(result['candidates'])} contour(s) fermé(s) — reste à trancher :")
        for identifier in payload["candidates"]:
            print(f"  {identifier}")
    print(f"{len(result['refusals'])} candidat(s) refusé(s) -> {args.out}")
    return 0 if unique else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
