# Architecture — carte du code

Ce document existe pour éviter de relire tout `src/` à chaque tâche. Lire cette page, puis
seulement les fichiers de la zone concernée. Les règles produit et les contraintes de
livraison sont dans [AGENTS.md](../AGENTS.md) ; le format des données dans
[PROJECT-FORMAT.md](PROJECT-FORMAT.md).

## En une minute

Application statique Vite + TypeScript + Babylon.js 9. Aucun backend, aucun compte : tout
l'état persistant vit dans le `localStorage` du navigateur.

- `src/main.ts` — composition de l'interface et **état de l'écran** : mode courant, sélection,
  préférences, projets. Il possède le DOM.
- `src/scene/viewer.ts` — la scène Babylon : caméras, modes, coupe, éclairage, mesures,
  collisions. Il possède le rendu.
- `src/model/` — données pures : types, validation, géométrie. Ni DOM ni Babylon.
- `src/furniture/` — meubles : modèle, placement, groupes, historique, couche de rendu.
- `src/ui/` — fragments HTML purs et panneaux autonomes.

Les deux mondes se parlent dans un seul sens à la fois : `main.ts` appelle des méthodes du
viewer, et le viewer remonte par des callbacks (`onModeChange`, `onFrame`, `onSelectRoom`,
`onDestination`, `onMeasure`, `onEditFurniture`).

## Carte des modules

| Zone                   | Fichier                                 | Rôle                                                                |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| Composition            | `src/main.ts`                           | Câblage DOM, `setMode`, projets, préférences, raccourcis            |
| Moteur                 | `src/scene/engine.ts`                   | Moteur WebGL, message si l'accélération graphique manque            |
| Scène                  | `src/scene/viewer.ts`                   | `HouseViewer` : modes, caméras, coupe, ombres, mesures, portes      |
| Géométrie de la maison | `src/scene/buildHouse.ts`               | Murs, sols, plafonds, menuiseries, portes                           |
| Arêtes de mur          | `src/scene/beveledBox.ts`               | Boîte à arêtes chanfreinées, pour les murs                          |
| Angles verticaux       | `src/scene/cornerBead.ts`               | Chanfrein des angles concaves entre deux murs                       |
| Extérieur              | `src/scene/buildExterior.ts`            | Façades, toiture, terrain                                           |
| Matériaux              | `src/scene/materials.ts`                | Matériaux partagés, carrelage procédural                            |
| Relief et rugosité     | `src/scene/surfaceTextures.ts`          | Normal maps et roughness maps procédurales, tuilées au mètre        |
| Repère                 | `src/scene/coordinates.ts`              | Passage au repère du plan, cadrage plan, déplacement clavier        |
| Cadrage                | `src/scene/framing.ts`                  | `fitOverview`, `fitPlan`, marges d'interface                        |
| Navigation             | `src/scene/navigation.ts`               | Destination de visite, plan de coupe, mur face caméra               |
| Caméra de visite       | `src/scene/walkCamera.ts`               | Hauteur du regard, rayon visiteur, vitesse, pas                     |
| Coupe des murs         | `src/scene/wallCutaway.ts`              | `auto` / `full` / `low`, plans de découpe par matériau              |
| Ouvertures en plan     | `src/scene/planOpenings.ts`             | Baies et portes dessinées dans la vue Plan                          |
| Ambiance de visite     | `src/scene/interiorAmbience.ts`         | IBL locale, TAA, occlusion, bloom, repli sous 24 fps                |
| Diagnostic             | `src/scene/diagnostics.ts`              | `mybob.diag()` : moteur, GPU, cadence, résolution, scène            |
| Mesure                 | `src/scene/measurement.ts`              | Accrochage aux axes du plan                                         |
| Soleil                 | `src/scene/solar.ts`                    | Équations NOAA, fuseaux IANA                                        |
| Données                | `src/model/types.ts`                    | Format versionné (`schemaVersion: 1`)                               |
| Validation             | `src/model/validate.ts`                 | Contrôle à l'import, erreurs lisibles                               |
| Géométrie pure         | `src/model/geometry.ts`                 | Surfaces, appartenance, tronçons de mur, altitude du sol            |
| Meubles — modèle       | `src/furniture/model.ts`                | Types, identifiants, clé de stockage, historique                    |
| Meubles — rendu        | `src/furniture/layer.ts`                | Maillages, sélection, glisser, calques, découpe en plan             |
| Meubles — placement    | `src/furniture/placement.ts`            | Contraintes bâtiment, recherche de place                            |
| Meubles — groupes      | `src/furniture/groups.ts`               | Liaison, transformations, glisser contraint                         |
| Meubles — édition      | `src/furniture/editorDraft.ts`          | Brouillon transactionnel de la popup                                |
| Meubles — panneau      | `src/furniture/panel.ts`                | Liste, ajout, popup d'édition                                       |
| Meubles — variantes    | `src/furniture/variants.ts`             | Livre de variantes par projet                                       |
| Meubles — session      | `src/furniture/layoutSession.ts`        | Chargement/écriture par projet et niveau                            |
| Interface              | `src/ui/appTemplate.ts`                 | Gabarit statique de l'application                                   |
| Textes de mode         | `src/ui/modeChrome.ts`                  | Titres, aides clavier et tactile par mode                           |
| Compteur de cadence    | `src/ui/frameRate.ts`                   | Affichage des fps, écriture limitée à quatre par seconde            |
| Panneaux               | `src/ui/roomPanels.ts`, `minimap.ts`    | Liste des pièces, fiche, plan miniature                             |
| Aide et accueil        | `src/ui/firstSteps.ts`, `onboarding.ts` | Carte « Premiers pas », aide courte et complète                     |
| Export image           | `src/ui/imageExport.ts`                 | PNG de la caméra, cartouche, options                                |
| Banc d'essai (dev)     | `src/ui/fxLab.ts`                       | Poussière, chanfrein d'angle, SSAO forcé — jamais dans un build     |
| Styles                 | `src/style.css` + `src/style/*.css`     | `chrome`, `scene`, `feedback` ; `furniture/panel.css` pour la popup |

## Le flux d'une donnée

```text
public/projects/*.json
  → validateProject()            src/model/validate.ts
  → HouseViewer.load()           src/scene/viewer.ts
      → buildHouse()             murs, sols, portes
      → buildExterior()          façades, toiture, terrain
      → buildWallCutaway()       plans de découpe
      → buildPlanOpenings()      baies en plan
  → FurnitureLayer               src/furniture/layer.ts
  → localStorage                 clés ci-dessous
```

Clés de stockage, toutes préfixées `maison-atelier:` — `projects:v1` (projets importés),
`layout:v1:<projet>:<niveau>` (aménagement), `variants:v1:<projet>`, `navigation:v1`,
`onboarding`, `solar:<projet>`, `last-project`. Changer une clé casse les données locales :
ne le faire qu'avec une migration.

## Les trois modes et leur état — le point le plus fragile

`overview`, `plan` et `walk` existent **deux fois** : `mode` dans `src/main.ts` (ce que
montre l'interface) et `viewer.mode` dans `src/scene/viewer.ts` (ce que rend la scène).

- `main.setMode(next, fromViewer)` est le seul point d'entrée de l'interface. Il pose `mode`,
  appelle `viewer.setMode(next)` si nécessaire, puis met à jour les boutons, les titres,
  les aides et `syncDisplayControls()`.
- `viewer.setMode()` peut **refuser** : sans destination de visite valide, il appelle
  `onDestinationRejected` et sort sans changer `viewer.mode`. `main.setMode` relit alors
  `viewer.mode` et rend `false` : c'est pour cela que `setMode` retourne un booléen.
- `viewer.onModeChange` remonte vers `main.setMode(next, true)`. Le drapeau
  `syncingViewerMode` empêche la récursion quand c'est `main` qui a déclenché le changement.
- Ne jamais écrire `viewer.mode` directement, ni changer de caméra active hors de
  `viewer.setMode` : la coupe (`updateSection`), les découpes (`updateCutaway`), les ombres
  (`updateShadowPolicy`) et l'ambiance sont toutes dérivées de `viewer.mode`.

Symptôme d'une désynchronisation : l'interface affiche encore « Plan » alors que la caméra
marche, ou l'inverse. Toute nouvelle façon d'entrer en visite doit passer par `main.setMode`
ou par une méthode du viewer qui appelle `setMode` (comme `goTo` et `focusRoom`).

## Visite et rendu

- Vitesse de marche 2,8 m/s par défaut, réglable de 1 à 5 m/s ; Maj multiplie par 1,7. La
  sensibilité du regard va de 50 à 200 %. Les deux réglages sont locaux
  (`maison-atelier:navigation:v1`) et s'appliquent à tous les projets.
- Tone mapping ACES, intensités ciel et soleil réduites. Le bouton Lumière ne commande que les
  luminaires intérieurs, jamais le soleil.
- La visite a sa propre ambiance : environnement cubique généré localement (aucun fichier
  distant) pour un reflet ambiant, lisible surtout sur le verre et l'acier ; le relief vient de
  l'occlusion ambiante et des luminaires du niveau, renforcés parce que le plafond masque le
  soleil. Cet environnement est en **demi-flottants**, donc linéaire et au-delà du blanc : la
  baie et le luminaire y valent plusieurs fois un mur, ce qui donne aux reflets un point chaud
  au lieu d'une tache grise. Il est généré en 128 px — un reflet n'en résout pas plus, et les
  six faces coûtent une trentaine de millisecondes à l'entrée en visite. Plan et Vue 3D gardent
  leur éclairage : l'environnement et le tampon de géométrie ne sont attachés qu'en visite et
  libérés en sortie, et l'environnement précédent est restauré plutôt qu'effacé. Avec un aperçu
  solaire appliqué, l'ambiance suit le soleil comme ailleurs.
- Les murs sont des boîtes à arêtes chanfreinées (`beveledBox.ts`, 4 mm) : un angle vif est le
  marqueur n°1 de l'image de synthèse, un chanfrein accroche la lumière. Les jonctions
  mur/plafond et mur/sol en portent un.
- Les angles **verticaux** entre deux murs n'en portent pas, et c'est mesuré, pas supposé. Un
  tel angle est concave : ses deux faces intérieures se croisent, il n'y a aucune arête à
  chanfreiner. Le couper en onglet ne changerait rien à l'image — l'onglet ne déplace que le
  recouvrement caché à l'intérieur du mur, la face visible reste la même. `cornerBead.ts` sait
  poser un chanfrein de 45° par-dessus, mais à 4 mm il est invisible et à 12 mm il efface le
  creux que l'occlusion dessine : les deux murs y diffèrent de 6 niveaux sur 255, il n'y a rien
  à adoucir. Le module reste, le banc d'essai permet de le revérifier.
- Le banc d'essai (`src/ui/fxLab.ts`) n'existe qu'en développement : `main.ts` l'importe
  derrière `import.meta.env.DEV` et en dynamique, donc Vite le retire entièrement d'un build.
  Il porte les questions de rendu non tranchées — poussière, chanfrein d'angle, SSAO forcé —
  pour les juger sur la vraie maison plutôt qu'à l'aveugle.
- Les surfaces ne sont plus des couleurs unies : plâtre, parquet, béton et acier portent une
  normal map et une roughness map, générées par bruit fractal et tuilées au mètre. Les UV des
  boîtes sont réécrits en mètres par `worldScaleUvs`, sinon un mur de 4 m et une plinthe de
  50 cm étireraient le même grain différemment. Le parquet garde sa tuile de 4,8 × 3,2 m, celle
  de son albédo, et sa roughness varie planche par planche. Les données de pixels sont calculées
  une fois par session et mises en cache : changer de projet reconstruit la scène, pas le bruit.
- La chaîne de post-traitements de la visite est ordonnée et l'ordre compte : Babylon ajoute
  chaque pipeline à la fin de la chaîne de la caméra, donc `updateInteriorAmbience` construit
  le TAA d'abord, l'occlusion ensuite, le bloom en dernier. On lit
  `TAA, TAAPass, SSAO…, ssaoCombine, bloom`. Le bloom est réglé à un seuil de 0,6 et un poids
  de 0,2 : la lampe et la baie prennent un peu de lumière, les murs blancs restent nets. Son
  `imageProcessingEnabled` est faux, sinon le tone mapping serait appliqué deux fois — l'app
  tone-map déjà dans les shaders des matériaux — et ses sous-effets sont configurés avant la
  coupure, qui détruit le post-process et nullifie `imageProcessing`.
- La cadence est surveillée pendant toute la visite : trois relevés consécutifs sous 24 images
  par seconde, hors onglet masqué, retirent l'occlusion ; l'environnement et les luminaires
  restent en place. Un relevé sain remet le compteur à zéro.
- La cadence s'affiche en tout petit dans le pied de la scène et passe en ambre sous 24 images
  par seconde : le repli devient observable sans ouvrir les outils du navigateur. C'est un
  affichage, pas un réglage de qualité. Pour diagnostiquer une machine lente à distance,
  `mybob.diag()` imprime moteur, GPU, cadence, résolution réellement rendue, état de l'ambiance
  de visite, taille de la scène et caractéristiques de la machine ; la commande est rappelée au
  démarrage. `mybob.diag()` ne renvoie rien — la console réafficherait la valeur de retour et le
  rapport apparaîtrait deux fois — et `mybob.report()` donne le même texte sans l'imprimer, pour
  `copy(mybob.report())`.
- L'extérieur cadre le terrain et le faîtage ; Vue 3D montre la maison ouverte ; Plan masque
  terrain et toiture. Sélectionner une pièce ou ajouter un meuble depuis l'extérieur revient à
  la vue intérieure.

## Invariants à ne pas casser

- Mètres en interne, centimètres dans les champs ; les valeurs non modifiées gardent leur
  valeur exacte malgré l'arrondi d'affichage.
- Identifiants stables, `schemaVersion: 1`, validation à l'import.
- Les dialogues de meubles sont transactionnels : tout reste un brouillon jusqu'à
  Enregistrer, Annuler jette l'ensemble.
- La réactivité ne remplace pas un contrôle natif pendant la saisie.
- Visite et extérieur gardent les volumes complets ; une coupe explicite garde la priorité.
- Le build public ne contient que la démonstration : `vite.config.ts` et
  `scripts/check-public-build.mjs` portent l'allowlist.
- Aucune donnée personnelle dans le dépôt : les plans privés sont des
  `public/projects/private-*.json` git-ignorés.

## Recettes

**Ajouter un mode de vue** — `ViewMode` dans `viewer.ts`, une branche dans `viewer.setMode`
(caméra, coupe, découpes), un titre et une aide dans `ui/modeChrome.ts`, un bouton
`[data-view]` dans `ui/appTemplate.ts`, puis vérifier `syncDisplayControls` et les gardes
`mode === 'walk'` dispersées dans `main.ts`.

**Ajouter un type de meuble** — `FurnitureKind` et les dimensions par défaut dans
`furniture/model.ts`, la géométrie dans `furniture/layer.ts`, les champs de la popup dans
`furniture/panel.ts` et `measurements.ts`, les contraintes dans `placement.ts` et `checks.ts`.

**Ajouter un champ au format projet** — `model/types.ts`, `model/validate.ts` (avec un
message d'erreur en français), la consommation dans `scene/` ou `ui/`, un test dans
`tests/model.test.ts`, et la documentation dans `PROJECT-FORMAT.md`.

**Changer un texte d'interface** — les libellés de mode sont dans `ui/modeChrome.ts`, l'aide
dans `ui/firstSteps.ts`, les pièces dans `ui/roomPanels.ts`, le reste dans `ui/appTemplate.ts`
et `main.ts`. Respecter la voix décrite dans [IDENTITE-MYBOB.md](IDENTITE-MYBOB.md).

## Vérifier

```sh
pnpm install --frozen-lockfile
pnpm test          # node --test + tsx : DOM (Happy DOM) et géométrie (NullEngine)
pnpm run ci        # format, tests, build, contrôle du build public
pnpm run test:e2e  # Playwright sur le build public, port libre à chaque exécution
```

Les tests DOM utilisent Happy DOM et les tests de scène un `NullEngine` : ils prouvent le
comportement, pas le rendu. Pour juger un rendu, ouvrir un vrai navigateur et dire ce qui a
été regardé.

Recette navigateur utile quand un bug dépend d'un projet multi-niveaux, sans jamais créer de
fichier privé dans le dépôt : lancer `pnpm run dev`, puis injecter un projet de test dans le
`localStorage` avant le chargement de la page (clé `maison-atelier:projects:v1`, tableau de
projets validés) et le sélectionner dans `#project-select`. Un niveau « Premier étage » se
fabrique en dupliquant le niveau du studio avec `elevation: 2.8`.

Sur une fixture qu'on s'apprête à utiliser dans un test, lancer `scripts/audit-plan.ts` :
une suite verte sur une géométrie fausse ne distingue pas le correct de l'incorrect.

## Pièges connus

- `public/projects/maison-atelier.json` est un **gabarit synthétique** de test, pas la maison
  de l'owner ; `studio-demo.json` est la démonstration publique. Les deux sont modifiables.
- `planArea` doit coller au polygone à un centimètre carré près (`tests/model.test.ts`).
- Un meuble en L ou tourné ne se teste pas avec sa boîte englobante : elle rejette des
  placements valides. Utiliser les triangles projetés.
- Le Plan pose un plan de coupe horizontal ; la visite doit le remettre à `null`, sinon les
  murs restent tronqués.
- Les ombres sont coupées quand les murs sont abaissés : une façade tronquée ne doit pas
  projeter l'ombre de son volume.
- La suite e2e prend un port libre : jamais de `--strictPort` sur un port connu, et ne pas
  arrêter le serveur d'un autre agent.
- Le moteur est **WebGL uniquement**. L'occlusion de la visite passe par le tampon de
  géométrie, que Babylon n'implémente pas en WebGPU : un moteur WebGPU rendrait la visite
  plus plate sans rien signaler. Ne pas réintroduire de repli.
