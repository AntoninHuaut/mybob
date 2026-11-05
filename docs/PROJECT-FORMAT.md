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

Les murs peuvent être orientés librement. Les angles ne sont pas raccordés par une opération booléenne : leurs extrémités doivent être prolongées ou ajustées pour fermer les jonctions. Le générateur répartit les parties solides du mur autour des ouvertures, y compris l’allège et le linteau. Les collisions correspondent à ces solides.

`kind` vaut `door`, `window`, `sliding` ou `garage`. L’allège `sill` vaut zéro par défaut. `offset`, `width` et `height` sont exprimés en mètres et l’ouverture doit rester entièrement dans son mur. Les ouvertures ne doivent pas se chevaucher.

Pour une porte battante, `hinge` vaut `start` ou `end` et `swing` vaut `1` ou `-1`. La rotation s’effectue autour de l’axe vertical local. Le sens est à contrôler en 3D après avoir interprété le symbole du plan. La hauteur nominale est celle du passage, avant les petits profils de menuiserie visuels.

Les fenêtres sont fixes dans cette version. Les baies coulissantes ont un panneau mobile et un panneau fixe. La porte de garage est simplifiée et se relève verticalement, sans mécanisme de rails.

## Pièces

Une pièce est un contour intérieur fini indépendant des murs. `polygon` sert au calcul de surface, à la sélection et au repérage. Il faut donc mettre à jour les deux lors d’une modification du plan. La validation de format ne garantit pas la conformité architecturale : elle ne vérifie pas encore tous les chevauchements entre pièces et murs.

`planArea` est facultatif : il conserve la surface annoncée dans le document de référence. La surface calculée est toujours obtenue depuis `polygon` et affichée séparément. Ne pas modifier le contour uniquement pour forcer une surface : les cotes linéaires et la géométrie priment.

`label` et `viewpoint` sont des positions à l’intérieur de la pièce. Le point de visite doit laisser une marge d’au moins 17 cm autour du visiteur, et ne pas se trouver dans le débattement d’une porte.

Les catégories sont `living`, `bedroom`, `bathroom`, `circulation`, `garage`, `storage`. Le garage reçoit un sol gris ; les autres pièces utilisent le carrelage imitation parquet. Le projet peut fournir un objet facultatif `finishes` avec les couleurs hexadécimales `wallColor`, `floorTint`, `garageColor` et `joineryColor`. Les textures différentes par pièce et leur édition visuelle sont des extensions à venir.

Une pièce peut déclarer `floorOffset`, entre −1 et 0 m, pour un sol plus bas que le niveau. La surface de référence est alors réellement découpée, puis remplacée par un sol à cette cote ; les collisions et le point de vue suivent ce sol. Le plafond conserve sa cote de niveau : le garage à [cote retirée] bénéficie donc de [cote retirée] libres sous un plafond à [cote retirée]. Les seuils jusqu’à 20 cm disposent d’une aide locale au franchissement si aucune porte ou aucun mur ne barre le passage. Cela ne remplace pas un modèle d’escalier pour les différences plus importantes.

## Ajouter et sauvegarder

Importer le fichier avec le bouton **Importer une autre maison**. Un import ayant le même identifiant remplace sa version importée précédente et peut masquer la version fournie du même projet. Retirer ce projet importé restaure la version fournie, lorsqu’elle existe.

La sauvegarde est locale au navigateur : pas de synchronisation entre appareils. Exporter le projet conserve les dimensions et les hypothèses, pas la caméra courante. Les niveaux multiples sont sélectionnables, mais aucune circulation par escalier n’est développée dans cette version.

L’export peut inclure `furnishing: {version: 1, levels: {...}}`, avec les meubles par identifiant de niveau. Ces données sont validées et sauvegardées séparément à l’import pour éviter de dupliquer les photos dans le stockage des plans.

## Soleil facultatif

`solar` peut contenir `latitude` (−90 à 90), `longitude` (−180 à 180), `northAngleDeg` (sens horaire depuis le haut du plan), et facultativement `timeZone` (IANA, par exemple `Europe/Paris`) et `label`. Aucun lieu n’est fourni par défaut. L’import valide ces champs ; les angles sont normalisés sur [0,360). Le calcul utilise un instant absolu, la date et l’heure locale étant converties avec le fuseau choisi.

Les réglages appliqués dans l’interface restent dans `maison-atelier:solar:<projectId>` et remplacent ceux du fichier lors de l’utilisation locale. L’export inclut la configuration effective. La préférence locale `null` signifie que l’utilisateur a choisi de revenir à l’éclairage standard, même si le fichier d’origine contient un champ solaire. Ces données ne sont jamais envoyées au serveur d’hébergement.
