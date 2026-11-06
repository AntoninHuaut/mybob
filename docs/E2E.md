# Tests de bout en bout automatisés

Les scénarios Playwright utilisent uniquement le **build public de démonstration**, servi sur `127.0.0.1:4179`. Ils ne ciblent ni le site déployé ni un projet personnel. Chaque test démarre avec un contexte navigateur et un stockage vierges. Les polices distantes facultatives sont bloquées pour éviter une dépendance réseau.

## Lancer localement

Avec Node 24 et les dépendances verrouillées installées :

```sh
pnpm exec playwright install chromium
pnpm run test:e2e
```

Sous Linux, la première installation peut nécessiter `pnpm exec playwright install --with-deps chromium`. `test:e2e` compile l’application, vérifie l’exclusion du plan personnel puis lance les scénarios. Le port 4179 doit être libre ; aucun serveur déjà présent n’est réutilisé.

Après un build public déjà vérifié, `pnpm run test:e2e:built` lance les scénarios seuls. `pnpm run test:e2e:report` ouvre le rapport HTML local. On peut cibler un format avec `pnpm exec playwright test --project=mobile-chromium`, ou afficher le navigateur avec `--headed`.

Les tests indépendants restent à un worker par machine pour limiter la concurrence WebGL logicielle. Le benchmark local à deux workers a donné 51,1 s contre 52,2 s à un worker : gain trop faible pour changer ce défaut. On peut essayer `pnpm run test:e2e:built --workers=2` sur une machine plus puissante. `fullyParallel` permet de répartir les tests du même fichier entre plusieurs lots CI.

## Couverture

Dix scénarios sont exécutés en Chromium ordinateur 1280 × 720 et en émulation mobile tactile 390 × 844, soit vingt exécutions :

- Ajout d’un canapé, édition et duplication en brouillon, annulation, rechargement : un seul meuble conserve son nom et sa largeur enregistrés.
- Variante indépendante, retrait transactionnel, annuler/rétablir après bascule entre variantes, validation du nom inchangé et restauration après rechargement.
- Export JSON téléchargé et analysé, puis import dans un second contexte vierge : les deux variantes et leurs meubles sont restaurés, y compris après rechargement.
- Passage au Plan, téléchargement d’un PNG dont l’en-tête et les dimensions sont vérifiés, puis accès réel à Recentrer en paysage 568 × 320.
- Duplication/retrait depuis la barre rapide, Ctrl Z avec le focus sur un bouton et sans sélection, rétablissement, puis désélection par Échap et clic hors du meuble.
- Mesure : aperçu du segment et distance évolutive, alignement droit, confirmation au second clic et sortie par Échap.

Le parcours Actions rapides vérifie aussi Dupliquer→Suppr avec le focus toujours sur le bouton, puis Ctrl Z avec l’événement logique AZERTY `key=z, code=KeyW`. Le parcours Table exerce les flèches depuis sa ligne de sélection, sans recentrer le focus sur le canvas.

- Import d’une pièce synthétique avec canapé au mur, largeur 200 → 300 cm du côté libre, annulation sans effet, enregistrement et Ctrl Z. Les dimensions du bâtiment ne changent pas.
- Huit chaises autour d’une table : Annuler puis validation atomique, copie indépendante, garde des champs/dialogues et historique.
- Liaison meuble TV + TV, enregistrement, glisser réel, flèche clavier et rechargement : groupe et positions relatives conservés.
- Table dans le creux d’un canapé d’angle : distance initiale de 0,60 m qui diminue à la souris et au clavier. Ce scénario synthétique ne reproduit pas encore le blocage signalé dans le projet personnel.

Le test de table attend deux images rendues après le changement de mode et vérifie la sélection effective avant le glisser. Cela évite de cliquer à l’ancienne position d’une étiquette 3D sur un runner lent. Pour diagnostiquer cette synchronisation, `MYBOB_E2E_SLOW_CPU=1` active une émulation Chromium quatre fois plus lente dans ce fichier de scénarios, sans ralentir les runs normaux.

Les actions passent par l’interface et les fichiers téléchargés. Aucun accès à l’instance interne du moteur ni modification directe de localStorage ne remplace les actions utilisateur. Les tests ne reposent pas sur des délais fixes. Les rendus WebGL utilisent SwiftShader pour rester exécutables sur les runners sans GPU.

## CI et diagnostic

GitHub Actions compile et contrôle une seule fois le build public, puis le transmet par artefact à trois runners E2E parallèles (`--shard=1/3`, `2/3`, `3/3`), avec un seul worker pour éviter que plusieurs scènes WebGL logicielles se disputent le même CPU. Les vingt tests sont répartis en lots de sept, sept et six. Le mode `fullyParallel` répartit les tests individuels, même s’ils sont dans le même fichier. Chaque test conserve son contexte et son stockage isolés.

Seul Chromium headless shell est téléchargé, avec un cache lié à la version de Playwright. Chaque runner vérifie les bibliothèques de l’exécutable avec `ldd` et installe les dépendances système si l’une d’elles manque ; cette installation est limitée à cinq minutes. Un scénario en échec fait échouer la CI, sans retry masquant une instabilité. Les trois lots continuent en cas d’échec d’un lot pour garder leurs diagnostics. Les rapports HTML et fichiers des scénarios sont conservés sous `playwright-report-1`, `-2`, `-3` pendant sept jours ; traces et captures restent disponibles en cas d’échec. Seule la démonstration doit être utilisée dans ces rapports. Le build public intermédiaire expire après un jour.

Le check obligatoire « Tests, types, build et confidentialité » reste identique pour la protection de `main`. Il s’exécute même si une dépendance échoue ou est ignorée et ne réussit que si le build et les trois lots ont tous réussi. Ne pas remplacer ce contrôle par un check qui ne vérifie que le build. L’auto-merge attend ce résultat agrégé.

Mesure de référence avant parallélisation : run GitHub `42125616484`, 4 min 15 s au total, dont 3 min 09 s d’E2E en série ; tests unitaires 2 s, build 27 s et installation navigateur 21 s. Le gain distant dépend aussi du temps d’attribution des runners et de l’état du cache ; le mesurer sur les runs de la PR, sans déduire le gain CI des seuls timings locaux.

Les sorties `playwright-report/` et `test-results/` sont ignorées par Git. Cloudflare conserve la commande `npm run ci` sans navigateur ; les E2E sont une étape supplémentaire du workflow GitHub, exécutée sur le même commit. Les deux pipelines restent indépendants : Cloudflare n’attend pas le résultat E2E GitHub pour publier.

La première exécution Linux a passé six des huit parcours initiaux ; les deux réimports ont dépassé leur budget de 45 s, alors que le rendu logiciel était sensiblement plus lent que localement. La suite accorde désormais 90 s par scénario en CI ; les parcours longs réimport/actions rapides utilisent `test.slow()`. Le réimport ferme aussi la première page avant d’ouvrir la seconde session WebGL, tout en gardant les stockages isolés. Les assertions restent identiques et aucun retry n’est activé.

Cette couverture complète les tests Happy DOM/NullEngine et les inspections visuelles. Elle ne prouve pas la fidélité visuelle d’une image, les collisions sur un trajet complet ou le comportement sur un appareil iOS/Android physique. Firefox, WebKit et le pincement natif ne sont pas couverts par cette suite Chromium.

Configuration : `playwright.config.ts`. Scénarios : `e2e/workflows.spec.ts`. Références : [serveur de test Playwright](https://playwright.dev/docs/test-webserver), [exécution en CI](https://playwright.dev/docs/ci).
