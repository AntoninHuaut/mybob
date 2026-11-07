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
MIN_THICKNESS = 0.06  # m, en dessous ce n'est pas une épaisseur de mur
MAX_THICKNESS = 0.45  # m, au-dessus non plus


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


def openings_from_chain(chain, wall, origins, sill=None):
    """Baies d'une chaîne, ramenées sur l'offset du mur qu'elle mesure.

    Les segments d'une chaîne sont ordonnés par abscisse croissante : leur
    intervalle monde se lit directement. L'offset d'une baie se compte depuis le
    début du mur, qui peut aller dans l'autre sens. L'allège vient du plan
    (« All : 1.10 m ») ; sans elle, la baie est marquée non résolue plutôt que
    posée à une hauteur inventée.
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
                "sill": 0.0 if height >= 1.6 else (sill if sill is not None else 0.0),
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


def snap_rooms(rooms, walls, outline=None, tolerance=0.30):
    """Recale les pièces sur les faces des murs : une pièce s'arrête à la face finie.

    Le recalage est un **déplacement**, pas une mesure : il est rapporté pour que
    personne ne le confonde avec une lecture du plan. Un sommet déplacé de plus
    de quelques centimètres signale un polygone qui n'était pas sur les faces.
    """
    xs, zs = wall_faces(walls)
    moves = []
    for room in rooms:
        snapped = []
        for point in room["polygon"]:
            x = round(snap(point[0], xs, tolerance), 4)
            z = round(snap(point[1], zs, tolerance), 4)
            # Un recalage ne doit pas sortir la pièce du niveau : sur un contour
            # en L, la face d'un mur peut être dehors. On garde alors l'original.
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
        # Le repère et le point de visite restent où ils sont : les recaler les
        # poserait sur la face d'un mur, donc sur le bord du polygone.
    return moves


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


def close_walls(walls, tolerance=0.45):
    """Prolonge un about de mur jusqu'à la face du mur qu'il vise.

    Un plan dessine souvent une cloison qui s'arrête à une poutre ou à un trait,
    pas à la face du mur. Le vide laisse passer le remplissage et la pièce
    n'existe plus : sur Sannerville, trois cloisons s'arrêtaient 34 cm avant le
    mur sud et tout le niveau ne formait qu'une région.

    On prolonge l'about jusqu'à la face la plus proche, dans l'axe du mur, et on
    rapporte chaque prolongement : c'est un déplacement, pas une lecture.
    """
    moves = []
    for wall in walls:
        # Un mur extérieur s'arrête au contour : le prolonger le ferait sortir.
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
                    # L'autre mur est perpendiculaire : son étendue se lit sur
                    # l'axe `across` du mur courant.
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
    """Recolle les cloisons qu'un dessin coupe à chaque porte.

    Un plan dessine une cloison en morceaux : le trait s'arrête au tableau de la
    porte et reprend après. Pour le remplissage, ces morceaux sont des murs
    séparés, le vide laisse passer et les pièces fusionnent — sur Émiéville en
    mode généré, tout le niveau ne formait qu'une région de 107,93 m².

    On recolle les morceaux alignés et l'écart devient une baie. La hauteur de
    cette baie n'est pas lue : elle est posée à la hauteur de porte usuelle et
    rapportée comme telle.
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
    """Découpe un mur extérieur là où une cloison le rencontre.

    Une façade n'a pas une épaisseur : sur Émiéville le nord fait 22 cm côté
    garage et 34 cm côté chambres. Prendre une seule cote pour toute l'arête
    fait grandir les pièces — 0,65 m² sur chambre-3. On coupe aux jonctions, puis
    chaque tronçon reprend la cote qui le longe.

    Les baies suivent : chacune est reportée sur le tronçon qui la contient, par
    son intervalle monde, jamais par un offset recopié.
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
        # La face extérieure est celle qui tombe sur le contour : c'est elle qui
        # reste fixe quand l'épaisseur change, pas l'axe.
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
            # Le premier tronçon garde l'identifiant du mur : une surcharge qui
            # visait ce mur continue de le viser.
            segment = {
                "id": wall["id"] if index == 0 else f"{wall['id']}-{index + 1}",
                "start": [0.0, 0.0],
                "end": [0.0, 0.0],
                "exterior": True,
                "openings": [],
            }
            # Le sens du mur d'origine est conservé : les offsets de baies et le
            # sens d'ouverture des portes en dépendent.
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
    """Remplace les cloisons du modèle par celles lues sur le dessin.

    Les murs hachurés ne sont pas extractibles : ils restent ceux du modèle, avec
    leurs baies. Seules les cloisons — les rectangles remplis — sont reprises du
    dessin, parce que c'est là qu'elles sont exactes. Une cloison sans
    contrepartie dans le modèle est ajoutée.

    L'épaisseur n'est reprise que si elle concorde. L'aplat du dessin est le mur
    **brut** ; le modèle porte le mur **fini**, doublage compris. Remplacer l'un
    par l'autre rétrécit la pièce : sur Émiéville, la cloison garage/WC fait
    10,2 cm à l'aplat et 15 cm finie, et la surface imprimée du WC (1,62 m²)
    tranche pour 15 cm. L'écart est rapporté, pas absorbé.
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
        # On garde l'identifiant, l'emprise et les baies du modèle : une cloison
        # lue s'arrête au tableau d'une porte, le mur du modèle la traverse. Seuls
        # la position et la épaisseur viennent du dessin.
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
    """Repère points -> mètres, depuis les chaînes qui portent l'emprise."""
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
    """Épaisseur lue sur une cote en centimètres posée contre le mur.

    Une cote de 22, 34 ou 15 contre une façade donne son épaisseur. On ne
    retient que les cotes perpendiculaires au mur et dont le libellé tombe dans
    son emprise : c'est une lecture, pas une déduction. Sans cote trouvée, le
    mur garde l'épaisseur de repli et le script le dit.
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


def printed_sill(registry, pages):
    """Allège imprimée la plus fréquente, ou None si le plan n'en donne pas."""
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


def merge_openings(model_walls, generated_walls, tolerance=0.12):
    """Reporte sur le modèle les baies que les chaînes prouvent et qu'il n'a pas.

    La fusion garde les murs du modèle, qui portent les murs hachurés et les
    portes intérieures. Elle ne doit pas jeter pour autant les baies lues sur
    les chaînes : une baie prouvée par une cote et absente du modèle est un
    manque, pas un choix.

    Une baie est reportée par son intervalle **monde**, pas par son offset : deux
    murs voisins peuvent être à six centimètres l'un de l'autre, et un offset
    recopié d'un mur à l'autre poserait la baie hors du mur. La baie doit tenir
    dans l'emprise du mur d'accueil, sinon elle n'est pas reportée.
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
                if world_low < w_low - tolerance or world_high > w_high + tolerance:
                    continue
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
                break
    return added


def compare_thickness(model_walls, generated_walls, tolerance=0.12, gap=0.02):
    """Écarts d'épaisseur entre les murs du modèle et les cotes du plan.

    La fusion garde les murs du modèle, mais elle ne doit pas taire ce que le
    plan dit d'autre : un mur dont l'épaisseur déclarée s'écarte de la cote
    imprimée est signalé, et c'est une surcharge qui le corrige, pas une
    régénération.
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
    plan, registry, template, level_id, pages, thickness, overrides=None, merge=True, report=None
):
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
    frame = world_frame(chains, outline)
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
        for opening in openings_from_chain(chain, wall, origins, sill):
            opening["id"] = f"{wall['id']}-o{len(wall['openings']) + 1}"
            wall["openings"].append(opening)

    generated = walls
    added = []
    thickness_gaps = []
    partition_gaps = []
    closed = []
    rejoined = []
    if merge:
        # Les murs hachurés du modèle sont conservés : seules les cloisons changent.
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
    target["walls"] = walls
    moves = snap_rooms(target["rooms"], walls, target.get("outline"))
    if report is not None:
        report["thickness"] = read
        report["openingsAdded"] = added
        report["thicknessGaps"] = thickness_gaps
        report["roomMoves"] = moves
        report["partitionGaps"] = partition_gaps
        report["closed"] = closed
        report["rejoined"] = rejoined
        report["sill"] = sill
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
    )
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    level = next(candidate for candidate in result["levels"] if candidate["id"] == args.level)
    openings = sum(len(wall.get("openings", [])) for wall in level["walls"])
    print(f"{len(level['walls'])} murs, {openings} baies -> {args.out}")
    read = report.get("thickness") or []
    printed = sum(1 for item in read if item["printed"])
    print(f"épaisseurs lues sur le plan : {printed}/{len(read)}")
    fallback = [item["wall"] for item in read if not item["printed"]]
    if fallback:
        print(f"  sans cote, épaisseur de repli : {', '.join(fallback)}")
    if report.get("sill") is None:
        print("  allège : aucune cote imprimée, baies de fenêtre posées à 0")
    else:
        print(f"  allège imprimée : {report['sill']} m")
    if report.get("openingsAdded"):
        print(f"  baies ajoutées depuis les chaînes : {len(report['openingsAdded'])}")
    moves = report.get("roomMoves") or []
    if moves:
        worst = max(moves, key=lambda move: move["distance"])
        print(
            f"  pièces recalées sur les faces : {len(moves)} sommet(s), "
            f"le plus grand de {worst['distance']:.3f} m ({worst['room']})"
        )
    if report.get("rejoined"):
        print(
            f"  cloisons recollées : {len(report['rejoined'])} porte(s) "
            f"refermée(s) en baie"
        )
    for move in report.get("closed") or []:
        print(
            f"  {move['wall']} : about prolongé de {move['gap']} m "
            f"({move['from']} -> {move['to']})"
        )
    for gap in report.get("partitionGaps") or []:
        print(
            f"  {gap['wall']} : cloison du modèle {gap['model']} m, "
            f"aplat du dessin {gap['drawn']} m — épaisseur du modèle conservée"
        )
    for gap in report.get("thicknessGaps") or []:
        print(
            f"  {gap['wall']} : épaisseur du modèle {gap['model']} m, "
            f"cote imprimée {gap['printed']} m"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
