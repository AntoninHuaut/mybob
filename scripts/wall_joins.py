"""Liste les abouts de murs qu'aucun autre mur ne couvre.

Un about de mur doit rejoindre un autre mur (ou un mur extérieur sur le
contour) ; un about libre est un raccord manquant ou une cloison héritée
qui flotte. C'est ce contrôle qui a révélé une cloison de cage d'escalier
posée au-delà du plancher du niveau, invisible pour l'audit de l'époque.

Seule la géométrie des murs est lue : ce n'est ni une preuve de fidélité au
plan, ni un diagnostic de pièce.

Usage :
  python scripts/wall_joins.py <projet.json> <niveau>
  python scripts/wall_joins.py --self-test
"""

import json
import sys


def rect(wall):
    (ax, az), (bx, bz) = wall["start"], wall["end"]
    dx, dz = bx - ax, bz - az
    length = (dx * dx + dz * dz) ** 0.5
    if length == 0:
        return None
    ux, uz = dx / length, dz / length
    nx, nz = -uz, ux
    half = wall["thickness"] / 2
    return [
        (ax + nx * half, az + nz * half),
        (bx + nx * half, bz + nz * half),
        (bx - nx * half, bz - nz * half),
        (ax - nx * half, az - nz * half),
    ]


def inside(pts, x, z, eps=1e-9):
    sign = 0
    n = len(pts)
    for i in range(n):
        ax, az = pts[i]
        bx, bz = pts[(i + 1) % n]
        cross = (bx - ax) * (z - az) - (bz - az) * (x - ax)
        if abs(cross) < eps:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            return False
    return True


def report(project, level_id):
    """Imprime les abouts non couverts du niveau et renvoie leur nombre."""
    level = next((lv for lv in project["levels"] if lv["id"] == level_id), None)
    if level is None:
        sys.exit(
            f"niveau {level_id!r} inconnu : " + ", ".join(lv["id"] for lv in project["levels"])
        )
    rects = [(w["id"], rect(w)) for w in level["walls"]]
    rects = [(wid, pts) for wid, pts in rects if pts]

    bare = 0
    for wall in level["walls"]:
        for label, (x, z) in (("start", wall["start"]), ("end", wall["end"])):
            covered = [wid for wid, pts in rects if wid != wall["id"] and inside(pts, x, z)]
            if not covered:
                bare += 1
                print(f"{wall['id']}.{label} ({x:.3f}, {z:.3f}) non couvert")
    if bare == 0:
        print(f"{level_id} : tous les abouts de murs sont couverts")
    return bare


def self_test():
    """Non-régression sur un projet synthétique : aucune donnée réelle."""
    open_loop = {
        "levels": [
            {
                "id": "l",
                "walls": [
                    {"id": "a", "start": [0, 0], "end": [2, 0], "thickness": 0.1},
                    {"id": "b", "start": [2, 0], "end": [2, 2], "thickness": 0.1},
                ],
            }
        ]
    }
    # Un angle ouvert laisse libres ses deux extrémités : c'est le cas normal.
    if report(open_loop, "l") != 2:
        print("ECHEC un angle ouvert doit laisser deux abouts libres")
        return 1
    closed = {
        "levels": [
            {
                "id": "l",
                "walls": [
                    {"id": "a", "start": [0, 0], "end": [2, 0], "thickness": 0.1},
                    {"id": "b", "start": [2, 0], "end": [2, 2], "thickness": 0.1},
                    {"id": "c", "start": [2, 2], "end": [0, 2], "thickness": 0.1},
                    {"id": "d", "start": [0, 2], "end": [0, 0], "thickness": 0.1},
                ],
            }
        ]
    }
    if report(closed, "l") != 0:
        print("ECHEC le contour fermé doit couvrir tous ses abouts")
        return 1
    floating = {
        "levels": [
            {
                "id": "l",
                "walls": [
                    {"id": "a", "start": [0, 0], "end": [2, 0], "thickness": 0.1},
                    {"id": "e", "start": [3, 0], "end": [5, 0], "thickness": 0.1},
                ],
            }
        ]
    }
    if report(floating, "l") != 4:
        print("ECHEC la cloison isolée doit laisser quatre abouts libres")
        return 1
    print("about de murs : auto-test réussi")
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if "--self-test" in argv:
        return self_test()
    if len(argv) < 2:
        sys.exit(__doc__)
    project = json.loads(open(argv[0], encoding="utf-8-sig").read())
    return report(project, argv[1])


sys.exit(main())
