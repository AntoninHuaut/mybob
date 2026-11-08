"""Lists the wall ends no other wall covers.

A wall end must join another wall (or an exterior wall on the outline); a free
end is a missing junction or an inherited partition that floats. This check is
what revealed a stairwell partition placed beyond the level's floor, invisible
to the audit of the time.

Only wall geometry is read: it is neither a proof of fidelity to the plan, nor
a room diagnosis.

Usage:
  python scripts/wall_joins.py <project.json> <level>
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
    """Prints the level's uncovered ends and returns their count."""
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
                print(f"{wall['id']}.{label} ({x:.3f}, {z:.3f}) not covered")
    if bare == 0:
        print(f"{level_id}: every wall end is covered")
    return bare


def self_test():
    """Non-regression on a synthetic project: no real data."""
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
    # An open corner leaves both its ends free: that is the normal case.
    if report(open_loop, "l") != 2:
        print("FAIL an open corner must leave two free ends")
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
        print("FAIL the closed outline must cover all its ends")
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
        print("FAIL the isolated partition must leave four free ends")
        return 1
    print("wall ends: self-test passed")
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
