# Extraction PDF (pymupdf) : pièges vérifiés

Recettes pour les étapes de rendu et d'extraction de la compétence, telles qu'exécutées
sur des plans d'architecte réels. Outils, à la racine du dépôt : `scripts/render_pages.py` (rendu des pages)
et `scripts/extract_walls.py` (axes candidats).

## Rendu et lecture des pages

Rendre chaque page en PNG puis lire ces PNG avec l'outil de lecture d'images :
c'est le contrôle principal, plus fiable que l'interprétation des vecteurs au jugé.
Assembler des planches-contact (4 pages par planche, étiquetées) pour repérer
rapidement RDC, étages, coupes, plan de masse et notice dans un PDF de 15 pages.

Zoom sur une zone avant une lecture détaillée des cotes :

```python
page.get_pixmap(matrix=pymupdf.Matrix(300/72, 300/72), clip=pymupdf.Rect(x0, y0, x1, y1))
```

## Pages en `/Rotate 90`

Les A3 paysage sont souvent des médiabox 842 × 1191 avec `/Rotate 90` (ou 270).
`page.rect` est déjà orienté, mais `get_text("dict")` renvoie les coordonnées
**non tournées** : les convertir avant tout calcul de position, sinon les
positions M (étiquettes) et P (cotes) sont fausses de tout l'écran.

```python
import pymupdf
doc = pymupdf.open(pdf)
page = doc[i]
mb = page.mediabox
if page.rotation == 90:      # paysage : x_aff = hauteur_médiabox − y_doc, y_aff = x_doc
    tx = lambda x, y: (mb.height - y, x)
elif page.rotation == 270:
    tx = lambda x, y: (y, mb.width - x)
else:
    tx = lambda x, y: (x, y)
```

`get_pixmap(clip=…)` attend, lui, les coordonnées d'affichage. Vérifier la
conversion avec une étiquette connue (angle du cartouche) avant de conclure.

## Échelle et origine

Échelle déduite d'une cote totale connue, pas de la valeur du cartouche :
`pts_par_m = durée_px(cote_totale) / longueur_lue`. Origine : la face
extérieure du mur nord-ouest. Contrôler chaque chaîne en comparant ses
repères de cote vectoriels à la somme cumulée des segments.

## Chaînes de cotes et étiquettes

Les étiquettes de cotes sont du texte pivoté (≈90°/270°) posé sur la ligne.
Extraire par `get_text("dict")`, trier par angle de ligne puis par position :
la chaîne se lit de gauche à droite (ou de haut en bas) et doit se refermer
sur la cote totale ; retenir la valeur cumulée à chaque repère trouvé.
Format `a/b` : largeur/hauteur ; `All : X m` est une allège.

Vérifier que chaque étiquette de pièce (`SH : … m²`) tombe dans la zone
reconstituée ; une étiquette hors zone signale un mur mal placé plutôt qu'une
convention d'étiquetage.

## Contrôle de validation

`node --import tsx scripts/audit-plan.ts …` et l'overlay calibré de la
compétence restent les étapes de contrôle ; ces deux helpers ne font que
préparer les entrées (rendus, axes candidats).
