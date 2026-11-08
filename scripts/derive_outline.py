"""Layer 3: level outline deduced from the closed dimension chains.

The level outline is derived from the evidence registry instead of being written
by hand, rule by rule — a script measures, it does not decide:

1. **Extents** — per axis, maximum total of the closed chains, cross-checked as
   much as possible (several agreeing chains) or compared with the envelope read
   by `extract_plan.py` (`--plan`). A closed chain whose total does not equal the
   extent is DISCARDED and reported: it describes the building's interior, not its
   envelope (the 7.82 of an interior depth does not replace the 8.50 of a
   footprint).
2. **Cuts** — inner cumulative positions of the anchored chains, in both reading
   directions (base on the low or the high edge of the extent).
3. **Ink** (with `--pdf`) — each cut is looked for on the rendered page: a dark
   band, as thick as an exterior wall and set against the façade face, on each side
   of the cut. A cut where that presence **jumps** is a shoulder of the outline; a
   cut where it does not jump describes the interior (bedroom, partition, opening
   reveal) and is not tried. The rectangle is only kept if no cut jumps.
4. **Closure** — every outline edge must be reproduced by a contiguous sequence of
   an anchored chain (tolerance 0.015 m) or be a **filled depth**: wall thickness
   read in centimetres at the same place, or a printed sequence covering it. A
   depth with neither dimension nor thickness is refused.
5. **Judgement** — the edges of the kept outline must exist in ink (a wall face,
   band as support), and a façade notch is confirmed by a perpendicular sweep: the
   depth where the envelope jumps must confirm the filled depth, otherwise the
   candidate is refused.

If several outlines survive, the script lists them instead of deciding: what
remains a judgement is said, never guessed.

Usage:
  python scripts/derive_outline.py <registry.json> <output.json> [--pages 13] \
      [--pdf plan.pdf] [--plan plan.json]
  python scripts/derive_outline.py --self-test

Without `--pdf`, the registry + closure layers run alone: the rectangle and the four
reading directions of the notches are tried, and the result — if it is not unique —
is reported as a judgement to make, never settled by the script.
"""
import argparse
import json
import sys
from pathlib import Path

TOL = 0.015  # m, pairing of a printed sequence with an edge
EXTENT_TOL = 0.05  # m, cross-check with the extract_plan.py envelope
SUPPORT_MIN = 0.4  # fraction of an edge that must exist in ink
PROBE_STEP = 0.5  # m, sampling step along an edge
PROBE_MARGIN = 0.15  # m, distance from the ends before probing an edge
JUMP_OFFSETS = (0.15, 0.30, 0.45)  # m, measuring distances around a cut
INK_FLOOR = 0.15  # an edge must hold some wall in ink, openings aside
FACE_TOL_OUT, FACE_TOL_IN = 0.12, 0.08  # m, maximum gap from the face to the façade line
WALL_BAND_MIN, WALL_BAND_MAX = 0.15, 0.75  # m, thickness of a wall band
OUT_MARGIN = 0.15  # m, the probe starts just outside the façade line
IN_MARGIN = 0.55  # m, and crosses the possible wall thickness
DEPTH_MEASURE_TOL = 0.05  # m, accepted gap between sweep and depth
THICKNESS_MIN, THICKNESS_MAX = 0.12, 0.45  # m, cm dimension a thickness carries
SOLID_MIN = 0.45  # m, minimum length of the stroke carrying a wall face
SOLID_WINDOW = 0.6  # m, half-window for reading the stroke along the façade
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
    """Every printed contiguous sequence of the chain, once fitted."""
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
    """Extents per axis, anchored chains, cuts, sequences, discarded chains."""
    selected = [page for page in registry["pages"] if pages is None or page["index"] in pages]
    if not selected:
        raise SystemExit(f"no page {pages} in the registry")
    chains = [chain for page in selected for chain in page["chains"]]
    axes = {}
    for axis, name in (("x", "horizontal"), ("z", "vertical")):
        closed = [chain for chain in chains if chain["axis"] == name and chain["closed"]]
        if not closed:
            raise SystemExit(f"axis {axis}: no closed chain, outline cannot be derived")
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
                    f"total {chain['sum']:.2f} m does not equal the extent {extent:.2f} m: "
                    "chain discarded (it describes the interior, not the envelope)"
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
                    f"axis {axis}: extent {extent:.2f} m contradicted by the extracted "
                    f"envelope {expected:.2f} m"
                )
        if len(running) < 2 and not (cross and cross["ok"]):
            raise SystemExit(
                f"axis {axis}: a single chain carries {extent:.2f} m without a cross-check "
                "(no second agreeing chain, no --plan): extent not proven"
            )
        anchored = sorted(running, key=lambda chain: (chain["page"], chain["perpendicular"]))
        for chain in anchored:
            if chain_ppm(chain) is None:
                raise SystemExit("anchored chain without a printed scale")
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
    """Point origins of each axis and scale, from the first anchored chain."""
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
    """Centimetre dimensions of the registry, positioned in the world frame."""
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
# Candidates: rectangle, corner notch, façade notch
# ---------------------------------------------------------------------------


def edges_of(vertices, roles=None):
    """Edges of a closed rectilinear polygon, with their inward normal.

    Vertices are in traversal order (north then east then south…); the inward
    normal is (−dz, +dx) for that direction. `roles` marks the notch flanks, whose
    depth will be filled at closure.
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
    """Corner notch: the quadrant x≺x* and z≺z* is taken out of the outline."""
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
    """Façade notch: [a, b] taken out of the outline, depth towards the inside."""
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
    """Following vertices, rounded to the plan's centimetre."""
    return [[round(point[0], 2), round(point[1], 2)] for point in vertices]


def load_outline(path):
    """Derived outline, read from this script's output.

    An ambiguous outline is not an outline: the file must carry a single one,
    otherwise the next layer refuses to build on a judgement the script did not
    make. It is the repository rule — a script measures, it does not decide —
    applied at the boundary between layer 3 and layer 2.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    outline = payload.get("outline")
    if not outline:
        pending = payload.get("candidates") or []
        raise SystemExit(
            f"{path}: no unique outline — {len(pending)} candidate(s) remain to be "
            "decided, construction does not start on a guessed outline"
        )
    return [[round(float(point[0]), 4), round(float(point[1]), 4)] for point in outline]


# ---------------------------------------------------------------------------
# Closure: printed sequences or filled depth
# ---------------------------------------------------------------------------


def run_depths(axes, side):
    """Printed depths: sequences of the depth axis, fitted to the façade line."""
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
    """Thicknesses read in centimetres, close to the notch and oriented like it."""
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
    """Closure: every edge printed or depth filled."""
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
                            f"depth filled by the thickness {source['value']:.2f} m "
                            f"read in centimetres (« {source['text']} »)"
                        ),
                        "length": candidate["depth"],
                    }
                )
                continue
            return None, {
                "reason": (
                    f"edge {item['axis']}@{item['at']:.2f} [{item['low']:.2f},{item['high']:.2f}]: "
                    "depth with neither dimension nor thickness"
                )
            }
        return None, {
            "reason": (
                f"edge {item['axis']}@{item['at']:.2f} [{item['low']:.2f},{item['high']:.2f}]: "
                "no printed sequence reproduces it"
            )
        }
    return {"edges": proof}, None


# ---------------------------------------------------------------------------
# Ink: wall bands of the rendered page
# ---------------------------------------------------------------------------


class Ink:
    """Dark bands of the rendered page, in the world frame.

    An exterior wall is drawn as face strokes plus hatching; by merging nearby runs
    (0.26 m), it becomes a band as thick as the wall, set against the façade line
    and facing the inside of the outline. A dimension stroke, a threshold or a leaf
    only measure a few centimetres: below 15 cm, a band is not a wall.
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
        """Merged dark runs, in metres from the start of the segment."""
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
        """Length of the continuous stroke passing through (x, z), along `along`.

        A wall face is a **solid** stroke. A dash-dot line — height limit, upper
        floor edge, roof overhang — is drawn in dashes of a few centimetres: taking
        it for a face puts a façade where the plan carries none. On plan B, the
        south façade is drawn dashed in line with the entrance notch, and the
        perpendicular probe read a continuous wall there.

        The probe tries the exact point then two one-pixel offsets on each side: a
        face stroke rarely falls exactly on the coordinate deduced from the
        dimensions.
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
        """Wall whose outer face is set at the façade line (x, z), facing inwards.

        Returns (gap from the face to the façade line, thickness read) if a wall is
        there, None otherwise. A wall is only recognised as a band: face on the line,
        **solid stroke**, and wall thickness once strokes are merged.
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
        """Presence of the wall at façade line `nu`, side `side`, at position q."""
        if side in ("north", "south"):
            inward = (0.0, 1.0 if side == "north" else -1.0)
            return self.wall_at(q, nu, inward)
        inward = (1.0 if side == "west" else -1.0, 0.0)
        return self.wall_at(nu, q, inward)

    def edge_support(self, item, credits=None):
        """Fraction of an edge where a wall has its face on the façade line.

        Returns (ink, openings): the fraction of probes where a wall holds the
        edge, and the fraction of the remaining probes a printed opening explains —
        a window or a door interrupts the face stroke, and the plan says so: an
        open chain segment, or an opening dimension set against the wall. The edge
        must hold some wall by itself: an opening explains a gap, it does not
        replace a wall.
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
    """Cuts classified by the ink: a shoulder where presence jumps.

    For each candidate cut and each façade containing it, the wall's presence is
    measured on either side, at three distances: a probe line sometimes falls
    between two hatch strokes of the same wall, and a single reading would turn an
    absence of reading into an absence of wall — the majority vote per series of
    probes is what tells the two apart. A cut is only kept if presence jumps: it is
    a shoulder of the outline, and the direction of the jump prescribes the
    notch's quadrant or its façade notch — the chain's reading direction is no
    longer an unknown.
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
                        "candidate": f"cut {value:.2f} on {side}",
                        "reason": "no wall on either side: neither shoulder nor façade",
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
    """Nearby shoulders merged: several chains measure the same one.

    Two chains often read the same shoulder a few centimetres apart, in opposite
    reading directions; their cuts stay distinct registry values. One presence jump
    per side and per direction is kept, at the median of the values carrying it.
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
    """Notch quadrant prescribed by two consistent jumps.

    The x jump says which side the absence extends to (« after »: the wall lives
    beyond the cut, the absence is before it); the z jump, likewise. A corner only
    exists if the two jumps answer each other: the absence based on the south
    façade cuts it, so the jump must have shown there — a z jump measured on the
    east side, hidden behind a window, says nothing about the south-west corner.
    """
    if x_jump["presence"] == "after":
        absent_x, side_x = "min", "min"
    else:
        absent_x, side_x = "max", "max"
    if z_jump["presence"] == "after":
        absent_z, side_z = "min", "min"
    else:
        absent_z, side_z = "max", "max"
    # the x jump's absence must join the façade measured by the z jump
    if side_z == "max" and not (absent_z == "max"):
        pass
    return absent_x, absent_z, side_x, side_z


QUADRANT_KEYS = {
    # (absent_x, absent_z) -> builder flags (dx_minus, dz_minus)
    ("min", "min"): (False, False),
    ("max", "min"): (False, True),
    ("min", "max"): (True, False),
    ("max", "max"): (True, True),
}
JUMP_SIDES = {
    # (absent_z, absent_x) -> the façade where each jump must have shown
    ("max", "min"): ("south", "west"),
    ("min", "min"): ("north", "west"),
    ("max", "max"): ("south", "east"),
    ("min", "max"): ("north", "east"),
}


def enumerate_from_jumps(axes, jumps, thicknesses):
    """Outlines prescribed by the validated shoulders.

    A corner notch comes from an x jump and a z jump that **answer** each other:
    the absence they measure must join the façade where the other jump showed —
    the corner (x<x*, z>z*) cuts the south and west façades, and nothing else. A
    façade notch comes from two jumps on the same façade with the absence between
    them. The rectangle is only kept if no jump exists anywhere.
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
            # the absence must lie between the two shoulders
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
    """Without a rendered page: rectangle, four quadrants and filled depths."""
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
    """Perpendicular sweep at the middle of the notch: where the envelope jumps.

    The probe starts just outside the façade line and crosses inwards over 75 cm.
    The first band as thick as a wall is the envelope: the distance from its face
    to the façade line is the notch's real depth. Thresholds and dimension strokes,
    too thin, do not interrupt it.
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
    """Printed openings, per axis: open chains and opening dimensions.

    The plan interrupts a façade's face stroke at every opening, and it prints it:
    a chain segment « 1.40/1.05 », an isolated dimension « 0.90/2.15 » set against
    the wall. These intervals credit the absence of stroke in ink — without them, a
    window would break a façade.
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
# Run
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
                                f"edge {item['axis']}@{item['at']:.2f} "
                                f"[{item['low']:.2f},{item['high']:.2f}] without a wall in ink "
                                f"(wall {fractions['ink']:.0%}, openings {fractions['openings']:.0%})"
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
                                "ink sweep without an envelope under the notch"
                                if measure is None
                                else (
                                    f"depth {entry['candidate']['depth']:.2f} m contradicted "
                                    f"by the ink sweep ({measure:.2f} m)"
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
    """Non-regression of the five layers on synthetic fixtures.

    The fixtures replay two patterns found on real plans — plan A's corner notch
    and plan B's façade notch — on a synthetic footprint: no real data enters the
    repository. The ink layer's PDF is drawn on the fly, so that the test also
    covers the rejection of a dash-dot line.
    """
    failures = []
    failures += _self_test_corner()
    failures += _self_test_facade()
    failures += _self_test_refusals()
    failures += _self_test_ink()
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("derived outline: self-test passed")
    return 0


def _fixture(name):
    return json.loads((FIXTURE / name).read_text(encoding="utf-8"))


def _self_test_corner():
    """Corner notch: cross-checked extents, discarded chain, ambiguous outline."""
    failures = []
    registry = _fixture("registry-corner.json")
    result = derive(registry, [1])
    axes = result["axes"]
    if not close(axes["x"]["extent"], 10.0) or not close(axes["z"]["extent"], 8.0):
        failures.append(
            f"extents {axes['x']['extent']:.2f} x {axes['z']['extent']:.2f} instead of 10.00 x 8.00"
        )
    discarded = axes["x"]["discarded"] + axes["z"]["discarded"]
    if len(discarded) != 1 or not close(discarded[0]["sum"], 7.6):
        failures.append(f"discarded chain {discarded} instead of the single 7.60 m chain")
    if not result["ambiguous"]:
        failures.append("without a rendered page, four quadrants stay possible: the script decided")
    wanted = [[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [4.0, 8.0], [4.0, 5.0], [0.0, 5.0]]
    outlines = [outline_of(entry["candidate"]["vertices"]) for entry in result["candidates"]]
    if wanted not in outlines:
        failures.append(f"the quadrant (x<4, z>5) is missing from the {len(outlines)} closed outline(s)")
    return failures


def _self_test_facade():
    """Façade notch: depth deduced from a dimension in centimetres."""
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
            f"the 3.00..5.00 façade notch 0.35 m deep is missing from the "
            f"{len(result['candidates'])} closed outline(s)"
        )
        return failures
    entry = found[0]
    if entry["candidate"]["depthSource"] != "thickness":
        failures.append(f"depth attributed to {entry['candidate']['depthSource']}")
    depth_edges = [item for item in entry["proof"]["edges"] if item["class"] == "derived"]
    if len(depth_edges) != 2:
        failures.append(
            f"{len(depth_edges)} derived edge(s) instead of the notch's two flanks"
        )
    if any(item["class"] == "printed" for item in entry["proof"]["edges"] if "profondeur" in item.get("note", "")):
        failures.append("an undimensioned depth was declared printed")
    return failures


def _self_test_refusals():
    """An extent that is not cross-checked, or contradicted by the envelope, is not derived."""
    failures = []
    registry = _fixture("registry-unproven.json")
    try:
        derive(registry, [1])
        failures.append("an extent carried by a single chain was accepted")
    except SystemExit as error:
        if "not proven" not in str(error):
            failures.append(f"unexpected refusal on the non-cross-checked extent: {error}")
    try:
        derive(_fixture("registry-corner.json"), [1], plan_envelope=[10.0, 9.0])
        failures.append("an extent contradicted by the extracted envelope was accepted")
    except SystemExit as error:
        if "contradicted" not in str(error):
            failures.append(f"unexpected refusal on the contradicted extent: {error}")
    return failures


def _self_test_ink():
    """Ink layer: the outline is derived from the drawing, a dash-dot line does not make a wall."""
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
    # A dash-dot line on the south façade line, where the outline has no wall,
    # doubled by a solid stroke just behind: without rejecting the dash-dot, the
    # perpendicular probe would read a 20 cm wall there.
    for step in range(0, 40):
        low = 0.0 + step * 0.10
        page.draw_line(point(low, 8.0), point(low + 0.06, 8.0), color=(0.0, 0.0, 0.0), width=1)
    page.draw_line(point(0.0, 7.80), point(4.0, 7.80), color=(0.0, 0.0, 0.0), width=1)

    path = str(Path(tempfile.mkdtemp()) / "self-test-outline.pdf")
    document.save(path)
    result = derive(_fixture("registry-corner.json"), [1], None, path)
    if result["ambiguous"]:
        failures.append(
            f"{len(result['candidates'])} outline(s) kept with the rendered page instead of one"
        )
        return failures
    produced = outline_of(result["candidates"][0]["candidate"]["vertices"])
    if produced != outline:
        failures.append(f"derived outline {produced} instead of {outline}")
    ink = Ink(path, 1, result["origins"], 40.0)
    if ink.wall_at(2.0, 8.0, (0.0, -1.0)) is not None:
        failures.append("a dash-dot line on the façade line was read as a wall")
    if ink.wall_at(2.0, 5.0, (0.0, -1.0)) is None:
        failures.append("the notch wall, drawn solid, was not read")
    return failures


def main(argv):
    if "--self-test" in argv:
        return self_test()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry")
    parser.add_argument("out")
    parser.add_argument("--pages", default=None, help="registry pages, e.g. 8 or 13,14")
    parser.add_argument("--pdf", default=None, help="rendered page for the ink classifier")
    parser.add_argument(
        "--plan", default=None, help="output of extract_plan.py, to cross-check the extents"
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
            f"axis {axis}: extent {extent:.2f} m, "
            f"{len(axes[axis]['anchored'])} anchored chain(s), "
            f"{len(axes[axis]['cuts'])} cut(s), {len(axes[axis]['runs'])} sequence(s)"
        )
        for item in axes[axis]["discarded"]:
            print(f"  discarded: {item['reason']}")
    if unique:
        outline = payload["outline"]
        print("derived outline: " + " ".join(f"[{x},{z}]" for x, z in outline))
        entry = result["candidates"][0]
        notch = entry["candidate"].get("notch")
        if notch and notch["kind"] == "facade":
            derived = next((item for item in payload["edges"] if item["class"] == "derived"), None)
            claim = "DEDUCED from a printed thickness, not read" if derived else "printed"
            print(
                f"  notch {notch['a']:.2f}..{notch['b']:.2f} on {notch['side']}, "
                f"depth {entry['candidate']['depth']:.2f} m {claim}"
            )
    else:
        print(f"{len(result['candidates'])} closed outline(s) — still to decide:")
        for identifier in payload["candidates"]:
            print(f"  {identifier}")
    print(f"{len(result['refusals'])} refused candidate(s) -> {args.out}")
    return 0 if unique else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
