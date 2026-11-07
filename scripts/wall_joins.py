"""Liste les abouts de murs qu'aucun autre mur ne couvre.

Un about de mur doit rejoindre un autre mur (ou un mur extérieur sur le
contour) ; un about libre est un raccord manquant ou une cloison héritée
qui flotte. C'est ce contrôle qui a révélé une cloison de cage d'escalier
posée au-delà du plancher du niveau, invisible pour l'audit de l'époque.

Seule la géométrie des murs est lue : ce n'est ni une preuve de fidélité au
plan, ni un diagnostic de pièce.

Usage :
  python scripts/wall_joins.py <projet.json> <niveau>
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


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    project = json.loads(open(sys.argv[1], encoding="utf-8-sig").read())
    level_id = sys.argv[2]
    level = next((lv for lv in project["levels"] if lv["id"] == level_id), None)
    if level is None:
        sys.exit(f"niveau {level_id!r} inconnu : {', '.join(lv['id'] for lv in project['levels'])}")
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


main()
