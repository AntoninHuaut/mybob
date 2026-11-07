# Extérieur V2

Le terrain est une donnée optionnelle `site` du projet importé. Le moteur ne contient ni coordonnées de parcelle, ni géométrie personnelle en dur. Le build public continue d’exclure le fichier personnel ; importer la maison reste une opération locale au navigateur.

## Sources et précision

Le terrain vient entièrement des données du projet : `boundary` décrit le contour de la parcelle, `declaredArea` conserve la surface annoncée par le document de référence, et `elevation` fixe la cote du terrain relative au sol du niveau. La surface calculée depuis `boundary` est affichée séparément de `declaredArea` ; un écart entre les deux signale une saisie approximative et n’est jamais corrigé en redimensionnant la parcelle. Ces coordonnées ne constituent pas un relevé de géomètre.

Le terrain est plat par défaut. Un projet peut déclarer des points plus bas près d’une limite ou d’une pièce abaissée : ces pentes, talus et rampes restent simplifiés. Les surfaces `gravel` et `path` reprennent l’intention du stationnement et du chemin piéton ; leurs raccords sont indicatifs.

La toiture est décrite par `roofs` : sommets, faces planes et pignons. Le format accepte plusieurs pans, des raccords en croupe et des hauteurs d’égout et de faîtage quelconques ; leur projection doit couvrir l’enveloppe de toiture sans trou ni chevauchement. Une entrée en retrait est couverte. Les débords, gouttières, épaisseurs et charpente ne sont pas représentés. La pente déclarée n’est pas reproduite à l’identique : elle reste indicative et n’est pas présentée comme une cote vérifiée.

Les couleurs extérieures viennent de `facadeColor` et `roofColor`, sans valeur colorimétrique certifiée. Les faces intérieures restent blanches. Les menuiseries bicolores et les teintes de porte ne sont pas encore reproduites : les menuiseries existantes restent simplifiées.

Les documents de référence servent à vérifier les ouvertures et volumes intérieurs. Aucune clôture ni plantation n’est inventée : seules les surfaces déclarées sont rendues. Le gazon présente une texture de bruit fine, déterministe et générée localement, sans téléchargement d’images.

## Format optionnel

```ts
site?: {
  boundary: [number, number][]; // x/z, dans le repère du RDC
  elevation: number;           // terrain plat, relatif au sol du RDC
  declaredArea?: number;       // information du plan, distincte du calcul
  facadeColor?: string;        // #rrggbb
  roofColor?: string;
  surfaces?: {
    id: string;
    kind: 'gravel' | 'path';
    polygon: [number, number][];
  }[];
  roofs?: {
    id: string;
    vertices: [number, number, number][]; // x/y/z, y relatif au RDC
    faces: number[][];                   // indices de polygones plans
    gables?: number[][];                 // faces traitées avec l’enduit
  }[];
  notes: string[];
}
```

Ce format accepte une autre parcelle et une autre enveloppe de toiture sans réécrire le moteur. Les polygones doivent être simples, les accès restent dans la parcelle et l’emprise du RDC doit y tenir. Les faces de toiture doivent être planes, non dégénérées, sans croisement et ne référencer que des indices entiers valides. Les couleurs et nombres sont vérifiés à l’import. Le format de projet reste en version 1 : les projets sans `site` continuent de fonctionner.

`buildExterior(project, level, scene)` retourne un groupe indépendant et ses maillages : terrain et accès, façades identifiées par `metadata.wallId`, toiture/pignons initialement masqués, limites horizontales et hauteur maximale. La vue contrôle la visibilité des faces extérieures en même temps que celle des murs en coupe. Le gazon est évidé sous la maison, y compris quand le mur touche la limite de parcelle ; il ne traverse donc pas une pièce abaissée.

Les ouvertures des façades utilisent la même cote de sol adjacente que les murs intérieurs, quelle que soit la catégorie de pièce abaissée. En visite, le plafond visible participe aux ombres solaires, et la toiture reste affichée : le plafond la masque depuis l'intérieur, elle rend la maison entière depuis la pelouse. L'aperçu reste simplifié et ne simule pas la lumière indirecte, la météo ou les bâtiments voisins.

## Cadrage de la vue extérieure

La vue extérieure cadre sur le **bâti**, pas sur la parcelle : l'union du contour du niveau bas
et de l'emprise du toit (`src/scene/framing.ts`), plus un recul proportionnel de 10 % de la
plus grande dimension du bâti. La parcelle donne l'échelle et le recul ; elle reste
entièrement visible en fond — glissée puis dézoomée derrière le sujet si nécessaire — mais ne
dicte plus le cadrage. L'azimut est lui aussi un choix de cadrage : parmi l'angle courant et
les quatre points cardinaux, la vue garde celui où la maison occupe le plus de largeur à
l'écran, ce qui garde la vue utilisable sur une parcelle étroite et longue au bâtiment
décentré. Le cadrage se calcule toujours depuis le niveau bas : passer d'un niveau à l'autre ne
le change pas, et le sol comme la pelouse ne sont jamais coupés par le bord de l'image.

La visite sort de la maison. Sa limite est `boundary` : le visiteur marche sur le terrain plat, franchit une porte extérieure ouverte, et n'est ramené au départ que s'il quitte la parcelle, passe sous le sol ou au-dessus du plafond. Sans `site`, l'emprise du niveau reste la limite. Le sol sous le visiteur suit la pièce à l'intérieur et `elevation` à l'extérieur ; une pièce abaissée garde son propre plancher. Le terrain n'ajoute ni rampe, ni clôture, ni marche dessinée : quand `elevation` place le terrain sous le plancher, la différence reste une marche franchie par l'assistance de seuil, jusqu'à 20 cm. Au-delà, le visiteur ne rentre plus : c'est un signal que la cote de terrain est à revoir, pas un défaut de collision.

Le départ d'une visite vérifie les triangles projetés du mobilier avec la marge du visiteur : le creux libre d'un canapé en L et les espaces autour d'un meuble tourné restent accessibles. Le test se déclenche au choix de la destination, pas à chaque image. Les collisions pendant le déplacement restent celles des maillages Babylon.
