# MyBob — identité

Référence unique de l'identité du produit : positionnement, voix, palette, personnage et
règles d'usage des illustrations. Ce document remplace les anciens `DA-BOB.md` et
`IMPLEMENTATION-IDENTITE.md`, dont le contenu utile est repris ici.

## L’idée

**MyBob, c’est Bob : un assistant pour imaginer sa maison et essayer des aménagements à taille
réelle.** Il rend les choix plus simples en donnant des repères concrets, tout en laissant la
main à la personne qui aménage. MyBob est le nom du produit ; Bob est la personnalité qui
l’incarne.

Signature : **« Faites de la place à vos idées. »** Elle évoque à la fois l’espace et
l’expérimentation, sans promettre un résultat automatique. Descriptif fonctionnel quand le
contexte l’exige : « Visualisez votre maison et essayez vos aménagements en 3D. »

### Personnalité

Bob est débrouillard, attentif et calme. Il a le sens pratique d’un bon copilote : il montre,
explique et laisse décider. Il peut avoir un petit sourire dans le ton, jamais aux dépens de la
clarté. Il ne joue ni au robot bavard ni à l’expert qui sait mieux que l’utilisateur.

- **Concret** : des mots simples, des mesures, des actions compréhensibles.
- **Chaleureux** : un accueil humain, sans familiarité forcée.
- **Sûr de ses limites** : distinguer un aperçu d’une mesure ou d’une simulation exacte.
- **Discret** : la maison et les commandes restent les premiers rôles.

## Voix et rédaction

Employer le vouvoiement, des phrases courtes et des verbes d’action. Les libellés restent
descriptifs ; la personnalité se glisse surtout dans l’accueil, les états vides et les aides.
Bob peut parler à la première personne ponctuellement, mais les messages fréquents, erreurs et
confirmations restent directs. Pas de blagues répétées, de jargon de chantier, d’emojis
systématiques ni d’exclamations à chaque clic.

| Situation            | Proposition                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| Accueil              | « Bonjour, moi c’est Bob. Faisons de la place à vos idées. »                   |
| Présentation         | « Visualisez votre maison, placez vos meubles et comparez vos idées. »         |
| État vide            | « Pas encore de meuble ici. Ajoutez-en un pour commencer. »                    |
| Action               | « Ajouter un meuble »                                                          |
| Contrainte           | « Le meuble ne peut pas passer à travers ce mur. Essayez une autre position. » |
| Enregistrement local | « Enregistré dans ce navigateur »                                              |
| Aperçu solaire       | « Aperçu approximatif, selon le lieu et l’orientation indiqués. »              |
| Export               | « Exporter le projet »                                                         |

Éviter « Bob a tout sauvegardé dans le cloud », « Laissez-moi concevoir votre maison » ou
« Oups, petit souci ! » : ces formulations promettent trop ou masquent une information utile.
Ne pas suggérer une conversation, une intelligence artificielle ou une action autonome qui
n’existe pas.

## Direction visuelle : l’atelier habité

Une base claire et architecturale, réchauffée par une couleur profonde et un accent énergique.
L’interface encadre la maison comme une table de travail : elle ne concurrence ni le plan ni les
meubles.

| Rôle   | Proposition | Usage                                           |
| ------ | ----------- | ----------------------------------------------- |
| Encre  | `#20312E`   | Texte principal et surfaces sombres ponctuelles |
| Craie  | `#F7F6F1`   | Fond général chaud                              |
| Blanc  | `#FFFFFF`   | Panneaux et champs                              |
| Sauge  | `#37695C`   | Actions principales, sélection, repères         |
| Corail | `#D66B4E`   | Accent rare, illustration ou détail de marque   |
| Trait  | `#D6DED9`   | Séparateurs et contours                         |

Ce sont des intentions, pas des couleurs à appliquer aveuglément : vérifier les contrastes
texte/fond et les états survol, focus, désactivé et erreur avant intégration. Ne pas utiliser la
couleur seule pour transmettre une information.

La typographie doit être lisible et disponible localement ou via une pile système : sans
empattement sobre, titres légèrement affirmés, chiffres faciles à comparer. Un mot-symbole
**MyBob** en casse mixte, avec « Bob » identifiable, suffit. Privilégier des formes simples
inspirées du plan (angles, lignes, ouvertures), des coins légèrement arrondis et des icônes au
trait cohérentes. Éviter l’esthétique de chantier littérale, les dégradés décoratifs et les gros
aplats qui mangent la scène.

### Bob, présence visuelle

Bob est un **personnage visible et attachant**, inspiré de l’énergie rassurante d’un bricoleur
de dessin animé : il aime chercher des solutions, prend plaisir à essayer et invite à s’y
mettre. L’interprétation doit être originale, avec sa propre silhouette et ses propres
vêtements ; ne pas reproduire le personnage, le costume ou les éléments reconnaissables d’un
personnage existant.

Direction retenue : un compagnon humain stylisé, aux formes simples et expressives, avec une
silhouette immédiatement reconnaissable, un sourire naturel et une posture active. Une tenue
d’atelier contemporaine (surchemise ou tablier, petit outil ou mètre) évoque le côté pratique ;
la palette sauge, craie et corail relie le personnage au produit. Garder des proportions et des
expressions accessibles aux adultes : chaleureux et un peu malicieux, sans tomber dans le bébé
ni la caricature.

Bob est présent aux moments choisis, pas au-dessus de la scène en permanence : il accueille,
explique un outil ou accompagne un état vide, puis laisse la place au plan. Les erreurs et les
informations de sauvegarde restent sobres et précises.

## Assets livrés

Tout est dans `src/assets/brand/`, importé depuis le code pour que Vite émette des noms hachés.
Aucun plan personnel ni photographie n’a servi de référence.

| Fichier                              | Rôle                                                | Usage actuel                         |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------ |
| `bob.png`                            | Pose d’accueil en pied, référence du personnage     | Source, non affichée directement     |
| `bob-portrait.png`                   | Recadrage compact de la pose d’accueil              | Panneau projet                       |
| `bob-plan.png`                       | Bob étudie un plan générique                        | Aide courte et complète              |
| `bob-mesure.svg`                     | Bob pointe un mètre ruban                           | Barre d’instructions du mode Mesurer |
| `bob-contrainte.svg`, `bob-idee.svg` | Poses « contrainte » et « idée »                    | Dessinées, pas encore affichées      |
| `public/favicon.svg`                 | Glyphe « porte de Bob » : une porte ouverte, un œil | Favicon et marque en petite taille   |

Le glyphe est le seul élément de marque autorisé en petite taille : une seule couleur, lisible à
16 px, sans dégradé, jamais à côté de chaque commande.

Règles d’usage :

- Les poses détaillées restent réservées à l’accueil, l’aide et les états vides ; jamais en
  superposition de la scène 3D.
- Les toasts restent textuels par défaut ; une pose n’apparaît que pour un message durable.
- Les illustrations décoratives portent `alt=""` quand le texte voisin nomme déjà Bob ; une
  image qui porte seule une information reçoit un texte de remplacement utile.
- Pas d’animation requise ; si une animation est ajoutée, respecter `prefers-reduced-motion`.
- Les images du site passent par `src/assets/brand/` et l’allowlist de
  `scripts/check-public-build.mjs` (`assets/bob-*.png`). Ne jamais élargir cette règle à tout
  `public/`.
- Aucune police distante obligatoire : la pile système suffit, avec un repli vérifié.

## Application dans le produit

1. **Entrée** : nom MyBob, signature ou phrase descriptive et une courte présentation de Bob.
   L’accès au projet de démonstration et à l’import reste immédiatement clair.
2. **Interface de travail** : marque compacte dans l’en-tête ; palette et typographie au service
   de la scène, sans agrandir les commandes ni gêner les formulaires.
3. **Aide contextuelle** : une phrase utile au bon endroit, avec Bob comme signature
   occasionnelle. Les raccourcis, unités et contraintes restent explicites.
4. **Messages et données** : expliquer précisément l’enregistrement local, l’export et les
   limites des aperçus. Ne jamais laisser entendre que les plans sont synchronisés ou envoyés à
   Bob.
5. **Exports et supports** : cartouche discret MyBob si cela reste compatible avec la
   lisibilité ; ne pas ajouter de marque sur les images sans choix produit explicite.

## Reste à faire

- Retoucher le fond des deux poses PNG pour la craie `#F7F6F1` ou une transparence pure : elles
  posent aujourd’hui sur du blanc pur et « flottent » dans le panneau.
- Afficher les poses « contrainte » et « idée » quand des messages durables existeront.
- Vérifier le rendu des poses à l’écran, à 2× sur écran dense.

## Décisions ouvertes

Faut-il montrer Bob comme un signe presque abstrait ou un personnage plus visible ? La signature
doit-elle figurer dans l’application ou seulement dans sa présentation ? Ces choix peuvent être
tranchés après examen des pistes visuelles dans l’interface réelle.
