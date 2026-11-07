# Tests de bout en bout

Les scénarios Playwright utilisent uniquement le build public de démonstration, servi sur `127.0.0.1`, sur un port libre tiré à chaque exécution. Ils ne ciblent ni le site déployé ni un projet personnel. Chaque test démarre avec un contexte navigateur et un stockage vierges.

Prérequis une seule fois : `pnpm exec playwright install chromium` (sous Linux,
`pnpm exec playwright install --with-deps chromium` à la première installation). Choix du
port et serveur : `playwright.config.ts`.

## En local : cibler la fonctionnalité, jamais la suite entière

La suite e2e complète est l'affaire du pipeline : la CI la joue sharded en trois
(`test:e2e:built --shard=n/3`, `ci.yml`). En local, un scénario e2e ne sert qu'à itérer sur
le workflow navigateur touché par un changement — par titre avec `--grep`, ou par fichier :

```sh
pnpm run build                                   # une fois, fige dist/
pnpm exec playwright test --grep "mesure"        # les scénarios dont le titre contient « mesure »
pnpm exec playwright test --grep "lien"          # le partage par URL (e2e/share-link.spec.ts)
pnpm exec playwright test e2e/furniture-actions.spec.ts   # tous ceux d'un fichier
```

Scénarios : `e2e/workflows.spec.ts` (canapé contre un mur, brouillon, variantes,
export/import JSON, plan/PNG, mesures, accueil), `e2e/furniture-actions.spec.ts`
(chaises et table, liaison TV, glisser), `e2e/share-link.spec.ts` (partage par lien :
lecture seule du destinataire, adoption, silence pour le propriétaire, vieux lien, hash
corrompu), `e2e/first-steps.spec.ts` (carte Premiers pas, aide). Choisir le fichier
d'abord, le `--grep` ensuite.

`pnpm run test:e2e` (build complet + exclusion du plan personnel + tous les scénarios)
n'est pas la boucle locale : il n'existe que pour la CI, qui rejoue tout sur le build
vérifié. Après un build public déjà vérifié, `pnpm run test:e2e:built` lance les scénarios
seuls — c'est lui qui reçoit le `--grep` ou le fichier. `pnpm run test:e2e:report` ouvre
le rapport HTML local. `--headed` affiche le navigateur.

Les scénarios tournent en Chromium ordinateur, sur le rendu logiciel SwiftShader, pour
rester exécutables sur une machine sans GPU. Ils passent par l'interface et les fichiers
téléchargés, sans accéder à l'instance interne du moteur ni modifier directement
`localStorage`.

Configuration : `playwright.config.ts`.
