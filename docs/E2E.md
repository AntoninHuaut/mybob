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

## Couverture

Quatre scénarios sont exécutés en Chromium ordinateur 1280 × 720 et en émulation mobile tactile 390 × 844, soit huit exécutions :

- Ajout d’un canapé, édition et duplication en brouillon, annulation, rechargement : un seul meuble conserve son nom et sa largeur enregistrés.
- Variante indépendante, retrait transactionnel, annuler/rétablir après bascule entre variantes, validation du nom inchangé et restauration après rechargement.
- Export JSON téléchargé et analysé, puis import dans un second contexte vierge : les deux variantes et leurs meubles sont restaurés, y compris après rechargement.
- Passage au Plan, téléchargement d’un PNG dont l’en-tête et les dimensions sont vérifiés, puis accès réel à Recentrer en paysage 568 × 320.

Les actions passent par l’interface et les fichiers téléchargés. Aucun accès à l’instance interne du moteur ni modification directe de localStorage ne remplace les actions utilisateur. Les tests ne reposent pas sur des délais fixes. Les rendus WebGL utilisent SwiftShader pour rester exécutables sur les runners sans GPU.

## CI et diagnostic

GitHub Actions exécute les E2E après les tests unitaires, le build et le contrôle public. Chromium et ses dépendances système sont installés dans le job. Un scénario en échec fait échouer la CI, sans retry masquant une instabilité. Le rapport HTML et les fichiers des scénarios sont conservés comme artefact GitHub pendant sept jours ; les traces et captures sont conservées en cas d’échec. Seule la démonstration doit être utilisée dans ces rapports.

Les sorties `playwright-report/` et `test-results/` sont ignorées par Git. Cloudflare conserve la commande `npm run ci` sans navigateur ; les E2E sont une étape supplémentaire du workflow GitHub, exécutée sur le même commit. Les deux pipelines restent indépendants : Cloudflare n’attend pas le résultat E2E GitHub pour publier.

Cette couverture complète les tests Happy DOM/NullEngine et les inspections visuelles. Elle ne prouve pas la fidélité visuelle d’une image, les collisions sur un trajet complet ou le comportement sur un appareil iOS/Android physique. Firefox, WebKit et le pincement natif ne sont pas couverts par cette suite Chromium.

Configuration : `playwright.config.ts`. Scénarios : `e2e/workflows.spec.ts`. Références : [serveur de test Playwright](https://playwright.dev/docs/test-webserver), [exécution en CI](https://playwright.dev/docs/ci).
