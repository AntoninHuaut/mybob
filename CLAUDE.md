@AGENTS.md

## Claude Code

- `AGENTS.md` above is the only source of rules: this file adds none, it only says how Claude
  Code reaches them.
- The repository skills live in `.agents/skills/` (shared with other agents). `.claude/skills/`
  only holds pointers to them, so that Claude Code discovers them: edit the source skill, never
  the pointer.
- `.claude/settings.json` allows the usual verification commands. Personal settings go in
  `.claude/settings.local.json`, git-ignored.
