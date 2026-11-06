# Direction artistique de Bob — pistes de déclinaison

Complément de [docs/IDENTITE-MYBOB.md](IDENTITE-MYBOB.md), issu de la revue du 7 novembre 2026. Ce document est une spécification ; les trois poses vectorielles (« contrainte », « idée », « mesure ») sont livrées dans `src/assets/brand/` (SVG 512 × 768, fond transparent) et restent à contrôler visuellement à l’écran. Leur intégration suit les règles d’usage ci-dessous : seule « mesure » est affichée pour l’instant (barre d’instructions du mode Mesurer) ; « contrainte » et « idée » attendent les messages durables et l’onboarding (#16). Le retouche craie des deux poses PNG existantes reste à faire.

## Constats sur les assets actuels

Les deux poses (`bob.png`, `bob-plan.png`) sont cohérentes entre elles et avec la palette de l’identité : surchemise sauge `#37695C`, accents corail `#D66B4E`, style éditorial vectoriel adapté à un public adulte. Trois limites ressortent :

1. **Fond** : la pose d’accueil pose sur un fond blanc pur alors que l’interface est craie `#F7F6F1`. Le personnage « flotte » légèrement dans le panneau.
2. **Petites tailles** : rien ne remplace les illustrations détaillées en 16–24 px (favicon, icône d’aide). Le plan d’identité prévoyait un signe géométrique ; il n’existe pas encore.
3. **Registre d’expression** : deux poses suffisent pour l’accueil et l’aide, mais les toasts et états vides n’ont pas de contrepoint visuel.

## 1. Intégration du fond

Régénérer ou retoucher les poses pour poser sur un fond **craie `#F7F6F1`** (ou transparence pure, le panneau fournissant le fond). Ajouter une ombre portée très légère sous les pieds si le personnage est cadré en pied. Vérifier le rendu à 2× sur écran haute densité : la source 384 × 576 est limite pour le portrait affiché en grand ; viser 512 × 768 minimum pour toute nouvelle pose.

## 2. Signe géométrique « porte de Bob »

Un glyphe simple, inspiré d’une porte entrouverte évoquant un visage, utilisable en une couleur :

- silhouette : un rectangle au trait arrondi dont un côté est ouvert, et un point (l’œil) dans l’ouverture ;
- une seule couleur, encre `#20312E` en positif ou craie en négatif ;
- lisible à 16 px sans texte, sans dégradé ;
- usages : favicon, bouton d’aide, marque de dialogue dans les futurs messages de Bob ;
- contre-indications : ne pas l’afficher à côté de chaque commande (règle de discrétion de l’identité).

## 3. Poses supplémentaires

Mêmes règles de provenance que `src/assets/brand/README.md` : aucune photo ni plan personnel comme référence, la pose `bob.png` sert de référence du personnage. Consignes de génération à soumettre telles quelles :

- **Pose « contrainte »** (toasts de blocage) : Bob lève les mains, paumes ouvertes, sourire understanding ; même tenue, même palette ; fond craie ou transparent.
- **Pose « idée »** (variante enregistrée, export réussi) : Bob brandit un mètre ruban ou esquisse un geste de validation sobre, sans exclamations visuelles.
- **Pose « mesure »** (aide du mode Mesurer) : Bob pointe un mètre ruban tendu vers le sol, regard vers le bas, style identique à `bob-plan.png`.

Chaque pose est livrée en 512 × 768, transparence préservée, puis recadrée selon les besoins (portrait compact, bandeau d’aide).

## 4. Règles d’usage dans l’interface

- Les poses détaillées restent réservées à l’accueil, l’aide et les états vides ; jamais en superposition de la scène 3D.
- Les toasts restent textuels par défaut ; une pose n’apparaît que pour les messages durables (délégué à une évolution future, pas d’ajout systématique).
- Le glyphe « porte » est le seul élément de marque autorisé en petite taille.
