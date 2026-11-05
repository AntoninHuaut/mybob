# Interface : donner la priorité à la maison

L’application conserve le vert architectural et le fonctionnement des vues 3D, Plan, Extérieur et Visite. Cette passe concentre l’interface autour des tâches : ouvrir sa maison, choisir une pièce, placer un meuble, vérifier son encombrement.

L’en-tête passe à 56 px sur ordinateur, contient le projet, l’export et l’aide, et permet de replier le panneau pour agrandir la scène. Les titres au-dessus du modèle décrivent la vue active ; les slogans et numéros décoratifs ont été retirés. Le bouton Importer ma maison occupe toute la largeur du panneau avec une cible de 44 px et ouvre directement le sélecteur de fichier. Le format JSON et le stockage local sont précisés à proximité.

Le panneau sépare Maison et Meubles dans deux onglets navigables au clavier avec les flèches, Début et Fin. Les réglages de navigation restent dans un bloc repliable. L’ajout de meuble est accessible dans les deux contextes ; sa boîte indique la pièce de destination. Sélectionner un meuble dans la scène ouvre son onglet. Les textes, champs et actions ont été agrandis et leur contraste renforcé. Le panneau mobile conserve son fonctionnement en superposition, et un panneau fermé est retiré de la navigation clavier avec `inert`.

Les feuilles de style ont été consolidées pour éviter les superpositions de réglages ajoutés au fil des versions. Les interactions qui sont déjà utiles dans la scène restent en place.

Références consultées :

- [Frontend Design — Anthropic](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) : hiérarchie utile, mise en page adaptée au produit, libellés directs et cohérence de l’identité existante.
- [W3C — Understanding Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) : zones cliquables et espacement. Les actions principales utilisent ici des cibles de 40 à 44 px ; cette référence ne vaut pas une certification WCAG complète.

Vérification : TypeScript et tests de régression, revue indépendante des transitions de panneau, des raccourcis et des collisions. Aucun navigateur graphique disponible dans l’environnement : pas de validation visuelle ni de capture d’écran revendiquée.
