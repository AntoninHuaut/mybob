# MyBob — plan d’identité

Proposition à discuter · 6 novembre 2026

## L’idée

**MyBob, c’est Bob : un assistant pour imaginer sa maison et essayer des aménagements à taille réelle.** Il rend les choix plus simples en donnant des repères concrets, tout en laissant la main à la personne qui aménage. MyBob est le nom du produit ; Bob est la personnalité qui l’incarne.

Signature proposée : **« Faites de la place à vos idées. »** Elle évoque à la fois l’espace et l’expérimentation, sans promettre un résultat automatique. Descriptif fonctionnel quand le contexte l’exige : « Visualisez votre maison et essayez vos aménagements en 3D. »

### Personnalité

Bob est débrouillard, attentif et calme. Il a le sens pratique d’un bon copilote : il montre, explique et laisse décider. Il peut avoir un petit sourire dans le ton, jamais aux dépens de la clarté. Il ne joue ni au robot bavard ni à l’expert qui sait mieux que l’utilisateur.

- **Concret** : des mots simples, des mesures, des actions compréhensibles.
- **Chaleureux** : un accueil humain, sans familiarité forcée.
- **Sûr de ses limites** : distinguer un aperçu d’une mesure ou d’une simulation exacte.
- **Discret** : la maison et les commandes restent les premiers rôles.

## Voix et rédaction

Employer le vouvoiement, des phrases courtes et des verbes d’action. Les libellés restent descriptifs ; la personnalité se glisse surtout dans l’accueil, les états vides et les aides. Bob peut parler à la première personne ponctuellement, mais les messages fréquents, erreurs et confirmations restent directs. Pas de blagues répétées, de jargon de chantier, d’emojis systématiques ni d’exclamations à chaque clic.

| Situation            | Proposition                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| Accueil              | « Bonjour, moi c’est Bob. On commence par quelle pièce ? »                     |
| Présentation         | « Visualisez votre maison, placez vos meubles et comparez vos idées. »         |
| État vide            | « Pas encore de meuble ici. Ajoutez-en un pour commencer. »                    |
| Action               | « Ajouter un meuble »                                                          |
| Contrainte           | « Le meuble ne peut pas passer à travers ce mur. Essayez une autre position. » |
| Enregistrement local | « Enregistré dans ce navigateur »                                              |
| Aperçu solaire       | « Aperçu approximatif, selon le lieu et l’orientation indiqués. »              |
| Export               | « Exporter le projet »                                                         |

Éviter « Bob a tout sauvegardé dans le cloud », « Laissez-moi concevoir votre maison » ou « Oups, petit souci ! » : ces formulations promettent trop ou masquent une information utile. Ne pas suggérer une conversation, une intelligence artificielle ou une action autonome qui n’existe pas.

## Direction visuelle : l’atelier habité

Une base claire et architecturale, réchauffée par une couleur profonde et un accent énergique. L’interface encadre la maison comme une table de travail : elle ne concurrence ni le plan ni les meubles.

| Rôle   | Proposition | Usage                                           |
| ------ | ----------- | ----------------------------------------------- |
| Encre  | `#20312E`   | Texte principal et surfaces sombres ponctuelles |
| Craie  | `#F7F6F1`   | Fond général chaud                              |
| Blanc  | `#FFFFFF`   | Panneaux et champs                              |
| Sauge  | `#37695C`   | Actions principales, sélection, repères         |
| Corail | `#D66B4E`   | Accent rare, illustration ou détail de marque   |
| Trait  | `#D6DED9`   | Séparateurs et contours                         |

Ce sont des intentions, pas des couleurs à appliquer aveuglément : vérifier les contrastes texte/fond et les états survol, focus, désactivé et erreur avant intégration. Ne pas utiliser la couleur seule pour transmettre une information.

La typographie doit être lisible et disponible localement ou via une pile système : sans empattement sobre, titres légèrement affirmés, chiffres faciles à comparer. Un mot-symbole **MyBob** en casse mixte, avec « Bob » identifiable, suffit au départ. Privilégier des formes simples inspirées du plan (angles, lignes, ouvertures), des coins légèrement arrondis et des icônes au trait cohérentes. Éviter l’esthétique de chantier littérale, les dégradés décoratifs et les gros aplats qui mangent la scène.

### Bob, présence visuelle

Explorer un petit signe géométrique inspiré d’un plan ou d’une porte ouverte, capable d’évoquer un visage sans en dépendre. Il doit fonctionner en une couleur, à petite taille et sans texte. L’utiliser d’abord dans l’accueil ou l’aide, pas à côté de chaque commande. Aucune mascotte détaillée, animation ou avatar n’est nécessaire pour lancer l’identité. Un dessin final et ses variantes restent à concevoir et tester ; ce document ne prétend pas fournir un logo final.

## Application dans le produit

1. **Entrée** : nom MyBob, signature ou phrase descriptive et une courte présentation de Bob. L’accès au projet de démonstration et à l’import reste immédiatement clair.
2. **Interface de travail** : marque compacte dans l’en-tête ; palette et typographie au service de la scène, sans agrandir les commandes ni gêner les formulaires.
3. **Aide contextuelle** : un portrait de Bob et une phrase utile dans les aides et ?tats vides pertinents. Les raccourcis, unités et contraintes restent explicites.
4. **Messages et données** : expliquer précisément l’enregistrement local, l’export et les limites des aperçus. Ne jamais laisser entendre que les plans sont synchronisés ou envoyés à Bob.
5. **Exports et supports** : cartouche discret MyBob si cela reste compatible avec la lisibilité ; ne pas ajouter de marque sur les images sans choix produit explicite.

## Mise en œuvre proposée

1. Valider le positionnement, la signature et le niveau de présence de Bob ; choisir les messages à réécrire en priorité.
2. Dessiner deux ou trois pistes de signe et de mot-symbole, puis les examiner en petit format, en monochrome et dans l’en-tête réel.
3. Faire une maquette de l’accueil et d’un écran de travail sur ordinateur, puis vérifier les petits écrans, les contrastes et le focus clavier.
4. Intégrer progressivement les éléments retenus dans les composants existants ; conserver la navigation, les dimensions et les interactions. Vérifier les parcours au navigateur et les tests existants.
5. Harmoniser documentation et textes au fur et à mesure, sans renommer les clés de stockage ni modifier les formats de projet pour une évolution de marque.

**Décisions ouvertes** : faut-il montrer Bob comme un signe presque abstrait ou un personnage plus visible ? La signature doit-elle figurer dans l’application ou seulement dans sa présentation ? Ces choix peuvent être tranchés après examen des pistes visuelles dans l’interface réelle.
Bob est un **personnage visible et attachant**, inspir? de l??nergie rassurante d?un bricoleur de dessin anim? : il aime chercher des solutions, prend plaisir ? essayer et invite ? s?y mettre. L?interpr?tation doit ?tre originale, avec sa propre silhouette et ses propres v?tements ; ne pas reproduire le personnage, le costume ou les ?l?ments reconnaissables de Bob le bricoleur.

Direction propos?e : un compagnon humain stylis?, aux formes simples et expressives, avec une silhouette imm?diatement reconnaissable, un sourire naturel et une posture active. Une tenue d?atelier contemporaine (surchemise ou tablier, petit outil ou m?tre) ?voque le c?t? pratique ; la palette sauge, craie et corail relie le personnage au produit. Garder des proportions et des expressions accessibles aux adultes : chaleureux et un peu malicieux, sans tomber dans le b?b? ou la caricature.

Pr?voir une illustration principale en pied pour l?accueil, un portrait compact pour l?aide et quelques poses utiles : accueillir, observer un plan, proposer une piste et signaler une limite avec s?rieux. Les expressions accompagnent le message sans remplacer son texte. La version compacte doit rester lisible ? petite taille et ne pas ?tre l?unique moyen de reconna?tre une action. Le logo MyBob reste lisible ind?pendamment de Bob.

Bob est pr?sent aux moments choisis, pas au-dessus de la sc?ne en permanence : il accueille, explique un outil ou accompagne un ?tat vide, puis laisse la place au plan. Les erreurs et les informations de sauvegarde restent sobres et pr?cises. Les poses, le costume et le dessin final restent ? concevoir et tester ; ce document est une direction, pas un asset final.

## Application dans le produit

1. **Entrée** : nom MyBob, signature ou phrase descriptive et une courte présentation de Bob. L’accès au projet de démonstration et à l’import reste immédiatement clair.
2. **Interface de travail** : marque compacte dans l’en-tête ; palette et typographie au service de la scène, sans agrandir les commandes ni gêner les formulaires.
3. **Aide contextuelle** : une phrase utile au bon endroit, avec Bob comme signature occasionnelle. Les raccourcis, unités et contraintes restent explicites.
4. **Messages et données** : expliquer précisément l’enregistrement local, l’export et les limites des aperçus. Ne jamais laisser entendre que les plans sont synchronisés ou envoyés à Bob.
5. **Exports et supports** : cartouche discret MyBob si cela reste compatible avec la lisibilité ; ne pas ajouter de marque sur les images sans choix produit explicite.

## Mise en œuvre proposée

1. Valider le positionnement, la signature et le niveau de présence de Bob ; choisir les messages à réécrire en priorité.
2. Dessiner deux ou trois pistes de signe et de mot-symbole, puis les examiner en petit format, en monochrome et dans l’en-tête réel.
3. Faire une maquette de l’accueil et d’un écran de travail sur ordinateur, puis vérifier les petits écrans, les contrastes et le focus clavier.
4. Intégrer progressivement les éléments retenus dans les composants existants ; conserver la navigation, les dimensions et les interactions. Vérifier les parcours au navigateur et les tests existants.
5. Harmoniser documentation et textes au fur et à mesure, sans renommer les clés de stockage ni modifier les formats de projet pour une évolution de marque.

**Décisions ouvertes** : faut-il montrer Bob comme un signe presque abstrait ou un personnage plus visible ? La signature doit-elle figurer dans l’application ou seulement dans sa présentation ? Ces choix peuvent être tranchés après examen des pistes visuelles dans l’interface réelle.
