# Essayer un aménagement

Dans l’onglet **Meubles**, ajouter un meuble par sa catégorie et ses dimensions en centimètres. L’ajout utilise les dimensions saisies et une configuration paramétrique. Les anciens onglets Photo et Lien marchand ont été retirés : ils ne généraient pas de géométrie.

Sélectionner un meuble dans la scène ou dans la liste des objets présents. Le déplacer en glissant, saisir une rotation, ou utiliser les flèches (1 cm, Maj : 10 cm). R tourne de 15°, Supprimer retire, Ctrl Z annule et Ctrl Maj Z rétablit. Un glisser complet forme une seule action d’historique. Le verrouillage protège le placement.

Les ajouts et duplications cherchent une place libre dans la pièce choisie. En cas de place insuffisante, aucun meuble n’est ajouté et la boîte de saisie reste ouverte. Le glisser s’arrête au contact des murs, vitrages et linteaux, y compris après un saut du pointeur. Les rotations, dimensions et positions saisies sont refusées si elles font pénétrer le meuble dans le bâtiment ou dépasser son contour/plafond. Les conflits entre meubles et les enveloppes de passage restent des diagnostics pour permettre, par exemple, de tester une chaise sous une table.

Les anciennes positions invalides importées ne sont pas déplacées silencieusement. Elles restent signalées et peuvent être sorties du mur par glisser. Le champ Position permet de replacer directement un meuble dans une autre pièce ; le glisser respecte les obstacles sur son trajet.

Les distances partent des centres des quatre faces. Les enveloppes de passage et d’ouverture sont réglables ; les alertes d’intersection et de débattement sont des aides géométriques conservatrices, sans certification réglementaire. Le module de livraison théorique ne tient compte ni de l’inclinaison, ni de l’emballage, ni des virages du trajet ; il n’est plus exposé comme alerte de placement. Les marges de passage sont facultatives, sans valeur imposée à l’ajout.

Les aménagements sont sauvegardés localement par maison et par niveau. L’export du projet inclut les meubles. Les références déjà présentes dans les anciens fichiers restent compatibles, mais ne sont plus proposées dans l’interface. Une erreur de sauvegarde est signalée si la mémoire locale est indisponible ou pleine. Conserver un export pour transférer ou sauvegarder le travail.

Dans **Navigation**, accessible près des outils de vue, régler le regard assis/debout, masquer les façades gênantes, activer une coupe, ou choisir un point libre du sol pour commencer une visite à cet endroit. Ce changement de point de vue ne simule pas une marche automatique au travers des pièces. Les volumes complets et leurs collisions sont restaurés en visite.

Les zones de maison encore incertaines restent signalées dans les notes du modèle. Les meubles n’améliorent pas la précision des plans d’origine.

## Types et configurations

Les quatorze catégories comprennent les meubles TV, téléviseurs, tables basses, bibliothèques, poufs et tables d’appoint. Sélectionner un canapé puis choisir sa forme : droit, angle avec dossier en retour, ou méridienne ouverte. Le côté est décrit en regardant le canapé de face. Les dimensions hors tout restent largeur, profondeur et hauteur ; le corps principal et la largeur du retour définissent le vide du L. Les collisions utilisent les deux parties occupées et laissent ce vide disponible pour une table.

La hauteur de pose est relative au sol fini. Le bouton Ajouter une TV dessus d’un meuble TV place un téléviseur à sa cote supérieure. Les dimensions proposées restent à remplacer par celles du modèle réel.

Les commandes flottantes sur le meuble sélectionné tournent de −90°, +90° ou +15°, en plan et en 3D. Les mêmes contraintes et l’historique s’appliquent : une rotation qui pénètre un mur est refusée.

La navigation utilise le glisser gauche pour tourner, le glisser droit pour déplacer et la molette pour zoomer. Chaque commande possède une icône qui distingue le bouton concerné. La sensibilité du déplacement droit a été ramenée à la valeur normale Babylon après la régression de la passe précédente.

## Navigation et édition

ZQSD / WASD déplace la vue 3D ou Plan dans les directions de l’écran, à vitesse adaptée au zoom. Maj accélère. Cliquer dans la vue lui donne le clavier ; les champs de formulaire et les menus conservent leurs touches. Les flèches déplacent un meuble sélectionné, ou la vue sans sélection.

Le simple clic sélectionne et propose les rotations rapides. Le double-clic dans la scène ouvre une popup d’édition, comme pour l’ajout. Aucun formulaire de modification ne reste dans le panneau latéral. Le bouton Modifier fournit le même accès au clavier. Le panneau ne se reconstruit plus sur un clic de configuration, sur Passage et ouverture, ou quand il perd le focus : les saisies et volets restent stables.

Les profondeurs des canapés sont saisies depuis le dos : profondeur du corps principal puis profondeur totale côté allongé. Aucune soustraction n’est demandée. Le schéma local indique ces deux longueurs et la largeur du retour. Les assises et bases en L utilisent des volumes continus, sans trou à la jonction.

Changer un canapé droit en angle ou méridienne utilise la profondeur totale affichée pour le retour ; revenir à un canapé droit conserve la profondeur du corps. Les mesures laissées intactes conservent leur précision d’origine. Décocher le verrouillage dans la popup rend immédiatement les dimensions et la position modifiables, dans le même brouillon. Annuler conserve le meuble et son verrouillage initiaux ; Enregistrer applique le déverrouillage et les modifications ensemble.

La TV se renseigne d’abord par diagonale en pouces, au format 16:9. Le boîtier et les pieds sont estimés ; Dimensions exactes permet de corriger largeur, profondeur et hauteur. Une modification manuelle de largeur/hauteur retire la diagonale associée, pour ne pas conserver une indication devenue fausse. Les anciens téléviseurs aux dimensions personnalisées restent compatibles.

## Ensembles de meubles

Dans les réglages d’un meuble, Lier à un autre meuble permet de choisir son partenaire. La liaison conserve les positions actuelles. Déplacer ou tourner un membre transforme tout le groupe, avec un arrêt commun contre les murs et une seule action Annuler. Un membre verrouillé bloque les transformations qui le déplaceraient. Séparer les meubles rend l’ensemble indépendant. Les dimensions restent individuelles. Ajouter une TV dessus crée et lie automatiquement le téléviseur au meuble TV.

La vue Plan coupe les murs à 1,20 m par défaut et dessine les fenêtres et baies en cyan à leurs positions réelles. Les meubles gardent leur volume visible, y compris armoires et TV ; la coupe explicite choisie dans les réglages reste prioritaire pour les murs.

Les tests du contrôleur DOM utilisent Happy DOM (sans navigateur graphique) pour vérifier la stabilité des menus et des saisies, les conversions du formulaire, les pouces et l’ouverture de l’éditeur. Les tests Babylon NullEngine couvrent géométrie, groupes et navigation ; ils ne valident pas le rendu GPU sur le poste de l’utilisateur.

## Popup et commandes discrètes

Modifier ouvre une fenêtre modale avec Annuler et Enregistrer. Fermer, Annuler ou Échap abandonne tout le brouillon, y compris lier, séparer, dupliquer, aligner, ajouter une TV et retirer. Enregistrer applique les changements en une seule opération annulable. Un placement refusé conserve la popup et la saisie pour correction. Les groupes et actions explicites restent disponibles dans la popup ; les actions secondaires sont regroupées sous Autres actions et Favori est retiré. Un bloc de liaison sans contenu n’est plus rendu.

La barre de sélection est désormais compacte et dockée en bas de la vue ; elle ne suit plus le meuble et ne masque pas son déplacement. Navigation est un panneau distinct, près des outils de vue, pour les réglages de caméra.

En visite, viser un meuble à moins de trois mètres puis appuyer sur F ouvre sa popup. Les murs et portes arrêtent la visée ; E conserve le contrôle des portes. La visite est pausée et la souris libérée pendant l’édition. Après fermeture, Reprendre la visite permet de capturer de nouveau la souris.
