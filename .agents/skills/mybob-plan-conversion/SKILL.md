---
name: mybob-plan-conversion
description: Reconstruct or regenerate Mybob house JSON from architectural PDFs. Splits what a script may do (measure, compute, verify) from what the AI must decide (which wall, which thickness, which dimension), gates the result on the surfaces printed in the plan, and records the traps that already cost a session.
---

# Du PDF au plan Mybob

Livrer une reconstruction fidèle et traçable dans le schéma actuel. Un JSON
importable n'est que la première porte technique : ne pas promouvoir une
géométrie devinée au rang de conversion terminée parce qu'elle passe la
validation.

Lire `AGENTS.md`, `docs/PROJECT-FORMAT.md`,
`src/model/types.ts` et `src/model/validate.ts`. Suivre le skill de maintenance
pour toute modification du dépôt. Garder les plans d'origine, les pages rendues,
les registres de preuve, les calques et les bundles personnels dans les
répertoires ignorés (`reference-documents/`, `artifacts/plan-review/`). Un projet
personnel qui doit vivre sous `public/projects/` suit la convention
`private-*.json` (ignorée par git) ; `scripts/check-public-build.mjs` reste
l'autorité sur ce qui peut être publié. Ne jamais ajouter de donnée personnelle à
la liste blanche des ressources publiques.

Les cas de référence de ce document s'appellent **plan A** (RDC, page 8, 1/75)
et **plan B** (RDC page 13, combles page 14, 1/50) — pages comptées à partir de
1, comme les options `--pages` des scripts du dépôt. Aucun nom de personne, de
constructeur ni de dossier n'est écrit ici — le dépôt est public ; la commune,
elle, est autorisée par le propriétaire (voir plus bas le nommage des maisons).
Les plans eux-mêmes vivent dans `reference-documents/`, ignoré par git.

## La règle : un script mesure, l'IA décide

**Un script mesure ou calcule. Il ne décide pas.**

Toute décision — quel mur existe, quelle épaisseur il a, quelle cote imprimée va
sur quelle face, où s'arrête une cloison — est prise par l'IA, puis vérifiée par
un script. Un script qui devine produit un résultat plausible et faux, et
personne ne le voit : c'est exactement ce que les bandes hachurées ont coûté.

Corollaire, et c'est la condition posée par le propriétaire : **un script qui
n'est pas exact à 100 % n'entre pas dans la chaîne**. Il reste une proposition à
valider, ou il disparaît. Mieux vaut une IA précise avec peu d'outils qu'un outil
approximatif qu'on croit.

## L'inventaire

Les scripts listés ici vivent dans `scripts/` à la racine du dépôt, pas dans
le dossier du skill : ils sont partagés avec la CI (mode `--self-test`), les
scripts npm et d'autres skills, et suivis par Prettier. Ne pas les déplacer ni
les dupliquer dans `.agents/`.

| script                     | ce qu'il fait                                                           | exactitude                                                              |
| -------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `extract_plan_evidence.py` | lit cotes, chaînes, étiquettes de surface                               | **100 %** — lecture, aucune interprétation                              |
| `check_plan_surfaces.py`   | compare surfaces imprimées et polygones du projet                       | **100 %** — calcul, c'est la porte de sortie                            |
| `check_site.py`            | vérifie parcelle, implantation, niveaux et toit contre le plan de masse | **100 %** — calcul, refuse les écarts et signale le non coté            |
| `plan_faces.py`            | calcule les pièces depuis les murs du niveau                            | **100 %** — calcul, aucune détection                                    |
| `compare_plan.py`          | mesure l'encre sous chaque mur du modèle                                | **100 %** — mesure, ne corrige rien                                     |
| `audit-plan.ts`            | cohérence interne du projet                                             | **100 %** — calcul                                                      |
| `check-plan-decisions.ts`  | arithmétique des décisions et rejeu de l'enveloppe                      | **100 %** — calcul                                                      |
| `extract_plan.py`          | cloisons, par l'aplat de couleur du dessin                              | **100 % sur les cloisons**, aveugle sur les bandes hachurées            |
| `derive_outline.py`        | contour du niveau, des chaînes fermées et de l'encre                    | **exact sur le plan A**, refuse le plan B (profondeur non cotée)        |
| `extract_doors.py`         | portes intérieures, par les arcs de débattement du dessin               | **exact sur l'arc**, muet sur les portes sans arc (voir plus bas)       |
| `generate_project.py`      | murs extérieurs, épaisseurs et baies lues au plan                       | **exact mais incomplet** : n'invente jamais, oublie ce qu'il ne lit pas |

Les quatre derniers sont les seuls qui produisent de la géométrie. Ils sont
utilisables parce qu'ils n'inventent rien : `extract_plan.py` ne rend que des
rectangles remplis, `derive_outline.py` ne retient un contour que si chaque
arête est reproduite par une suite imprimée ou comblée par une épaisseur cotée,
`extract_doors.py` ne rend une porte que si un quart de cercle et son vantail se
mesurent, `generate_project.py` ne place une baie que sur une chaîne refermée.
Ce qu'ils ne savent pas lire manque, et c'est à l'IA de le voir.

Les **portes intérieures** ne sont pas cotées, donc aucune chaîne ne les porte —
mais leur **symbole** est normalisé, et c'est lui qui se mesure. Voir « Les
portes intérieures, lues sur l'arc » plus bas : le script rend la charnière, la
largeur et le sens de débattement, et il rapporte les portes qu'il ne lit pas au
lieu de les deviner.

## Deux boucles, et ne pas les confondre

Les tests de CI tournent sur des plans **synthétiques** : aucune donnée
personnelle dans le dépôt. Ils vérifient la mécanique — une chaîne se referme,
une surface s'apparie, une pièce se calcule. Ils ne disent **rien** de la
fidélité au plan.

Les vrais PDF sont la seule source de vérité, et ils restent locaux
(`reference-documents/`, `artifacts/plan-review/`, ignorés par git).

| boucle     | support            | ce qu'elle prouve                      | où    |
| ---------- | ------------------ | -------------------------------------- | ----- |
| régression | plans synthétiques | le code fait encore ce qu'il faisait   | CI    |
| conception | les vrais PDF      | l'approche marche sur une vraie maison | local |

**Un CI vert ne valide pas un plan.** Deux fois dans la même session, un script
a passé son auto-test et cassé le vrai plan :

- `merge_openings` reportait les baies par leur offset : sur le plan réel, deux
  murs à six centimètres l'un de l'autre se confondaient et la baie du garage
  atterrissait dans la chambre 1 ;
- `merge_partitions` reprenait l'épaisseur de l'aplat : sur le plan réel, la
  cloison garage/WC passait de 15 à 10,2 cm et le WC gagnait 0,09 m².

Les deux ont été vus par la porte des surfaces sur le plan A, pas par la CI. Un
auto-test synthétique est un filet de régression, pas une validation.

### La boucle de conception, en commandes

```sh
# 1. Lire le document.
uvx --from pymupdf python scripts/extract_plan_evidence.py plan.pdf registry.json --pages 8
uvx --from pymupdf python scripts/extract_plan.py plan.pdf plan.json \
    --scale 37.795 --envelope x0,y0,x1,y1

# 1 bis. Dériver le contour du niveau, au lieu de l'écrire à la main.
python scripts/derive_outline.py registry.json outline.json --pages 8 \
    --pdf plan.pdf --plan plan.json

# 1 ter. Lire les portes intérieures sur leurs arcs, et confronter au projet.
python scripts/extract_doors.py plan.pdf 8 doors.json --registry registry.json \
    --pages 8 --compare out.json --level rdc

# 2. Construire : murs extérieurs, cloisons, baies, épaisseurs lues au plan.
python scripts/generate_project.py plan.json registry.json modele.json rdc out.json \
    --pages 8 --outline outline.json

# 2 bis. Ou seulement les baies, quand les murs du modèle sont déjà justes.
python scripts/generate_project.py plan.json registry.json modele.json rdc out.json \
    --pages 8 --openings-only --outline outline.json

# 3. Juger le résultat, pas le dessin.
python scripts/check_plan_surfaces.py registry.json out.json --level rdc --page 8
python scripts/plan_faces.py out.json --level rdc --compare
node --import tsx scripts/audit-plan.ts out.json

# 4. Recalculer les pièces fermées depuis les murs, et réécrire le projet.
python scripts/plan_faces.py out.json --level rdc --apply --write out.json
```

La troisième étape est celle qui compte. Tant qu'une pièce est hors tolérance,
le plan n'est pas fini — sauf si l'écart est documenté comme une incohérence du
plan lui-même, ce qui est un résultat, pas un échec.

**L'audit a une porte que les surfaces n'ont pas** : `room-unreachable`. Une pièce
peut être exacte au centimètre carré et n'avoir aucune porte. Sur le plan B,
neuf pièces sur neuf étaient exactes et six étaient inaccessibles à la visite,
parce que le RDC n'avait pas une seule baie. Les surfaces ne le voient pas : elles
ne comparent que les pièces qu'on leur donne. Il faut les trois portes, et
`reachedRooms` se lit à chaque passage.

La quatrième supprime les retours de cloison qui dépassaient dans une pièce :
sur le plan A, l'audit passe de huit réserves à une.

Un niveau sous versant ne suit pas cette boucle telle quelle : le plancher
s'arrête au rampant et la page imprime trois tableaux de surfaces. Voir
« Un niveau sous versant », plus bas.

Quand un vrai plan révèle un motif que les fixtures ne couvrent pas, ajouter le
motif à la fixture **et** la ligne dans ce fichier. Une fixture qui ne vient pas
d'un vrai cas est une fixture qui rassure à tort.

## Ce que dit l'état de l'art

Deux familles de méthodes, et le choix dépend d'une seule question : le PDF
est-il vectoriel ?

- **Vectoriel** — les méthodes géométriques et à base de règles dominent et
  atteignent une bonne exactitude. C'est notre cas. La littérature récente
  décrit la chaîne en quatre modules : grille d'axes et détection des cotes,
  reconnaissance du texte et **récupération de l'échelle**, reconstruction de la
  topologie des traits, rectification géométrique. C'est exactement la nôtre.
- **Scan** — il faut de l'apprentissage profond (segmentation sémantique,
  détection d'objets, OCR). Les méthodes géométriques y échouent sur le bruit et
  les traits cassés.

Ne pas sortir l'apprentissage profond pour un plan vectoriel : il n'apporte rien
et il coûte la reproductibilité.

Deux résultats établis ailleurs qui confirment le partage :

- **Les modèles de vision lisent mal les plans.** Un modèle récent extrait
  correctement les noms de pièces et les surfaces, mais hallucine ou rate des
  détails de mur, et un mur mal lu produit une conclusion absurde. Une image de
  feuille envoyée à un modèle est de plus réduite à environ 1568 px sur le grand
  côté : le texte des cotes d'un A3 dense y disparaît. La lecture reste au
  script.
- **La méthode du manuel « traits épais = murs, traits fins = portes » ne
  s'applique pas à un PDF.** Elle suppose des calques ou un dessin propre. Dans
  un PDF il n'y a pas de calques, et les lignes de cote sont aussi des paires de
  traits parallèles : c'est précisément pour cela que l'appariement de traits a
  rendu 44 murs au lieu de 25. Le manuel ne dit pas comment distinguer une cote
  d'un mur ; le dessin, si — par l'aplat de couleur des cloisons et par les
  chaînes refermées.

Sources utiles : `solidtakeoff.com/guides/how-to-find-the-scale-of-a-pdf-drawing`
(hiérarchie des sources d'échelle), `mdpi.com/2075-5309/16/5/1043` (chaîne en
quatre modules, vectoriel contre scan), `axcelerate.ai/blogs/ai-powered-floor-plan-analysis`
(limites mesurées des modèles de vision sur les plans).

## Établir la preuve avant de générer

Inventorier les fichiers source réels, leurs empreintes SHA-256, le nombre de
pages, les titres de dessin, les identifiants de projet, les dates et les
révisions. Séparer les maisons différentes et les dessins périmés. Vérifier que
les fichiers existent localement : un ancien résumé, un JSON existant ou des
notes de modèle ne remplacent pas la source. Si une source essentielle manque,
continuer le travail d'audit indépendant et réclamer cette source ; ne pas
déclarer vérifié un ancien JSON régénéré.

Nommer chaque maison par sa commune, jamais par un nom de personne ni par un
sigle de dossier : `plans-emieville.pdf`, `plan-sannerville.pdf`, et les projets
`maison-emieville`, `maison-sannerville`. La commune se lit dans le cartouche du
PDF, pas dans le nom du fichier reçu. `pnpm run backup:private` nomme les copies
d'après `project.id` : renommer un projet, c'est renommer sa sauvegarde.

Une maison a souvent plusieurs PDF, et le nom évident n'est pas le bon. Un
`plans-emieville-scan.pdf` s'est révélé être un scan de 15 pages d'une édition
antérieure alors que l'original vectoriel dormait à côté sous
`plans-emieville.pdf` ; une session entière a conclu que la maison n'avait pas de
plan vectoriel. Avant d'accepter une source, lister tous les fichiers candidats
de cette maison et les comparer sur `page.get_drawings()` et
`page.get_text("words")`. Préférer le vectoriel, et dire quel fichier et quelle
page ont servi. Quand le propriétaire mentionne un document introuvable, demander
son emplacement plutôt que de substituer le nom le plus proche.

Vérifier si la source est un dessin vectoriel ou un scan avant de promettre une
chaîne. `page.get_text()` et `page.get_drawings()` répondent en un appel : un PDF
vectoriel rend des cotes et des traits, un scan ne rend ni l'un ni l'autre. La
couche d'extraction et la couche de décision ont besoin de texte ; la couche de
vérification (`measure_plan.py`, `compare_plan.py`, le calque) lit des pixels et
fonctionne sur les deux. Sur un scan, le registre de preuve se construit à la
main depuis l'image rendue, et l'échelle s'imprime dans le cartouche faute de
chaîne pour la déduire — un scan à 1/75 fait 105 px/m à 200 dpi, pas les
157 px/m d'un dessin à 1/50.

Rendre les plans de niveau, les coupes, les élévations et le plan de masse.
Inspecter des recadrages lisibles, symboles et extrémités de cote compris.
L'extraction et l'OCR ne sont qu'une aide. Suivre
[references/reconstruction.md](references/reconstruction.md) pour le registre de
mesure, la construction des coordonnées et le calque sur la source. Terminer le
registre d'enveloppe et de cloisons avant la géométrie finale ; y revenir quand
les contrôles révèlent des contradictions.

Pour parcourir un PDF multi-pages (rendus individuels et planches de contact
annotées) et pour les axes de murs candidats tirés des traits vectoriels,
utiliser `scripts/render_pages.py` et `scripts/extract_walls.py` depuis la racine
du dépôt (`uvx --from pymupdf python scripts/render_pages.py plan.pdf out-dir/`).
`references/pdf-extraction.md` consigne les pièges vérifiés de ces outils :
repères de page tournée, échelle déduite d'une cote d'ensemble imprimée, et
recoupement libellé/surface. Utiliser le tableau de surfaces imprimé comme
recoupement (la somme des pièces doit atteindre le total imprimé) ; ne jamais
déduire une dimension linéaire d'une surface annoncée.

**Une page se repère par son texte, pas par son numéro d'ancienne note.** Les
scripts du dépôt numérotent à partir de 1 (`--pages 8` ouvre `doc[7]`) ; seul
pymupdf lui-même compte à partir de 0, et une note d'une session passée peut
compter
dans n'importe laquelle des deux conventions. Deux pages voisines du même
constructeur se ressemblent assez pour qu'un calque pressé se croie aligné.
Localiser la page d'un niveau par un texte qui n'existe que sur elle — la
surface d'une pièce donnée, un titre de dessin — et consigner ce texte dans le
registre, pas un numéro hérité. `grid_page.py`, `overlay_page.py` et
`extract_walls.py` impriment les premiers mots de la page lue : vérifier cette
ligne avant de lire un rendu. Une passe du soir a rendu la page des combles en
cherchant celle du rez-de-chaussée : le numéro venait d'une note, la page
changeait d'index selon la convention.

Pour confronter un modèle à la source sans passer par la géométrie du modèle,
mesurer directement le plan rendu : `scripts/measure_plan.py` balaye des lignes
sur l'image et rapporte les bandes de murs en mètres, en fusionnant les deux
faces d'une cloison hachurée et en écartant les traits de cote fins. Mesurer à
plusieurs endroits avant de conclure sur une épaisseur : une fenêtre interrompt
le mur et montre son cadre là où la face devrait être, ce qui se lit comme un mur
plus fin. C'est ainsi qu'un mur de 0,34 m a été pris pour un mur de 0,21 m.

Rendre assez grand pour la cloison la plus fine. Un mur de 7 cm a besoin d'une
dizaine de pixels entre ses deux faces, donc la résolution requise dépend de
l'échelle imprimée : 200 dpi suffisent à 1/50, mais un dessin à 1/75 demande
300 dpi. En dessous, les faces fusionnent en un trait et le mur se lit absent —
cinq murs d'un plan à 1/75 ont été déclarés manquants à 120 dpi et sont tous
réapparus à 300 dpi. `compare_plan.py` avertit quand le mur déclaré le plus fin
tombe sous huit pixels.

### L'échelle

Trois sources, et elles ne se valent pas. L'ordre de préférence est celui de la
pratique du métier, pas une préférence personnelle :

1. **Une cote imprimée** — une cote isolée ou une chaîne refermée. Elle reste
   juste même si le PDF a été redimensionné à l'export. C'est la seule source
   dont on se sert pour mesurer.
2. **Une échelle graphique** — un cartouche gradué dessiné sur la feuille. Il
   rétrécit avec le dessin, donc il reste juste après un redimensionnement. Bon
   recoupement, jamais une source de mesure.
3. **Le ratio du cartouche** (`1/75`, `1:50`) — une affirmation sur la feuille
   imprimée d'origine, pas sur le fichier reçu. Un PDF exporté à 117 % garde son
   `1/75` et ne mesure plus rien. À lire comme une indication, à ne jamais
   utiliser comme échelle.

Un plan vectoriel exporté à l'échelle 1:1 donne exactement **37,795 pt/m à 1/75**
et **56,693 pt/m à 1/50**. Mesuré sur les deux maisons du constructeur : 37,79
sur le plan A, 56,66 à 56,71 sur le plan B. Si la valeur déduite des chaînes
s'écarte de ces nombres, c'est le fichier qui a été redimensionné, pas la méthode
qui est fausse : garder la valeur déduite et le noter.

Prendre la **médiane** des échelles par chaîne, jamais la moyenne : une chaîne
mal appariée donne un point aberrant (53,11 pt/m relevé sur une page à 1/50) et
la moyenne l'emporterait sur les six chaînes justes.

`check_plan_surfaces.py` imprime l'échelle reconnue et son écart au standard le
plus proche (`1/75 attendu 37.795 (-0.0 %)`). Au-delà de 1 %, il avertit : le
fichier a été redimensionné à l'export. C'est un diagnostic, pas une correction —
la mesure reste celle des cotes.

Sur un scan il n'y a pas de chaîne : l'échelle se lit dans le cartouche, et le
ratio redevient la seule source, avec l'incertitude qui va avec.

### L'origine, quand aucune chaîne ne couvre l'axe

L'échelle vient des chaînes ; l'**origine** aussi, et c'est là que ça casse. Une
chaîne partielle ne commence pas au bord du niveau : prendre son début pour
l'origine décale tout le niveau. La page 14 du plan B n'a qu'une chaîne
verticale de 2,78 + 1,27 = 4,05 m pour une emprise de 8,50 m ; l'origine tombait
3,5 m trop bas, toutes les étiquettes de surface se projetaient à z négatif, et
les sept pièces des combles sortaient « pièce sans étiquette ». On croit alors
que les noms de pièces ne correspondent pas, alors que c'est le repère.

La règle : si la plus longue chaîne d'un axe ne couvre pas l'emprise du niveau,
c'est la **cote d'ensemble** qui donne l'origine. Attention à ce qu'on appelle
« l'emprise » : c'est celle du **bâtiment**, pas celle du plancher du niveau. Un
niveau en retrait — des combles entre rampants, dont le plancher commence à
1,27 m de la façade — a une emprise plus petite que la cote d'ensemble. Calculer
l'origine avec l'emprise du niveau décale tout de la moitié de l'écart : sur le
plan B, 4,45 m, et les sept pièces des combles ressortent « pièce sans étiquette ».

Donc : chercher la cote dont la valeur vaut l'emprise du niveau ; à défaut, la
plus grande cote de l'axe, et prendre **sa** valeur pour l'origine
(`at - value * scale / 2`), jamais celle du niveau.

Le symptôme à reconnaître : des étiquettes de surface qui tombent hors du niveau,
un total calculé très inférieur au total imprimé, ou un repère dont l'origine
change entre deux niveaux de la même page. Vérifier le repère avant de soupçonner
la géométrie.

## Les trois couches

Garder extraction, décision et construction séparées pour qu'une erreur ne
puisse pas se cacher derrière un JSON valide.

### 0. Géométrie

`scripts/extract_plan.py` lit les murs sur le dessin lui-même. Chez ce
constructeur, les murs se dessinent de deux façons, et la différence compte :

- les **cloisons** sont des **rectangles remplis** d'une couleur d'aplat propre
  au CAO. Cette couleur est un marqueur sémantique, pas une propriété
  géométrique : elle donne l'épaisseur et les deux abouts exactement, sans
  ambiguïté avec les lignes de cote. Ne pas la coder en dur — prendre le
  remplissage non blanc et non noir le plus fréquent de la page, pour qu'une
  autre couleur de constructeur fonctionne aussi. Le cartouche réutilise souvent
  le même aplat : découper sur l'enveloppe du niveau.
- les **murs extérieurs** sont des **bandes hachurées** entre deux faces, non
  remplies. Leur position vient des chaînes de cotes refermées, qui la donnent au
  millimètre.

Et deux fausses formes de mur à écarter avant d'en poser un :

- **une porte dessinée ouverte** : son vantail à 90° et son arc forment deux
  segments pleins qu'une lecture pressée prend pour une cloison. La porte
  d'entrée d'un plan réel se dessine ainsi — son vantail a été pris pour un mur
  de façade. Un « mur » sans hachure, sans aplat, et dans l'axe d'une baie
  existante, est d'abord un vantail ;
- **une chaîne de cotes dessinée dans une pièce** : les cotes se tracent aussi à
  l'intérieur du plan, et une bande fine pleine largeur n'est pas toujours un
  mur. Décider sur le rendu de la page, pas sur le seul trait.

Six tentatives géométriques ont échoué sur les murs extérieurs et ne valent pas
d'être refaites : apparier les traits parallèles (les lignes de cote sont aussi
des paires parallèles, 44 murs au lieu de 25), regrouper le hachurage (ne
respecte pas les limites de mur), la densité d'encre entre les faces (dépend de
l'épaisseur : 0,25 pour un mur de 34 cm, 0,10 pour 7 cm, 0,01 pour une ligne de
cote), la morphologie suivie d'un remplissage par diffusion (fuit par les
portes — un garage est ressorti à 622 m²), la dilatation (mange 45 cm par pièce),
et la détection de zigzag (le hachurage est fait de traits séparés).

Le dessin est fidèle dimensionnellement : un mur de 34 cm mesure 0,339 m dessiné
sur un plan à 1/50 et 0,340 m sur un à 1/75. Le dessin est donc fiable pour les
positions et les épaisseurs ; c'est la _segmentation_ qui est difficile, pas
l'exactitude.

### 0 bis. Le contour, dérivé des chaînes fermées

Le contour était le dernier élément écrit à la main. `scripts/derive_outline.py`
le dérive en cinq couches, et **refuse** au lieu de deviner :

1. **Étendues** — par axe, le plus grand total des chaînes fermées, recoupé par
   une seconde chaîne d'accord ou par l'enveloppe d'`extract_plan.py` (`--plan`).
   Une chaîne dont le total ne vaut pas l'étendue est **écartée et rapportée** :
   elle décrit l'intérieur, pas l'enveloppe (le 7,82 d'une profondeur intérieure
   ne remplace pas les 8,50 d'une emprise).
2. **Découpes** — positions cumulées intérieures des chaînes ancrées, dans les
   deux sens de lecture.
3. **Encre** (`--pdf`) — chaque découpe est cherchée sur la page rendue : la
   présence d'un mur saute-t-elle de part et d'autre ? Une découpe où elle saute
   est un épaulement du contour ; une découpe où elle ne saute pas décrit
   l'intérieur et n'est pas essayée.
4. **Fermeture** — chaque arête doit être reproduite par une suite contiguë
   imprimée (0,015 m) ou être une **profondeur comblée** par une épaisseur lue en
   centimètres au même endroit. Une profondeur sans cote ni épaisseur est refusée.
5. **Jugement** — les arêtes doivent exister à l'encre, et une encoche de façade
   est confirmée par un balayage perpendiculaire.

Si plusieurs contours survivent, le script les **liste** au lieu de trancher, et
`load_outline()` refuse alors de les transmettre : la construction ne commence
pas sur un contour deviné.

```sh
python scripts/derive_outline.py artifacts/plan-review/registry.json contour.json \
    --pages 8 --pdf reference-documents/plans-emieville.pdf --plan artifacts/plan-review/plan.json
python scripts/derive_plan_decisions.py projet.json registry.json rdc decisions.json \
    --pages 8 --outline contour.json
python scripts/generate_project.py plan.json registry.json modele.json rdc out.json \
    --pages 8 --outline contour.json
```

**État mesuré.** Plan A (page 8) : le contour sort exactement
`[[0,0],[12.55,0],[12.55,12.54],[5.55,12.54],[5.55,7],[0,7]]`, et le remplacer
dans la chaîne ne change aucune surface (9 pièces sur 10 exactes, le hall à
−0,09 comme avant). Plan B (page 13) : le script **refuse** — 0 contour retenu,
112 candidats refusés. Le contour du plan B reste donc une décision, et c'est
écrit ici pour que la session suivante ne le prenne pas pour une mesure.

**Pourquoi le plan B ne se referme pas.** Deux causes mesurées, et ce n'est ni
le trait mixte ni le hachurage :

- **Le trou de la façade ouest est une baie, pas une encoche.** La chaîne le dit
  elle-même : `0,69 / 2.40/2.15 / 5,41` — 2,40 de large, 2,15 de haut. Le script
  l'essaie comme un redent et cherche un fond de mur à 2,40 ou 3,09 m ; la sonde
  n'y trouve **0 % d'encre** (`x=2.40 -> [(0.21,0.35), (4.17,4.82), (7.92,8.30)]`).
  Il refuse d'inventer ce fond, et c'est le bon comportement. Sur le plan A
  l'encoche est réelle : son fond à x=5,55 tient 2,7 m de mur sur 5,54 m, soit
  49 % — au-dessus du seuil de 40 % — avec une ouverture de 1,71 m au milieu.
- **Le plan B ne cote pas sa profondeur.** L'axe z n'a **qu'une chaîne ancrée,
  en 3 segments** (0,69 / 2,40 / 5,41) : quatre frontières, 12 suites. Les
  découpes viennent des baies des façades sud et nord (17 et 18 sauts), et
  aucune n'existe sur l'axe z. La couche fermeture exige que chaque arête soit
  une suite contiguë imprimée _sur l'axe perpendiculaire_ : aucun rectangle ne
  peut se fermer. Le plan A a 3 chaînes ancrées et 178 suites sur le même axe,
  ses façades cotées en 10 et 7 segments.

**Un trait mixte n'est pas une face de mur.** Ce n'est pas ce qui bloque le plan
B — sa façade sud est continue à z=0 — mais c'est un piège réel de la couche
encre : une ligne en tirets de 9 cm au nu de la façade se lit comme un mur
continu dès qu'on fusionne les traits proches. `Ink.solid()` mesure la longueur
du trait continu qui passe par la sonde et rejette tout ce qui est en dessous de
0,45 m. Le motif est dans la fixture `tests/fixtures/plan-outline/` et dans
l'auto-test, pas seulement dans ce paragraphe.

### 0 ter. Les portes intérieures, lues sur l'arc

Une porte intérieure n'est pas cotée, mais son **symbole est normalisé** : un
quart de cercle de rayon égal à la largeur du vantail, dont le **centre est la
charnière**, plus le **vantail tracé ouvert**, perpendiculaire au mur.
`scripts/extract_doors.py` mesure ces trois choses et rien d'autre.

```sh
# Le cadre se déduit des chaînes refermées, comme pour le contour.
python scripts/extract_doors.py plan.pdf 8 doors.json \
    --registry artifacts/plan-review/registry.json --pages 8
# Puis on confronte les portes lues aux portes écrites, et on lit les écarts.
python scripts/extract_doors.py plan.pdf 8 doors.json \
    --registry artifacts/plan-review/registry.json --pages 8 \
    --compare public/projects/private-maison.json --level rdc
```

**Ce qui écarte une hachure, ce n'est pas la densité.** Le plan A porte 156
tracés remplis et 165 cellules denses de six segments ou plus : compter les
segments courts ne donne rien. Trois conditions ensemble, et elles seules :

1. le tracé n'est **pas rempli** — un arc est un trait, une hachure est un aplat ;
2. l'ajustement circulaire laisse un **résidu ≤ 0,15 pt** — un amas de hachure ne
   se pose pas sur un cercle ;
3. la **couverture angulaire** vaut 80–100° — un quart de cercle, pas un demi-tour.

Le **vantail** tranche ensuite entre les deux extrémités de l'arc : celle qui
porte un segment partant de la charnière est la position **ouverte**, donc le sens
de débattement ; l'autre est la position **fermée**, donc l'ouverture dans le mur.
Sans ce segment, les deux extrémités sont interchangeables et le script ne compte
pas la porte.

**État mesuré sur les deux plans** (19 arcs, 21 portes à vantail écrites) :

| plan       | arcs lus | portes écrites | appariées | dans ±5 cm le long du mur |
| ---------- | -------- | -------------- | --------- | ------------------------- |
| A, RDC     | 8        | 8              | 8         | 5                         |
| B, RDC     | 6        | 7              | 6         | 5                         |
| B, combles | 5        | 6              | 5         | 5                         |

Les écarts sont **listés, jamais corrigés en silence** :

- **deux portes n'ont aucun arc** — `hall-nord-door-1` (plan B, RDC, 1,36 m) et
  `p-dressing` (combles, 1,00 m). Le dessin y montre une bande hachurée et des
  traits de tableau, pas un quart de cercle. Le script dit `AUCUN ARC LU` ; il ne
  les invente pas ;
- **une porte-fenêtre à deux vantaux** n'a qu'un arc complet : le second est
  tronqué à 37,7°. Le script le rapporte comme **arc partiel** et ne compte que le
  vantail entier, donc 0,583 m au lieu de 1,20 m ;
- **trois portes du plan A et trois du plan B ont la charnière de l'autre côté**
  de l'ouverture par rapport au champ `hinge` écrit à la main. L'ouverture, elle,
  est au bon endroit : c'est le côté du pivot qui est faux ;
- **deux murs du projet sont décalés** et emportent leur porte : `entree-fond`
  (plan B, RDC) de 0,51 m et le mur nord du WC des combles de 0,76 m. La position
  le long du mur est juste à 2 cm ; c'est le mur qui n'est pas là où le projet le
  dit. Le rapport sépare les deux, parce que corriger la porte ne corrigerait pas
  le mur ;
- **deux portes sont à plus de 5 cm** : `porte-ch2` du plan A (+0,72 m, la cloison
  `ch2-nord` du projet est décalée de 0,44 m et trop longue de 0,57 m) et
  `wc-ouest-door-1` du plan B (−0,76 m, l'ouverture est écrite du mauvais côté de
  la charnière).

**Ce que le script ne décide pas.** Le sens de débattement est rendu comme un
**vecteur**, pas comme un signe : le champ `swing` du projet est une direction de
rotation dans le repère local du mur, et les deux ne se comparent pas sans le
code du viewer. Le côté de la pièce reste une interprétation à confirmer sur
place, et le projet doit le dire.

**Le cadre, et son refus.** `--registry` déduit l'origine et l'échelle des
chaînes refermées, avec la règle de `derive_outline.py`. La page des combles du
plan B n'a **aucune chaîne verticale refermée** : le script refuse et demande
`--origin`, plutôt que de deviner un axe. Sur cette page l'origine en z vient de
l'emprise dessinée (les deux façades à 8,50 m l'une de l'autre), et c'est écrit
comme une mesure, pas comme une déduction.

### 1. Extraction

`scripts/extract_plan_evidence.py` transforme un PDF en registre déterministe :
pages, libellés classés (cotes, baies, allèges, surfaces de pièces, niveaux,
pentes), tableaux de surfaces, et chaînes de cotes avec leur résidu de fermeture
et l'échelle déduite des seuls centres de libellés. Une chaîne n'est retenue
comme fermée que si ses segments contigus somment au total imprimé ; les
épaisseurs de murs et les cotes isolées sont rapportées à part au lieu d'être
fondues dans la somme.

### 2. Décision

Un enregistrement par face de mur et par baie, chacun portant une classe de
preuve (`printed`, `printed-partial`, `derived`, `scaled`, `assumed`) et un
drapeau `unresolved`. `scripts/derive_plan_decisions.py` écrit un squelette
conservateur. Une cote imprimée mesure entre **faces finies**, jamais entre axes :
le script énumère les conventions d'about (axe, demi-épaisseur propre,
demi-épaisseur voisine) et garde celle qui reproduit la portée imprimée. Une
longueur seule ne prouve rien — deux murs de même longueur sur deux lignes de
cote différentes donnent le même nombre — donc une face n'est revendiquée que si
quelque chose de positionnel l'ancre à cette portée. Deux ancrages existent, et
le script les essaie dans cet ordre :

- **`openings`** — les baies du mur lui-même. Leurs positions imprimées doivent
  impliquer une seule origine de mur, et le mur doit tenir dans la portée.
- **`envelope`** — une chaîne fermée dont la somme égale l'étendue du contour du
  niveau sur son axe. Une telle chaîne couvre exactement cette étendue, donc son
  origine est une frontière du contour et ses segments deviennent des
  coordonnées absolues. Le sens de lecture est inconnu : garder celui qui
  retrouve le plus de frontières du modèle, et abandonner la chaîne en cas
  d'égalité. La ligne de la chaîne est ensuite placée dans le repère du modèle —
  les deux axes se fournissent mutuellement leur origine — ce qui dit de quel
  côté du contour elle mesure. Seul un mur portant la face de ce côté peut être
  prouvé par elle ; sans ce filtre, un mur ouest se fait « prouver » par la
  chaîne de la façade est, ce qui est arrivé sur un vrai plan.

Des décalages nuls donnent `printed` (ou `printed-partial` sur une chaîne
ouverte) ; des décalages non nuls donnent `derived`, parce que la longueur dépend
alors des épaisseurs déclarées. Un mur d'enveloppe en retrait d'une
demi-épaisseur aux deux bouts du contour est `derived` depuis l'étendue
d'ensemble imprimée.

**Deux conventions d'about donnent souvent la même longueur.** Un mur de 3,92 m
entre deux murs de 0,34 m fait 4,09 m qu'on parte de sa face nord ou de sa face
sud. Trancher par un rang arbitraire écartait la bonne et laissait la face non
résolue ; toutes les conventions sont donc rendues, et c'est l'ancrage
positionnel qui choisit. Sur le plan A, ce seul correctif fait passer les faces
résolues de 2 à 4 et retire deux avertissements « origine du mur non déclarée ».

**Ce que la porte ne peut pas prouver, et qu'il faut dire.** Sur le plan A, après
dérivation du contour et ce correctif, il reste **21 faces sur 25** non résolues,
et la porte sort donc encore en erreur sans `--allow-unresolved`. Le compte se
répartit ainsi, et ce n'est pas un défaut du script :

- **11 faces** sont des murs **sans aucune baie** qui ne portent pas la face du
  contour. Aucun ancrage ne les atteint : `openings` n'a rien à apparier, et
  `envelope` ne prouve que les murs qui touchent le côté mesuré. Leur longueur
  est bien reproduite par une suite imprimée, mais rien ne dit _où_ elle se pose.
- **6 faces** n'ont que des **portes intérieures** (0,73/2,04), qui ne sont
  cotées nulle part — voir plus bas.
- **6 faces** ont une baie imprimée, mais la suite qui reproduit la longueur ne
  contient pas cette baie : la cote de façade et la cote de baie ne sont pas sur
  la même ligne.

Les 6 ouvertures non résolues sont exactement les **portes intérieures**. Un
script ne les rendra jamais exactes : elles se lisent à l'encre et se posent à la
main. Tant qu'elles restent `scaled`/`unresolved`, la porte est infranchissable
sur un vrai plan, et c'est le comportement voulu — la construction ne commence
pas sur une supposition. Le déblocage est une décision à documenter (les classer
`assumed` avec leur justification), pas un réglage de tolérance.

`scripts/check-plan-decisions.ts` est la porte entre les couches 2 et 3. Il
recalcule chaque affirmation au lieu de croire sa prose : la portée référencée
doit sommer à la longueur déclarée, la longueur d'axe du mur doit découler de
cette longueur et des décalages déclarés, la largeur et la hauteur imprimées
d'une baie doivent correspondre à son segment, et chaque chaîne doit venir des
pages du niveau lui-même. Une affirmation `envelope` est rejouée depuis le
repère déclaré : la chaîne doit toujours sommer à l'étendue du contour, et
l'intervalle monde de la portée doit tomber sur les faces du mur ou les
tableaux de la baie. Il rejette aussi une face appuyée sur une chaîne non
fermée, une affirmation `printed` sans référence de chaîne, une affirmation
`printed-partial` sur une chaîne fermée, une décision manquante pour un mur ou
une baie, et un décalage de baie qui contredit sa chaîne une fois l'origine du
mur déclarée. Il sort en erreur tant qu'une décision reste non résolue : la
construction ne commence pas sur une supposition. En **fusion**, les murs
viennent du modèle et la décision ne construit rien : `--allow-unresolved`
laisse alors passer une face non résolue, jamais une contradiction. Sans ce
drapeau, la porte est infranchissable sur un vrai plan (21 faces non résolues sur
25 sur le plan A, après dérivation du contour) et le pipeline documenté ne
s'exécute jamais de bout en bout.

```sh
uvx --from pymupdf python scripts/extract_plan_evidence.py plan.pdf artifacts/plan-review/registry.json --pages 13,14
python scripts/derive_outline.py artifacts/plan-review/registry.json artifacts/plan-review/outline.json --pages 13 --pdf plan.pdf
uvx --from pymupdf python scripts/derive_plan_decisions.py project.json artifacts/plan-review/registry.json rdc artifacts/plan-review/decisions.json --pages 13 --outline artifacts/plan-review/outline.json
node --import tsx scripts/check-plan-decisions.ts artifacts/plan-review/decisions.json project.json artifacts/plan-review/registry.json
```

Passer `--pages` avec les pages qui portent le niveau. Sans lui, le script mélange
toutes les pages du registre, et un mur du rez-de-chaussée se fait « prouver » par
une cote de l'étage : cette seule erreur a produit quatre fausses preuves sur un
vrai plan.

Le registre et le fichier de décisions portent de vraies données de plan : les
garder dans les répertoires ignorés, jamais dans le dépôt.
`tests/fixtures/plan-reference/` contient le plan de référence synthétique
(registre, projet, décisions) que `python scripts/derive_plan_decisions.py
--self-test` et `tests/plan-reference.test.ts` vérifient en CI ; il ne contient
aucune donnée réelle et doit le rester. `tests/fixtures/plan-outline/` porte les
trois registres de la couche contour — encoche de coin (motif du plan A), encoche
de façade à profondeur déduite d'une cote en centimètres (motif du plan B), et
étendue portée par une seule chaîne — que `python scripts/derive_outline.py
--self-test` rejoue, PDF synthétique compris. Ces fixtures viennent de vrais
plans : une fixture inventée rassure à tort.

Classer les cotes en imprimées, dérivées, mises à l'échelle ou supposées. Garder
pour chaque valeur sa page, ses extrémités, son équation et son incertitude. Les
valeurs dérivées renvoient à des cotes transcrites indépendamment, pas au JSON de
sortie. Résoudre les chaînes contradictoires par les révisions et les conventions
de mesure ; ne pas les moyenner en silence. Ne jamais déduire une dimension
linéaire d'une surface annoncée.

### 3. Construction et vérification

`scripts/generate_project.py` assemble le projet : murs extérieurs depuis le
contour (chaque arête donne un mur dont la face extérieure est l'arête, l'axe en
retrait d'une demi-épaisseur), baies depuis les chaînes fermées qui mesurent
chaque côté, cloisons depuis la couche géométrie, et pièces recollées sur les
nouvelles faces de murs. Puis `validateProject`, `scripts/audit-plan.ts`, le
calque, le navigateur.

Rien n'y est inventé : l'**épaisseur** de chaque mur extérieur est lue sur la
cote en centimètres posée contre lui (22, 34, 15), l'**allège** sur la cote
`All : 1.10 m`, la **hauteur** de baie sur son libellé `90/2.15`. Le script dit
combien de murs il a lus et lesquels gardent une valeur de repli. Sur le plan A :
7 murs sur 8, allège 1,10 m.

**Une façade n'a pas une épaisseur.** Sur le plan A le nord fait 22 cm côté
garage et 34 cm côté chambres ; prendre une seule cote pour toute l'arête faisait
grandir chambre-3 de 0,65 m². Le script coupe donc chaque arête là où une cloison
la rencontre, redonne à chaque tronçon la cote qui le longe, et garde la **face
extérieure** fixe — c'est elle qui est sur le contour, pas l'axe. Les baies
suivent, reportées par leur intervalle monde.

Effet mesuré : le plan **entièrement généré**, sans un seul mur écrit à la main,
passe de 6 à **8 pièces sur 10** à ±0,05 m². Les deux qui restent sont le hall
(incohérence du plan) et le WC (+0,09, cloison garage brute à 10,2 cm contre
15 cm finie).

Attention à l'ambiguïté : deux cotes voisines peuvent décrire le même mur (21 et
22 pour la même façade, brut et fini). Le script prend la plus proche ; c'est une
proposition, et c'est une surcharge qui tranche.

Trois choses que le script fait et qu'il **rapporte**, parce qu'elles sont des
déplacements et non des mesures :

- **le recalage des pièces** sur les faces de murs (`snap_rooms`, 30 cm). Un
  sommet déplacé de plus de quelques centimètres signale un polygone qui n'était
  pas sur les faces ;
- **les écarts d'épaisseur** entre le modèle et la cote imprimée ;
- **les écarts d'épaisseur de cloison** entre le modèle et l'aplat du dessin.

Ce dernier est le piège le plus coûteux. **L'aplat du dessin est le mur brut ; le
modèle porte le mur fini, doublage compris.** Sur le plan A, la cloison
garage/WC fait 10,2 cm à l'aplat et 15 cm finie, et la surface imprimée du WC
(1,62 m²) tranche pour 15 cm. Remplacer l'un par l'autre rétrécit la pièce de
0,09 m². La fusion ne reprend donc l'épaisseur que si elle concorde à 3 cm, et
signale l'écart sinon.

Le **type** d'une baie est une convention, pas une lecture : sous 1,60 m de
hauteur c'est une fenêtre avec allège, au-dessus c'est une baie à seuil. Le plan
donne la hauteur, pas le type. C'est écrit ici pour que personne ne le prenne
pour une mesure. Trois règles en découlent, et elles sont dans le script :

- hauteur < 1,60 m → `window` ; hauteur ≥ 1,60 m et largeur ≥ 1,60 m → `sliding`
  (une ouverture de hauteur de porte large de 2,40 m n'est pas un vantail) ;
  sinon `door` ;
- une ouverture pleine hauteur de plus de 2,00 m qui donne sur une pièce de type
  `garage` est une porte de garage — la pièce est dans le modèle, donc la règle
  est exacte ;
- l'**allège** n'est pas votée : le plan porte plusieurs `All : … m` sur la même
  page (1,10 au nord, 1,20 au sud au plan B). Prendre la plus fréquente
  posait 1,20 sous les fenêtres du nord. Chaque étiquette est appariée à la baie
  la plus proche, et une baie sans étiquette est rapportée comme non résolue.

La convention du script est un défaut, pas un verdict : le propriétaire a corrigé
trois types après relecture 3D, et ses réponses priment sur la règle.

- une ouverture imprimée `1.40/2.15` pleine hauteur d'un séjour peut être une
  **baie** (`sliding`), pas une porte battante : le script dit `door`, la maison
  dit baie ;
- la « fenêtre double » d'une cuisine est **coulissante sur le côté** : `sliding`
  avec son allège (1,60/1,05 allège 1,10 au plan A, 1,80/1,05 au plan B) ;
- une baie pleine hauteur de chambre (1,20/2,15 sans allège) est une
  **porte-fenêtre ouvrante** : `door` avec `glazed: true`, pas une fenêtre
  fixe aux poignées décoratives ;
- toute baie de mur extérieur porte `exterior: true` : sans lui, le coulissant
  rend en panneau plein et la porte de garage démarre ouverte — c'est ce qui
  a fait lire « portes coulissantes pleines » au propriétaire sur le plan B.
  `generate_project.py` pose ce drapeau à chaque passe de génération ; une
  génération plus ancienne ne l'a pas, donc vérifier la clé avant relecture.

**Une chaîne de façade peut couvrir plusieurs arêtes.** Au sud du plan B, le
séjour, l'entrée en renfoncement et le garage sont trois arêtes distinctes, et une
seule chaîne les mesure toutes. Chercher l'arête par le côté seul posait toutes
les baies sur la première et perdait les autres : l'entrée et le séjour n'avaient
plus une seule ouverture, et six pièces sur neuf étaient inaccessibles à la
visite. Chaque baie est donc placée sur l'arête dont l'intervalle la contient, et
à distance égale la plus proche du côté mesuré — le renfoncement d'entrée est à
0,35 m du nu de façade, une tolérance ne le distinguerait pas.

Deux limites mesurées sur de vrais plans : **une façade dont les baies ne sont
que des cotes isolées** (pas une chaîne fermée) ne donne aucune baie, et **une
porte intérieure sans arc de débattement** ne se lit pas par le symbole. Les deux
se rapportent comme manquantes, jamais inventées.

Les portes intérieures qui portent un arc se lisent par `extract_doors.py` (voir
« Les portes intérieures, lues sur l'arc »). Celles qui n'en portent pas se lisent
**à l'encre**, mur par mur, et c'est l'IA qui les pose : le propriétaire accepte
qu'elles soient approchées, à condition que les murs soient justes. La méthode qui
marche : balayer l'axe du mur tous les centimètres et relever les plages sans
encre d'au moins 30 cm. Un balayage sur une seule ligne ne suffit pas — une
cloison de 7 cm fait deux pixels, et la hachure d'un mur épais donne des trous qui
n'en sont pas. Trois droites dans l'épaisseur (les deux faces et l'axe), et on
retient la plage où **aucune** n'a d'encre.

`--openings-only` garde les murs du modèle et n'ajoute que les baies des chaînes.
C'est le mode d'une maison dont les murs sont déjà justes : il ne touche ni aux
cloisons, ni aux pièces, donc les surfaces ne bougent pas. Sur le plan B, il a
ajouté les onze baies extérieures sans déplacer un seul sommet de pièce.

`--replace` jette les murs du modèle et ne garde que ce que le dessin donne. Ne
pas l'utiliser sur une vraie maison : les murs hachurés et les portes intérieures
disparaissent, et le garage perd environ un mètre carré. Le défaut est la fusion.

La fusion garde les murs du modèle — ils portent les murs hachurés et les portes
intérieures — mais elle ne jette plus ce que le dessin a calculé : les **baies**
prouvées par une chaîne et absentes du modèle sont reportées, par leur intervalle
monde et non par leur offset (deux murs voisins peuvent être à six centimètres
l'un de l'autre), et les **écarts d'épaisseur** entre le modèle et la cote
imprimée sont signalés. Sur le plan A, le modèle avait déjà les seize baies : la
fusion n'ajoute rien et le dit.

## Construire depuis un référentiel commun

Reconstruire les faces finies et les raccords depuis un seul référentiel de
coordonnées, puis en déduire les axes de murs et les polygones de pièces. Mètres
en interne ; x à droite, z vers le bas, y vers le haut. L'épaisseur est centrée
sur l'axe. Les décalages de baies suivent le mur orienté depuis son début :
convertir explicitement les coordonnées monde de la chaîne de cotes. Vérifier
séparément l'allège, le linteau, le niveau de sol et le débattement.

Préserver les identifiants, les niveaux de référence et le repère lors de la
correction d'un projet existant. Sauvegarder et inventorier les identifiants et
les changements avant remplacement. Ne pas importer une régénération par-dessus
l'agencement du navigateur du propriétaire, ni inventer du mobilier depuis les
données du dépôt.

Distinguer l'emprise au sol, la hauteur utilisable et la surface habitable
déclarée. Le schéma a des plafonds horizontaux, des volées droites (`stairs`) et
des trémies (`floorVoids`), mais pas de fenêtre de toit ni de plafond intérieur
en pente. Les maillages de toit représentent les enveloppes extérieures, pas ces
éléments manquants. Consigner l'emplacement source de chaque élément non pris en
charge et son effet sur la fidélité. Ne pas remplacer une trémie par un mur, une
fenêtre de toit par une fenêtre de façade, ni un niveau en pente par une boîte
pleine hauteur déclarée fidèle. Une volée tournante, un palier ou une volée
courbe sont approchés par des volées droites : déclarer l'approximation au lieu
de la présenter comme la géométrie dessinée. Un niveau supérieur provisoire peut
être fourni séparément avec ses limites explicites. Étendre le schéma est une
décision d'implémentation séparée, pas un champ JSON non documenté.

## Pièges de schéma qui ont coûté des itérations

`validateProject` rejette ces cas avant tout contrôle géométrique ; les traiter à
la saisie plutôt que de les découvrir un par un :

- chaque pièce a besoin d'un `label` et d'un `viewpoint` dans son polygone (le
  visiteur a besoin d'environ 0,17 m de dégagement) ;
- chaque niveau a besoin d'un tableau `lights` et d'une `ceilingHeight` positive,
  même sous un toit en pente (documenter la valeur retenue) ;
- les identifiants sont uniques sur tout le projet : préfixer par niveau (`wc`,
  `wc-etage`) ;
- les polygones doivent être simples (pas de croisement, pas d'arête répétée) ;
- les baies doivent tenir sous la hauteur du mur ou du plafond, les portes,
  coulissants et portes de garage partent du sol, et toute baie fait au moins
  10 cm de large et de haut ;
- les polygones de pièces, les libellés et les points de vue restent dans le
  contour du niveau ;
- les polygones de pièces s'arrêtent aux **faces finies** des murs, jamais sur
  leurs axes. Un polygone qui atteint l'axe recouvre le mur d'une demi-épaisseur :
  l'audit signale `room-solid-wall` et la surface de la pièce grandit en silence.
  Calculer chaque face en `axe ± épaisseur / 2` et l'utiliser des deux côtés de
  chaque cloison. Cette seule erreur explique la plupart des défauts trouvés dans
  trois reconstructions distinctes ; la vérifier avant de lire le moindre résidu
  de surface ;
- `planArea` est optionnel et positif ; c'est la valeur imprimée, jamais une
  cible à atteindre en bougeant des murs. Consigner **quelle** valeur imprimée
  c'est : un polygone de pièce est un plancher, donc il se compare à la surface
  utile (SU), pas à la surface habitable (SH). Les plans impriment souvent les
  deux, et leur différence est la partie sous pente ou sous escalier à moins de
  1,80 m de hauteur. Comparer un plancher à une SH fabrique un résidu qui se lit
  comme une erreur de géométrie : un hall imprimé `SH 5.19 / SU 6.97` montrait
  +2,08 contre la SH et +0,30 contre la SU, sans rien de faux dans le modèle.

## Vérifier

### La porte des surfaces

Le plan imprime la surface de chaque pièce — `SH : 13.03 m²`, `SA : 16.53 m²`.
C'est la seule mesure du document qui juge le résultat : une pièce dont la
surface calculée s'écarte de la surface imprimée est une pièce dont les murs sont
mal placés, quelle que soit la propreté du dessin.

```sh
python scripts/check_plan_surfaces.py registry.json projet.json --level rdc --page 8
```

Le script apparie chaque étiquette à la pièce qui la contient, calcule la surface
du polygone et rapporte l'écart. Tolérance : **0,05 m²**. Tant qu'une pièce est
hors tolérance, le plan n'est pas fini.

**Quelle surface comparer.** Un polygone de pièce est un **plancher**, donc un
SU. La SH est le plancher moins ce qui est sous 1,80 m de hauteur. Sur un niveau
à plafond plat les deux coïncident ; sous pente ou sous escalier, non. Quand le
plan imprime les deux, le script prend la **SU** — sur le plan B le hall imprime
`SH 5,19` et `SU 6,97`, et comparer au SH aurait affiché une fausse erreur de
1,78 m². Corollaire : c'est la SU qu'il faut stocker dans `planArea`, sinon l'app
affiche « contour à vérifier » sur une pièce juste.

État mesuré sur le RDC du plan A (page 8, 1/75), tolérance 0,05 m² :

| version                               | hors tolérance | total calculé |
| ------------------------------------- | -------------- | ------------- |
| modèle d'origine                      | 4              | 106,14 m²     |
| modèle corrigé, pièces calculées      | 1 (le hall)    | 106,29 m²     |
| génération seule, aucun mur à la main | 2 (hall, wc)   | 106,47 m²     |

Imprimé : 106,33 m². Les quatre écarts de départ étaient `chambre-1` +0,64,
`degagement` −1,26, `sejour` +0,58, `hall` −0,17. Deux cotes imprimées les ont
résolus : `chambre-1` parce que son décrochement fait **4,05 m** de large et non
4,77 (3,65 × 2,57 + 4,05 × 0,90 = 13,03), et le dégagement parce que le couloir
se prolonge jusqu'à z = 5,46 le long du retour de la salle de bains (cote 60).
Le séjour suivait.

Reste le hall, à −0,09, non résolu et documenté : le plan imprime 0,60 + 1,73 =
2,33 m² pour un bloc de 1,27 × 1,79 = 2,27 m². Et le WC de la génération seule,
à +0,09, parce que la cloison garage/WC fait 10,2 cm à l'aplat et 15 cm finie.

**Une surface ne s'hérite pas, elle se recalcule** — corriger un mur doit faire
bouger la pièce, et c'est cette porte qui le prouve.

Un écart de surface ne dit pas _quel_ mur corriger. Il dit qu'il y en a un. La
table `compare_plan.py --table` donne le candidat : `décalé` d'abord,
`épaisseur divergente` ensuite.

### Un niveau sous versant

Un niveau de combles ne se lit pas comme un rez-de-chaussée, et quatre choses y
trompent :

**Le plancher ne va pas jusqu'à la façade.** Le dessin porte un trait à 1,27 m de
chaque façade longue : c'est là que le versant touche le plancher. Ce trait est
la **limite du plancher**, pas une limite de hauteur. Le prendre pour une cloison
de 5 cm est correct ; l'ignorer fait déborder les pièces sous le toit. La preuve
est arithmétique : sur le plan B, la salle de bains fait 3,72 × 2,52 = 9,37 m²
entre ce trait et sa cloison sud, contre 9,38 imprimé.

**La limite H = 1,80 m est une autre ligne.** C'est un trait mixte, à 1,83 m et
6,67 m sur le plan B, et ce n'est pas un mur : elle sépare la SH de l'annexe.
Ne pas la confondre avec le rampant, et ne pas la poser en cloison.

Pour la retrouver, se méfier du hachurage : un trait mixte se reconnaît à ses
tronçons courts, mais la hachure d'un mur en produit aussi. Grouper les tronçons
courts fait donc apparaître de fausses lignes mixtes **dans l'épaisseur des
murs** — un WC du plan B s'est vu inventer une limite à z = 6,32 qui n'était que
sa hachure, et une pièce s'est fait couper en deux pour rien. Filtrer par longueur
cumulée par ligne, et confirmer sur le rendu avant de conclure.

**La page imprime trois tableaux, pas un.** `SURFACES HABITABLES`,
`SURFACES ANNEXES`, `SURFACES GARAGE`. La surface d'une pièce est
**SH + annexe** — c'est le plancher, donc la SU. Sur le plan B : dressing 5,51 +
1,61 = 7,12, salle de bains 7,67 + 1,71 = 9,38. Prendre la SH seule fait
afficher une fausse erreur sur chaque pièce.

**Le plancher déborde dans les chiens assis.** Un versant percé d'une lucarne
n'est pas un versant continu : le plancher de la pièce passe sous la lucarne et
va jusqu'à son mur de fond. Sur le plan B, deux chiens assis de 0,90 m de large
percent le versant sud (x 2,161..3,060 et 10,181..11,081) et ajoutent **0,75 m²**
chacun. C'est exactement l'écart des deux chambres 3 : 4,55 × 3,37 = 15,33 plus
0,77 de lucarne = 16,10 imprimé. Le rampant doit donc être **coupé** à chaque
baie et le contour du niveau porter les deux avancées. Un rampant continu laisse
les deux pièces courtes de 0,77 m² et fait croire à une contradiction du plan qui
n'existe pas.

**Et les surfaces imprimées ne se referment pas toujours.** Sur le plan B, après
reconstruction depuis les aplats et les traits, tolérance 0,05 m² :

| pièce           | imprimé | dessin | écart | cause                                                    |
| --------------- | ------- | ------ | ----- | -------------------------------------------------------- |
| salle de bains  | 9,38    | 9,37   | −0,01 | —                                                        |
| chambre 2       | 14,44   | 14,44  | 0,00  | —                                                        |
| chambre 3 ouest | 16,10   | 16,12  | +0,02 | 4,55 × 3,37 + 0,75 de lucarne                            |
| chambre 3 est   | 13,90   | 13,90  | 0,00  | 4,96 × 2,78 − 0,65 d'about du couloir + 0,75 de lucarne  |
| dressing        | 7,12    | 7,05   | −0,07 | placard technique : 0,25 au dessin, 0,19 dans le tableau |
| WC              | 1,24    | 2,01   | +0,77 | le tableau compte 0,85 × 1,46, la cote 0,85 × 2,39       |
| dégagement      | 4,14    | 3,48   | −0,66 | le tableau déplace 0,77 m² du WC vers le dégagement      |

Quatre pièces tombent juste. Les trois autres s'expliquent par le plan lui-même,
et deux se prouvent par une **somme**. Le WC et le dégagement forment **une seule
région ouverte** : aucun mur entre eux, seulement une porte de 0,85 m. Le tableau
coupe cette région ailleurs que le dessin, mais le total tombe : 1,24 + 4,14 =
5,38 imprimé, 2,01 + 3,48 = 5,49 au dessin, et 0,85 × 2,39 + 3,74 × 0,90 = 5,40
par les cotes du plan. C'est la répartition qui est arbitraire, pas la surface —
et c'est pour cela qu'un écart de surface ne dit jamais quel mur corriger. Le
dressing, lui, bute sur le placard technique : le tableau lui donne 0,19 m², le
dessin 0,25.

**On ne redimensionne pas une pièce pour faire tomber le nombre** : on garde la
géométrie du dessin, on stocke la surface imprimée, et on écrit la cause. Un
niveau sous versant demande donc sa propre passe de décision, comme le RDC — la
chaîne ne le devine pas.

Dernière approximation à déclarer : les fenêtres de toit et les lucarnes. L'app
ne modélise pas de toit, donc un velux se pose sur le rampant, à l'arête basse,
avec la largeur et la hauteur imprimées : c'est faux de 0,8 m en profondeur. Le
schéma de toiture ne porte que des pans et des pignons, donc **le volume d'une
lucarne n'existe pas** : son plancher se pose — il est réel et le tableau le
compte — mais son mur de fond doit rester sous la couverture, à 1,10 m au lieu
des 2,15 m dessinés, et sa fenêtre perd son allège. Une lucarne montée en pleine
hauteur traverse le toit de 0,83 m et se voit de l'extérieur.

### Le toit et le terrain se lisent aussi

Un projet sans `site` n'a pas de vue extérieure du tout : le bouton reste caché.
Le toit n'est pas une décision, il est imprimé — mais sur d'autres pages que le
plan de niveau.

| ce qu'on cherche              | où c'est imprimé                                                      |
| ----------------------------- | --------------------------------------------------------------------- |
| pente du toit                 | coupes : `PENTE = 45.00 °`                                            |
| hauteur d'égout et de faîtage | coupes et plan de masse : `Egout: +3.43`, `Faitage: +8.11`            |
| niveau du sol fini            | plan de masse : `RDC: +0.28` sur la référence `±0.00`                 |
| parcelle et reculs            | plan de masse : `32.60`, `16.00`, `3.61`, `17.35`, `Surface : 522 m²` |
| couleurs                      | insertion : façade crème, toiture ardoise                             |

**Tout ramener au repère du niveau**, pas à la référence du cartouche. Le plan de
masse donne `RDC: +0.28` : l'égout à `+3.43` vaut donc **3,15** au-dessus du sol
fini du RDC, et le faîtage **7,83**. Oublier cette soustraction pose le toit
28 cm trop haut, et les murs traversent.

**L'avalée se déduit, elle ne se lit pas.** La descente de faîtage à égout vaut
`7,83 − 3,15 = 4,68`. À 45°, la demi-portée vaut `8,50 / 2 = 4,25`. L'écart,
**0,43 m**, est le débord de toit. C'est ce qui fait tomber le faîtage au milieu
du bâtiment.

**Les pignons sont des index**, pas des sommets : `gables: [[6, 2, 7], [8, 3, 9]]`
pointe dans `vertices`, comme `faces`. Une liste de sommets est rejetée par
`validate.ts` avec « Géométrie de toiture invalide ».

**La vue extérieure est celle du bâtiment, pas du niveau affiché.** Les façades
viennent du niveau bas et le toit couvre le reste. Construire l'extérieur depuis
les combles ne montrait que le toit, et posait la pelouse à leur altitude.

**Les murs d'un niveau sous versant doivent rester sous le toit.** La hauteur
maximale d'un mur est `toit(z) − plancher`. Sur le plan B, le toit au rampant
vaut 4,80 pour un plancher à 2,75 : 2,05 m au plus. Un `ceilingHeight` de 2,5
laissait les cloisons traverser la couverture de 42 cm, visibles de l'extérieur.

#### Vérifier un extérieur déjà posé

Un `site` écrit lors d'une session précédente n'a jamais été comparé au
document. Les cinq étapes ci-dessous sont un script — le registre du plan de
masse se régénère par `extract_plan_evidence.py --pages <n>`, puis :

```sh
python scripts/check_site.py <registre-masse.json> <projet.json> --page <n>
```

Il rend un tableau imprimé / calculé / écart par point de contrôle, refuse ce
qui dépasse la tolérance en nommant le côté ou le niveau fautif, et signale le
non coté. La méthode reste la lecture de son rapport, dans cet ordre parce que
chaque étape suppose la précédente :

1. **Les quatre côtés de la parcelle et sa surface.** Calculer les longueurs et
   l'aire au lacet, comparer aux cotes et à `Surface :`. Un côté faux déplace
   tout le reste.
2. **Les reculs.** Distance de chaque côté au contour du niveau. C'est ce qui
   dit si la parcelle est bien _placée_, et non seulement bien dimensionnée :
   les longueurs peuvent tomber juste avec la maison au mauvais endroit.
3. **Les niveaux.** `Egout` et `Faitage` moins `RDC`, comparés aux `y` des
   sommets de toiture.
4. **La topologie du toit.** Compter les pignons et les égouts sur les quatre
   façades, et les retrouver dans `gables` et `faces`. Un pignon de trop se voit
   de l'extérieur.
5. **Les surfaces de terrain.** Voir ci-dessous : une seule est cotée.

Sur le plan A, l'étape 2 est celle qui a payé. Les quatre côtés tombaient juste
(32,03 / 19,32 / 28,33 / 14,01 pour 496 m²), mais il fallait encore vérifier que
la maison est à **9,40 m** de la limite de 14,01 m — la cote est imprimée — et
affleurante à celle de 32,03 m, où la chaîne `10,08 | 12,55 | 9,40` place la
façade de 12,55 m entre deux retours. Les deux autres reculs, 6,40 et 4,04 m,
se déduisent alors et ne sont cotés nulle part.

**L'égout du dessin n'est pas l'égout coté.** Sur la façade sud du plan A, la
hauteur mesurée entre l'arête basse des ardoises et le faîtage vaut 3,13 m, pour
3,32 m cotés. Ce n'est pas une erreur de 19 cm : le trait du dessin est le dessus
de la gouttière, la cote `Egout` est la ligne d'eau. Un écart de 15 à 20 cm à cet
endroit est normal — ne pas « corriger » le toit pour le faire tomber.

**Une seule surface de terrain est cotée.** Le plan de masse cote l'entrée
charretière (`5.00m x 5.00m` sur le plan A, `6.00x6.00m` sur le plan B) et rien
d'autre : le reste du gravillon, l'accès au garage et le chemin vers l'entrée
sont dessinés mais pas mesurés. Les écrire est une décision, pas une lecture.
Les déclarer dans `site.notes` — le panneau « Terrain et extérieur » les
affiche — plutôt que de les laisser passer pour des cotes.

### Les pièces se calculent depuis les murs

Un polygone de pièce saisi à la main est une opinion. `plan_faces.py` ferme le
niveau, découpe le plan aux faces de murs, remplit les cellules libres et rend
la surface exacte de chaque région. Aucune cellule ne peut traverser un mur, donc
la surface est un calcul, pas une détection.

```sh
python scripts/plan_faces.py projet.json --level rdc --compare
```

`--apply` remplace le polygone des pièces **fermées** par le contour calculé, et
laisse les espaces ouverts tels quels en le disant. C'est ce qui supprime les
retours de cloison qui dépassaient dans une pièce : sur le plan A, sept pièces
repassent au contour exact et l'audit tombe de huit réserves à une.

Il répond à une question que la porte des surfaces ne peut pas poser : **les murs
ferment-ils vraiment les pièces ?** Sur le plan A, avant correction, le séjour,
le dégagement et le hall ne formaient qu'une seule région de 45,46 m² : aucun mur
ne les séparait. C'est normal — ce sont des zones d'un même espace ouvert — mais
il faut le savoir avant de lire un écart de surface.

Deux conséquences :

- une **zone ouverte** n'a pas de surface propre. Sa limite est une convention,
  et le plan peut se contredire. Sur le plan A, `placard` + `hall` impriment
  0,60 + 1,73 = 2,33 m² pour un bloc de 1,27 × 1,79 = 2,27 m² : les cotes du plan
  ne se referment pas sur 0,06 m². On documente l'écart, on ne bouge pas un mur
  pour faire tomber le nombre ;
- une pièce dont le polygone diffère de la région sous son centre est un
  **polygone faux**, pas un mur faux. `--compare` le dit pièce par pièce.

### L'audit interne

Lancer `validateProject`, puis l'audit déterministe. Il rapporte les
chevauchements pièce/pièce, les intersections pièce/mur plein, les murs
colinéaires en double, les abouts de murs qui s'arrêtent juste avant un autre
mur, les cloisons qui flottent hors du contour ou au-dessus d'une trémie
déclarée (`wall-over-void`), les pièces qu'aucun passage de plain-pied
n'atteint, un point d'apparition hors de toute pièce, le dégagement du
visiteur et les résidus de surface déclarée. Résoudre les chevauchements
accidentels, les cloisons doublées, les abouts presque joints et les passages
bloqués. Enquêter sur les résidus de surface ; garder `planArea` à part et
expliquer les différences par la preuve. Un accord de surface ne suffit pas.

```sh
node --import tsx scripts/audit-plan.ts artifacts/plan-review/house.json > artifacts/plan-review/house-audit.json
```

L'audit rapporte les intersections de polygones, les surfaces de pièces, les
extrémités monde des baies, le dégagement des murs, les murs en double, les
écarts d'about et un remplissage par diffusion sur grille depuis le point
d'apparition à travers les baies franchissables de plain-pied (`reachedRooms`).
Il soustrait du footprint des murs les baies franchissables de plain-pied ; les
fenêtres restent pleines. Il n'établit ni la fidélité à la source, ni le
débattement des vantaux, ni les seuils, ni le mobilier, ni la justesse complète
des raccords. Ne jamais ajuster la géométrie automatiquement pour verdir son
rapport.

Un compte `reachedRooms` n'a de sens que lorsque les murs sont fermés. Un vide
laissé entre deux pièces laisse passer le remplissage et rapporte une
connectivité complète alors qu'aucune porte ne dessert la zone ; fermer le mur
d'abord, puis lire le compte. Un résidu qu'on ne peut pas déduire des cotes
imprimées est une trouvaille, pas un arrondi : énoncer la plage que produit
l'ambiguïté et marquer non résolu, au lieu de bouger un mur jusqu'à ce que le
nombre tombe juste.

**Le cas symétrique existe et il est plus vicieux** : une pièce peut être
atteinte par un interstice qui ne devrait pas exister. Sur le plan B, la salle
d'eau n'a aucune porte et se lisait pourtant comme atteinte, parce que le
polygone des WC s'arrêtait 24 cm avant le mur sud et que le remplissage passait
sous le murêt. Un `reachedRooms` complet n'est donc pas une preuve de plan
correct : il faut lire **par où** on passe. Le test qui tranche est de fermer le
mur manquant et de regarder si la pièce devient inatteignable — si oui, c'était
bien un interstice.

Lire les propres drapeaux de l'audit avant de rapporter. Il renvoie
`sourceVerified: false` et `browserInspected: false` parce qu'il contrôle la
cohérence interne, pas la fidélité au plan. Un rapport propre veut dire « pas de
chevauchement, pas de mur non joint, pas de pièce inatteignable » — rien de plus.
Annoncer un niveau corrigé sur cette base est l'erreur qui cache toutes les
autres.

### La comparaison à la source

Comparer un plan généré à la source avec un calque calibré indépendamment.
Inspecter les décrochements de périmètre, les jonctions de cloisons, les tableaux
et les ancrages asymétriques qui détectent un miroir. Consigner les résidus et
l'incertitude en pixels de la source. Ne jamais calibrer sur la géométrie de
sortie. Puis rendre la comparaison numérique avec
`scripts/compare_plan.py projet.json calibration.json rapport.json` : pour chaque
mur il cherche un trait sombre à `-épaisseur/2` et un autre à `+épaisseur/2`, et
rapporte le décalage d'axe, l'épaisseur mesurée et un verdict. Un mur sans
contrepartie est inventé ; un mur dont l'épaisseur diverge est déclaré faux. Cela
attrape en une passe ce qu'un calque visuel ne fait que suggérer.

```sh
python scripts/overlay-plan.py projet.json calibration.json overlay.png
```

Le JSON de calibration fournit `image`, `level`, trois `anchors` non colinéaires
et des `checks` indépendants, chacun avec `world: [x,z]` et `pixel: [u,v]`.
L'outil demande Pillow et écrit un rapport de résidu de calibration à côté du
calque. Le rendu de la source et l'interprétation des ancrages restent des
entrées explicites.

`compare_plan.py --table` imprime une ligne par mur : verdict, décalage mesuré,
épaisseur lue, épaisseur déclarée. C'est la liste de travail.

- `aligné` — rien à faire.
- `épaisseur divergente` — le mur dessiné est plus épais ou plus fin que déclaré.
  Corriger par une surcharge, pas en régénérant.
- `contrepartie partielle` — le mur est interrompu dans le dessin (un cadre de
  fenêtre se lit comme un mur plus fin). Vérifier avant de conclure.
- `décalé` — le mur est au mauvais endroit. C'est celui qui compte.
- `aucune contrepartie` — le mur est inventé.

Quatre outils complètent ce calque, dans `scripts/` : `grid_page.py` rend une
page de plan PDF avec une grille en mètres, pour lire une épaisseur ou une cote
contre le modèle ; `overlay_page.py` dessine les murs et pièces du projet
par-dessus la planche ; `model_plan.py` rend un niveau depuis le JSON seul, pour
vérifier ce que le modèle dit sans le dessin ; `wall_joins.py` liste les abouts
de murs qu'aucun autre mur ne couvre. Les trois premiers prennent le numéro de
page **à partir de 1** comme le reste du dépôt, un repère `(ox, oy, échelle)` en
points affichés de la page tournée, et impriment la page lue. `wall_joins.py` a
révélé une cloison flottant hors du plancher — l'audit la signale désormais
(`interior-wall-outside-outline`) — et reste la liste de travail des abouts
libres, l'autre façon de trouver un mur inventé ou un raccord manquant.

### Le navigateur

Importer dans un vrai navigateur. Inspecter chaque niveau en Plan et en vue
d'ensemble, l'extérieur s'il est fourni, et traverser les portes disponibles.
Vérifier les angles, les murs en double ou qui dépassent, les baies flottantes ou
bouchées, les niveaux de sol, le dégagement du point d'apparition et les
relations plafond/toit. Consigner les captures et les vues réellement inspectées.
Les tests NullEngine et DOM ne remplacent pas la revue visuelle. Confirmer que la
géométrie nouvelle se lit dans la projection **Plan**, pas seulement en 3D : une
vue orthographique de dessus éclaire toutes les faces horizontales à l'identique,
donc une volée d'escalier partageant le matériau du sol devient invisible, comme
tout objet dont la face supérieure a la couleur de la surface en dessous. Donner
à cette géométrie un matériau distinct et vérifier sur une capture plutôt qu'en
raisonnant sur la scène.

**Comment obtenir la capture.** Le projet est git-ignoré, donc il ne suffit pas
d'ouvrir l'URL : il faut l'injecter dans le stockage local avant le rendu.

```sh
npx vite --host 127.0.0.1 --port <libre> --mode private
```

Puis un script Playwright qui, dans cet ordre : injecte le projet sous
`maison-atelier:projects:v1`, pose `maison-atelier:last-project` à son `id`,
met `maison-atelier:onboarding` à `{version: 1, cardSeen: true}`, recharge,
attend trois secondes, ferme le panneau « premiers pas » (il masque le bas de la
vue), puis clique `Vue 3D`, `Extérieur`, `Plan`, `Visite`. Couper les requêtes
externes avec `page.route` pour que la capture ne dépende pas du réseau.

Deux pièges : un port fixe entre en collision avec les autres agents et avec la
suite e2e, qui prend le sien — en tirer un au hasard ; et l'état de la vue est
mémorisé, donc une capture « Plan » après une capture « Visite » ne montre pas
la même chose qu'au premier lancement.

Puis corriger le registre et le modèle, et refaire les contrôles concernés.
Lancer les vérifications CI et de confidentialité applicables ; ne publier que
par le flux de pull request du dépôt.

## Retoucher sans refaire

Un mur généré n'est pas définitif. `--overrides` prend un petit fichier appliqué
après génération :

```json
{
  "walls": { "ext-4": { "thickness": 0.42, "offset": 0.02 } },
  "openings": { "ext-3-o1": { "offset": 1.5, "width": 0.9 } }
}
```

Une correction vise un mur et survit à une régénération. Corriger trois murs ne
veut jamais dire refaire les vingt autres. Garder ce fichier à côté du projet,
pas dans le dépôt.

Les **portes intérieures** ne passent pas par là : `--overrides` ne sait pas
ajouter une baie, seulement déplacer ou redimensionner une baie existante. Elles
s'écrivent donc directement dans le projet, après la génération, avec leur
justification en commentaire du script qui les pose. C'est la seule couche qui
n'est pas reproductible depuis le PDF, et c'est assumé : le propriétaire veut
pouvoir les retoucher à la main dans l'interface, plus tard. Les murs, eux, ne se
retouchent pas à la main.

Un mur manquant se corrige aussi à la main, et il faut le chercher : ni la porte
des surfaces ni l'audit ne signalent un mur absent. Sur le plan B, le mur ouest
des WC n'existait pas — les WC étaient ouverts sur le hall sur 1,60 m — et rien
ne le disait. Ce qui l'a montré est le calque : les murs du modèle en orange
par-dessus le dessin, et une bande hachurée du dessin sans orange en dessous.
Faire le calque à chaque passe, pas seulement à la fin.

**Le cas symétrique — un mur que le dessin ne porte pas — est passé trois fois.**
Une surface reste juste, `reachedRooms` reste complet et l'audit ne dit rien :
aucune des trois portes ne voit un mur **de trop**. Quatre murs inventés ont
survécu à trois passes et c'est le propriétaire qui les a vus, sur les deux
plans, en une seule revue. Deux visages à connaître :

- le mur posé pour fermer un contour : une cloison droite inventée pour qu'un
  rectangle de pièce tombe à la surface imprimée, alors que le dessin ouvre la
  pièce en L sur sa voisine (mur double, vide mort de 20 cm au sol) ; et une
  cloison droite dans un alinéa où le dessin ne porte qu'une cote et un
  pointillé (deux portes en série vers une même pièce) ;
- le mur hérité qui flotte ou qui ferme : une cloison entièrement hors du
  plancher du niveau, dont le plancher s'arrête au rampant, qui pend sous la
  maison en 3D ; et une cloison qui ferme hermétiquement une cage d'escalier —
  une volée descend depuis le palier, rien ne peut la murer.

Le visage combles du second cas : au plan B, une cloison collée au flanc est de
la volée dans les combles — x 5,795, aucun aplat dans l'extrait — alors que le
dessin ouvre la trémie jusqu'au mur des WC (x 6,15) et n'y montre qu'un
garde-corps. Le piège vient du remplissage : la cloison ferme la trémie pour
que `reachedRooms` ne passe pas par le vide, et l'inventé survit parce que la
trémie est déclarée `floorVoids` et qu'aucune pièce ne borde la face. La
réponse du propriétaire, une revue 3D plus tard : « un mur en trop à l'étage ».

La variante trémie n'attend plus la revue du propriétaire pour se voir :
`audit-plan.ts` signale désormais tout mur plein qui chevauche un
`floorVoids` déclaré (`wall-over-void`, seuil 0,01 m² ; un mur qui affleure la
face de la trémie reste sous le seuil). Les autres visages restent là :
`compare_plan.py` (« aucune contrepartie ») et le calque orange.
Un mur de contour inventé vient presque toujours d'un polygone calé sur la
surface imprimée au lieu d'être calé sur les faces : corriger le polygone,
garder la surface imprimée dans `planArea`, documenter le résidu — jamais
l'inverse. Une cage ouverte sur son palier n'est pas un trou : tant que `stairs`
et `floorVoids` ne sont pas déclarés, elle se rend nue, et c'est un manque
déclaré, pas un défaut à murer.

## Livrer un état d'achèvement honnête

Fournir le JSON importable local, le registre de preuve, les changements
avant/après, le rapport d'audit et les résultats de comparaison à la source et de
revue navigateur. Énoncer les résidus maximaux mesurés et les éléments non
résolus au lieu d'un pourcentage d'exactitude inventé. Marquer le résultat
provisoire tant que des dimensions matérielles, la comparaison à la source ou les
contrôles visuels restent non résolus. Nommer précisément la preuve manquante. Ne
pas revendiquer la perfection, une exactitude de relevé ou un déploiement sans la
preuve correspondante.

Donner la répartition, pas un pourcentage : quels murs viennent du dessin, quels
murs viennent du modèle, quelles baies manquent, quelles pièces sont hors
tolérance et de combien. Un plan dont le garage est à 1 m² est un plan à
corriger, pas à présenter.

## Fermer la boucle

Ce skill est un document de travail, pas une procédure finie. Après une passe de
conversion, avant de la déclarer terminée :

1. **Demander au propriétaire ce qu'il faut changer.** Nommer les choix concrets
   faits et demander lesquels sont faux ou manquants : le fichier source retenu,
   la page du niveau, les épaisseurs de murs gardées, les baies laissées non
   résolues, l'automatisation faite à la main, l'écart de surface qu'il remarque
   en premier. Le propriétaire connaît la maison et le constructeur ; l'IA sait
   ce que les scripts ont fait. Aucune des deux moitiés ne suffit seule.
2. **Consigner la réponse dans ce fichier**, dans la section à laquelle elle
   appartient, pas dans un journal de conversation. Une correction qui reste dans
   un échange est perdue à la session suivante.
3. **Transformer le travail manuel répété en étape de script.** Si la même chose a
   été faite deux fois à la main — localiser la page du niveau, lire une échelle,
   apparier des faces, placer une ligne de cote — elle appartient à `scripts/`,
   avec une fixture et une étape de CI. N'automatiser que ce qui se vérifie : une
   étape qui devine en silence est pire qu'une étape manuelle écrite noir sur
   blanc.
4. **Garder l'échec dans le skill.** Une conclusion fausse qui a coûté une
   session (un scan pris pour la seule source, un mur prouvé par la façade
   opposée) vaut plus qu'une réussite, à condition que le piège soit écrit là où
   la session suivante le lira.

Poser les questions une fois, à la fin de la passe, sous forme de liste courte et
précise. Ne pas demander confirmation à chaque étape : le propriétaire a demandé
le travail, pas un commentaire continu.

## Sauvegarder les projets personnels

Un projet `private-*.json` n'existe qu'à deux endroits : le clone local et le
stockage du navigateur. Perdre le clone, c'est perdre la maison.

```sh
pnpm run backup:private
```

Copie chaque `public/projects/private-*.json` vers `reference-documents/<id>.json`.
**À lancer après chaque passe de décision**, pas seulement à la fin : une copie
qui date de trois passes est pire qu'aucune copie, parce qu'elle a l'air d'une
sauvegarde. Sur une session réelle, les deux copies avaient dérivé de trois clés
et de dix clés — dont tout le `site` du second plan, ajouté après la copie.

`reference-documents/` peut être une **jonction** vers un dossier synchronisé
(kDrive, OneDrive) : les scripts n'y voient aucune différence, et les PDF comme
les copies sortent du dépôt. Le dossier est git-ignoré, donc git ne traverse
jamais la jonction. Vérifier après création que
`reference-documents/plans-emieville.pdf` s'ouvre : une jonction cassée se voit à
l'ouverture, pas à la création.

Garder les états intermédiaires dans `reference-documents/historique/` plutôt que
de les écraser : un modèle provisoire faux est la preuve de ce qui a échoué, et
c'est ce qui a permis de comprendre pourquoi le second plan ne tenait pas.
