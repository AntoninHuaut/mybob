# Revue ciblée — bugs et utilisation du mobilier

Revue indépendante du 6 novembre 2026, demandée par le propriétaire. Priorité aux bugs reproductibles, aux tests et aux gestes existants. Données synthétiques uniquement ; aucun plan ni export personnel ajouté au dépôt. Cette revue ne constitue pas une validation du déploiement.

## Défauts confirmés et corrections coordonnées

| Défaut                                                                                    | Reproduction ou preuve                                                                                                                                                                                          | Correction                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supprimer après Dupliquer ne répond pas tant qu’on ne reclique pas dans la scène.         | Le bouton d’action conserve le focus ; l’ancien filtre clavier excluait les boutons avant de traiter Suppr. Signalement utilisateur cohérent avec le contrôleur.                                                | Le contrôleur principal traite la suppression hors champs/dialogues sans exiger de refocaliser la scène. Les flèches sont autorisées depuis la barre du meuble et sa ligne de sélection.                                                   |
| Ctrl Z dépend du clavier physique.                                                        | L’ancien contrôleur comparait `event.code` à `KeyZ`. Sur AZERTY, la touche produisant `z` peut avoir `code=KeyW`.                                                                                               | Employer le caractère logique `event.key` pour les raccourcis C/V/Z/Y/R, avec garde des champs et fenêtres d’édition. Ne pas confondre ces raccourcis avec les commandes de marche fondées sur les touches physiques.                      |
| Un groupe verrouillé ou contraint ne bouge pas et ne donne aucune explication au glisser. | `FurnitureLayer.pointer()` retournait avant la création du glisser si un membre était verrouillé ; un déplacement contraint à zéro retournait aussi sans signal.                                                | Callback `onDragBlocked(reason)` : nom du membre verrouillé, ou indication bâtiment/ensemble, ou accrochage lorsque la correction de snap annule le déplacement. Une notification au plus par geste. Aucun assouplissement des collisions. |
| Les flèches peuvent traverser une cloison mince.                                          | Objet de 5 × 5 cm à X=4,95 m, cloison de 2 cm à X=5 m, Maj+Droite de 10 cm : X=5,05 m passe la validation de destination, bien que le trajet traverse le mur. Le balayage du même trajet s’arrête à X=4,9669 m. | Utiliser le balayage continu du groupe pour les translations clavier, comme pour le glisser. Les champs Position restent un placement absolu explicite.                                                                                    |

Les modifications de `src/main.ts` et les régressions clavier sont prises en charge par l’agent principal. Cette sous-revue a modifié uniquement `src/furniture/layer.ts`, `tests/group-layer.test.ts` et ce rapport.

## Régressions exécutées par cette sous-revue

Les huit tests de `tests/group-layer.test.ts` passent avec Node 24 et Babylon NullEngine. Trois cas ont été ajoutés :

- un membre TV verrouillé est nommé, sans démarrer le glisser ni créer de modification d’historique ;
- une butée complète sur le contour ne produit qu’un message par geste et aucune modification fictive, puis réarme le message au geste suivant ;
- un accrochage ramenant le meuble à sa position initiale produit un seul message et aucune entrée d’historique.

Les tests antérieurs restent verts : déplacement des deux membres d’un ensemble TV, correction de snap atomique, collision d’un autre membre avec un mur, verrouillage et interruption du glisser. Cela vérifie le contrôleur et les données, pas l’apparence d’une capture ou un téléphone physique.

Le probe ignoré `artifacts/probe-keyboard-thin-wall.ts` reproduit la traversée par validation de destination et la compare au balayage. Il ne contient que la géométrie fictive décrite ci-dessus. La suite complète, les nouveaux parcours navigateur et les checks de la PR doivent être consultés séparément avant publication.

## Signalements non reproduits dans les données disponibles

**Meuble TV + TV :** aucune perte de `groupId` trouvée dans la liaison, les transformations, le glisser ou la sauvegarde. Les tests de groupe conservent les positions relatives. Le parcours synthétique de l’agent principal lie explicitement les deux objets, enregistre, glisse, déplace au clavier et recharge sans rupture. Cela ne prouve pas que le cas personnel est résolu.

**Table restant à 0,60 m :** après réception des dimensions et positions affichées par le propriétaire, un probe local ignoré a testé cette configuration sur son modèle local. Les placements sont valides et les déplacements simulés sont permis. La valeur de 0,60 m correspond à la profondeur fixe de la table ; l’interface l’affichait dans une pastille identique à celles des écarts. La confusion est donc probable, sans prouver à elle seule pourquoi la table aurait pu sembler immobile à l’écran. À la demande du propriétaire, le placement affiche seulement les écarts ; une régression synthétique vérifie qu’ils évoluent au déplacement. Aucune donnée personnelle n’est incluse dans le test partagé.

Les diagnostics ajoutés doivent rendre visibles les causes confirmées de blocage, sans présenter l’une d’elles comme la cause certaine du projet personnel.

## Praticité retenue

La liaison doit apparaître comme une opération du même brouillon que les dimensions : choix explicite du meuble, liste des membres, état « liaison préparée » et validation en bas de toute la fenêtre. La barre de sélection doit rendre perceptible la présence d’un ensemble. Les améliorations de cette interface sont réalisées par l’agent principal ; aucun changement visuel supplémentaire n’est revendiqué par cette sous-revue.

Un glisser bloqué ne doit ni rester muet ni multiplier les notifications à chaque mouvement du pointeur. Les raccourcis doivent agir après un bouton d’action sans voler les touches natives d’un champ ou d’une fenêtre modale. Ces principes ont guidé les corrections, en préservant les transactions, les identifiants et les contraintes géométriques.
