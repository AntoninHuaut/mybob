# Revue indépendante et corrections

Quatre relectures ont été réalisées : géométrie et cotes, interface et usages, code et validation, puis une revue finale en lecture seule sans historique du développement. Les vérifications techniques utilisent Babylon NullEngine ; aucune prévisualisation de navigateur officielle n’était disponible dans cette session.

## Corrections intégrées

- Repère 3D droit, commun au PDF, à la vue en plan et au plan miniature. Les directions de marche et la flèche de position reposent sur la direction réelle de la caméra. Les anciens fichiers de projet v1 restent compatibles.
- Implantation de cinq ouvertures corrigée à partir des chaînes de cotes. Porte-fenêtre de la [pièce] représentée depuis le sol et haute de [cote retirée].
- Garage à [cote retirée], avec hauteur libre de [cote retirée], découpe réelle du plancher, seuil et collisions adaptés. Franchissement testé de 30 à environ 240 Hz, sans passer à travers une porte fermée.
- Vue sur téléphone sur toute la largeur, panneau des pièces repliable, suppression du débordement vertical forcé en paysage et indication que la visite nécessite un clavier et une souris.
- Contrastes et tailles de texte améliorés, focus clavier conservé lors de la sélection, dialogue nommé pour les technologies d’assistance.
- États des options d’affichage centralisés : les étiquettes et le plafond ne peuvent plus masquer ou intercepter une mesure en cours. La désélection met à jour tous les repères.
- Validation d’import renforcée : objets malformés, tailles incompatibles avec les profils, allèges de portes, hauteurs insuffisantes, décalages de sol et pièces hors du contour du niveau sont rejetés. Les contours concaves sont pris en compte.
- Repères, cadrage et assistance de seuil isolés dans de petites fonctions testables. Code et styles mis en forme avec une configuration commune.

## Limites conservées explicitement

Les raccords de la chambre 1, du dégagement, du hall et de la pièce de vie ne retrouvent pas encore toutes les surfaces du tableau du plan. Ils sont signalés directement dans la liste des pièces, dans leurs détails et dans les notes de modèle. Ils doivent être vérifiés avant un placement de mobilier exigeant une précision fine dans ces zones.

Les sens de battants et les dimensions finies des huisseries restent interprétés ; les luminaires et matériaux sont proposés pour la visualisation. Les contours de pièces et les murs sont encore des données distinctes : la validation d’import ne constitue pas une validation BIM de leurs raccords ni de tous leurs chevauchements.

L’apparence GPU, la capture souris, les gestes tactiles et le ressenti d’une visite sur appareil réel restent à vérifier. Les tests de projection et de collision ne remplacent pas cette revue visuelle.

Une extraction du stockage des projets hors de `main.ts` pourra être utile avec l’ajout du mobilier. Une réécriture du moteur ou un changement de framework n’est pas nécessaire pour cette version.

## Vérifier localement

```sh
npm test
npm run build
npm run format:check
```
