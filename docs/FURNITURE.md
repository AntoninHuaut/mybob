# Essayer un aménagement

Dans l’onglet **Meubles**, ajouter un meuble par sa catégorie et ses dimensions en centimètres. L’ajout utilise les dimensions saisies et une configuration paramétrique. Les anciens onglets Photo et Lien marchand ont été retirés : ils ne généraient pas de géométrie.

Sélectionner un meuble dans la scène ou dans la liste des objets présents. Le déplacer en glissant, saisir une rotation, ou utiliser les flèches (1 cm, Maj : 10 cm). R tourne de 15°, Supprimer retire, Ctrl Z annule et Ctrl Maj Z rétablit. Un glisser complet forme une seule action d’historique. Le verrouillage protège le placement.

Les ajouts et duplications cherchent une place libre dans la pièce choisie. En cas de place insuffisante, aucun meuble n’est ajouté et la boîte de saisie reste ouverte. Le glisser s’arrête au contact des murs, vitrages et linteaux, y compris après un saut du pointeur. Les rotations, dimensions et positions saisies sont refusées si elles font pénétrer le meuble dans le bâtiment ou dépasser son contour/plafond. Les conflits entre meubles et les enveloppes de passage restent des diagnostics pour permettre, par exemple, de tester une chaise sous une table.

Les anciennes positions invalides importées ne sont pas déplacées silencieusement. Elles restent signalées et peuvent être sorties du mur par glisser. Le champ Position permet de replacer directement un meuble dans une autre pièce ; le glisser respecte les obstacles sur son trajet.

Les distances partent des centres des quatre faces. Les enveloppes de passage et d’ouverture sont réglables ; les alertes d’intersection et de débattement sont des aides géométriques conservatrices, sans certification réglementaire. Le contrôle de livraison vérifie uniquement un volume debout face à une porte d’entrée modélisée : ni l’inclinaison, ni l’emballage, ni les virages du trajet ne sont simulés.

Les aménagements sont sauvegardés localement par maison et par niveau. L’export du projet inclut les meubles ; les favoris sont facultatifs et séparés. Les références déjà présentes dans les anciens fichiers restent compatibles, mais ne sont plus proposées dans l’interface. Une erreur de sauvegarde est signalée si la mémoire locale est indisponible ou pleine. Conserver un export pour transférer ou sauvegarder le travail.

Dans **Déplacement et vue**, régler le regard assis/debout, masquer les façades gênantes, activer une coupe, ou choisir un point libre du sol pour commencer une visite à cet endroit. Ce changement de point de vue ne simule pas une marche automatique au travers des pièces. Les volumes complets et leurs collisions sont restaurés en visite.

Les zones de maison encore incertaines restent signalées dans les notes du modèle. Les meubles n’améliorent pas la précision des plans d’origine.

## Types et configurations

Les quatorze catégories comprennent les meubles TV, téléviseurs, tables basses, bibliothèques, poufs et tables d’appoint. Sélectionner un canapé puis choisir sa forme : droit, angle avec dossier en retour, ou méridienne ouverte. Le côté est décrit en regardant le canapé de face. Les dimensions hors tout restent largeur, profondeur et hauteur ; le corps principal et la largeur du retour définissent le vide du L. Les collisions utilisent les deux parties occupées et laissent ce vide disponible pour une table.

La hauteur de pose est relative au sol fini. Le bouton Ajouter une TV dessus d’un meuble TV place un téléviseur à sa cote supérieure. Les dimensions proposées restent à remplacer par celles du modèle réel.

Les commandes flottantes sur le meuble sélectionné tournent de −90°, +90° ou +15°, en plan et en 3D. Les mêmes contraintes et l’historique s’appliquent : une rotation qui pénètre un mur est refusée.

La navigation utilise le glisser gauche pour tourner, le glisser droit pour déplacer et la molette pour zoomer. Chaque commande possède une icône qui distingue le bouton concerné. La sensibilité du déplacement droit a été ramenée à la valeur normale Babylon après la régression de la passe précédente.
