# Trying a furniture arrangement

Interface labels are quoted in French, as the user sees them.

## Variants and precise placement

In Meubles, Dupliquer creates a variant independent of all levels; Renommer gives it a name. The selector compares up to ten layouts with the camera kept in place. Each variant/level keeps its Annuler/Rétablir (undo/redo) history during the session. JSON exports contain every variant, including the active one for earlier versions of the application. Older local saves are picked up without erasing their original keys.

The Placement précis pane has a multiple selection distinct from the edited piece. Tick pieces, choose X (horizontal) or Z (vertical) and align their edges or centres on the first ticked one. Espacements égaux distributes at least three pieces/sets between the two extremes, which stay in place. Every member of a linked set must be ticked; a lock or a collision with the building refuses the whole operation. One operation is a single Annuler action.

The Grille and Murs proches checkboxes separately enable snapping while dragging. The grid step is entered in centimetres. Both are off at start and stay optional aids; they never allow crossing walls and never change furniture measurements.

In the **Meubles** tab, add a piece by its category and its dimensions in centimetres. Adding uses the entered dimensions and a parametric configuration. The old Photo and merchant-link tabs have been removed: they generated no geometry.

Select a piece in the scene or in the list of present objects. Move it by dragging, enter a rotation, or use the arrows (1 cm, Shift: 10 cm). R rotates by 15°, Delete removes, Ctrl Z undoes and Ctrl Shift Z redoes. A complete drag is a single history action. Locking protects the placement.

Ctrl C copies the selected piece into the workshop clipboard for the session; Ctrl V creates an independent copy with a new identifier, unlocked and not linked to the original group. Pasting looks for a free spot in the original room and stays undoable. The system clipboard, text input and edit dialogs are not intercepted. The Dupliquer button stays available in the quick bar and in Autres actions.

The Ctrl Z/Y/C/V shortcuts use the key's logical character: Ctrl Z also works with AZERTY (`z` on the physical `KeyW` key). Delete works after Dupliquer without clicking the scene again. Arrows also act from the quick bar or the piece's row; they respect the path and do not cross a thin partition, even with Shift. Fields and dialogs stay protected. A locked member or a constraint that blocks dragging is reported once per gesture, without creating a false Annuler action.

A selected table offers **Chaises**: a count from 1 to 16 (8 by default), adjustable width/depth and gap to the top. Chairs face the table, are distributed along its sides and follow its rotation. The gap may be zero; it is not an imposed clearance. The Lier les chaises à la table option can be unticked. Nothing is added before validation; a wall or a physical overlap refuses the whole addition without moving existing furniture. A single Annuler action removes the new chairs.

Linking is shown in an Ensemble block with the members' names. No piece is preselected in the menu to avoid an accidental link to the first one in the list. Ajouter à l'ensemble prepares the draft; Enregistrer, at the bottom of the whole window, also validates the link. Annuler discards it. The selection bar shows « n liés » and its title lists the members.

Additions and duplications look for a free spot in the chosen room. If there is not enough room, no piece is added and the input box stays open. Dragging stops on contact with walls, glazing and lintels, including after a pointer jump. Entered rotations, dimensions and positions are refused if they make the piece penetrate the building or exceed its outline/ceiling. Conflicts between pieces and clearance envelopes stay diagnostics, so that you can for instance test a chair under a table.

When an increase in width/depth is blocked by the building, the draft moves the centre towards the free space, within half the increase on each local axis. The side touching the wall stays touching, within geometric tolerance. A rotation or position explicitly edited is not corrected automatically. The shift keeps linked sets rigid and respects their locks and obstacles. If no local position allows the requested dimensions, the input stays refused; the building is never resized and the piece is never moved to another room. Annuler keeps the original and Enregistrer produces a single history action.

The **Déplacer vers…** button of the selected piece's bar lists the rooms of the level and moves the piece (and its linked set, rigidly) into the chosen one, in a single Annuler action, with every dimension untouched (`furniture/roomMove.ts`). It takes the free spot of that room nearest to where the piece was; walls, glazing and lintels still apply, clearances do not. A refusal says why: too big for the room by N cm even turned, room occupied by other pieces, no valid spot, or a linked piece that would not fit. A locked piece does not move.

When the selected piece's back stands against an interior partition (parallel to it, 10 cm off its face at most), the same dialog offers **Retourner contre l'autre face de la cloison**: the piece, and its linked set, turns half a turn around the point of the partition behind it, so it stands against the other face with the same gap and the same dimensions. Walls, glazing, lintels and the outline still decide on the other side; a refusal says so. One Annuler action.

A drag sweeps the piece along its path, so a fast pointer never jumps a wall. When the pointer goes over another room that the sweep cannot reach, the piece waits at the wall and a translucent ghost shows where it would land: the valid spot of that room nearest to the pointer (`dropFurnitureInRoom`), searched again every 5 cm of pointer travel. Releasing lands it there, one Annuler action; bringing the pointer back into a reachable room removes the ghost. As during a drag, only the building is mandatory there, overlapping another piece stays a diagnostic. An interrupted drag (window blur, cancelled pointer, mode change) never lands. Invalid positions imported from older files are not silently moved. They stay flagged and can be dragged out of the wall. The Position field moves a piece directly into another room; dragging respects the obstacles on its path.

Distances start from the centres of the four faces. Clearance and opening envelopes are adjustable; intersection and swing warnings are conservative geometric aids, with no regulatory certification. The theoretical delivery module accounts for neither tilting, nor packaging, nor turns along the path; it is no longer exposed as a placement warning. Clearances are optional, with no value imposed when adding.

During placement, only the distances to obstacles are shown (« Écart »); the piece's dimensions stay available in its card. Besides the four axes towards the walls, the selected piece gets a real dimension (closest points of the footprints) to each neighbour outside its linked set within 1 m — at most three. Members of the same linked set (table + chairs) are never dimensioned against each other: the set moves as one block. Gaps ≤ 2 cm stay hidden.

Arrangements are saved locally per house and per level. The project export includes the furniture. A save error is reported if local storage is unavailable or full. Keep an export to transfer or back up the work.

In **Navigation**, next to the view tools, set a seated/standing eye height, hide obstructing façades, enable a cutaway, or pick a free floor point to start a walk there. This change of viewpoint does not simulate an automatic walk through the rooms. Full volumes and their collisions are restored during the walk.

House areas that are still uncertain stay flagged in the model's notes. Furniture does not improve the precision of the original plans.

## Types and configurations

The twenty categories are grouped by room in the Type de meuble menu: Salon, Salle à manger, Chambre, Dressing, Cuisine, Bureau, Salle de bain and Autre. The bathroom offers WC, shower, bathtub and vanity unit. Select a sofa then choose its shape: straight, corner with a return backrest, or open chaise longue. The side is described looking at the sofa from the front. Overall dimensions stay width, depth and height; the main body and the return width define the void of the L. Collisions use the two occupied parts and leave that void free for a table.

A walk-in wardrobe is described as a sequence of runs: a common depth, then for each run its length and the angle that ends it (left, right or end). One run is enough for a straight wardrobe, two make a corner, three a U, and so on up to twelve. Overall width and depth are computed from the runs and are not entered. Runs share their corner and the inner void stays free, for instance for a seat.

A kitchen uses the same run chain and corner convention as a dressing. Enter run lengths and depth in centimetres; the overall footprint follows automatically and its inner void stays free. Set the worktop height, the overall height (including tall columns), the front colour through Teinte du volume, and a separate worktop colour. Optional wall units share a bottom height, height and depth. Add sink, hob, oven-column and fridge-column markers with a run number, offset from that run's start and width. An oven column offers **Micro-ondes au-dessus du four**, off by default. The two appliances have separate fronts and the cabinet ends behind them to avoid competing surfaces. Slots must fit on their run and may not overlap on the same run. A separate straight kitchen represents an island. Everything stays in the popup draft until Save and travels with JSON exports and share links. These are simplified volumes and equipment markers, not a reconstruction of appliances or photo textures.

Kitchen base units and tall columns share a continuous straight plinth down to the floor,
10 cm high and recessed 4 cm from the run's edges, including the exposed back of an island.
Small runs clamp that recess to a quarter of their length or depth. The plinth uses the cabinet
finish; worktop and appliance heights, overall dimensions and placement stay unchanged.

A shower is described by two independent settings: the tray height in centimetres, where 0 gives a walk-in shower without a tray, and the sides carrying a glass panel (left, right, front, back). A ticked side takes an optional length in centimetres: a panel shorter than the side leaves the rest open, which is how a walk-in shower keeps its entrance (left and right panels start at the back where the shower head is; front and back panels start from the left or the right as chosen). A blank length keeps the whole side, so earlier projects and links do not change. Geometry in `furniture/showerPanels.ts`. The shower head is at the back of the volume; rotating the shower changes the wall. Sanitary volumes are simplified markers: replace the proposed measurements with those of the real model.

Mounting height is relative to the finished floor. The Ajouter une TV dessus button of a TV unit places a television at its top height. Proposed dimensions are to be replaced with those of the real model.

The floating controls on the selected piece rotate by −90°, +90° or +15°, in plan and in 3D. The same constraints and history apply: a rotation that penetrates a wall is refused.

This bar also gives access to Dupliquer and Retirer, without opening the popup. While dragging, magnetism sticks the piece to walls and aligns centres/edges with other pieces; holding Alt suspends it for that gesture. Every action is undoable. Actions performed in the popup stay drafts until Enregistrer. The bar wraps onto several lines on a narrow screen. Clicking outside the piece in the scene, or Escape even with a button focused, clears the selection and its green outline. Ctrl Z / Ctrl Shift Z work with no piece selected and with focus on a button; fields and dialogs keep their own editing.

3D navigation uses left drag to rotate, right drag to pan and the wheel to zoom. Plan also pans with a simple drag and zooms with a pinch on a touch screen. Every control has an icon that distinguishes the button. Right-drag panning sensitivity was brought back to the normal Babylon value after the regression of the previous pass.

## Navigation and editing

ZQSD / WASD moves the 3D or Plan view in screen directions, at a speed adapted to the zoom. Shift speeds up. Clicking in the view gives it the keyboard; form fields and menus keep their keys. Arrows move a selected piece, or the view with no selection.

A single click selects and offers the quick rotations. A double click in the scene opens an edit popup, as when adding. No edit form stays in the side panel. The Modifier button gives the same access from the keyboard. The panel no longer rebuilds on a configuration click, on Passage et ouverture, or when it loses focus: inputs and panes stay stable.

Sofa depths are entered from the back: depth of the main body, then total depth on the extended side. No subtraction is asked. The local diagram shows these two lengths and the return width. L-shaped seats and bases use continuous volumes, with no hole at the junction.

The popup's Teinte du volume repaints the piece, as when adding, locked or not: colour is not geometry. It stays a draft like the rest; an untouched control keeps the stored hex spelling, since the browser reports lowercase. Changing a straight sofa into a corner or chaise longue uses the displayed total depth for the return; going back to a straight sofa keeps the body depth. Measurements left untouched keep their original precision. Unticking the lock in the popup immediately makes dimensions and position editable, in the same draft. Annuler keeps the original piece and lock; Enregistrer applies the unlock and the changes together.

A TV is first entered by its diagonal in inches, in 16:9. The case and feet are estimated; Dimensions exactes corrects width, depth and height. A manual change of width/height removes the associated diagonal, so as not to keep an indication that has become wrong. Older televisions with custom dimensions stay compatible.

## Furniture sets

In a piece's settings, Lier à un autre meuble picks its partner. Linking keeps the current positions. Moving or rotating a member transforms the whole group, with a common stop against walls and a single Annuler action. A locked member blocks transformations that would move it. Séparer les meubles makes the set independent again. Dimensions stay individual. Ajouter une TV dessus creates the television and links it to the TV unit automatically.

Plan view cuts walls at 1.20 m by default and draws windows and bays in cyan at their real positions. Furniture keeps its visible volume, including wardrobes and TVs; an explicit cutaway chosen in the settings keeps priority for walls.

The DOM controller tests use Happy DOM (no graphical browser) to check the stability of menus and inputs, form conversions, inches and opening the editor. The Babylon NullEngine tests cover geometry, groups and navigation; they do not validate GPU rendering on the user's machine.

## Popup and discreet controls

Modifier opens a modal window with Annuler and Enregistrer. Closing, Annuler or Escape discards the whole draft, including link, separate, duplicate, align, add a TV and remove. Enregistrer applies the changes as a single undoable operation. A refused placement keeps the popup and the input for correction. Groups and explicit actions stay available in the popup; secondary actions are grouped under Autres actions and Favori has been removed. An empty link block is no longer rendered.

The selection bar is now compact and docked at the bottom of the view; it no longer follows the piece and does not hide its movement. Navigation is a separate panel, next to the view tools, for camera settings.

During the walk, aiming at a piece less than three metres away then pressing F opens its popup. Walls and doors stop the aim; E keeps control of doors. The walk is paused and the mouse released during editing. After closing, Reprendre la visite or a simple click in the view recaptures the mouse; a request refused during the cool-down window that follows Escape (Chromium) is retried automatically once, and only a second failure shows the message.

## Rendering resources

Furniture bodies merge into one triangle mesh per used finish, preserving their root,
identifier, picking and collision shape. Materials are created only when used, shared by
role and exact colour channels (without hex rounding), reference counted, and released with the final owning visual. Moving or
elevating an unchanged piece reuses its meshes; dimension/shape/colour edits rebuild it.
Ghosts use the same finish cache and remain non-pickable.

The 3D finishes use PBR: finish roughness 0.6, fabric 0.95 with fine plaster relief,
wood feet 0.55, linen 0.9 and metallic handles 0.35. Plan uses a lazily shared StandardMaterial
counterpart with the previous diffuse/specular palette, alpha and face-culling policy. Counterparts are released on return
to 3D. Box parts have a 4 mm chamfer, reduced to one fifth of the thinnest dimension for
small parts; L-shaped upholstery keeps its closed continuous polygonal solids.

One non-pickable contact mesh per piece follows its occupied convex footprints, including
L-shaped voids. It shares a generated alpha tile, sits 2 mm above its room's finished floor,
and follows translation/rotation without following the piece's optional vertical elevation.
Plan disables it. Body meshes also enter the sun's caster list; furniture revisions invalidate
the cached shadow pass and walk aim after setItems and live placement.

Measured repository benchmarks, each with one default piece of every kind:

| Fixture         | House meshes before / after | Furnished meshes before / after | Materials before / after | Vertices before / after |
| --------------- | --------------------------- | ------------------------------- | ------------------------ | ----------------------- |
| Large benchmark | 266 / 124                   | 438 / 241                       | 113 / 25                 | 14,565 / 23,621         |
| studio-demo     | 70 / 38                     | 192 / 105                       | 107 / 19                 | 5,746 / 14,802          |

Furniture bodies alone fall from 122 meshes/98 materials to 47 meshes/9 materials; contact
footprints add 20 meshes and one material. Real chamfer strips and corner triangles add
8,784 vertices; contact quads add 80. This deliberate appearance cost has an explicitly
reviewed vertex budget with the same 10% headroom. Mesh/material ceilings are lowered to
the final counts plus 10%. NullEngine resource counts do not measure GPU frame time.
