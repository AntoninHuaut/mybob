# MyBob — brand identity

Single reference for the product identity: positioning, voice, palette, character and usage
rules for illustrations. The app is in French, so the copy examples below stay in French: they
are the interface's actual voice.

## The idea

**MyBob is Bob: an assistant for imagining your home and trying furniture arrangements at full
scale.** It makes choices simpler by giving concrete reference points, while leaving the person
arranging in charge. MyBob is the product name; Bob is the personality that embodies it.

Tagline: **« Faites de la place à vos idées. »** ("Make room for your ideas.") It evokes both
space and experimentation, without promising an automatic result. Functional description when
the context requires it: « Visualisez votre maison et essayez vos aménagements en 3D. »

### Personality

Bob is resourceful, attentive and calm. He has the practical sense of a good co-pilot: he
shows, explains and lets you decide. A small smile may show in the tone, never at the expense
of clarity. He plays neither the chatty robot nor the expert who knows better than the user.

- **Concrete**: simple words, measurements, understandable actions.
- **Warm**: a human welcome, without forced familiarity.
- **Sure of his limits**: tell a preview apart from an exact measurement or simulation.
- **Discreet**: the house and the controls stay the lead roles.

## Voice and writing

Use the formal « vous », short sentences and action verbs. Labels stay descriptive; the
personality mostly shows in the welcome, empty states and help. Bob may occasionally speak in
the first person, but frequent messages, errors and confirmations stay direct. No repeated
jokes, building-site jargon, systematic emojis or exclamations on every click.

| Situation     | Copy                                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| Welcome       | « Bonjour, moi c’est Bob. Faisons de la place à vos idées. »                   |
| Introduction  | « Visualisez votre maison, placez vos meubles et comparez vos idées. »         |
| Empty state   | « Pas encore de meuble ici. Ajoutez-en un pour commencer. »                    |
| Action        | « Ajouter un meuble »                                                          |
| Constraint    | « Le meuble ne peut pas passer à travers ce mur. Essayez une autre position. » |
| Local save    | « Enregistré dans ce navigateur »                                              |
| Solar preview | « Aperçu approximatif, selon le lieu et l’orientation indiqués. »              |
| Export        | « Exporter le projet »                                                         |

Avoid « Bob a tout sauvegardé dans le cloud », « Laissez-moi concevoir votre maison » or
« Oups, petit souci ! »: these promise too much or hide useful information. Never suggest a
conversation, an artificial intelligence or an autonomous action that does not exist.

## Visual direction: the lived-in workshop

A light, architectural base, warmed by a deep colour and an energetic accent. The interface
frames the house like a workbench: it competes neither with the plan nor with the furniture.

| Role  | Value     | Use                                       |
| ----- | --------- | ----------------------------------------- |
| Ink   | `#20312E` | Main text and occasional dark surfaces    |
| Chalk | `#F7F6F1` | Warm general background                   |
| White | `#FFFFFF` | Panels and fields                         |
| Sage  | `#37695C` | Primary actions, selection, markers       |
| Coral | `#D66B4E` | Rare accent, illustration or brand detail |
| Line  | `#D6DED9` | Separators and outlines                   |

These are intentions, not colours to apply blindly: check text/background contrasts and the
hover, focus, disabled and error states before integrating. Never use colour alone to convey
information.

Typography must be legible and available locally or through a system stack: a sober sans-serif,
slightly assertive headings, figures easy to compare. A mixed-case **MyBob** wordmark, with
"Bob" identifiable, is enough. Prefer simple shapes inspired by the plan (angles, lines,
openings), slightly rounded corners and consistent line icons. Avoid a literal building-site
aesthetic, decorative gradients and large flat areas that eat the scene.

### Bob, visual presence

Bob is a **visible, endearing character**, inspired by the reassuring energy of a cartoon
handyman: he likes looking for solutions, enjoys trying and invites you to get started. The
interpretation must be original, with its own silhouette and clothing; never reproduce the
character, costume or recognisable elements of an existing character.

Chosen direction: a stylised human companion, with simple, expressive shapes, an immediately
recognisable silhouette, a natural smile and an active posture. Contemporary workshop clothing
(overshirt or apron, a small tool or tape measure) evokes the practical side; the sage, chalk
and coral palette ties the character to the product. Keep proportions and expressions suited
to adults: warm and a little mischievous, never babyish nor caricatural.

Bob appears at chosen moments, not permanently above the scene: he welcomes, explains a tool or
accompanies an empty state, then makes way for the plan. Errors and save information stay
sober and precise.

## Delivered assets

Everything is in `src/assets/brand/`, imported from code so that Vite emits hashed names. No
personal plan or photograph was used as a reference.

| File                                 | Role                                          | Current use                         |
| ------------------------------------ | --------------------------------------------- | ----------------------------------- |
| `bob.png`                            | Full-length welcome pose, character reference | Source, not displayed directly      |
| `bob-portrait.png`                   | Compact crop of the welcome pose              | Project panel                       |
| `bob-plan.png`                       | Bob studies a generic plan                    | Short and full help                 |
| `bob-mesure.svg`                     | Bob points a tape measure                     | Instruction bar of the Measure mode |
| `bob-contrainte.svg`, `bob-idee.svg` | "Constraint" and "idea" poses                 | Drawn, not displayed yet            |
| `public/favicon.svg`                 | "Bob's door" glyph: an open door, an eye      | Favicon and small-size brand mark   |

The glyph is the only brand element allowed at small size: a single colour, legible at 16 px,
no gradient, never next to every control.

Usage rules:

- Detailed poses are reserved for the welcome, help and empty states; never overlaid on the 3D
  scene.
- Toasts stay text-only by default; a pose only appears for a lasting message.
- Decorative illustrations carry `alt=""` when neighbouring text already names Bob; an image
  that alone carries information gets useful alternative text.
- No animation required; if one is added, respect `prefers-reduced-motion`.
- Site images go through `src/assets/brand/` and the allowlist in
  `scripts/check-public-build.mjs` (`assets/bob-*.png`). Never widen this rule to all of
  `public/`.
- No mandatory remote font: the system stack is enough, with a verified fallback.

## Application in the product

1. **Entry**: MyBob name, tagline or descriptive sentence and a short introduction of Bob.
   Access to the demonstration project and to import stays immediately clear.
2. **Working interface**: compact brand mark in the header; palette and typography serve the
   scene, without enlarging controls or getting in the way of forms.
3. **Contextual help**: one useful sentence in the right place, with Bob as an occasional
   signature. Shortcuts, units and constraints stay explicit.
4. **Messages and data**: explain local saving, export and preview limits precisely. Never imply
   that plans are synchronised or sent to Bob.
5. **Exports and media**: a discreet MyBob title block if it stays compatible with legibility;
   no brand on images without an explicit product decision.

## Still to do

- Retouch the background of the two PNG poses to chalk `#F7F6F1` or pure transparency: they
  currently sit on pure white and "float" in the panel.
- Display the "constraint" and "idea" poses once lasting messages exist.
- Check how the poses render on screen, at 2× on a dense display.

## Open decisions

Should Bob be shown as an almost abstract sign or as a more visible character? Should the
tagline appear in the application or only in its presentation? These choices can be settled
after reviewing the visual directions in the real interface.
