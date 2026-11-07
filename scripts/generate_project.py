"""Couche 3 : assembler un projet à partir de la géométrie lue sur le plan.

Entrées :
- le plan extrait (`extract_plan.py`) : les cloisons, avec leur épaisseur ;
- le registre d'évidence : les chaînes de cotes refermées, qui donnent la
  position exacte des baies le long de chaque façade ;
- un projet modèle : le contour du niveau, les pièces, les éclairages et le
  point de départ, qui ne se déduisent pas du dessin.

Sortie : un projet complet, où les murs et les baies viennent du plan.

Les murs extérieurs suivent le contour : chaque arête donne un mur dont la face
extérieure est l'arête, l'axe étant en retrait d'une demi-épaisseur. Les baies
d'une façade sont placées depuis la chaîne de cotes qui mesure ce côté, jamais
depuis le symbole dessiné.

Usage :
  uvx --from pymupdf python scripts/generate_project.py <plan.json> <registre.json> \
      <modele.json> <niveau> <sortie.json> [--pages 8] [--thickness 0.34]
"""
import argparse
import json
import math
import sys
from pathlib import Path

TOL = 0.01  # m
DEFAULT_THICKNESS = 0.34  # m, épaisseur d'un mur extérieur sans cote


def outline_edges(outline):
    """Arêtes du contour, avec leur normale rentrante."""
    edges = []
    for index, start in enumerate(outline):
        end = outline[(index + 1) % len(outline)]
        dx, dz = end[0] - start[0], end[1] - start[1]
        length = math.hypot(dx, dz)
        if length < TOL:
            continue
        # Normale candidate, orientée vers l'intérieur du polygone.
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
    """Origine du repère de tracé par axe, déduite des chaînes qui portent l'emprise."""
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
    """Côté du contour que mesure une chaîne, en mètres, ou None."""
    along = 0 if chain["axis"] == "horizontal" else 1
    origin = origins.get(1 - along)
    if origin is None:
        return None
    return (chain["perpendicular"] - origin) / chain["printedPointsPerMetre"]


def edge_for_side(edges, axis, side, outline):
    """Arête du contour qui porte le côté mesuré par une chaîne."""
    # Le côté d'une chaîne horizontale est une ordonnée, celui d'une verticale une abscisse.
    values = [point[1] if axis == "horizontal" else point[0] for point in outline]
    low, high = min(values), max(values)
    for edge in edges:
        if edge["axis"] != axis:
            continue
        coordinate = edge["start"][1] if axis == "horizontal" else edge["start"][0]
        if side > high and abs(coordinate - high) <= TOL:
            return edge
        if side < low and abs(coordinate - low) <= TOL:
            return edge
    return None


def chain_start(chain, origins):
    """Position monde du début d'une chaîne, en mètres."""
    along = 0 if chain["axis"] == "horizontal" else 1
    origin = origins.get(along)
    if origin is None:
        return None
    ppm = chain["printedPointsPerMetre"]
    first = chain["segments"][0]
    return (first["at"][along] - first["value"] / 2 * ppm - origin) / ppm


def openings_from_chain(chain, wall, origins):
    """Baies d'une chaîne, ramenées sur l'offset du mur qu'elle mesure.

    Les segments d'une chaîne sont ordonnés par abscisse croissante : leur
    intervalle monde se lit directement. L'offset d'une baie se compte depuis le
    début du mur, qui peut aller dans l'autre sens.
    """
    along = 0 if chain["axis"] == "horizontal" else 1
    start_world = chain_start(chain, origins)
    if start_world is None:
        return []
    wall_start = wall["start"][along]
    wall_end = wall["end"][along]
    cursor = start_world
    found = []
    for segment in chain["segments"]:
        low, high = cursor, cursor + segment["value"]
        cursor = high
        if segment["kind"] != "opening" or "/" not in segment["text"]:
            continue
        width_text, height_text = segment["text"].split("/", 1)
        width = float(width_text.replace(",", ".")) if "," in width_text or "." in width_text else float(width_text) / 100
        height = float(height_text.replace(",", ".")) if "," in height_text or "." in height_text else float(height_text) / 100
        offset = low - wall_start if wall_end >= wall_start else wall_start - high
        if offset < -TOL or offset + width > abs(wall_end - wall_start) + TOL:
            continue
        found.append(
            {
                "offset": round(max(0.0, offset), 4),
                "width": round(width, 4),
                "height": round(height, 4),
                "kind": "window" if height < 1.6 else "door",
                "sill": 0.0 if height >= 1.6 else 1.0,
            }
        )
    return found


def wall_faces(walls):
    """Abscisses et ordonnées des faces de murs, pour recaler les pièces."""
    xs, zs = set(), set()
    for wall in walls:
        half = wall["thickness"] / 2
        if abs(wall["start"][0] - wall["end"][0]) >= abs(wall["start"][1] - wall["end"][1]):
            zs.update({round(wall["start"][1] - half, 4), round(wall["start"][1] + half, 4)})
        else:
            xs.update({round(wall["start"][0] - half, 4), round(wall["start"][0] + half, 4)})
    return sorted(xs), sorted(zs)


def snap(value, candidates, tolerance):
    """Valeur la plus proche dans une liste, si elle est à portée."""
    if not candidates:
        return value
    nearest = min(candidates, key=lambda candidate: abs(candidate - value))
    return nearest if abs(nearest - value) <= tolerance else value


def snap_rooms(rooms, walls, tolerance=0.30):
    """Recale les pièces sur les faces des murs : une pièce s'arrête à la face finie."""
    xs, zs = wall_faces(walls)
    for room in rooms:
        room["polygon"] = [
            [round(snap(point[0], xs, tolerance), 4), round(snap(point[1], zs, tolerance), 4)]
            for point in room["polygon"]
        ]
        # Le repère et le point de visite restent où ils sont : les recaler les
        # poserait sur la face d'un mur, donc sur le bord du polygone.


def apply_overrides(walls, overrides):
    """Applique les retouches saisies après la génération.

    Une retouche porte sur un mur précis : le décaler perpendiculairement, ou
    changer son épaisseur. Elle survit à une régénération, donc corriger trois
    murs ne demande pas de refaire les vingt autres.
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


def merge_partitions(model_walls, partitions, tolerance=0.15):
    """Remplace les cloisons du modèle par celles lues sur le dessin.

    Les murs hachurés ne sont pas extractibles : ils restent ceux du modèle, avec
    leurs baies. Seules les cloisons — les rectangles remplis — sont reprises du
    dessin, parce que c'est là qu'elles sont exactes. Une cloison sans
    contrepartie dans le modèle est ajoutée.
    """
    merged = [json.loads(json.dumps(wall)) for wall in model_walls]
    added = 0
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
        # On garde l'identifiant, l'emprise et les baies du modèle : une cloison
        # lue s'arrête au tableau d'une porte, le mur du modèle la traverse. Seuls
        # la position et la épaisseur viennent du dessin.
        best["start"][across] = best["end"][across] = round(centre, 4)
        best["thickness"] = partition["thickness"]
    return merged, added


def build(plan, registry, template, level_id, pages, thickness, overrides=None, merge=True):
    level = next(candidate for candidate in template["levels"] if candidate["id"] == level_id)
    outline = level["outline"]
    chains = [
        chain
        for page in registry["pages"]
        if pages is None or page["index"] in pages
        for chain in page["chains"]
    ]
    edges = outline_edges(outline)
    origins = envelope_frame(chains, outline)

    walls = []
    for index, edge in enumerate(edges):
        walls.append(
            {
                "id": f"ext-{index + 1}",
                "start": [
                    round(edge["start"][0] + edge["normal"][0] * thickness / 2, 4),
                    round(edge["start"][1] + edge["normal"][1] * thickness / 2, 4),
                ],
                "end": [
                    round(edge["end"][0] + edge["normal"][0] * thickness / 2, 4),
                    round(edge["end"][1] + edge["normal"][1] * thickness / 2, 4),
                ],
                "thickness": thickness,
                "exterior": True,
                "openings": [],
            }
        )

    for chain in chains:
        if not chain["closed"]:
            continue
        side = chain_side(chain, origins)
        if side is None:
            continue
        edge = edge_for_side(edges, chain["axis"], side, outline)
        if edge is None:
            continue
        wall = walls[edges.index(edge)]
        for opening in openings_from_chain(chain, wall, origins):
            opening["id"] = f"{wall['id']}-o{len(wall['openings']) + 1}"
            wall["openings"].append(opening)

    if merge:
        # Les murs hachurés du modèle sont conservés : seules les cloisons changent.
        walls = merge_partitions(level["walls"], plan["walls"])[0]
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

    result = json.loads(json.dumps(template))
    target = next(candidate for candidate in result["levels"] if candidate["id"] == level_id)
    if overrides:
        apply_overrides(walls, overrides)
    target["walls"] = walls
    snap_rooms(target["rooms"], walls)
    return result


def self_test():
    """Non-régression sur un cas synthétique : aucune donnée réelle."""
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
    # Une chaîne refermée sur la façade sud, avec une porte de 0,90 m.
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
    # Mode remplacement : tout vient du dessin et du contour.
    result = build(plan, registry, template, "rdc", [1], 0.34, merge=False)
    level = result["levels"][0]
    failures = []
    if len(level["walls"]) != 5:
        failures.append(f"{len(level['walls'])} murs au lieu de 4 murs extérieurs + 1 cloison")
    exterior = [wall for wall in level["walls"] if wall.get("exterior")]
    if len(exterior) != 4:
        failures.append(f"{len(exterior)} murs extérieurs au lieu de 4")
    openings = [opening for wall in level["walls"] for opening in wall.get("openings", [])]
    if len(openings) != 1:
        failures.append(f"{len(openings)} baies au lieu de 1")
    # L'arête sud va de x=6 vers x=0 : la porte à x 2,00..2,90 est à 3,10 du début.
    elif abs(openings[0]["width"] - 0.9) > 0.01 or abs(openings[0]["offset"] - 3.1) > 0.01:
        failures.append(f"baie mal placée : {openings[0]}")
    # La fusion garde les murs du modèle que le dessin ne donne pas.
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
        failures.append("la fusion a supprimé un mur hachuré du modèle")
    elif len(kept.get("openings", [])) != 1:
        failures.append("la fusion a perdu une baie du modèle")
    # La fusion ne garde que les murs du modèle et les cloisons lues : le mur
    # hachuré et la cloison, pas de murs extérieurs régénérés.
    if len(merged_walls) != 2:
        failures.append(f"{len(merged_walls)} murs après fusion au lieu de 2")

    # Une retouche survit à la régénération et ne touche que le mur visé.
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
        failures.append(f"retouche d'épaisseur non appliquée : {target['thickness']}")
    if abs(untouched["thickness"] - 0.34) > 1e-9:
        failures.append(f"retouche appliquée au mauvais mur : {untouched['thickness']}")
    if failures:
        for failure in failures:
            print(f"ECHEC {failure}")
        return 1
    print("génération de projet : auto-test réussi")
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
        help="remplacer tous les murs par ceux du dessin, au lieu de fusionner",
    )
    parser.add_argument(
        "--overrides",
        default=None,
        help="fichier de retouches appliquées après génération (murs et baies)",
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
    result = build(
        plan,
        registry,
        template,
        args.level,
        pages,
        args.thickness,
        overrides,
        merge=not args.replace,
    )
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    level = next(candidate for candidate in result["levels"] if candidate["id"] == args.level)
    openings = sum(len(wall.get("openings", [])) for wall in level["walls"])
    print(f"{len(level['walls'])} murs, {openings} baies -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
