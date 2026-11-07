# Tests de bout en bout

Les scénarios Playwright utilisent uniquement le build public de démonstration, servi sur `127.0.0.1`, sur un port libre tiré à chaque exécution. Ils ne ciblent ni le site déployé ni un projet personnel. Chaque test démarre avec un contexte navigateur et un stockage vierges.

## Lancer localement

Avec Node 24 et les dépendances verrouillées installées :

```sh
pnpm exec playwright install chromium
pnpm run test:e2e
```

Sous Linux, la première installation peut nécessiter `pnpm exec playwright install --with-deps chromium`. `test:e2e` compile l'application, vérifie l'exclusion du plan personnel puis lance les scénarios. Le port est tiré au hasard à chaque exécution (`playwright.config.ts`) : plusieurs agents peuvent lancer la suite en parallèle sans se collisionner. Aucun serveur déjà présent n'est réutilisé.

Après un build public déjà vérifié, `pnpm run test:e2e:built` lance les scénarios seuls. `pnpm run test:e2e:report` ouvre le rapport HTML local. `--headed` affiche le navigateur.

Les scénarios tournent en Chromium ordinateur, sur le rendu logiciel SwiftShader, pour rester exécutables sur une machine sans GPU. Ils passent par l'interface et les fichiers téléchargés, sans accéder à l'instance interne du moteur ni modifier directement `localStorage`.

Configuration : `playwright.config.ts`. Scénarios : `e2e/workflows.spec.ts`, `e2e/furniture-actions.spec.ts` et `e2e/first-steps.spec.ts`.
