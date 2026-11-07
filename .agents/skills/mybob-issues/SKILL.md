---
name: mybob-issues
description: Open a Mybob GitHub issue that can actually be worked from — the body format, the level of evidence expected, the acceptance criterion, and the anonymisation rules for a public repository.
---

# Ouvrir une issue Mybob

Une issue de ce dépôt n'est pas un pense-bête : c'est le brief d'une session
future qui n'aura pas le contexte de celle qui l'a écrite. Elle doit tenir seule.

## Avant d'écrire

1. **Vérifier qu'elle n'existe pas.** `gh issue list --state all --limit 30`.
   Une issue existante s'étend d'un commentaire ; elle ne se double pas.
2. **Nommer le fichier et la ligne.** Une issue qui dit « le cadrage est trop
   large » se discute ; une issue qui dit `src/scene/framing.ts:94` remplace
   `outline: site.boundary` se corrige.
3. **Compter.** Un nombre mesuré vaut mieux qu'un adjectif : « 22 portes dont la
   position n'est garantie par rien » plutôt que « beaucoup de portes ».

## Le corps

Cinq sections, dans cet ordre. Celles qui n'ont rien à dire se suppriment.

```markdown
## Le problème

Ce qui est faux, où c'est dans le code, et ce que ça produit concrètement.
Une phrase de conséquence pour l'utilisateur, pas pour le développeur.

## Ce qu'on sait déjà

Les mesures, les essais qui ont échoué, les chiffres des deux plans.
Un tableau quand il y a plus de deux valeurs à comparer.

## Ce qu'il faudrait

Les options par coût croissant, avec la préférée nommée et la raison.
Pas de liste de souhaits : une direction.

## Critère d'acceptation

Une phrase vérifiable par quelqu'un qui n'a pas lu le reste.
« Sur les deux plans, la maison occupe au moins la moitié de la largeur. »

## Vérification

Les commandes exactes, et ce qu'elles doivent rendre.
```

## Ce qui rend une issue exploitable

- **Un critère d'acceptation mesurable.** « Ça marche » n'en est pas un.
  « Le même script rend exactement ces deux contours » en est un.
- **Les pièges déjà payés.** Si une tentative a échoué, l'écrire : la session
  suivante la refera sinon. C'est la partie la plus utile du corps.
- **Les chiffres des deux plans** quand le sujet touche à la conversion. Un cas
  unique ne prouve rien ; deux cas montrent ce qui est général.
- **La distinction lecture / décision.** Ce qu'un script peut mesurer et ce que
  l'IA doit trancher ne se mélangent pas dans la même phrase.

## Anonymisation

Le dépôt est public. Jamais de nom de ville, de constructeur, de lot, de numéro
de dossier, ni de coordonnée personnelle. Les plans s'appellent **plan A** et
**plan B**. Les cotes, elles, se citent : ce sont des mesures, pas une identité.

Vérifier avant d'envoyer : `gh issue create --body-file` puis relire le rendu.
Une issue est publique dès sa création, et son historique aussi.

## Après

- Poser un label quand il est évident (`enhancement`, `bug`) ; sinon rien.
- Ne pas fermer une issue parce que le code a bougé ailleurs : la fermer quand
  le critère d'acceptation est atteint, et le dire dans le commentaire de
  fermeture.
