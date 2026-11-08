# Format d’un projet de maison

Le contrat TypeScript est dans `src/model/types.ts` ; `validateProject()` est exécuté au chargement et à l’import. Le projet est un fichier JSON UTF-8, de moins de 32 Mo pour l’import depuis l’interface.

## Repère et unités

- Une unité vaut **un mètre**, à tous les niveaux.
- Les points `[x, z]` décrivent le plan horizontal. `x` augmente vers la droite du plan et `z` vers le bas.
- L’axe vertical est `y`. `elevation` est la hauteur du sol fini du niveau par rapport à l’origine du projet.
- Le rendu utilise un repère droit pour garder la même disposition que le PDF et le plan miniature. Le contrat `spawn.yaw` des fichiers v1 reste inchangé : 0 regarde vers le bas du plan, π vers le haut ; la conversion vers la caméra est interne.
- Un mur est défini par son axe, ses deux extrémités, sa hauteur et son épaisseur finie. L’épaisseur est répartie de chaque côté de l’axe.
- Les ouvertures sont mesurées le long de l’axe du mur, depuis `start`, dans la direction de `end`.

## Projet minimal

```json
{
  "schemaVersion": 1,
  "id": "maison-exemple",
  "name": "Maison exemple",
  "description": "Un premier niveau",
  "units": "m",
  "source": {
    "title": "Mon plan coté",
    "status": "À vérifier",
    "notes": ["Origine et précision des dimensions."]
  },
  "levels": [
    {
      "id": "niveau-rdc",
      "name": "Rez-de-chaussée",
      "elevation": 0,
      "ceilingHeight": 2.5,
      "outline": [
        [0, 0],
        [6, 0],
        [6, 5],
        [0, 5]
      ],
      "spawn": { "position": [3, 3], "yaw": 3.14159 },
      "walls": [
        {
          "id": "mur-nord",
          "start": [0, 0.15],
          "end": [6, 0.15],
          "thickness": 0.3,
          "exterior": true
        },
        {
          "id": "mur-est",
          "start": [5.85, 0.15],
          "end": [5.85, 4.85],
          "thickness": 0.3,
          "exterior": true
        },
        {
          "id": "mur-sud",
          "start": [0, 4.85],
          "end": [6, 4.85],
          "thickness": 0.3,
          "exterior": true,
          "openings": [
            {
              "id": "porte-1",
              "kind": "door",
              "offset": 2.5,
              "width": 0.9,
              "height": 2.1,
              "exterior": true
            }
          ]
        },
        {
          "id": "mur-ouest",
          "start": [0.15, 0.15],
          "end": [0.15, 4.85],
          "thickness": 0.3,
          "exterior": true
        }
      ],
      "rooms": [
        {
          "id": "piece-1",
          "name": "Pièce principale",
          "kind": "living",
          "polygon": [
            [0.3, 0.3],
            [5.7, 0.3],
            [5.7, 4.7],
            [0.3, 4.7]
          ],
          "label": [3, 2.5],
          "viewpoint": [3, 3]
        }
      ],
      "lights": [{ "id": "plafonnier-1", "position": [3, 2.5], "provisional": true }]
    }
  ]
}
```

## Murs et ouvertures

Les murs peuvent être orientés librement. Les angles ne sont pas raccordés par une opération booléenne : leurs extrémités doivent être prolongées ou ajustées pour fermer les jonctions. Le générateur répartit les parties solides du mur autour des ouvertures, y compris l’allège et le linteau. Les collisions correspondent à ces solides. La hauteur d’un mur ne dépasse pas la hauteur de plafond de son niveau, sauf un mur de fond de lucarne, qui traverse la couverture : sa déclaration est décrite avec [la toiture](EXTERIOR.md).

`kind` vaut `door`, `window`, `sliding` ou `garage`. L’allège `sill` vaut zéro par défaut. `offset`, `width` et `height` sont exprimés en mètres et l’ouverture doit rester entièrement dans son mur. Les ouvertures ne doivent pas se chevaucher. Une fenêtre de toit n’est pas une ouverture de mur : elle se déclare sur le pan qui la porte, dans `site.roofs[].windows`, et se lit sur la coupe plutôt que sur le plan horizontal — voir [la toiture](EXTERIOR.md).

Pour une porte battante, `hinge` vaut `start` ou `end` et `swing` vaut `1` ou `-1`. La rotation s’effectue autour de l’axe vertical local. Le sens est à contrôler en 3D après avoir interprété le symbole du plan. La hauteur nominale est celle du passage, avant les petits profils de menuiserie visuels.

Les fenêtres sont fixes dans cette version. Les baies coulissantes ont un panneau mobile et un panneau fixe ; une allège non nulle en fait une fenêtre coulissante posée sur un mur d'allège. Une porte battante peut porter `glazed: true` pour un vantail vitré (porte-fenêtre) qui s'ouvre comme une porte, et `leaves: 2` pour un vantail par jambage, qui se rencontrent au milieu de l'embrasure ; `hinge` ne dit alors plus de quel côté la porte s'ouvre. La porte de garage est un rideau sectionnel : les panneaux suivent un rail vertical, un quart de tour au linteau, puis un plan horizontal sous plafond, sans modélisation des rails eux-mêmes.

## Pièces

Une pièce est un contour intérieur fini indépendant des murs. `polygon` sert au calcul de surface, à la sélection et au repérage. Il faut donc mettre à jour les deux lors d’une modification du plan. La validation de format ne garantit pas la conformité architecturale : elle ne vérifie pas encore tous les chevauchements entre pièces et murs.

`planArea` est facultatif : il conserve la surface annoncée dans le document de référence. La surface calculée est toujours obtenue depuis `polygon` et affichée séparément. Ne pas modifier le contour uniquement pour forcer une surface : les cotes linéaires et la géométrie priment.

`label` et `viewpoint` sont des positions à l’intérieur de la pièce. Le point de visite doit laisser une marge d’au moins 17 cm autour du visiteur, et ne pas se trouver dans le débattement d’une porte.

Les catégories sont `living`, `bedroom`, `bathroom`, `circulation`, `garage`, `storage`. Le garage reçoit un sol gris ; les autres pièces utilisent le carrelage imitation parquet. Le projet peut fournir un objet facultatif `finishes` avec les couleurs hexadécimales `wallColor`, `floorTint`, `garageColor` et `joineryColor`. Les textures différentes par pièce et leur édition visuelle sont des extensions à venir.

Une pièce peut déclarer `floorOffset`, entre −1 et 0 m, pour un sol plus bas que le niveau. La surface de référence est alors réellement découpée, puis remplacée par un sol à cette cote ; les collisions et le point de vue suivent ce sol. Le plafond conserve sa cote de niveau : une pièce abaissée gagne donc de la hauteur libre sous un plafond inchangé. Les seuils jusqu’à 20 cm disposent d’une aide locale au franchissement si aucune porte ou aucun mur ne barre le passage. Au-delà, une volée déclarée dans `stairs` décrit le franchissement.

## Escaliers et trémies

Un niveau peut déclarer `stairs`, une liste de volées droites qui montent vers le niveau supérieur. Chaque volée porte `start` et `end` (l’axe, du premier au dernier nez de marche), `width` (largeur dégagée, centrée sur l’axe), `steps` (nombre de marches) et `rise` (hauteur totale franchie, du sol de ce niveau au sol du niveau au-dessus). Le giron vaut la longueur de l’axe divisée par `steps`. La validation refuse un giron inférieur à 15 cm, une marche de plus de 25 cm, et une volée dont une extrémité sort du contour du niveau.

`floorVoids` déclare les ouvertures du plancher de ce niveau, en polygones simples inscrits dans le contour. Une trémie perce le plancher, la dalle et le plafond du niveau inférieur : c’est le niveau supérieur qui la porte, puisqu’elle appartient à son sol.

Le schéma ne décrit que des volées droites. Un escalier balancé, hélicoïdal ou à palier se décompose en plusieurs volées droites : c’est une approximation des marches gagnantes, à déclarer comme telle. Les garde-corps, les limons et les sous-faces ne sont pas modélisés, et la caméra de visite ne gravit pas les marches.

## Ajouter et sauvegarder

Importer le fichier avec le bouton **Importer ma maison**. Un import ayant le même identifiant demande confirmation avant de remplacer sa version importée précédente ou masquer la version fournie du même projet. Lorsque ce projet est ouvert, la confirmation permet d’exporter d’abord sa version actuelle. Les meubles sont remplacés uniquement pour les niveaux fournis dans l’aménagement importé. Retirer ce projet importé restaure la version fournie, lorsqu’elle existe. Les contours de niveaux et pièces doivent être simples, sans croisement ni arête répétée.

La sauvegarde est locale au navigateur : pas de synchronisation entre appareils. Exporter le projet conserve les dimensions et les hypothèses, pas la caméra courante. Les niveaux multiples sont sélectionnables ; les volées déclarées dans `stairs` sont rendues et bloquent le passage, mais la caméra de visite ne les gravit pas.

L’export peut inclure `furnishing: {version: 1, levels: {...}}`, avec les meubles par identifiant de niveau. Ces données sont validées et sauvegardées séparément à l’import pour éviter de dupliquer les photos dans le stockage des plans.

`furnishing.variants` est facultatif et contient `{version: 1, activeId, variants: [{id, name, levels: {...}}]}`. Il accepte une à dix variantes, des identifiants uniques, des noms de 1 à 60 caractères et uniquement les niveaux du projet. Chaque liste de meubles est validée. Quand cet objet est fourni, il constitue le jeu complet à restaurer ; `furnishing.levels` reste un miroir de sa variante active pour la compatibilité. Un ancien fichier sans `variants` met à jour les niveaux fournis dans la variante active et conserve les autres variantes nommées. Le nom d’une variante n’est pas un identifiant. Un export complet des anciens niveaux peut également servir à restaurer un stockage local de variantes illisible.

## Soleil facultatif

`solar` peut contenir `latitude` (−90 à 90), `longitude` (−180 à 180), `northAngleDeg` (sens horaire depuis le haut du plan), et facultativement `timeZone` (IANA, par exemple `Europe/Paris`), `label` et `instant`. Ce dernier conserve la date et l’heure choisies sous forme UTC ISO canonique (`2026-07-01T10:30:00.000Z`). Les anciens fichiers sans `instant` utilisent l’heure actuelle. Aucun lieu n’est fourni par défaut. L’import valide ces champs ; les angles sont normalisés sur [0,360). Le calcul utilise un instant absolu, la date et l’heure locale étant converties avec le fuseau choisi.

Les réglages appliqués dans l’interface restent dans `maison-atelier:solar:<projectId>` et remplacent ceux du fichier lors de l’utilisation locale. L’export inclut la configuration effective. La préférence locale `null` signifie que l’utilisateur a choisi de revenir à l’éclairage standard, même si le fichier d’origine contient un champ solaire. Ces données ne sont jamais envoyées au serveur d’hébergement.

## Partage par lien

Le bouton **Lien** place dans le fragment de l’URL un instantané de l’état courant, forme
`#p1:<base64url(déflate-raw(pack sémantique))>`. Le préfixe `p1` isole la version du format
pour une future migration sans ambiguïté de lecture. Le fragment ne quitte jamais le
navigateur : il n’est ni envoyé au serveur d’hébergement ni consigné dans l’historique
(`history.replaceState`).

Le lien transporte un **document d’export complet** : le projet, l’aménagement de chaque
niveau et toutes les variantes — jamais la caméra courante ni les préférences de navigation.
Deux différences assumées vis-à-vis du JSON exporté :

- **Identifiants renumérotés.** Les identifiants réels (meubles, niveaux, murs, ouvertures,
  pièces, escaliers, luminaires, surfaces, toitures) sont de l’entropie incompressible ; dans
  le pack ils deviennent positionnels — `niveau-0`, `mur-0-1`, `meuble-0`, `groupe-0` — et sont
  régénérés au déballage. Sont conservés : l’identifiant du projet, les noms (niveaux, pièces),
  les notes, la description, la source et les identifiants de variantes. Déballer puis repacker
  un lien rend les mêmes octets.
- **Quantification.** Les distances sont arrondies au millimètre, les angles au dix-millième
  de radian, les couleurs sont internées en minuscules 24 bits ; les champs absents ne sont
  pas écrits. L’écart est en dessous de la précision de saisie.

À l’ouverture d’un lien : le propriétaire du projet voit son état comparé au lien (rien si
identique, un choix de trois issues sinon) ; un destinataire ouvre le projet en lecture seule,
en mémoire seule, et peut l’ajouter à ses projets — il reçoit alors un nouvel identifiant et
devient un projet importé normal, documenté ci-dessus. Un lien tronqué ou corrompu charge le
projet local avec un avertissement, sans jamais bloquer le démarrage.
