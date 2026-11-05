# Éclairage — références et pistes de réalisme

Revue du 5 novembre 2026, à la demande du propriétaire. Le code a été inspecté et les pages de référence ont été consultées en ligne. Les démonstrations citées n’ont pas fait l’objet d’une inspection graphique interactive pendant cette recherche. Aucun asset téléchargé et aucun changement du rendu dans cette passe.

## État observé dans Mybob

- `src/scene/viewer.ts` utilise déjà le tone mapping ACES, une exposition de 0,95 et un contraste de 1,02. La scène n’a pas de `environmentTexture` pour l’éclairage fondé sur une image (IBL).
- Le bâti emploie des matériaux PBR, mais les meubles de `src/furniture/layer.ts` utilisent encore `StandardMaterial`. Leurs réponses à la lumière ne sont donc pas homogènes.
- L’éclairage hémisphérique reste global : intensité 0,42 en Visite sans position solaire explicite, puis 0,35 en journée avec soleil configuré. Ce type de lumière ne tient pas compte des murs comme obstacles.
- Les plafonniers sont des `PointLight` de portée 5,5 m et d’intensité 0,32, sans ombres propres ni limitation aux pièces. Leur contribution peut éclairer une surface située de l’autre côté d’un mur.
- Le soleil possède une shadowmap PCF de 2048 px. La politique d’ombres les désactive en Plan et dans la vue d’ensemble à façades abaissées : cela évite de présenter des ombres de volumes artificiellement ouverts comme un résultat physique.
- Le parquet utilise une texture de couleur procédurale ; il n’y a pas de normal maps, d’occlusion ambiante ni d’illumination globale dans le rendu actuel.

Ces constats expliquent probablement une lumière uniforme et un manque de relief ou d’ancrage des meubles. Cette explication reste une hypothèse visuelle à vérifier avec des captures comparables ; elle ne remplace pas une mesure du rendu.

## Références retenues

| Référence                                                                                                                                                                           | Utilité pour Mybob                                                                                              | Limite ou licence                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Mansion Cinematic — Babylon.js Editor](https://editor.babylonjs.com/experiments/mansion)                                                                                           | Objectif d’ambiance architecturale : volumes, contraste, matières et lumière intérieure.                        | La page recommande un ordinateur en raison des textures 4K et des effets avancés. S’en inspirer visuellement sans copier ce budget sur téléphone. La page de démo ne constitue pas une autorisation de réutiliser ses assets. |
| [PBR Demo — Babylon.js](https://www.babylonjs.com/Demos/PBR/)                                                                                                                       | Référence de réponse des matériaux et des reflets.                                                              | Une démonstration PBR ne valide pas l’éclairage d’un intérieur fermé. Ne pas reprendre ses assets sans vérifier leur licence.                                                                                                 |
| [HDR Environment — documentation officielle Babylon.js](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/materials/using/HDREnvironment.md) | Chargement d’un environnement préfiltré `.env`, meilleur choix pour éviter le préfiltrage au démarrage.         | L’environnement ajoute de la lumière et des reflets ; il ne remplace pas l’occlusion des murs ni les rebonds calculés dans le bâtiment.                                                                                       |
| [Lebombo — Poly Haven](https://polyhaven.com/a/lebombo)                                                                                                                             | Référence photographique d’un séjour : lumière douce des fenêtres, luminaires chauds et ombres peu contrastées. | La page indique CC0. Ses fenêtres, luminaires et reflets représentent un autre intérieur : ne pas appliquer son panorama à toutes les pièces comme s’il s’agissait du bâtiment courant.                                       |
| [Global Illumination with Reflective Shadow Maps — Babylon.js](https://doc.babylonjs.com/features/featuresDeepDive/lights/rsmgi)                                                    | Piste expérimentale pour des rebonds diffus.                                                                    | La documentation signale explicitement des fuites lumineuses, un coût GPU et des limites sur les grandes scènes. Ce n’est pas une solution complète d’illumination globale.                                                   |

Les HDRI, textures et modèles de Poly Haven sont proposés en [CC0, selon leur page de licence](https://polyhaven.com/license), permettant notamment l’usage commercial et la redistribution. Conserver malgré tout la provenance, l’auteur, la version ou la date d’acquisition et la licence de tout fichier réellement intégré. Une capture ou un asset visible dans une démo tierce n’est pas automatiquement réutilisable.

## Ordre de travail conseillé

1. **Distribution lumineuse en Visite.** Comparer une baisse de la lumière hémisphérique avec une limitation des plafonniers aux pièces concernées. Pour quelques luminaires proches, tester des spots avec ombres. Limiter les sources actives et leur nombre de shadowmaps ; l’ajout systématique d’une shadowmap à chaque plafonnier serait coûteux. Une restriction par pièce reste une approximation, notamment aux portes ouvertes : vérifier les transitions visuellement.
2. **Environnement PBR sobre.** Essayer un `.env` générique préfiltré de 256–512 px, servi localement et sans panorama de fond obligatoire. Mesurer son poids et son coût réels. Réduire sa contribution lorsque le soleil est sous l’horizon et conserver le Plan neutre. Rééquilibrer l’hémisphérique pour éviter d’additionner deux ambiances trop fortes.
3. **Réponse cohérente des matériaux.** Tester des matériaux PBR sur les meubles, puis de légères variations de roughness et de normales sur le sol et l’enduit. Préserver les couleurs de repérage, les unités, les dimensions et la géométrie existantes. Une normal map subtile doit suggérer la matière sans transformer la lecture du plan.
4. **Contacts et angles.** Prototyper une occlusion ambiante discrète hors Plan, avec repli ou désactivation sur les appareils limités. Vérifier les halos sur les bords, les petits meubles et les ouvertures. L’occlusion ambiante ne simule pas les rebonds ni l’éclairage provenant des fenêtres.
5. **Illumination indirecte expérimentale.** Tester la GI RSM uniquement si les étapes précédentes ne suffisent pas. Mesurer le gain dans une petite scène et le coût sur mobile avant toute généralisation. La GI RSM ne corrige pas les fuites de lumière puisqu’elle ne gère pas l’occlusion de ses lumières virtuelles.

Il est préférable de conserver des réglages de base stables pendant les comparaisons. Une hausse générale d’exposition peut blanchir les murs tout en laissant inchangée la mauvaise distribution de lumière. Le réalisme recherché repose d’abord sur les contrastes spatiaux, les contacts, les matières et la cohérence des sources.

## Contraintes à préserver

- Le Plan conserve une lumière neutre et ses repères lisibles. Les vues à façades abaissées restent des aides d’aménagement ; leurs ombres ne doivent pas être présentées comme une simulation physique.
- Le soleil reste approximatif et dépend uniquement d’une localisation et d’une orientation explicitement renseignées. Un environnement générique ne doit pas ajouter un second soleil incohérent avec la position choisie, ni maintenir une forte lumière de jour la nuit.
- L’IBL est une lumière d’environnement, sans connaissance automatique du volume fermé des pièces. Ajouter une HDRI seule peut renforcer les fuites lumineuses apparentes ; la correction des plafonniers et l’ajustement de l’ambiance restent nécessaires.
- Les géométries, identifiants, contraintes de placement, collisions et imports restent inchangés. Aucun réglage ne doit dépendre des dimensions ou identifiants d’une maison personnelle.
- Les assets génériques sont servis depuis le build ; aucune géométrie de maison n’est envoyée à un service de rendu ou à un fournisseur d’HDRI.

## Assets et allowlist du build public

La publication reste limitée à la démonstration. `vite.config.ts` copie explicitement le favicon et le JSON fictif ; `scripts/check-public-build.mjs` autorise actuellement dans `assets/` les fichiers JavaScript, CSS et fontes. Un `.env` ou une texture externe n’entre donc pas automatiquement dans cette publication.

Si un asset lumineux est retenu, prévoir une intégration précise : fichier générique identifié, provenance et licence documentées, taille contrôlée, chemin ou empreinte attendus et test du contrôle public. Préserver le rejet du plan personnel et des documents d’origine. Ne pas activer la copie générale du dossier `public/` ni élargir la liste à tous ses contenus pour faire passer une HDRI. Aucune modification de cette allowlist n’a été réalisée par cette revue.

## Validation avant décision

Utiliser un projet fictif et des caméras reproductibles pour comparer avant/après : pièce près des fenêtres, pièce éloignée, jour, nuit, luminaires allumés et éteints, puis Plan et vue à façades abaissées. Vérifier les portes ouvertes, les reflets et la conservation des détails sur les murs clairs. Contrôler également l’export PNG.

Mesurer le temps avant la première image, les temps de frame et la mémoire après plusieurs changements de projet. Tester les formats ordinateur et mobile simulé puis, lorsque disponible, un véritable téléphone. L’émulation d’un viewport et les tests NullEngine ne reproduisent pas les limites d’un GPU mobile. Aucun budget chiffré de performances ni gain visuel n’est revendiqué à ce stade : ils doivent être mesurés sur le prototype.
