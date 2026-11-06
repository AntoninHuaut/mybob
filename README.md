# Maison — Atelier 3D

Application de visite de maisons en 3D pour ordinateur, réalisée avec **Babylon.js 9**, TypeScript et Vite. Le moteur est indépendant des projets : la maison reconstruite depuis les plans VP et un studio fictif utilisent exactement le même code.

## Reprise avec un nouvel agent

Lire [AGENTS.md](AGENTS.md), [le guide de passation locale](docs/HANDOFF.md) et [le skill de maintenance](.agents/skills/mybob-maintenance/SKILL.md). **Exporter son projet depuis le navigateur actuel avant de passer en local** : le dépôt ne contient pas l’aménagement sauvegardé dans ce navigateur.

## Démarrer

Node.js 24 et pnpm 12.15.0.

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Ouvrir l’adresse indiquée par Vite. Par défaut, seul le studio de démonstration est embarqué ; importer sa maison localement. `npm run dev:private` charge le modèle personnel depuis le dépôt privé. L’application utilise WebGPU par défaut quand le navigateur expose un adaptateur matériel, avec repli automatique sur WebGL (rendu logiciel, navigateur automatisé ou démarrage trop lent) ; `?webgl=1` force WebGL. L’accélération graphique reste nécessaire. Aucun compte ni serveur de données n’est nécessaire en local.

```sh
npm test
npm run build
npm run format:check
```

Le dossier `dist/` contient la version statique déployable. Les dépendances et les données de maison sont intégrées ou servies localement ; Google Fonts est facultatif et possède des polices de repli système.

Tests navigateur automatisés : `pnpm exec playwright install chromium`, puis `pnpm run test:e2e`. Vingt exécutions couvrent les parcours essentiels en Chromium ordinateur et mobile simulé. Voir [le guide E2E](docs/E2E.md) pour les scénarios, rapports et limites.

Le build normal est **public et limité à la démonstration**. La commande `npm run ci` exécute tous les contrôles et vérifie qu’aucun plan personnel n’est présent dans l’artefact. Configuration Cloudflare Pages et GitHub Actions : [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

La V2 ajoute le terrain et la toiture paramétrables, une navigation réglable et un éclairage avec tone mapping. Le bouton Soleil ajoute un aperçu selon la commune, le nord du plan, la date et l’heure locale ; la vue Plan reste neutre. Détails et limites : [docs/V2.md](docs/V2.md), [docs/EXTERIOR.md](docs/EXTERIOR.md).

## Utilisation

- **Vue 3D** : glisser avec le bouton gauche pour tourner ; molette pour zoomer ; bouton droit pour déplacer.
- Le cadrage s’adapte à la fenêtre et réserve une marge pour l’interface. **Recentrer** réaffiche la maison entière après un zoom ou un déplacement.
- **Extérieur** : si le projet contient un terrain, affiche la parcelle, les façades et la toiture ; la vue 3D garde la toiture ouverte pour aménager.
- **Plan** : vue orthographique, sélection des pièces et des dimensions extérieures ; glisser pour déplacer, pincer ou utiliser la molette pour zoomer.
- **Visite** : ZQSD, WASD ou flèches pour marcher, souris pour regarder, Maj pour accélérer, E pour ouvrir ou fermer une porte proche. Échap libère la souris.
- En cas de refus de capture de souris, cliquer dans la scène et glisser avec le bouton gauche pour regarder.
- Cliquer sur une pièce dans la liste ou le plan miniature, puis sur **Visiter cette pièce**, pour s’y rendre.
- **Mesurer** : premier clic sur le sol, aperçu du segment et de sa distance au déplacement, second clic pour confirmer. Alignement automatique près des axes du plan ; Maj force une ligne droite, Alt conserve l’angle libre. Un troisième clic commence une nouvelle mesure ; les mesures confirmées restent affichées et « Effacer les mesures » les retire. Il ne s’agit pas d’un accrochage aux arêtes ni d’une cotation d’exécution.
- **Actions du meuble** : modifier, tourner, dupliquer, placer contre un mur et retirer sont accessibles dans la barre de sélection. Cliquer ailleurs dans la scène ou appuyer sur Échap désélectionne. Ctrl Z annule la dernière modification même sans sélection ou avec un bouton actif ; les champs de texte et fenêtres d’édition conservent leur comportement natif.
- Les portes intérieures sont ouvertes au départ. En vue 3D, un clic sur une porte la manipule également.
- Les projets peuvent être exportés et importés en JSON. Les projets importés sont conservés dans le stockage local du navigateur, sur cet ordinateur. Exporter les fichiers pour les sauvegarder ou les transférer.
- **Variantes** : dans Meubles, dupliquer et nommer plusieurs aménagements, puis basculer entre eux avec la même caméra ; chaque variante affiche un aperçu en plan du niveau courant. L’export JSON conserve toutes les variantes et tous les niveaux.
- **Répéter des meubles** : Ctrl C puis Ctrl V copie le meuble sélectionné ; chaque copie est indépendante et annulable. Sur une table, **Chaises** répartit le nombre voulu autour du plateau, avec dimensions réglables et liaison facultative.
- **Placement précis** : sélectionner plusieurs meubles pour les aligner ou répartir leurs espacements ; activer séparément l’accrochage à une grille réglable ou aux murs pendant le glisser.
- **Soleil** : après localisation, le panneau dans la scène propose un curseur horaire, Été/Hiver et lever/coucher approximatifs, sans déplacer la caméra. « Animer la journée » déroule l’ensoleillement en 12 secondes ; toute manipulation manuelle l’arrête.
- **Image** : télécharger un PNG du Plan ou de la 3D sans panneaux, avec noms/surfaces et dimensions facultatifs.
- **Soleil** : après localisation, le panneau dans la scène propose un curseur horaire, Été/Hiver et lever/coucher approximatifs, sans déplacer la caméra.
- **Image** : télécharger un PNG du Plan ou de la 3D sans panneaux, avec noms/surfaces et dimensions facultatifs ; fond transparent et cartouche projet en option.

## Fichiers importants

```text
public/projects/private-project.json    Premier projet, dimensions et hypothèses
public/projects/studio-demo.json Second projet indépendant
src/model/types.ts              Format versionné des projets
src/model/validate.ts           Validation à l’import
src/model/geometry.ts           Calculs en mètres
src/scene/buildHouse.ts         Génération des murs, sols, menuiseries et portes
src/scene/materials.ts          Matériaux et texture procédurale de carrelage
src/scene/viewer.ts             Caméras, collisions, éclairage et mesure
src/scene/walkCamera.ts         Caméra de visite et hauteur réelle du regard
src/ui/                        Plan miniature, icônes et formatage
src/main.ts                    Interface et gestion des projets
tests/model.test.ts             Contrôles de géométrie et de collisions avec Babylon NullEngine
docs/PROJECT-FORMAT.md          Ajouter une autre maison
docs/MODEL-NOTES.md             Sources, précision et limites
```

## Périmètre de cette version

Rez-de-chaussée, garage, visite, portes, plan, mesures et projets multiples. L’atelier permet maintenant d’ajouter des meubles paramétriques cotés, de les déplacer, de vérifier leurs espaces et de sauvegarder/exporter l’aménagement. Les canapés peuvent avoir un angle ou une méridienne, les téléviseurs une hauteur de pose, et les meubles sont contrôlés contre les murs. L’ajout se fait par dimensions ; les anciennes options photo et lien marchand ont été retirées. Voir [docs/FURNITURE.md](docs/FURNITURE.md). Le terrain et l’enveloppe extérieure sont inclus ; l’aménagement des combles reste hors périmètre.

**La reconstruction n’est pas encore un relevé exact de l’existant.** Plusieurs cotes principales sont reprises du plan, mais les raccords de l’entrée de la chambre 1, du dégagement et du hall restent à confirmer. Les surfaces au plan et celles calculées sur les contours du modèle sont affichées séparément. Voir `docs/MODEL-NOTES.md`.

Les plans et photos fournis par le propriétaire ne sont pas inclus dans les sources ni dans le site. Le dépôt GitHub `AntoninHuaut/mybob` est privé. Le build Cloudflare Pages embarque seulement la démonstration ; la maison personnelle est importée et conservée localement dans le navigateur.

Les corrections issues des revues indépendantes sont résumées dans [docs/REVIEW.md](docs/REVIEW.md). Le détail des cotes vérifiées et des écarts d’origine est conservé dans [docs/GEOMETRY-AUDIT.md](docs/GEOMETRY-AUDIT.md).

Le téléphone permet de consulter la vue 3D et le plan en pleine largeur, avec un panneau des pièces repliable. La visite en déplacement reste destinée à l’ordinateur avec clavier et souris. Les textes, le focus et les dialogues ont été repris lors de la revue d’accessibilité.

## Extensions prévues

Le mobilier forme une collection indépendante, liée au projet et au niveau, avec identifiants, dimensions en mètres et transformations. Le rendu, les contrôles de placement, l’historique et les sauvegardes sont isolés dans `src/furniture/`. Un futur test de livraison complet nécessiterait une simulation du trajet et des rotations ; le module théorique de passage debout reste dans le code, mais n’est plus exposé comme alerte de placement.

Les identifiants sont stables et le format porte `schemaVersion: 1`, afin de permettre des migrations ultérieures. Aucun outil d’analyse automatique de PDF n’est inclus.
