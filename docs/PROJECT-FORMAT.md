# House project format

The TypeScript contract is in `src/model/types.ts`; `validateProject()` runs on load and on import. A project is a UTF-8 JSON file, under 32 MB for import from the interface. Names and labels inside a project are shown in the interface, so they are written in French.

## Frame of reference and units

- One unit is **one metre**, on every level.
- Points `[x, z]` describe the horizontal plane. `x` increases towards the right of the plan and `z` downwards.
- The vertical axis is `y`. `elevation` is the height of the level's finished floor relative to the project origin.
- Rendering uses a right-handed frame to keep the same layout as the PDF and the mini-map. The `spawn.yaw` contract of v1 files is unchanged: 0 looks towards the bottom of the plan, π towards the top; the conversion to the camera is internal.
- A wall is defined by its axis, its two ends, its height and its finished thickness. The thickness is split on each side of the axis.
- Openings are measured along the wall axis, from `start`, towards `end`.

## Minimal project

```json
{
  "schemaVersion": 1,
  "id": "maison-exemple",
  "name": "Maison exemple",
  "description": "Un premier niveau",
  "units": "m",
  "source": {
    "title": "Mon plan coté",
    "status": "À vérifier",
    "notes": ["Origine et précision des dimensions."]
  },
  "levels": [
    {
      "id": "niveau-rdc",
      "name": "Rez-de-chaussée",
      "elevation": 0,
      "ceilingHeight": 2.5,
      "outline": [
        [0, 0],
        [6, 0],
        [6, 5],
        [0, 5]
      ],
      "spawn": { "position": [3, 3], "yaw": 3.14159 },
      "walls": [
        {
          "id": "mur-nord",
          "start": [0, 0.15],
          "end": [6, 0.15],
          "thickness": 0.3,
          "exterior": true
        },
        {
          "id": "mur-est",
          "start": [5.85, 0.15],
          "end": [5.85, 4.85],
          "thickness": 0.3,
          "exterior": true
        },
        {
          "id": "mur-sud",
          "start": [0, 4.85],
          "end": [6, 4.85],
          "thickness": 0.3,
          "exterior": true,
          "openings": [
            {
              "id": "porte-1",
              "kind": "door",
              "offset": 2.5,
              "width": 0.9,
              "height": 2.1,
              "exterior": true
            }
          ]
        },
        {
          "id": "mur-ouest",
          "start": [0.15, 0.15],
          "end": [0.15, 4.85],
          "thickness": 0.3,
          "exterior": true
        }
      ],
      "rooms": [
        {
          "id": "piece-1",
          "name": "Pièce principale",
          "kind": "living",
          "polygon": [
            [0.3, 0.3],
            [5.7, 0.3],
            [5.7, 4.7],
            [0.3, 4.7]
          ],
          "label": [3, 2.5],
          "viewpoint": [3, 3]
        }
      ],
      "lights": [{ "id": "plafonnier-1", "position": [3, 2.5], "provisional": true }]
    }
  ]
}
```

## Walls and openings

Walls may be oriented freely. Corners are not joined by a boolean operation: their ends must be extended or adjusted to close the junctions. The generator distributes the solid parts of the wall around the openings, including the sill wall and the lintel. Collisions match these solids. A wall's height does not exceed its level's ceiling height, except for a dormer back wall, which crosses the roof covering: its declaration is described with [the roof](EXTERIOR.md).

`kind` is `door`, `window`, `sliding` or `garage`. The `sill` defaults to zero. `offset`, `width` and `height` are in metres and the opening must stay entirely within its wall. Openings must not overlap. A roof window is not a wall opening: it is declared on the roof slope carrying it, in `site.roofs[].windows`, and is read on the section rather than on the horizontal plan — see [the roof](EXTERIOR.md).

For a hinged door, `hinge` is `start` or `end` and `swing` is `1` or `-1`. Rotation happens around the local vertical axis. The direction must be checked in 3D after interpreting the plan symbol. The nominal height is that of the clear passage, before the small visual joinery profiles.

Windows are fixed in this version. Sliding bays have one moving panel and one fixed panel; a non-zero sill makes it a sliding window set on a sill wall. A hinged door may carry `glazed: true` for a glazed leaf (French window) that opens like a door, and `leaves: 2` for one leaf per jamb, meeting in the middle of the opening; `hinge` then no longer says which side the door opens from. The garage door is a sectional shutter: panels follow a vertical track, a quarter turn at the lintel, then a horizontal plane under the ceiling, without modelling the tracks themselves.

## Rooms

A room is a finished interior outline independent of the walls. `polygon` is used for area computation, selection and location. Both must therefore be updated when the plan changes. Import refuses two rooms whose overlap exceeds 1 % of the smaller one. Format validation otherwise does not guarantee architectural conformity: a wall crossing a room is not checked (the plan audit reports it).

`planArea` is optional: it keeps the area stated in the reference document. The computed area is always derived from `polygon` and shown separately. Never change the outline only to force an area: linear dimensions and geometry take precedence.

`label` and `viewpoint` are positions inside the room. The walk point must leave a margin of at least 17 cm around the visitor, and must not lie in a door's swing.

Categories are `living`, `bedroom`, `bathroom`, `circulation`, `garage`, `storage`. The garage gets a grey floor; the other rooms use the wood-effect tiling. The project may provide an optional `finishes` object with the hexadecimal colours `wallColor`, `floorTint`, `garageColor` and `joineryColor`. Per-room textures and their visual editing are future extensions.

A room may declare `floorOffset`, between −1 and 0 m, for a floor lower than the level. The reference surface is then actually cut out, then replaced by a floor at that height; collisions and the viewpoint follow that floor. The ceiling keeps its level height: a lowered room therefore gains headroom under an unchanged ceiling. Thresholds up to 20 cm get a local stepping aid if no door or wall blocks the way. Beyond that, a flight declared in `stairs` describes the crossing.

## Sloping ceilings

An attic level keeps a flat `ceilingHeight` and declares its sloping parts in `ceilingSlopes`. Each slope has a foot line `start` → `end`, the ceiling `height` above the level floor along that line, and a `rise` per metre (1 for 45°). The ceiling rises on the **left** of `start → end` as drawn on the plan (x to the right, z downwards) — east to west for a slope rising south from a north knee wall — and validation refuses a slope whose rising side does not hold the middle of the plan. The slope runs the whole length of the level: the ceiling at a point is the lowest of the flat ceiling and of every slope. `gaps`, in metres along the foot line from `start`, interrupt the slope where a dormer opens the roof: there the ceiling stays flat.

```json
"ceilingSlopes": [
  { "id": "rampant-nord", "start": [12.06, 1.27], "end": [0.34, 1.27], "height": 1.24, "rise": 1 },
  { "id": "rampant-sud", "start": [0.34, 7.23], "end": [12.06, 7.23], "height": 1.24, "rise": 1,
    "gaps": [[1.82, 2.72]] }
]
```

The ceiling and the top of every wall follow the slopes (`src/model/ceiling.ts`); a dormer back wall, the only wall allowed above the flat ceiling, is not trimmed. A fixture hangs from the ceiling above it. An opening must fit under the ceiling over its whole width, and a room's walk point needs 1.80 m of ceiling above it. A roof window (`site.roofs[].windows`) over a level with slopes opens the ceiling over its plan footprint, and the sides of that well rise vertically from the ceiling to the roof face, so the window shows from inside. The ceiling is not a collider: the walk camera can still lean into a low slope. Furniture is refused when its top passes the lowest ceiling over its corners.

## Stairs and floor openings

A level may declare `stairs`, a list of straight flights rising to the level above. Each flight carries `start` and `end` (the axis, from the first to the last nosing), `width` (clear width, centred on the axis), `steps` (number of steps) and `rise` (total height climbed, from this level's floor to the floor of the level above). The going is the axis length divided by `steps`. Validation rejects a going under 15 cm, a step over 25 cm, and a flight with an end outside the level outline.

`floorVoids` declares the openings in this level's floor, as simple polygons inside the outline. A void pierces the floor, the slab and the ceiling of the level below: the upper level carries it, since it belongs to its floor.

The schema only describes straight flights. A winder, spiral or landing staircase is broken down into several straight flights: an approximation of the winders, to be declared as such. Balustrades, stringers and soffits are not modelled, and the walk camera does not climb the steps.

## Adding and saving

Import the file with the **Importer ma maison** button. An import with the same identifier asks for confirmation before replacing its previous imported version or hiding the bundled version of the same project. When that project is open, the confirmation offers to export its current version first. Furniture is replaced only for the levels provided in the imported arrangement. Removing that imported project restores the bundled version, when it exists. Level and room outlines must be simple, with no crossing nor repeated edge.

Saving is local to the browser: no synchronisation between devices. Exporting the project keeps the dimensions and assumptions, not the current camera. Multiple levels are selectable; flights declared in `stairs` are rendered and block the way, but the walk camera does not climb them.

The export may include `furnishing: {version: 1, levels: {...}}`, with the furniture per level identifier. This data is validated and saved separately on import to avoid duplicating photos in the plans' storage.

`furnishing.variants` is optional and contains `{version: 1, activeId, variants: [{id, name, levels: {...}}]}`. It accepts one to ten variants, unique identifiers, names of 1 to 60 characters and only the project's levels. Each furniture list is validated. When this object is provided, it is the complete set to restore; `furnishing.levels` stays a mirror of its active variant for compatibility. An older file without `variants` updates the provided levels in the active variant and keeps the other named variants. A variant's name is not an identifier. A full export of the older levels can also be used to restore an unreadable local variant store.

## Optional sun

`solar` may contain `latitude` (−90 to 90), `longitude` (−180 to 180), `northAngleDeg` (clockwise from the top of the plan), and optionally `timeZone` (IANA, for example `Europe/Paris`), `label` and `instant`. The latter keeps the chosen date and time as a canonical UTC ISO string (`2026-07-01T10:30:00.000Z`). Older files without `instant` use the current time. No location is provided by default. Import validates these fields; angles are normalised to [0,360). The computation uses an absolute instant, the local date and time being converted with the chosen time zone.

Settings applied in the interface stay in `maison-atelier:solar:<projectId>` and override those of the file during local use. The export includes the effective configuration. The local preference `null` means the user chose to return to standard lighting, even if the original file contains a solar field. This data is never sent to the hosting server.

## Sharing by link

The **Lien** button puts a snapshot of the current state in the URL fragment, in the form
`#p1:<base64url(deflate-raw(semantic pack))>`. The `p1` prefix isolates the format version so
that a future migration can be read without ambiguity. The fragment never leaves the browser:
it is neither sent to the hosting server nor recorded in the history
(`history.replaceState`).

The link carries a **complete export document**: the project, the arrangement of every level
and all the variants — never the current camera nor the navigation preferences. Two deliberate
differences from the exported JSON:

- **Renumbered identifiers.** Real identifiers (furniture, levels, walls, openings, rooms,
  stairs, lights, surfaces, roofs) are incompressible entropy; in the pack they become
  positional — `niveau-0`, `mur-0-1`, `meuble-0`, `groupe-0` — and are regenerated on
  unpacking. Kept: the project identifier, names (levels, rooms), notes, description, source
  and variant identifiers. Unpacking then repacking a link yields the same bytes.
- **Quantisation.** Distances are rounded to the millimetre, angles to a ten-thousandth of a
  radian, colours are interned as lowercase 24-bit values; absent fields are not written. The
  error is below input precision. A vertex lying exactly on an edge may therefore move back by
  0.71 mm at worst: the containment tolerance in `src/model/geometry.ts` is one millimetre so
  that the unpacked project stays valid.

When a link is opened: the project owner sees their state compared to the link (nothing if
identical, a choice of three outcomes otherwise); a recipient opens the project read-only, in
memory only, and may add it to their projects — it then gets a new identifier and becomes a
normal imported project, documented above. A truncated or corrupted link loads the local
project with a warning, never blocking start-up.
