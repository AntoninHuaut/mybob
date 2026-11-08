@AGENTS.md

## Claude Code

- `AGENTS.md` ci-dessus est la seule source des règles : ce fichier n'en ajoute aucune, il
  dit seulement comment Claude Code y accède.
- Les skills du dépôt vivent dans `.agents/skills/` (partagés avec les autres agents).
  `.claude/skills/` n'en contient que des renvois, pour que Claude Code les découvre :
  modifier le skill source, jamais le renvoi.
- `.claude/settings.json` autorise les commandes de vérification courantes. Les réglages
  personnels vont dans `.claude/settings.local.json`, git-ignoré.
