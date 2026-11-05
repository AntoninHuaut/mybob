# Interface : privilégier la maison

Le panneau distingue Maison (projets, niveaux, pièces) et Meubles (ajout, sélection, aides de placement). La navigation est globale, dans le bouton Navigation de la scène. Sélectionner un meuble ne déploie plus un formulaire dans la barre latérale : un double-clic, le crayon de sa ligne ou celui de la barre contextuelle ouvre la même popup. En visite, F permet d’éditer le meuble visé à proximité.

Les champs de dimensions partagent une ligne de saisie alignée même avec des libellés multilignes. Les unités sont attachées à droite des inputs, les libellés du canapé sont courts et le schéma illustre les deux profondeurs. La grille se réduit sur petit écran. La popup conserve les menus natifs pendant la saisie.

Toutes les actions de modification, y compris lier, séparer, dupliquer, aligner, ajouter une TV sur un support et retirer, restent dans un brouillon. Enregistrer les applique en une seule opération annulable ; Annuler les abandonne. Les contrôles non modifiés préservent leurs valeurs exactes en mètres, malgré l’arrondi d’affichage en centimètres. Les erreurs apparaissent dans la popup, où les notifications globales seraient masquées par le dialogue natif.

La liste affiche un crayon par meuble, un seul compteur dans l’onglet, et des alertes repliées. Aucun espace de passage n’est imposé automatiquement : les marges se renseignent volontairement. Les contrôles de livraison simplifiés ne sont plus présentés comme alertes de placement. Le statut de sauvegarde a rejoint l’en-tête et ne recouvre plus la scène. Les raccourcis de déplacement et de suppression ignorent les contrôles de l’interface.

Le projet intégré s’appelle Démonstration. Une corbeille à côté du sélecteur permet de supprimer un projet importé après confirmation et propose d’abord un export. Elle retire seulement ses données et aménagements locaux ; les exemples intégrés ne sont pas supprimables.

## Coupe et éclairage

Navigation → Affichage des murs propose Automatique (défaut), Murs complets et Murs bas. En automatique, seules les façades faisant face à la caméra sont coupées à 1,10 m, avec une face de coupe solide. Les autres murs, sols et meubles gardent leurs matériaux. La visite et l’extérieur conservent les volumes complets ; une coupe explicite garde la priorité. Les collisions ne changent pas.

Le Plan utilise un éclairage blanc uniforme sans ombres. Les ombres sont aussi désactivées dans la vue automatique à murs abaissés : une façade tronquée ne doit pas projeter l’ombre de son volume d’origine. Les vues complètes retrouvent leurs ombres.

Le bouton Soleil ouvre la localisation, le nord, la date et l’heure locale. Une recherche explicite de commune utilise Open-Meteo ; seul le texte de recherche est envoyé, jamais le plan ou les meubles. Entrée dans le champ Commune lance cette recherche. Modifier la commune efface les anciennes coordonnées du brouillon pour éviter d’appliquer un nouveau nom à l’ancien lieu ; choisir un résultat les renseigne à nouveau. La saisie manuelle des coordonnées fonctionne sans ce service. La localisation n’est pas déduite du navigateur et aucun lieu personnel n’est intégré au site public. Les préférences, y compris l’instant choisi, sont locales par projet et incluses dans son export.

La position solaire suit les équations NOAA ; un test la compare au cas de référence NREL. Les fuseaux IANA et changements d’heure sont pris en compte. L’orientation du nord vient d’une saisie explicite : 0° vers le haut du plan, 90° à droite. Le relief, la météo et les constructions voisines ne sont pas simulés. Pour juger l’ensoleillement, préférer l’extérieur et les volumes complets : un toit ou un plafond masqué modifie la lumière reçue.

## Vérification

Tests des contrôleurs DOM avec Happy DOM, calculs solaires, transitions d’éclairage et matériaux avec Babylon NullEngine, validation TypeScript, production et exclusion des données privées du build public. Aucun navigateur graphique disponible : l’alignement CSS a été revu à partir des captures utilisateur et du code, sans prétendre à une validation visuelle dans le navigateur.
