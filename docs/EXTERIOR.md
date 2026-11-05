# Extérieur V2

Le terrain est une donnée optionnelle `site` du projet importé. Le moteur ne contient ni coordonnées de parcelle, ni géométrie personnelle en dur. Le build public continue d’exclure le fichier personnel ; importer la maison reste une opération locale au navigateur.

## Sources et précision

La [planche] du PDF donne la parcelle de [cote retirée], les côtés de [cote retirée] / [cote retirée] / [cote retirée] / [cote retirée] et l’implantation à [cote retirée] de la borne avant gauche, sur la limite latérale. Le quadrilatère reconstitué respecte ces longueurs et la surface à moins de 1 cm / 0,01 m² près. La limite latérale est supposée rectiligne et alignée sur le mur nord du RDC. Ces coordonnées reconstituées ne constituent pas un relevé de géomètre ; les angles ne sont pas cotés dans le document raster.

Le terrain est volontairement plat à [cote retirée] par rapport au sol fini habitable ([niveau retiré] et [niveau retiré] du plan de masse). Le plan prévoit aussi des points plus bas près de la limite et du garage : ces pentes, talus et rampes restent simplifiés. La zone de gravillons avant reprend l’intention du stationnement de [cote retirée] ; ses raccords et le chemin piéton sont indicatifs.

Les façades de la [planche] indiquent deux pignons, côté ouest et sud, avec un raccord en croupe au nord-est. Quatre pans continus décrivent la toiture en L ; leur projection couvre l’enveloppe de toiture sans trou ni chevauchement. Les hauteurs d’égout [cote retirée] et de faîtage [cote retirée] sont reprises de la coupe A-A par rapport au RDC. L’entrée en retrait est couverte. Les débords, gouttières, épaisseurs et charpente ne sont pas représentés. La notice annonce [pente retirée] ; en l’absence de débords modélisés, la pente graphique est indicative et n’est pas présentée comme une cote vérifiée.

Les couleurs extérieures approchent l’enduit beige ocre et l’ardoise décrits dans la notice, sans valeur colorimétrique certifiée. Les faces intérieures restent blanches. La menuiserie bicolore extérieure anthracite / intérieure blanche et les portes RAL 5008 ne sont pas encore reproduites : les menuiseries existantes restent simplifiées.

Les photos de chantier servent à vérifier les ouvertures et volumes intérieurs. Les vues du terrain sont celles de la planche d’insertion 10 ; aucune photo extérieure récente supplémentaire n’a été fournie. Aucune clôture ou plantation n’a donc été inventée. Le gazon présente une texture de bruit fine, déterministe et générée localement, sans téléchargement d’images.

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

`buildExterior(project, level, scene)` retourne un groupe indépendant et ses maillages : terrain et accès, façades identifiées par `metadata.wallId`, toiture/pignons initialement masqués, limites horizontales et hauteur maximale. La vue contrôle la visibilité des faces extérieures en même temps que celle des murs en coupe. Le gazon est évidé sous la maison, y compris quand le mur touche la limite de parcelle ; il ne traverse donc pas le garage abaissé.

Les ouvertures des façades utilisent la même cote de sol adjacente que les murs intérieurs, quelle que soit la catégorie de pièce abaissée. En visite, le plafond visible participe aux ombres solaires même lorsque la toiture extérieure est masquée. L'aperçu reste simplifié et ne simule pas la lumière indirecte, la météo ou les bâtiments voisins.

Le départ d'une visite vérifie les triangles projetés du mobilier avec la marge du visiteur : le creux libre d'un canapé en L et les espaces autour d'un meuble tourné restent accessibles. Le test se déclenche au choix de la destination, pas à chaque image. Les collisions pendant le déplacement restent celles des maillages Babylon.

## Vérification automatisée

Les tests contrôlent la surface et les quatre longueurs de la parcelle, l’implantation, l’aire exacte du gazon après évidement, l’absence de gazon sous le garage, le dégagement de sa porte, la couverture et les hauteurs de toiture, l’élimination de géométries invalides, le nettoyage de la scène et la compatibilité des projets sans terrain. Ces contrôles géométriques ne remplacent pas une inspection visuelle dans un navigateur WebGL.

`tests/scene-review.test.ts` vérifie aussi les ouvertures d'une pièce habitable abaissée, l'occultation par le plafond et les départs de visite autour de meubles concaves ou tournés.
