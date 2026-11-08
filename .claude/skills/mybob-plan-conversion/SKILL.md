---
name: mybob-plan-conversion
description: Reconstruct or regenerate Mybob house JSON from architectural PDFs. Splits what a script may do (measure, compute, verify) from what the AI must decide (which wall, which thickness, which dimension), gates the result on the surfaces printed in the plan, and records the traps that already cost a session.
---

Renvoi : la source de ce skill est `.agents/skills/mybob-plan-conversion/SKILL.md`. Ne rien ajouter ici.

Ce skill pèse environ 80 Ko. Le lire par morceaux plutôt qu'en une fois :

1. L'introduction jusqu'à « Ce que dit l'état de l'art » (la règle, l'inventaire, les deux
   boucles et leurs commandes) — à lire en entier.
2. Puis `grep -n '^##' .agents/skills/mybob-plan-conversion/SKILL.md` et seulement les sections de l'étape en
   cours : preuve, couches, référentiel commun, pièges de schéma, vérifier, retoucher, livrer.
3. Les annexes `.agents/skills/mybob-plan-conversion/references/` quand la section y renvoie.
