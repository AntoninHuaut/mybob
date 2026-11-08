---
name: mybob-plan-conversion
description: Reconstruct or regenerate Mybob house JSON from architectural PDFs. Splits what a script may do (measure, compute, verify) from what the AI must decide (which wall, which thickness, which dimension), gates the result on the surfaces printed in the plan, and records the traps that already cost a session.
---

Pointer: the source of this skill is `.agents/skills/mybob-plan-conversion/SKILL.md`. Add
nothing here.

The skill weighs about 80 KB. Read it in parts rather than all at once:

1. The introduction up to "What the state of the art says" (the rule, the inventory, the two
   loops and their commands) — read it in full.
2. Then `grep -n '^##' .agents/skills/mybob-plan-conversion/SKILL.md` and only the sections of
   the current step: evidence, layers, common reference, schema traps, verify, retouch,
   deliver.
3. The appendices in `.agents/skills/mybob-plan-conversion/references/` when a section points
   to them.
