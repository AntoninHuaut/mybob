# Déploiement Cloudflare Pages et CI GitHub

## Publication publique, données de maison locales

`npm run build` produit désormais une application publique avec **uniquement le studio de démonstration**. Vite ne copie pas le dossier `public/` : un plugin embarque explicitement le favicon et `studio-demo.json`. Tout plan personnel (`public/projects/private-*.json`, git-ignoré), les PDF et les photos de chantier ne font pas partie de cet artefact.

Les meubles, réglages solaires et projets importés sont traités et conservés dans le navigateur. Leur export reste un fichier personnel. Ces données ne sont pas envoyées à Cloudflare par l’application. Un changement d’origine de site ne transfère pas le stockage du navigateur : **exporter le projet et son aménagement depuis l’ancien site privé avant la migration**, puis importer ce fichier sur le nouveau site.

Le dépôt GitHub est public et ne contient aucun plan personnel : les projets personnels vivent dans `public/projects/private-*.json`, git-ignorés, et leur historique a été purgé.

Le service de build Cloudflare compile ces sources publiques ; la séparation garantit l’absence de données personnelles du site distribué.

Pour utiliser le vrai plan localement, de manière explicite :

```sh
npm run dev:private
npm run build:private
```

Le résultat de `build:private` ne doit pas être publié sur un site public. `npm run check:public` le rejette.

## CI GitHub Actions

Toutes les modifications passent par une branche `codex/` et une MR vers `main`. Aucun push direct ni fusion avec CI distante en attente ou en échec. Les tests locaux ne remplacent pas les checks du dernier commit de la MR. Le propriétaire autorise l’auto-merge GitHub lorsque les checks requis sont verts : l’activer pour les changements terminés et validés, sans redemander une permission par MR. Cloudflare ne doit recevoir la branche de production qu’après cette validation ; ses pipelines de build restent techniquement indépendants de GitHub Actions.

Protection GitHub de `main` : MR obligatoire, check « Tests, types, build et confidentialité » exigé depuis GitHub Actions, branche à jour (`strict`), règles appliquées aux administrateurs, force-push et suppression interdits. L’auto-merge attend ces checks et ne constitue pas un contournement. Ces réglages serveur ne sont pas contenus dans le diff Git.

Le workflow `.github/workflows/ci.yml` s’exécute sur les pushes vers `main`, les pull requests visant `main` et sur lancement manuel. Il utilise Node 24, pnpm 12.15.0 et `pnpm install --frozen-lockfile` avec `pnpm-lock.yaml`. Le passage à pnpm remplace l’ancienne installation `npm ci`.

Contrôles : mise en forme, tests, vérification TypeScript, compilation publique, puis contrôle de l’artefact. Le contrôle public rejette les fichiers hors liste autorisée, les documents d’origine, le vrai projet de maison et ses signatures connues dans les ressources JavaScript. Ce garde-fou complète l’inclusion explicite des seuls fichiers de démonstration ; il ne remplace pas la revue de tout nouvel asset destiné à être public.

Les Actions ont uniquement `contents: read`, aucun secret Cloudflare, une limite de 15 minutes et annulent les exécutions devenues obsolètes sur la même branche.

Après le contrôle public, GitHub partage le build avec trois runners qui exécutent les tests E2E en parallèle (`--shard`), en Chromium ordinateur. Chromium headless shell est mis en cache par version. Le check obligatoire « Tests, types, build et confidentialité » agrège le build et les trois lots : tout échec ou lot ignoré bloque sa réussite et l’auto-merge. Les rapports et traces d’échec sont archivés sept jours. Voir `docs/E2E.md`. Cette étape n’est pas incluse dans `npm run ci` côté Cloudflare : les deux pipelines restent indépendants.

## Connexion Cloudflare Pages

Dans le compte Cloudflare du propriétaire : **Workers & Pages → créer une application Pages → connecter GitHub**, puis autoriser uniquement le dépôt `AntoninHuaut/mybob`.

| Paramètre               | Valeur                       |
| ----------------------- | ---------------------------- |
| Projet Pages            | `mybob` ou un nom disponible |
| Branche de production   | `main`                       |
| Dossier racine          | racine du dépôt              |
| Framework               | aucun / Vite                 |
| Commande de build       | `npm run ci`                 |
| Dossier publié          | `dist`                       |
| Variable `NODE_VERSION` | `24`                         |

Cloudflare installe les dépendances puis exécute les mêmes contrôles avant sa publication. Un échec de test ou du contrôle public empêche ce déploiement et conserve la version précédente. Il n’est donc pas nécessaire de supposer que la CI GitHub a déjà terminé : les deux pipelines sont indépendants et utilisent les mêmes exigences.

Le fichier `wrangler.toml` déclare le dossier de sortie Pages. Aucun jeton Cloudflare n’est enregistré dans le dépôt. Les prévisualisations de branches doivent elles aussi conserver la commande publique ; ne pas y substituer `build:private`.

## État de la connexion

La connexion GitHub → Cloudflare Pages est active sur `main`. Le site est `https://mybob-9rj.pages.dev/`. Cloudflare Access protège les previews ; ne pas modifier ces restrictions pour tester. Vérifier les checks GitHub CI et Cloudflare du commit précis avant d’annoncer une publication.

La recherche de commune du réglage Soleil contacte Open-Meteo uniquement après un clic explicite et transmet seulement le nom recherché. Les coordonnées choisies, plans et meubles restent dans le stockage local et les exports.
