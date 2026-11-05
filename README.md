# Maison — Atelier 3D

Application de visite de maisons en 3D pour ordinateur, réalisée avec **Babylon.js 9**, TypeScript et Vite. Le moteur est indépendant des projets : la maison reconstruite depuis les plans VP et un studio fictif utilisent exactement le même code.

## Démarrer

Node.js 22.12+ ou 24 recommandé.

```sh
npm ci
npm run dev
```

Ouvrir l’adresse indiquée par Vite. L’application nécessite WebGL et l’accélération graphique. Aucun compte ni serveur de données n’est nécessaire en local.

```sh
npm test
npm run build
```

Le dossier `dist/` contient la version statique déployable. Les dépendances et les données de maison sont intégrées ou servies localement ; Google Fonts est facultatif et possède des polices de repli système.

## Utilisation

- **Vue 3D** : glisser avec le bouton gauche pour tourner ; molette pour zoomer ; bouton droit pour déplacer.
- **Plan** : vue orthographique, sélection des pièces et des dimensions extérieures.
- **Visite** : ZQSD, WASD ou flèches pour marcher, souris pour regarder, Maj pour accélérer, E pour ouvrir ou fermer une porte proche. Échap libère la souris.
- En cas de refus de capture de souris, cliquer dans la scène et glisser avec le bouton gauche pour regarder.
- Cliquer sur une pièce dans la liste ou le plan miniature, puis sur **Visiter cette pièce**, pour s’y rendre.
- **Mesurer** : deux clics sur le sol donnent une distance ; le troisième commence une nouvelle mesure. La mesure ne s’accroche pas automatiquement aux arêtes : ce n’est pas un outil de cotation d’exécution.
- Les portes intérieures sont ouvertes au départ. En vue 3D, un clic sur une porte la manipule également.
- Les projets peuvent être exportés et importés en JSON. Les projets importés sont conservés dans le stockage local du navigateur, sur cet ordinateur. Exporter les fichiers pour les sauvegarder ou les transférer.

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
src/ui/                        Plan miniature, icônes et formatage
src/main.ts                    Interface et gestion des projets
tests/model.test.ts             Contrôles de géométrie et de collisions avec Babylon NullEngine
docs/PROJECT-FORMAT.md          Ajouter une autre maison
docs/MODEL-NOTES.md             Sources, précision et limites
```

## Périmètre de cette version

Rez-de-chaussée, garage, finitions simples, visite, portes, vue en plan, mesures au sol et projets multiples. Pas de mobilier, d’extérieur ou de combles. La structure permet d’ajouter ensuite un module de mobilier et des sauvegardes d’aménagement sans modifier le format des murs.

**La reconstruction n’est pas encore un relevé exact de l’existant.** Plusieurs cotes principales sont reprises du plan, mais les raccords de l’entrée de la chambre 1, du dégagement et du hall restent à confirmer. Les surfaces au plan et celles calculées sur les contours du modèle sont affichées séparément. Voir `docs/MODEL-NOTES.md`.

Les plans et photos fournis par le propriétaire ne sont pas inclus dans les sources ni dans le site. L’hébergement Sites et le dépôt GitHub `AntoninHuaut/mybob` sont privés.

## Extensions prévues

Le mobilier pourra former une collection séparée contenant un identifiant, une référence GLB éventuelle, des dimensions en mètres et une transformation. Les aménagements seront liés à l’identifiant d’un projet et d’un niveau. La sélection, le déplacement au sol, l’annulation et la sauvegarde pourront être ajoutés indépendamment du générateur de maison.

Les identifiants sont stables et le format porte `schemaVersion: 1`, afin de permettre des migrations ultérieures. Aucun outil d’analyse automatique de PDF n’est inclus.
