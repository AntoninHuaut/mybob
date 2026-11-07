"""Couche 1 : registre d'évidence extrait d'un PDF de plans.

Extraction déterministe, sans interprétation : pages, étiquettes classées
(cotes, baies, allèges, surfaces, niveaux, pentes, niveaux nommés et côtés de
parcelle des plans de masse), table des surfaces et chaînes de cotes avec leur
résidu de fermeture et l'échelle déduite.

Usage :
  uvx --from pymupdf python scripts/extract_plan_evidence.py <pdf> <sortie.json> [--pages 13,14] [--skip-vectors]

Le registre contient des données de plan réelles : l'écrire dans un dossier
ignoré (`reference-documents/`, `artifacts/plan-review/`). Ce script ne décide
d'aucune géométrie : il expose ce qui est imprimé, et ce qui ne se referme pas.
"""
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path

import pymupdf

CHAIN_TOL = 2.5  # pt, écart perpendiculaire max entre étiquettes d'une même chaîne
TOTAL_TOL = 30.0  # pt, écart perpendiculaire max entre une chaîne et sa cote totale
CLOSE_TOL = 0.005  # m, résidu de fermeture accepté (arrondi au cm)
PAIR_TOL = 3.0  # pt, appariement libellé/valeur dans une table de surfaces
CONTIGUITY_TOL = 3.0  # pt, écart accepté entre centres de segments contigus

LINEAR = re.compile(r"^(\d+[.,]\d{1,3})$")
CENTIMETRES = re.compile(r"^(\d{1,3})$")
OPENING = re.compile(r"^(\d+(?:[.,]\d+)?)/(\d+(?:[.,]\d+)?)$")
SILL = re.compile(r"^All\s*:\s*(\d+[.,]\d+)\s*m$", re.I)
ROOM = re.compile(r"^(SH|SU|SA)\s*:\s*(\d+[.,]\d+)\s*m\s*[²2]$", re.I)
LEVEL = re.compile(r"^([±+-])\s*(\d+[.,]\d{1,3})$")
SLOPE = re.compile(r"^PENTE\s*=\s*(\d+[.,]\d+)\s*°$", re.I)
SCALE = re.compile(r"^Echelle\s*:\s*1/(\d+)$", re.I)
DATE = re.compile(r"^Date\s*:\s*(\d{2}/\d{2}/\d{4})$", re.I)
NUMBER = re.compile(r"^n°\s*(\S+)$")
SURFACE_VALUE = re.compile(r"^(\d+[.,]\d+)\s*m\s*[²2]$", re.I)
NAMED_LEVEL = re.compile(r"^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{0,30}?)\s*:\s*([±+\-−]?\d+[.,]\d{1,3})$")
PARCEL_SIDE = re.compile(r"^-\s*(\d+[.,]\d{1,3})\s*m\s*-$", re.I)
PARCEL_AREA = re.compile(r"^Surface\s*:\s*(\d+(?:[.,]\d+)?)\s*m\s*[²2]$", re.I)
RECT_AREA = re.compile(
    r"^([^0-9]{1,40}?)([0-9]+(?:[.,][0-9]{1,3})?)\s*m?\s*[xX]\s*([0-9]+(?:[.,][0-9]{1,3})?)\s*m"
)
SECTION = re.compile(r"^SURFACES?\s+.+$", re.I)
TOTAL_LABEL = re.compile(r"^total\b", re.I)
TOTAL_LINE = re.compile(r"^(TOTAL\s+.+?)\s+(\d+[.,]\d+)\s*m\s*[²2]$", re.I)


def metres(token):
    """Une cote sans séparateur décimal est imprimée en centimètres."""
    return float(token.replace(",", ".")) if re.search(r"[.,]", token) else float(token) / 100


def display_transform(page):
    """Coordonnées et directions de texte ramenées au repère affiché (cf. /Rotate)."""
    box, rot = page.mediabox, page.rotation
    if rot == 90:
        return (lambda x, y: (box.height - y, x)), (lambda dx, dy: (-dy, dx))
    if rot == 270:
        return (lambda x, y: (y, box.width - x)), (lambda dx, dy: (dy, -dx))
    return (lambda x, y: (x, y)), (lambda dx, dy: (dx, dy))


def iter_lines(page):
    to_point, to_dir = display_transform(page)
    lines = []
    for block in page.get_text("dict")["blocks"]:
        if block["type"] != 0:
            continue
        for line in block["lines"]:
            text = "".join(span["text"] for span in line["spans"]).strip()
            if not text:
                continue
            x0, y0 = to_point(line["bbox"][0], line["bbox"][1])
            x1, y1 = to_point(line["bbox"][2], line["bbox"][3])
            dx, dy = to_dir(*line["dir"])
            lines.append(
                {
                    "text": text,
                    "at": [round((x0 + x1) / 2, 2), round((y0 + y1) / 2, 2)],
                    "dir": [round(dx, 3), round(dy, 3)],
                    "size": round(max(span["size"] for span in line["spans"]), 2),
                    "horizontal": abs(dx) >= abs(dy),
                }
            )
    return lines


def classify(line):
    """Classe une ligne de texte. Retourne (genre, charge) ou None."""
    text = line["text"]
    if match := LINEAR.match(text):
        return "linear", {"value": metres(match.group(1))}
    if match := OPENING.match(text):
        return "opening", {"width": metres(match.group(1)), "height": metres(match.group(2))}
    if match := SILL.match(text):
        return "sill", {"value": metres(match.group(1))}
    if match := ROOM.match(text):
        return "room", {"surface": match.group(1).upper(), "area": metres(match.group(2))}
    if match := LEVEL.match(text):
        sign = -1.0 if match.group(1) in "-−" else 1.0
        return "level", {"value": sign * metres(match.group(2))}
    if match := SLOPE.match(text):
        return "slope", {"degrees": metres(match.group(1))}
    if match := SCALE.match(text):
        return "scale", {"denominator": int(match.group(1))}
    if match := DATE.match(text):
        return "date", {"value": match.group(1)}
    if match := NUMBER.match(text):
        return "drawingNumber", {"value": match.group(1)}
    if match := CENTIMETRES.match(text):
        return "centimetres", {"value": metres(match.group(1))}
    # Libellés du plan de masse : niveaux nommés, côtés de parcelle, surface
    # cadastrale et surfaces rectangulaires cotées dans une phrase. Lecture
    # littérale : rien ici ne dit à quel objet s'applique la valeur.
    if match := NAMED_LEVEL.match(text):
        return "namedLevel", {
            "name": match.group(1).strip(),
            "value": float(match.group(2).replace(",", ".")),
        }
    if match := PARCEL_SIDE.match(text):
        return "parcelSide", {"value": float(match.group(1).replace(",", "."))}
    if match := PARCEL_AREA.match(text):
        return "parcelArea", {"area": float(match.group(1).replace(",", "."))}
    if match := RECT_AREA.match(text):
        return "rectArea", {
            "name": match.group(1).strip(),
            "width": metres(match.group(2)),
            "depth": metres(match.group(3)),
        }
    return None


def segment_value(label):
    if label["kind"] == "opening":
        return label["width"]
    return label["value"]


def cluster_labels(labels):
    """Regroupe les cotes par axe et par ligne de cote (ordonnée perpendiculaire)."""
    items = []
    for label in labels:
        if label["kind"] not in ("linear", "centimetres", "opening"):
            continue
        axis = "horizontal" if label["horizontal"] else "vertical"
        perp = label["at"][1] if axis == "horizontal" else label["at"][0]
        items.append({"axis": axis, "perp": perp, "label": label})
    items.sort(key=lambda item: (item["axis"], item["perp"]))
    clusters = []
    for item in items:
        last = clusters[-1] if clusters else None
        if last and last["axis"] == item["axis"] and abs(last["perp"] - item["perp"]) <= CHAIN_TOL:
            last["items"].append(item)
        else:
            clusters.append({"axis": item["axis"], "perp": item["perp"], "items": [item]})
    return clusters


def contiguous_runs(segments, along, points_per_metre, tolerance=CONTIGUITY_TOL):
    """Découpe une ligne de cotes en suites contiguës à l'échelle imprimée.

    Deux étiquettes voisines sont contiguës si l'écart de leurs centres vaut la
    demi-somme de leurs longueurs. Une épaisseur de mur ou une cote isolée casse
    la suite : elle n'appartient pas à la chaîne.
    """
    runs, current = [], []
    for segment in segments:
        if current:
            previous = current[-1]
            expected = (segment_value(previous["label"]) + segment_value(segment["label"])) / 2 * points_per_metre
            actual = abs(segment["label"]["at"][along] - previous["label"]["at"][along])
            if abs(actual - expected) > tolerance:
                runs.append(current)
                current = []
        current.append(segment)
    if current:
        runs.append(current)
    return runs


def build_chains(labels, page_index, printed_denominator):
    """Chaînes de cotes contiguës, avec résidu de fermeture et échelle déduite."""
    printed = round(2834.6457 / printed_denominator, 2) if printed_denominator else None
    runs = []
    for cluster in cluster_labels(labels):
        along = 0 if cluster["axis"] == "horizontal" else 1
        segments = sorted(cluster["items"], key=lambda item: item["label"]["at"][along])
        if printed is None:
            runs.append((cluster, segments))
            continue
        runs.extend((cluster, run) for run in contiguous_runs(segments, along, printed))
    used = {id(item["label"]) for _, run in runs if len(run) >= 2 for item in run}
    chains, isolated, totals_used = [], [], set()
    for cluster, run in runs:
        if len(run) < 2:
            isolated.extend(item["label"] for item in run)
            continue
        axis = cluster["axis"]
        along = 0 if axis == "horizontal" else 1
        total = sum(segment_value(item["label"]) for item in run)

        def perpendicular(label):
            return label["at"][1] if axis == "horizontal" else label["at"][0]

        # Cote totale : étiquette isolée sur une ligne voisine, de valeur égale à la somme.
        candidates = [
            label
            for label in labels
            if label["kind"] in ("linear", "centimetres")
            and label["horizontal"] == (axis == "horizontal")
            and id(label) not in used
            and abs(perpendicular(label) - cluster["perp"]) <= TOTAL_TOL
            and abs(label["value"] - total) <= CLOSE_TOL
        ]
        candidates.sort(key=lambda label: abs(perpendicular(label) - cluster["perp"]))
        declared = candidates[0] if candidates else None
        if declared:
            totals_used.add(id(declared))
        first, last = run[0]["label"], run[-1]["label"]
        center_span = abs(last["at"][along] - first["at"][along])
        inner = total - (segment_value(first) + segment_value(last)) / 2
        implied = round(center_span / inner, 2) if inner > 0 else None
        chains.append(
            {
                "page": page_index,
                "axis": axis,
                "perpendicular": round(cluster["perp"], 2),
                "segments": [
                    {
                        "text": item["label"]["text"],
                        "kind": item["label"]["kind"],
                        "value": round(segment_value(item["label"]), 4),
                        "at": item["label"]["at"],
                    }
                    for item in run
                ],
                "sum": round(total, 4),
                "declaredTotal": (
                    {"text": declared["text"], "value": round(declared["value"], 4), "at": declared["at"]}
                    if declared
                    else None
                ),
                "residual": round(total - declared["value"], 4) if declared else None,
                "closed": bool(declared) and abs(total - declared["value"]) <= CLOSE_TOL,
                "impliedPointsPerMetre": implied,
                "printedPointsPerMetre": printed,
                "scaleResidual": round(implied - printed, 2) if implied and printed else None,
            }
        )
    chains.sort(key=lambda chain: (chain["axis"], chain["perpendicular"]))
    return chains, isolated, totals_used


def parse_surface_tables(lines, page_index):
    """Tables de surfaces : sections, lignes libellé/valeur, totaux."""
    ordered = sorted(lines, key=lambda line: (line["at"][1], line["at"][0]))
    headers = [line for line in ordered if SECTION.match(line["text"])]
    tables = []
    for index, header in enumerate(headers):
        stop = headers[index + 1]["at"][1] if index + 1 < len(headers) else float("inf")
        band = [
            line
            for line in ordered
            if header["at"][1] < line["at"][1] < stop and line["at"][0] >= header["at"][0] - 80
        ]
        values = [line for line in band if SURFACE_VALUE.match(line["text"])]
        names = [line for line in band if not SURFACE_VALUE.match(line["text"])]
        rows, totals = [], []
        for value in values:
            area = metres(SURFACE_VALUE.match(value["text"]).group(1))
            nearest = min(names, key=lambda name: abs(name["at"][1] - value["at"][1]), default=None)
            label = nearest["text"] if nearest and abs(nearest["at"][1] - value["at"][1]) <= PAIR_TOL else None
            entry = {"label": label, "area": area, "at": value["at"]}
            (totals if label and TOTAL_LABEL.match(label) else rows).append(entry)
        for line in band:
            if match := TOTAL_LINE.match(line["text"]):
                totals.append({"label": match.group(1).strip(), "area": metres(match.group(2)), "at": line["at"]})
        tables.append(
            {
                "page": page_index,
                "section": header["text"],
                "at": header["at"],
                "rows": rows,
                "sum": round(sum(row["area"] for row in rows), 4),
                "totals": totals,
            }
        )
    return tables


def page_record(page, index, skip_vectors):
    lines = iter_lines(page)
    labels = []
    for line in lines:
        classified = classify(line)
        if not classified:
            continue
        kind, payload = classified
        labels.append(
            {"kind": kind, "text": line["text"], "at": line["at"], "horizontal": line["horizontal"], **payload}
        )
    denominator = next((label["denominator"] for label in labels if label["kind"] == "scale"), None)
    chains, isolated, totals_used = build_chains(labels, index, denominator)
    return {
        "index": index,
        "rotation": page.rotation,
        "mediabox": [round(page.mediabox.width, 2), round(page.mediabox.height, 2)],
        "displaySize": [round(page.rect.width, 2), round(page.rect.height, 2)],
        "textLines": len(lines),
        "vectorStrokes": None if skip_vectors else len(page.get_drawings()),
        "cartouche": {
            "scale": f"1/{denominator}" if denominator else None,
            "date": next((label["value"] for label in labels if label["kind"] == "date"), None),
            "drawingNumber": next((label["value"] for label in labels if label["kind"] == "drawingNumber"), None),
            "titleCandidates": sorted(
                {line["text"] for line in lines if line["text"].isupper() and line["size"] >= 8 and len(line["text"]) > 3}
            ),
        },
        "labels": {
            "dimensions": [label for label in labels if label["kind"] in ("linear", "centimetres")],
            "openings": [label for label in labels if label["kind"] == "opening"],
            "sills": [label for label in labels if label["kind"] == "sill"],
            "rooms": [label for label in labels if label["kind"] == "room"],
            "levels": [label for label in labels if label["kind"] == "level"],
            "slopes": [label for label in labels if label["kind"] == "slope"],
            "namedLevels": [label for label in labels if label["kind"] == "namedLevel"],
            "parcelSides": [label for label in labels if label["kind"] == "parcelSide"],
            "parcelAreas": [label for label in labels if label["kind"] == "parcelArea"],
            "rectAreas": [label for label in labels if label["kind"] == "rectArea"],
        },
        "chains": chains,
        "chainTotals": [label for label in isolated if id(label) in totals_used],
        "isolatedDimensions": [
            label for label in isolated if label["kind"] != "centimetres" and id(label) not in totals_used
        ],
        "unassignedCentimetres": [label for label in isolated if label["kind"] == "centimetres"],
        "surfaceTables": parse_surface_tables(lines, index),
    }


def self_test():
    """Non-régression sur un PDF synthétique : aucune donnée réelle."""
    ppm = 2834.6457 / 50  # 1/50 à l'échelle 1:1
    document = pymupdf.open()
    page = document.new_page(width=842, height=595)
    baseline = 200.0
    # Chaîne horizontale 4,00 + 6,00 = 10,00 m, et sa cote totale juste au-dessus.
    page.insert_text((100.0, baseline), "4.00", fontsize=8)
    page.insert_text((100.0 + 5.00 * ppm, baseline), "6.00", fontsize=8)
    page.insert_text((100.0 + 5.00 * ppm - 10, baseline + 14), "10.00", fontsize=8)
    page.insert_text((100.0, baseline + 60), "SH : 12.00 m2", fontsize=8)
    page.insert_text((100.0, baseline + 80), "All : 1.10 m", fontsize=8)
    page.insert_text((100.0, baseline + 100), "90/2.15", fontsize=8)
    page.insert_text((100.0, baseline + 120), "Echelle : 1/50", fontsize=8)
    # Plan de masse : niveaux nommés, côté de parcelle, surface cadastrale,
    # surface rectangulaire cotée.
    page.insert_text((400.0, baseline), "RDC: +0.28", fontsize=8)
    page.insert_text((400.0, baseline + 14), "Egout: +3.01", fontsize=8)
    page.insert_text((400.0, baseline + 28), "- 32.03 m -", fontsize=8)
    page.insert_text((400.0, baseline + 42), "Surface :  496 m2", fontsize=8)
    page.insert_text((400.0, baseline + 56), "Entree charretiere 5.00mx5.00m, non close,", fontsize=8)
    page.insert_text((400.0, baseline + 70), "TN : -0.15", fontsize=8)
    path = str(Path(tempfile.mkdtemp()) / "self-test-evidence.pdf")
    document.save(path)
    record = page_record(pymupdf.open(path)[0], 1, True)
    failures = []
    chains = record["chains"]
    if len(chains) != 1:
        failures.append(f"{len(chains)} chaîne(s) au lieu de 1")
    else:
        chain = chains[0]
        if abs(chain["sum"] - 10.0) > 0.01:
            failures.append(f"somme de chaîne {chain['sum']} au lieu de 10.00")
        if not chain["closed"]:
            failures.append("chaîne non refermée alors que la cote totale est imprimée")
        if abs(chain.get("impliedPointsPerMetre", 0) - ppm) > 0.5:
            failures.append(f"échelle déduite {chain.get('impliedPointsPerMetre')} au lieu de {ppm:.2f}")
    rooms = record["labels"]["rooms"]
    if len(rooms) != 1 or abs(rooms[0]["area"] - 12.0) > 0.01:
        failures.append(f"étiquettes de surface {rooms}")
    sills = record["labels"]["sills"]
    if len(sills) != 1 or abs(sills[0]["value"] - 1.1) > 0.01:
        failures.append(f"allèges {sills}")
    openings = record["labels"]["openings"]
    if len(openings) != 1 or abs(openings[0]["width"] - 0.9) > 0.01 or abs(openings[0]["height"] - 2.15) > 0.01:
        failures.append(f"baies {openings}")
    if record["cartouche"]["scale"] != "1/50":
        failures.append(f"échelle du cartouche {record['cartouche']['scale']}")
    named = {
        label["name"]: label["value"] for label in record["labels"]["namedLevels"]
    }
    for name, value in (("RDC", 0.28), ("Egout", 3.01), ("TN", -0.15)):
        if abs(named.get(name, 0.0) - value) > 0.001:
            failures.append(f"niveau nommé {name} : {named.get(name)} au lieu de {value}")
    sides = record["labels"]["parcelSides"]
    if len(sides) != 1 or abs(sides[0]["value"] - 32.03) > 0.001:
        failures.append(f"libellés de côté de parcelle {sides}")
    areas = record["labels"]["parcelAreas"]
    if len(areas) != 1 or abs(areas[0]["area"] - 496.0) > 0.001:
        failures.append(f"libellés de surface cadastrale {areas}")
    rects = record["labels"]["rectAreas"]
    if (
        len(rects) != 1
        or abs(rects[0]["width"] - 5.0) > 0.001
        or abs(rects[0]["depth"] - 5.0) > 0.001
    ):
        failures.append(f"surfaces rectangulaires cotées {rects}")
    if failures:
        for failure in failures:
            print(f"ECHEC {failure}")
        return 1
    print("registre de cotes : auto-test réussi")
    return 0


def main(argv):
    if "--self-test" in argv:
        return self_test()
    if len(argv) < 3:
        print(__doc__)
        return 2
    pdf, out = argv[1], argv[2]
    pages = None
    skip_vectors = "--skip-vectors" in argv
    if "--pages" in argv:
        pages = [int(value) for value in argv[argv.index("--pages") + 1].split(",")]
    document = pymupdf.open(pdf)
    selected = pages or range(1, document.page_count + 1)
    registry = {
        "schemaVersion": 1,
        "generatedBy": "scripts/extract_plan_evidence.py",
        "source": {
            "file": pdf.replace("\\", "/").split("/")[-1],
            "sha256": hashlib.sha256(open(pdf, "rb").read()).hexdigest(),
            "pageCount": document.page_count,
        },
        "pages": [page_record(document[index - 1], index, skip_vectors) for index in selected],
    }
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(registry, handle, ensure_ascii=False, indent=2)
    for page in registry["pages"]:
        closed = sum(1 for chain in page["chains"] if chain["closed"])
        print(
            f"page {page['index']:>2} : {len(page['chains'])} chaînes ({closed} refermées), "
            f"{len(page['labels']['rooms'])} étiquettes de surface, "
            f"{len(page['surfaceTables'])} table(s), "
            f"{len(page['isolatedDimensions'])} cote(s) isolée(s), "
            f"{len(page['unassignedCentimetres'])} étiquette(s) en cm hors chaîne"
        )
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
