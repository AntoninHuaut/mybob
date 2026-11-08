---
name: mybob-issues
description: Open a Mybob GitHub issue that can actually be worked from — the body format, the level of evidence expected, the acceptance criterion, and the anonymisation rules for a public repository.
---

# Opening a Mybob issue

An issue in this repository is not a reminder: it is the brief of a future session that will
not have the context of the one that wrote it. It must stand on its own. Write it in English;
quote interface text in French as it appears in the app.

## Before writing

1. **Check it does not exist.** `gh issue list --state all --limit 30`. An existing issue is
   extended with a comment; it is not duplicated.
2. **Name the file and the line.** An issue saying "the framing is too wide" gets debated; an
   issue saying `src/scene/framing.ts:94` replaces `outline: site.boundary` gets fixed.
3. **Count.** A measured number beats an adjective: "22 doors whose position nothing
   guarantees" rather than "many doors".

## The body

Five sections, in this order. Delete those with nothing to say.

```markdown
## The problem

What is wrong, where it is in the code, and what it concretely produces.
One sentence of consequence for the user, not for the developer.

## What we already know

Measurements, failed attempts, the figures of both plans.
A table when there are more than two values to compare.

## What is needed

The options by increasing cost, with the preferred one named and why.
No wish list: one direction.

## Acceptance criterion

One sentence checkable by someone who has not read the rest.
"On both plans, the house takes at least half of the width."

## Verification

The exact commands, and what they must return.
```

## What makes an issue workable

- **A measurable acceptance criterion.** "It works" is not one. "The same script returns
  exactly these two outlines" is one.
- **The traps already paid for.** If an attempt failed, write it down: otherwise the next
  session will repeat it. This is the most useful part of the body.
- **The figures of both plans** when the subject touches conversion. A single case proves
  nothing; two cases show what is general.
- **The reading / decision distinction.** What a script can measure and what the AI must decide
  do not mix in the same sentence.

## Anonymisation

The repository is public. Never a person's name, builder, plot, file number, address, nor
personal coordinates. A house is named by its town, as in
[mybob-plan-conversion](../mybob-plan-conversion/SKILL.md): the owner allows it. The two
reference cases of the conversion keep their names **plan A** and **plan B**. Dimensions, on
the other hand, may be quoted: they are measurements, not an identity.

Check before sending: `gh issue create --body-file` then re-read the rendering. An issue is
public as soon as it is created, and so is its history.

## Afterwards

- Add a label when it is obvious (`enhancement`, `bug`); otherwise none.
- Do not close an issue because the code moved elsewhere: close it when the acceptance
  criterion is met, and say so in the closing comment.
