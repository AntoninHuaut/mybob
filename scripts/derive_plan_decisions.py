"""Couche 2 : squelette de décisions dérivé d'un projet et d'un registre.

Chaque face de mur et chaque ouverture reçoit une décision. Une preuve n'est
déclarée `printed` que si une suite contiguë de segments imprimés reproduit la
longueur (ou la largeur et la hauteur) à un centimètre près, qu'un seul
candidat existe et que la chaîne se referme. Sinon la décision reste
`unresolved` avec son motif : c'est au releveur de trancher, pas à ce script.

Usage :
  uvx --from pymupdf python scripts/derive_plan_decisions.py <projet.json> <registre.json> <niveau> <sortie.json>
"""
import json
import math
import re
import sys

TOL = 0.01  # m, tolérance d'appariement
OPENING_TEXT = re.compile(r"^(\d+(?:[.,]\d+)?)/(\d+(?:[.,]\d+)?)$")


def metres(token):
    return float(token.replace(",", ".")) if re.search(r"[.,]", token) else float(token) / 100


def sub_sums(chain):
    """Toutes les sommes de segments contigus, avec leurs bornes."""
    segments = chain["segments"]
    for start in range(len(segments)):
        total = 0.0
        for end in range(start, len(segments)):
            total += segments[end]["value"]
            yield start, end, total


def chain_ref(chain):
    return {"page": chain["page"], "axis": chain["axis"], "perpendicular": chain["perpendicular"]}


def match_length(chains, length, axis):
    """Chaînes refermées dont une suite contiguë reproduit `length` sur l'axe donné."""
    found = []
    for chain in chains:
        if chain["axis"] != axis or not chain["closed"]:
            continue
        for start, end, total in sub_sums(chain):
            if abs(total - length) <= TOL:
                found.append((chain, start, end, total))
    return found


def match_opening(chains, opening):
    """Segments de baie dont la largeur et la hauteur imprimées concordent."""
    found = []
    for chain in chains:
        if not chain["closed"]:
            continue
        for index, segment in enumerate(chain["segments"]):
            if segment["kind"] != "opening":
                continue
            parsed = OPENING_TEXT.match(segment["text"])
            if not parsed:
                continue
            width, height = metres(parsed.group(1)), metres(parsed.group(2))
            if abs(width - opening["width"]) <= TOL and abs(height - opening["height"]) <= TOL:
                found.append((chain, index, width, height))
    return found


def face_decision(wall, chains):
    length = math.dist(wall["start"], wall["end"])
    axis = "horizontal" if abs(wall["end"][0] - wall["start"][0]) >= abs(wall["end"][1] - wall["start"][1]) else "vertical"
    matches = match_length(chains, length, axis)
    if len(matches) == 1:
        chain, start, end, total = matches[0]
        return {
            "id": wall["id"],
            "wall": wall["id"],
            "evidence": {
                "class": "printed",
                "chain": chain_ref(chain),
                "segmentIndex": start,
                "cumulativeOffset": round(sum(s["value"] for s in chain["segments"][:start]), 4),
                "note": f"longueur {length:.3f} m = segments {start}..{end} ({total:.3f} m) de la chaîne",
            },
            "unresolved": False,
        }
    reason = (
        f"aucune suite imprimée ne reproduit {length:.3f} m"
        if not matches
        else f"{len(matches)} suites imprimées reproduisent {length:.3f} m"
    )
    return {
        "id": wall["id"],
        "wall": wall["id"],
        "evidence": {"class": "scaled", "note": f"longueur mesurée {length:.3f} m, axe {axis}"},
        "unresolved": True,
        "reason": reason,
    }


def opening_decision(opening, wall, chains):
    matches = match_opening(chains, opening)
    if len(matches) == 1:
        chain, index, width, height = matches[0]
        printed = round(sum(s["value"] for s in chain["segments"][:index]), 4)
        evidence = {
            "class": "printed",
            "chain": chain_ref(chain),
            "segmentIndex": index,
            "cumulativeOffset": printed,
            "note": f"largeur {width:.2f} m et hauteur {height:.2f} m imprimées",
        }
        # Le repère imprimé tombe sur l'offset du projet : le mur démarre à l'origine de la chaîne.
        if abs(printed - opening["offset"]) <= TOL:
            evidence["wallOrigin"] = 0.0
            evidence["note"] += " ; repère confondu avec l'origine du mur"
        return {"id": opening["id"], "wall": wall["id"], "evidence": evidence, "unresolved": False}
    reason = (
        f"aucune cote de baie {opening['width']:.2f}/{opening['height']:.2f} m sur le plan"
        if not matches
        else f"{len(matches)} cotes de baie concordent"
    )
    return {
        "id": opening["id"],
        "wall": wall["id"],
        "evidence": {"class": "scaled", "note": f"largeur {opening['width']:.2f} m, hauteur {opening['height']:.2f} m"},
        "unresolved": True,
        "reason": reason,
    }


def main(argv):
    if len(argv) < 5:
        print(__doc__)
        return 2
    project_path, registry_path, level_id, out = argv[1:5]
    project = json.load(open(project_path, encoding="utf-8"))
    registry = json.load(open(registry_path, encoding="utf-8"))
    level = next((candidate for candidate in project["levels"] if candidate["id"] == level_id), None)
    if level is None:
        raise SystemExit(f"niveau {level_id} absent de {project_path}")
    chains = [chain for page in registry["pages"] for chain in page["chains"]]
    faces = [face_decision(wall, chains) for wall in level["walls"]]
    openings = [
        opening_decision(opening, wall, chains) for wall in level["walls"] for opening in wall.get("openings", [])
    ]
    decisions = {
        "schemaVersion": 1,
        "project": project["id"],
        "level": level_id,
        "registry": registry_path.replace("\\", "/"),
        "faces": faces,
        "openings": openings,
    }
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(decisions, handle, ensure_ascii=False, indent=2)
    proven = sum(1 for decision in faces + openings if not decision["unresolved"])
    total = len(faces) + len(openings)
    print(f"{len(faces)} faces, {len(openings)} ouvertures : {proven} prouvées, {total - proven} à trancher")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
