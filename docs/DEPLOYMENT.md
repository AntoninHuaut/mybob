# Déploiement Cloudflare Pages et CI GitHub

## Publication publique, données de maison locales

`npm run build` produit désormais une application publique avec **uniquement le studio de démonstration**. Vite ne copie pas le dossier `public/` : un plugin embarque explicitement le favicon et `studio-demo.json`. Le vrai plan `private-project.json`, les PDF et les photos de chantier ne font pas partie de cet artefact.

Les meubles, réglages solaires et projets importés sont traités et conservés dans le navigateur. Leur export reste un fichier personnel. Ces données ne sont pas envoyées à Cloudflare par l’application. Un changement d’origine de site ne transfère pas le stockage du navigateur : **exporter le projet et son aménagement depuis l’ancien site privé avant la migration**, puis importer ce fichier sur le nouveau site.

Le dépôt GitHub reste privé. Le rendre public exposerait aussi son historique et le modèle de maison présent dans les sources : ce n’est pas nécessaire pour Cloudflare Pages.

Le service de build Cloudflare aura accès aux sources du dépôt privé, donc aussi au modèle personnel présent dans ce dépôt. La séparation garantit son absence du site distribué au public ; elle ne cache pas ces sources au fournisseur chargé de les compiler.

Pour utiliser le vrai plan localement, de manière explicite :

```sh
npm run dev:private
npm run build:private
```

Le résultat de `build:private` ne doit pas être publié sur un site public. `npm run check:public` le rejette.

## CI GitHub Actions

Le workflow `.github/workflows/ci.yml` s’exécute sur les pushes vers `main`, les pull requests visant `main` et sur lancement manuel. Il utilise Node 24, pnpm 12.15.0 et `pnpm install --frozen-lockfile` avec `pnpm-lock.yaml`. Le passage à pnpm remplace l’ancienne installation `npm ci`.

Contrôles : mise en forme, tests, vérification TypeScript, compilation publique, puis contrôle de l’artefact. Le contrôle public rejette les fichiers hors liste autorisée, les documents d’origine, le vrai projet de maison et ses signatures connues dans les ressources JavaScript. Ce garde-fou complète l’inclusion explicite des seuls fichiers de démonstration ; il ne remplace pas la revue de tout nouvel asset destiné à être public.

Les Actions ont uniquement `contents: read`, aucun secret Cloudflare, une limite de 15 minutes et annulent les exécutions devenues obsolètes sur la même branche.

Après le contrôle public, GitHub installe Chromium et exécute les tests E2E du build en formats ordinateur/mobile. Les rapports et traces d’échec sont archivés sept jours. Voir `docs/E2E.md`. Cette étape supplémentaire n’est pas incluse dans `npm run ci` côté Cloudflare : les deux pipelines restent indépendants et un échec E2E GitHub ne bloque pas à lui seul la publication Cloudflare.

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

La connexion GitHub → Cloudflare Pages est active sur `main`. Le site est `https://mybob-9rj.pages.dev/`. Le 5 novembre 2026, le propriétaire a rendu la production accessible et conservé Cloudflare Access sur les previews. Ne pas modifier ces restrictions pour tester. Vérifier les checks GitHub CI et Cloudflare du commit précis avant d’annoncer une publication. Aucun ancien hébergement Sites n’est la cible de livraison.

La recherche de commune du réglage Soleil contacte Open-Meteo uniquement après un clic explicite et transmet seulement le nom recherché. Les coordonnées choisies, plans et meubles restent dans le stockage local et les exports.
