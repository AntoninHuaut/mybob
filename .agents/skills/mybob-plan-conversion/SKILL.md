---
name: mybob-plan-conversion
description: Reconstruct or regenerate Mybob house JSON from architectural PDFs. Splits what a script may do (measure, compute, verify) from what the AI must decide (which wall, which thickness, which dimension), gates the result on the surfaces printed in the plan, and records the traps that already cost a session.
---

# Du PDF au plan Mybob

Livrer une reconstruction fidèle et traçable dans le schéma actuel. Un JSON
importable n'est que la première porte technique : ne pas promouvoir une
géométrie devinée au rang de conversion terminée parce qu'elle passe la
validation.

Lire `AGENTS.md`, le journal de passation local `docs/HANDOFF.md` (ignoré par
git, présent sur le clone du propriétaire), `docs/PROJECT-FORMAT.md`,
`src/model/types.ts` et `src/model/validate.ts`. Suivre le skill de maintenance
pour toute modification du dépôt. Garder les plans d'origine, les pages rendues,
les registres de preuve, les calques et les bundles personnels dans les
répertoires ignorés (`reference-documents/`, `artifacts/plan-review/`). Un projet
personnel qui doit vivre sous `public/projects/` suit la convention
`private-*.json` (ignorée par git) ; `scripts/check-public-build.mjs` reste
l'autorité sur ce qui peut être publié. Ne jamais ajouter de donnée personnelle à
la liste blanche des ressources publiques.

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

| script                     | ce qu'il fait                                        | exactitude                                                              |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `extract_plan_evidence.py` | lit cotes, chaînes, étiquettes de surface            | **100 %** — lecture, aucune interprétation                              |
| `check_plan_surfaces.py`   | compare surfaces imprimées et polygones du projet    | **100 %** — calcul, c'est la porte de sortie                            |
| `compare_plan.py`          | mesure l'encre sous chaque mur du modèle             | **100 %** — mesure, ne corrige rien                                     |
| `audit-plan.ts`            | cohérence interne du projet                          | **100 %** — calcul                                                      |
| `check-plan-decisions.ts`  | arithmétique des décisions et rejeu de l'enveloppe   | **100 %** — calcul                                                      |
| `extract_plan.py`          | cloisons, par l'aplat de couleur du dessin           | **100 % sur les cloisons**, aveugle sur les bandes hachurées            |
| `generate_project.py`      | murs extérieurs depuis le contour, baies des chaînes | **exact mais incomplet** : n'invente jamais, oublie ce qu'il ne lit pas |

Les deux derniers sont les seuls qui produisent de la géométrie. Ils sont
utilisables parce qu'ils n'inventent rien : `extract_plan.py` ne rend que des
rectangles remplis, `generate_project.py` ne place une baie que sur une chaîne
refermée. Ce qu'ils ne savent pas lire manque, et c'est à l'IA de le voir.

## Établir la preuve avant de générer

Inventorier les fichiers source réels, leurs empreintes SHA-256, le nombre de
pages, les titres de dessin, les identifiants de projet, les dates et les
révisions. Séparer les maisons différentes et les dessins périmés. Vérifier que
les fichiers existent localement : un ancien résumé, un JSON existant ou des
notes de modèle ne remplacent pas la source. Si une source essentielle manque,
continuer le travail d'audit indépendant et réclamer cette source ; ne pas
déclarer vérifié un ancien JSON régénéré.

Une maison a souvent plusieurs PDF, et le nom évident n'est pas le bon. Un
`Plans VP.pdf` s'est révélé être un scan de 15 pages d'une édition antérieure
alors que l'original vectoriel dormait à côté sous `Plans.pdf` ; une session
entière a conclu que la maison n'avait pas de plan vectoriel. Avant d'accepter
une source, lister tous les fichiers candidats de cette maison et les comparer
sur `page.get_drawings()` et `page.get_text("words")`. Préférer le vectoriel, et
dire quel fichier et quelle page ont servi. Quand le propriétaire mentionne un
document introuvable, demander son emplacement plutôt que de substituer le nom le
plus proche.

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
construction ne commence pas sur une supposition.

```sh
uvx --from pymupdf python scripts/extract_plan_evidence.py plan.pdf artifacts/plan-review/registry.json --pages 13,14
uvx --from pymupdf python scripts/derive_plan_decisions.py project.json artifacts/plan-review/registry.json rdc artifacts/plan-review/decisions.json --pages 13
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
aucune donnée réelle et doit le rester.

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

Deux limites mesurées sur de vrais plans : **les portes intérieures ne sont pas
extractibles** — elles sont dessinées en polylignes, pas en arcs, et leurs
libellés sont du texte vectorisé, donc ni l'arc ni le texte ne se lisent ; et une
façade dont les baies ne sont que des cotes isolées (pas une chaîne fermée) ne
donne aucune baie. Les deux se rapportent comme manquantes, jamais inventées.

`--replace` jette les murs du modèle et ne garde que ce que le dessin donne. Ne
pas l'utiliser sur une vraie maison : les murs hachurés et les portes intérieures
disparaissent, et le garage perd environ un mètre carré. Le défaut est la fusion.

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
hors tolérance, le plan n'est pas fini. Vérifier d'abord que l'étiquette comparée
est bien la surface de plancher (voir le piège `planArea` ci-dessus) : sur un
niveau à plafond plat, SH et SU coïncident ; sous pente, non.

État mesuré sur Émiéville RDC (page 8, 1/75), tolérance 0,05 m² :

| version                | pièces hors tolérance | garage   | total calculé |
| ---------------------- | --------------------- | -------- | ------------- |
| modèle                 | 4                     | exact    | 106,14 m²     |
| fusion (défaut)        | 5                     | exact    | 106,27 m²     |
| génération `--replace` | 6                     | −1,04 m² | 105,10 m²     |

Imprimé : 106,33 m². Les quatre écarts du modèle sont `chambre-1` +0,64,
`degagement` −1,26, `sejour` +0,58, `hall` −0,17. La fusion les hérite : elle
remplace des murs, pas des surfaces. **Une surface ne s'hérite pas, elle se
recalcule** — corriger un mur doit faire bouger la pièce, et c'est cette porte
qui le prouve.

Un écart de surface ne dit pas _quel_ mur corriger. Il dit qu'il y en a un. La
table `compare_plan.py --table` donne le candidat : `décalé` d'abord,
`épaisseur divergente` ensuite.

### L'audit interne

Lancer `validateProject`, puis l'audit déterministe. Il rapporte les
chevauchements pièce/pièce, les intersections pièce/mur plein, les murs
colinéaires en double, les abouts de murs qui s'arrêtent juste avant un autre
mur, les pièces qu'aucun passage de plain-pied n'atteint, un point d'apparition
hors de toute pièce, le dégagement du visiteur et les résidus de surface
déclarée. Résoudre les chevauchements accidentels, les cloisons doublées, les
abouts presque joints et les passages bloqués. Enquêter sur les résidus de
surface ; garder `planArea` à part et expliquer les différences par la preuve.
Un accord de surface ne suffit pas.

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
