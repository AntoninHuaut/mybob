# MyBob — plan d’implémentation de l’identité

6 novembre 2026 · Plan de travail, pas une fonctionnalité déjà livrée. Direction de référence : `docs/IDENTITE-MYBOB.md`.

## Résultat attendu

L’application s’appelle MyBob dans les surfaces visibles. Bob est un personnage original, identifiable et sympathique : un compagnon bricoleur chaleureux, un peu malicieux, à la présentation assez sobre pour des adultes. Il apparaît clairement dans l’aide et dans un accueil léger, tout en laissant le plan et les actions accessibles. Le fonctionnement de l’aménagement, des projets et de la sauvegarde ne change pas.

L’application ouvre actuellement directement la démonstration ; il n’existe pas d’écran d’accueil séparé. Le premier incrément utilisera donc le panneau d’aide existant et un bloc compact dans le panneau projet, sans ajouter de page bloquante, de dialogue automatique ou de nouvelle préférence de stockage.

## 1. Concevoir et préparer Bob

- Produire 2 ou 3 pistes originales de personnage humain stylisé : silhouette, visage, tenue d’atelier contemporaine et palette sauge/corail. Retenir l’énergie encourageante d’un bricoleur de dessin animé sans reprendre l’apparence ou les éléments distinctifs d’un personnage existant.
- Sélectionner une piste lisible à la fois en pied et en portrait. Préparer deux poses cohérentes : **accueil** (ouverte, souriante) et **repère** (observe ou présente un plan). Le message de contrainte reste textuel et sérieux ; aucune expression comique sur une erreur.
- Livrer une illustration d’accueil et un portrait sur fond transparent, avec marge de sécurité, dimensions intrinsèques et source de référence conservée dans le dépôt si ses droits le permettent. Préférer WebP ou PNG optimisé pour les illustrations et SVG pour le mot-symbole ou les formes vectorielles. Pas de police distante obligatoire ni de dépendance à un service d’images à l’exécution.
- Vérifier les droits d’utilisation et l’absence de référence aux plans ou photos personnels. Contrôler lisibilité à petite taille, contraste sur fonds clair et sombre, poids et rendu sur écran dense. Décider le budget après export, viser un chargement léger et mesurer le résultat réel.

**Livrables** : fichiers finaux, miniature de comparaison des pistes et courte notice indiquant origine, licence, dimensions et usages. Le dessin final doit être choisi avant l’intégration ; les captures de maquette permettent de juger l’équilibre sérieux/fun.

## 2. Intégrer les assets sans affaiblir le build public

- Placer les illustrations explicitement destinées au site dans `src/assets/brand/` et les importer depuis le code ou le CSS afin que Vite les émette avec un nom haché. Garder les projets JSON et fichiers personnels hors de ce dossier. Éviter une copie générale de `public/`.
- `scripts/check-public-build.mjs` n’accepte actuellement sous `assets/` que JS, CSS et polices : étendre précisément sa règle aux formats d’image réellement utilisés, et seulement à ces formats. Vérifier également les SVG comme texte pour les empreintes privées. Le favicon reste explicitement émis par `vite.config.ts` ; s’il change, conserver son entrée explicite et sa route de développement.
- Compléter `tests/public-build.test.ts` pour accepter les assets retenus et continuer à rejeter les fichiers non autorisés et les empreintes de la maison personnelle. Exécuter `pnpm run check:public` sur le vrai build ; ne jamais remplacer l’allowlist par une copie globale.
- Si une autre stratégie d’assets est choisie, documenter ses chemins de développement et production et adapter ensemble émission, types MIME et contrôle public.

## 3. Marque et fondations de l’interface

- Dans `src/main.ts`, remplacer le bloc `.brand` « maison. » par le mot-symbole **MyBob**, conserver un nom accessible et vérifier le comportement réel du lien existant avant d’en modifier l’action. Ne pas ajouter de lien qui laisse croire à un retour à l’accueil si cette navigation n’existe pas.
- Dans `index.html`, adapter le titre de l’onglet, la description et, si validé, le favicon. Vérifier aussi la couleur du thème. Ne pas renommer les identifiants de projet, clés `localStorage`, formats JSON, variables de déploiement ou noms de fichiers exportés par simple effet de marque.
- Dans `src/style.css`, introduire progressivement des variables de couleur pour texte, surfaces, bordures, action et accent ; mapper les règles existantes en priorité. La palette du plan DA est un point de départ, à ajuster selon le contraste. Préserver les états `:focus-visible`, survol, désactivé, erreur et les repères autres que la couleur. Conserver la compacité de l’en-tête, ses retours en petit écran et les unités attachées aux champs.
- Réexaminer l’import Google Fonts déjà présent dans `src/style.css` : privilégier une pile système ou des polices embarquées autorisées, sans imposer de service externe supplémentaire. Vérifier le rendu de repli si les polices sont indisponibles.

## 4. Faire entrer Bob dans les parcours existants

1. **Panneau projet** (`src/main.ts`, `.project-section` dans `src/style.css`) : ajouter un bloc d’accueil compact avec portrait de Bob et une phrase de présentation. Il reste dans le flux du panneau, sans recouvrir la scène ; le sélecteur, l’import et la notice de démonstration restent visibles ou accessibles par défilement. Pas de promesse de conversion automatique de PDF.
2. **Aide** (gestionnaire `#help`, `#info-dialog`, `.help-grid`) : ajouter la pose « repère » et une courte introduction, puis conserver les commandes, raccourcis et précisions existants. Le dialogue garde son titre accessible, sa fermeture et son défilement. Le texte reste lisible si l’image ne charge pas.
3. **États vides** : repérer les véritables états vides dans `src/furniture/panel.ts` avant toute modification. Ajouter au besoin un court message utile et, seulement si la place le permet, le portrait compact. Ne pas remplacer les contrôles natifs pendant la saisie et ne pas afficher Bob à chaque notification.
4. **Messages** : harmoniser les textes ciblés en conservant le sens exact des erreurs, des contraintes et de la sauvegarde locale. Ne pas annoncer une conversation, une IA, une synchronisation ou une action automatique inexistante. Préserver le statut non sauvegardé et les indications d’export.
5. **Image exportée** : conserver le cartouche et les images existants. Toute marque ajoutée à l’export doit faire l’objet d’une décision produit distincte.

Les illustrations décoratives ont `alt=""` lorsque le texte adjacent nomme déjà Bob ; si une image porte seule une information, fournir un texte de remplacement utile. Pas d’animation requise. Si une animation est ajoutée ultérieurement, respecter `prefers-reduced-motion`.

## 5. Vérification et critères d’acceptation

- **Identité** : MyBob apparaît dans l’en-tête et le titre du navigateur ; Bob est reconnaissable dans le panneau projet et l’aide, sans ressembler à une copie d’un personnage existant. Le texte reste compréhensible sans les images.
- **Parcours** : ouvrir la démonstration, importer un projet fictif, sélectionner un niveau, ajouter et modifier un meuble, annuler, exporter/réimporter ; vérifier que le statut local et les erreurs restent exacts. Aucun plan personnel requis pour ces essais.
- **Interface réelle** : inspecter dans un navigateur ordinateur, puis à largeur réduite et en faible hauteur ; vérifier en-tête, panneau défilant, aide, focus clavier, dialogue de meuble, Plan et vue 3D. Noter dimensions, navigateur et scénarios réellement inspectés. Les tests DOM et NullEngine ne remplacent pas cette inspection.
- **Accessibilité** : parcourir les contrôles au clavier ; vérifier focus visible, noms accessibles, ordre de lecture, images décoratives, contrastes texte/fond et lisibilité à zoom 200 %. Tester le repli sans police ou image chargée.
- **Automatisation** : adapter les tests DOM uniquement aux comportements nouveaux utiles et les E2E aux points d’entrée et parcours affectés ; exécuter `pnpm run ci` et `pnpm run test:e2e` avec Node 24. Vérifier le build public et son allowlist, ainsi que `git diff --check`.
- **Livraison** : mettre à jour `docs/HANDOFF.md` et `docs/UI-REFINEMENT.md` selon le comportement réel. Ouvrir une PR `codex/` vers `main`, vérifier les checks requis sur son dernier commit ; n’annoncer un déploiement qu’après succès GitHub et Cloudflare Pages.

## Découpage conseillé

1. **Création visuelle** : pistes, choix de Bob, assets finaux et notice de provenance.
2. **Intégration** : marque, assets explicitement autorisés, accueil compact et aide ; tests et inspection visuelle.
3. **Finitions** : états vides et harmonisation ciblée des textes après revue des parcours.

Chaque étape doit pouvoir être revue indépendamment. Le présent document ne livre ni illustration finale ni changement de l’application.
