"""Compare un projet à son plan source, en chiffres plutôt qu'à l'œil.

Deux passes indépendantes :

- **modèle -> source** : pour chaque mur, on échantillonne son axe et on cherche
  la bande sombre la plus proche perpendiculairement. On rapporte le décalage
  médian, l'épaisseur lue et le taux de recouvrement. Un mur sans bande en face
  est un mur inventé ; un décalage franc est un mur mal placé.
- **source -> modèle** : on balaye le rendu, on relève les bandes de murs et on
  cherche le mur du modèle qui les couvre. Une bande sans mur est un mur oublié.

Usage :
  python scripts/compare_plan.py <projet.json> <calibration.json> <sortie.json> [--step 0.5]

La calibration est celle d'`overlay-plan.py` : `image`, `level`, `anchors`
monde/pixel. Le rapport est un JSON ; rien n'est corrigé automatiquement.
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image

THRESHOLD = 120
SCAN_HALF = 0.6  # m, demi-fenêtre de recherche perpendiculaire
SAMPLE_FRACTIONS = (0.15, 0.3, 0.45, 0.6, 0.75, 0.85)
MIN_WALL_LENGTH = 0.3  # m, en dessous on ne peut pas échantillonner
MERGE_GAP = 0.26  # m, deux traits plus proches appartiennent au même mur
MIN_BAND, MAX_BAND = 0.05, 0.55
MIN_WALL_PIXELS = 8  # en dessous, les deux faces d'une cloison se confondent
FACE_TOLERANCE = 0.08  # m, écart accepté entre une face lue et sa position attendue
OFFSET_TOLERANCE = 0.05  # m, décalage d'axe accepté
THICKNESS_TOLERANCE = 0.06  # m, écart d'épaisseur accepté


def fit(pairs):
    mean_x = sum(x for x, _ in pairs) / len(pairs)
    mean_y = sum(y for _, y in pairs) / len(pairs)
    denominator = sum((x - mean_x) ** 2 for x, _ in pairs)
    if denominator < 1e-12:
        raise ValueError("La calibration doit couvrir les deux axes du monde")
    scale = sum((x - mean_x) * (y - mean_y) for x, y in pairs) / denominator
    if scale <= 0:
        raise ValueError("Le plan doit être orienté x vers la droite et z vers le bas")
    return scale, mean_y - scale * mean_x


def load_calibration(config):
    anchors = config["anchors"]
    scale_x, offset_x = fit([(a["world"][0], a["pixel"][0]) for a in anchors])
    scale_z, offset_z = fit([(a["world"][1], a["pixel"][1]) for a in anchors])
    return scale_x, offset_x, scale_z, offset_z


def to_pixel(x, z, calibration):
    scale_x, offset_x, scale_z, offset_z = calibration
    return scale_x * x + offset_x, scale_z * z + offset_z


def is_dark(pixels, u, v):
    width, height = pixels["size"]
    if not (0 <= u < width and 0 <= v < height):
        return False
    return pixels["data"][int(u), int(v)] < THRESHOLD


def dark_runs(pixels, u0, v0, du, dv, steps):
    """Bandes sombres le long d'un segment, en fraction de pas."""
    runs, start = [], None
    for step in range(steps):
        if is_dark(pixels, u0 + du * step, v0 + dv * step):
            if start is None:
                start = step
        elif start is not None:
            runs.append((start, step - 1))
            start = None
    if start is not None:
        runs.append((start, steps - 1))
    return runs


def wall_geometry(wall):
    (x0, z0), (x1, z1) = wall["start"], wall["end"]
    length = math.hypot(x1 - x0, z1 - z0)
    if length < 1e-9:
        return None
    return x0, z0, (x1 - x0) / length, (z1 - z0) / length, length


def compare_wall(wall, pixels, calibration, scale):
    """Vérifie que le plan montre bien les deux faces du mur déclaré.

    On ne cherche pas « une bande proche » : on cherche un trait sombre à
    -épaisseur/2 et un autre à +épaisseur/2. Un mur dont une seule face existe
    est un mur dont l'épaisseur ou la position est fausse ; un mur sans aucune
    face est un mur inventé.
    """
    geometry = wall_geometry(wall)
    if geometry is None or geometry[4] < MIN_WALL_LENGTH:
        return None
    x0, z0, ux, uz, length = geometry
    nx, nz = -uz, ux
    half = wall["thickness"] / 2
    steps = int(2 * SCAN_HALF * scale)
    offsets, thicknesses, hits = [], [], 0
    for fraction in SAMPLE_FRACTIONS:
        px, pz = x0 + ux * length * fraction, z0 + uz * length * fraction
        u, v = to_pixel(px, pz, calibration)
        # Un pas = un pixel : la normale unitaire du monde donne directement la
        # direction en pixels, l'échelle ne sert qu'à reconvertir en mètres.
        du, dv = nx, nz
        runs = dark_runs(pixels, u - du * steps / 2, v - dv * steps / 2, du, dv, steps)
        if not runs:
            continue
        centres = [((a + b) / 2 - steps / 2) / scale for a, b in runs]
        near_index = min(range(len(centres)), key=lambda i: abs(centres[i] + half))
        far_index = min(range(len(centres)), key=lambda i: abs(centres[i] - half))
        # Une cloison plus fine que la résolution du rendu donne un seul trait :
        # les deux faces se confondent et l'épaisseur n'est pas mesurable.
        if near_index == far_index:
            continue
        near, far = centres[near_index], centres[far_index]
        if abs(near + half) > FACE_TOLERANCE or abs(far - half) > FACE_TOLERANCE:
            continue
        offsets.append((near + far) / 2)
        thicknesses.append(far - near)
        hits += 1
    if not offsets:
        return {
            "id": wall["id"],
            "length": round(length, 3),
            "hitRate": 0.0,
            "offset": None,
            "width": None,
            "declaredThickness": wall["thickness"],
            "verdict": "aucune contrepartie dans le plan",
        }
    offsets.sort()
    thicknesses.sort()
    median_offset = offsets[len(offsets) // 2]
    median_thickness = thicknesses[len(thicknesses) // 2]
    hit_rate = hits / len(SAMPLE_FRACTIONS)
    if hit_rate < 0.5:
        verdict = "contrepartie partielle"
    elif abs(median_offset) > OFFSET_TOLERANCE:
        verdict = "décalé"
    elif abs(median_thickness - wall["thickness"]) > THICKNESS_TOLERANCE:
        verdict = "épaisseur divergente"
    else:
        verdict = "aligné"
    return {
        "id": wall["id"],
        "length": round(length, 3),
        "hitRate": round(hit_rate, 2),
        "offset": round(median_offset, 3),
        "width": round(median_thickness, 3),
        "declaredThickness": wall["thickness"],
        "verdict": verdict,
    }


def source_bands(pixels, calibration, level, step):
    """Bandes de murs relevées sur le rendu, par ligne de balayage."""
    scale_x, offset_x, scale_z, offset_z = calibration
    xs = [point[0] for point in level["outline"]]
    zs = [point[1] for point in level["outline"]]
    x_min, x_max = min(xs), max(xs)
    z_min, z_max = min(zs), max(zs)
    found = []
    z = z_min + step / 2
    while z < z_max:
        v = int(scale_z * z + offset_z)
        u_start = int(scale_x * x_min + offset_x)
        u_end = int(scale_x * x_max + offset_x)
        runs, start = [], None
        for u in range(u_start, u_end):
            if is_dark(pixels, u, v):
                if start is None:
                    start = u
            elif start is not None:
                runs.append((start, u - 1))
                start = None
        if start is not None:
            runs.append((start, u_end - 1))
        merged = []
        for a, b in runs:
            start_m, end_m = (a - offset_x) / scale_x, (b - offset_x) / scale_x
            if merged and start_m - merged[-1][1] <= MERGE_GAP:
                merged[-1] = (merged[-1][0], end_m)
            else:
                merged.append((start_m, end_m))
        for a, b in merged:
            if MIN_BAND <= b - a <= MAX_BAND:
                found.append({"z": round(z, 2), "x0": round(a, 2), "x1": round(b, 2)})
        z += step
    return found


def axis_distance(px, pz, geometry):
    """Distance d'un point à l'axe d'un mur, about compris."""
    x0, z0, ux, uz, length = geometry
    t = max(0.0, min(length, (px - x0) * ux + (pz - z0) * uz))
    return math.hypot(px - (x0 + ux * t), pz - (z0 + uz * t))


def covered(band, walls):
    """Un mur du modèle couvre-t-il cette bande à cette altitude ?

    Un mur parallèle au balayage coupe la ligne en z et couvre par son axe.
    Un mur perpendiculaire ne la coupe pas : balayée en lignes z, une petite
    bande est souvent la trace du mur lui-même (retour court), pas un mur en
    face. Le mur couvre alors par son empreinte, about compris.
    """
    centre = (band["x0"] + band["x1"]) / 2
    for wall in walls:
        geometry = wall_geometry(wall)
        if geometry is None:
            continue
        x0, z0, ux, uz, length = geometry
        if abs(ux) > 0.7:  # mur plutôt horizontal : ne coupe pas une ligne en z
            if axis_distance(centre, band["z"], geometry) <= wall["thickness"] / 2 + 0.12:
                return wall["id"]
            continue
        if not (min(z0, z0 + uz * length) - 0.15 <= band["z"] <= max(z0, z0 + uz * length) + 0.15):
            continue
        t = (band["z"] - z0) / uz if abs(uz) > 1e-9 else 0
        axis_x = x0 + ux * length * t
        if abs(axis_x - centre) <= wall["thickness"] / 2 + 0.12:
            return wall["id"]
    return None


def self_test():
    """Vérifie les quatre verdicts et un coin couvert par un retour perpendiculaire.

    Le coin et son retour sont une vérification purement géométrique, sans
    dépendre d'un PDF : le balayage en lignes z fait du retour horizontal la
    bande elle-même, et c'est l'empreinte du mur qui doit la couvrir.
    """
    from PIL import ImageDraw

    scale, origin = 100.0, (50.0, 50.0)
    image = Image.new("L", (400, 300), 255)
    draw = ImageDraw.Draw(image)

    def stroke(x0, z0, x1, z1):
        draw.line(
            [(origin[0] + x0 * scale, origin[1] + z0 * scale),
             (origin[0] + x1 * scale, origin[1] + z1 * scale)],
            fill=0,
            width=2,
        )

    # Un mur vertical à x=1,00 d'épaisseur 0,20 : deux faces à 0,90 et 1,10.
    stroke(0.9, 0.5, 0.9, 2.5)
    stroke(1.1, 0.5, 1.1, 2.5)

    pixels = {"data": image.load(), "size": image.size}
    calibration = (scale, origin[0], scale, origin[1])

    def wall(wall_id, x, thickness):
        return {
            "id": wall_id,
            "start": [x, 0.6],
            "end": [x, 2.4],
            "thickness": thickness,
        }

    cases = [
        ("bon", wall("bon", 1.0, 0.2), "aligné"),
        ("invente", wall("invente", 2.0, 0.2), "aucune contrepartie dans le plan"),
        ("epais", wall("epais", 1.0, 0.3), "épaisseur divergente"),
        ("decale", wall("decale", 1.08, 0.2), "décalé"),
    ]
    failures = []
    for label, candidate, expected in cases:
        result = compare_wall(candidate, pixels, calibration, scale)
        verdict = result["verdict"] if result else "écarté"
        status = "ok" if verdict == expected else "ÉCHEC"
        print(f"  {status:5} {label:8} attendu={expected:32} obtenu={verdict}")
        if verdict != expected:
            failures.append(label)
    # Un coin : cloison verticale et retour horizontal court. Les deux bandes
    # proviennent du retour lui-même ; le témoin du tronçon droit reste couvert
    # par la cloison, et une bande isolée loin de tout reste sans mur.
    cloison = {"id": "cloison", "start": [1.0, 0.6], "end": [1.0, 2.5], "thickness": 0.10}
    retour = {"id": "retour", "start": [1.0, 2.5], "end": [1.4, 2.5], "thickness": 0.10}
    corner_cases = [
        ({"z": 2.45, "x0": 0.95, "x1": 1.45}, "retour"),
        ({"z": 2.55, "x0": 1.05, "x1": 1.45}, "retour"),
        ({"z": 1.5, "x0": 0.95, "x1": 1.05}, "cloison"),
        ({"z": 0.5, "x0": 2.5, "x1": 3.0}, None),
    ]
    for band, expected in corner_cases:
        found = covered(band, [cloison, retour])
        status = "ok" if found == expected else "ÉCHEC"
        print(f"  {status:5} coin      z={band['z']} attendu={expected} obtenu={found}")
        if found != expected:
            failures.append(f"coin z={band['z']}")
    if failures:
        raise SystemExit(f"auto-test en échec : {', '.join(failures)}")
    print("auto-test : 4 verdicts et 4 bandes du coin conformes")
    return 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    if len(argv) < 4:
        print(__doc__)
        return 2
    project_path, calibration_path, output_path = argv[1:4]
    step = 0.5
    if "--step" in argv:
        step = float(argv[argv.index("--step") + 1])

    project = json.loads(Path(project_path).read_text(encoding="utf-8-sig"))
    config = json.loads(Path(calibration_path).read_text(encoding="utf-8-sig"))
    calibration = load_calibration(config)
    level = next(item for item in project["levels"] if item["id"] == config["level"])
    image = Image.open(config["image"]).convert("L")
    pixels = {"data": image.load(), "size": image.size}
    scale = calibration[0]

    thinnest = min((wall["thickness"] for wall in level["walls"]), default=0.0)
    if thinnest * scale < MIN_WALL_PIXELS:
        print(
            f"attention : la cloison la plus fine fait {thinnest * scale:.1f} px "
            f"à cette résolution ({scale:.0f} px/m). Rendre le plan plus grand, "
            f"sinon ses deux faces se confondent et le mur paraît absent."
        )

    walls = [compare_wall(wall, pixels, calibration, scale) for wall in level["walls"]]
    walls = [wall for wall in walls if wall]
    bands = source_bands(pixels, calibration, level, step)
    unmodelled = []
    for band in bands:
        if covered(band, level["walls"]) is None:
            unmodelled.append(band)

    report = {
        "project": project["id"],
        "level": level["id"],
        "image": config["image"],
        "walls": walls,
        "unmodelledBands": unmodelled,
        "summary": {
            "walls": len(walls),
            "aligned": sum(1 for wall in walls if wall["verdict"] == "aligné"),
            "shifted": sum(1 for wall in walls if wall["verdict"] == "décalé"),
            "partial": sum(1 for wall in walls if wall["verdict"] == "contrepartie partielle"),
            "missing": sum(1 for wall in walls if wall["verdict"] == "aucune contrepartie dans le plan"),
            "unmodelledBands": len(unmodelled),
        },
    }
    Path(output_path).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{report['summary']}")
    if "--table" in argv:
        print(f"  {'mur':22} {'verdict':32} {'décalage':>9} {'épaisseur lue':>14} {'déclarée':>9}")
        for wall in walls:
            print(
                f"  {wall['id']:22} {wall['verdict']:32} {wall['offset']:9.3f} "
                f"{wall['width']:14.3f} {wall['declaredThickness']:9.3f}"
            )
    for wall in walls:
        if wall["verdict"] != "aligné":
            print(f"  {wall['verdict']:32} {wall['id']:22} offset={wall['offset']} largeur={wall['width']}")
    for band in unmodelled[:10]:
        print(f"  bande sans mur                   z={band['z']} x={band['x0']}..{band['x1']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
