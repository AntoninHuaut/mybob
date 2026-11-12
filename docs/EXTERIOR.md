# Exterior (V2)

The terrain is an optional `site` field of the imported project. The engine contains neither plot coordinates nor hardcoded personal geometry. The public build still excludes the personal file; importing the house remains an operation local to the browser.

## Sources and precision

The terrain comes entirely from the project data: `boundary` describes the plot outline, `declaredArea` keeps the area stated in the reference document, and `elevation` sets the terrain height relative to the level's floor. The area computed from `boundary` is shown separately from `declaredArea`; a gap between the two signals an approximate entry and is never corrected by resizing the plot. These coordinates are not a land survey.

The terrain is flat by default. A project may declare lower points near a boundary or a lowered room: these slopes, banks and ramps stay simplified. The `gravel` and `path` surfaces express the intent of the parking area and the footpath; their joins are indicative.

The roof is described by `roofs`: vertices, planar faces and gables. The format accepts several slopes, hipped joins and any eaves and ridge heights; their projection must cover the roof envelope with no hole nor overlap. A recessed entrance is covered. Overhangs, gutters, thicknesses and framing are not represented. The declared pitch is not reproduced exactly: it stays indicative and is not presented as a verified dimension.

A slope may carry dormers in `dormers`: a footprint, `wallId` pointing to the back wall, and an optional `slope`. The back wall stays a wall of the level it crosses (`exterior: true`, parallel to the sides of the footprint): it alone carries its height and its window, like all other joinery, and it is the only wall allowed to exceed its level's ceiling height — it is the one that pierces the covering. Rendering cuts the slope over the footprint, from the inner face of the wall to its outer face, then builds the two rendered cheeks, the dormer's roof in covering material, and the dormer front: the back wall above the slope, in render, opened for the back wall's own windows. Without `slope`, that roof meets the main slope at the back of the footprint; with `slope` (rise per metre of setback), it meets it inside the footprint. Validation refuses what the engine cannot render: a footprint outside a single non-vertical slope, a slope that tilts along the dormer, a back wall that does not exceed the covering, a pitch with no possible junction. The dormer roof pitch is often undimensioned on plans: omitting `slope` then follows the drawing.

A slope may also carry roof windows in `windows`: a centre in plan, a horizontal width and a height measured along the rafter. A roof window belongs to no wall: rendering opens the slope and sets the frame in the slope's plane, at its height from the section. The printed width is read horizontally, the height along the rafter; the depth position is not read on the horizontal plan but on the section, and that is what tells a skylight apart from a vertical bay set against the eaves. Frame, glazing and mullion follow the roof in visibility and shadows; the glazing sits 6 mm back under the covering and no vertex leaves the slope, so the rafter hides the window wherever it hides the covering. Validation refuses what the engine cannot place: a window outside a single slope, a vertical or horizontal slope, a window that overflows or touches an edge of the slope (5 mm inset), a window smaller than the model's profiles (10 cm). A roof window stays a covering opening: neither roof hatch, flashing nor covering overhang is represented.

Exterior colours come from `facadeColor` and `roofColor`, with no certified colorimetric value. Interior faces stay white. Two-tone joinery and door colours are not reproduced yet: existing joinery stays simplified.

Reference documents are used to check openings and interior volumes. No fence or planting is invented: only declared surfaces are rendered. The lawn has a fine noise texture, deterministic and generated locally, with no image download.

## Optional format

```ts
site?: {
  boundary: [number, number][]; // x/z, in the ground-floor frame
  elevation: number;           // flat terrain, relative to the ground floor
  declaredArea?: number;       // plan information, distinct from the computation
  facadeColor?: string;        // #rrggbb
  roofColor?: string;
  surfaces?: {
    id: string;
    kind: 'gravel' | 'path';
    polygon: [number, number][];
  }[];
  roofs?: {
    id: string;
    vertices: [number, number, number][]; // x/y/z, y relative to the ground floor
    faces: number[][];                   // indices of planar polygons
    gables?: number[][];                 // faces rendered with render plaster
    dormers?: {
      id: string;
      start: [number, number]; // opposite corners of the footprint, in plan (x, z)
      end: [number, number];
      wallId: string;          // back wall of the crossed level
      slope?: number;          // dormer roof rise per metre of setback
    }[];
    windows?: {
      id: string;
      center: [number, number]; // window centre in plan (x, z)
      width: number;            // horizontal width, in metres
      height: number;           // height along the rafter, in metres
    }[];
  }[];
  notes: string[];
}
```

This format accepts another plot and another roof envelope without rewriting the engine. Polygons must be simple, accesses stay within the plot and the ground-floor footprint must fit inside it. Roof faces must be planar, non-degenerate, non-crossing and only reference valid integer indices. Colours and numbers are checked on import. The project format stays at version 1: projects without `site` keep working.

`buildExterior(project, level, scene)` returns an independent group and its meshes: terrain and accesses, façades identified by `metadata.wallId`, roof/gables initially hidden, horizontal bounds and maximum height. Slopes pierced by a dormer or a roof window are triangulated with their opening; the dormer's cheeks, roof and front, like the roof window's frame, follow the roof in visibility and shadows. The view controls the visibility of exterior faces together with that of cut walls. The lawn is hollowed out under the house, including where the wall touches the plot boundary; it therefore does not show through a lowered room.

Surfaces are generated, never loaded (`src/scene/surfaceTextures.ts`). The lawn's colour varies over 4–8 m patches in a 16 m tile, and a Babylon detail map adds grain, relief and roughness every 0.73 m: the two scales never line up, so neither repeat shows. The lawn's UVs are plan metres. The roof carries slate courses (0.2 m courses of 0.3 m slates, staggered, 1.2 m tile) and per-slate roughness; the render reuses the interior plaster relief at a coarser 1 m tile. Roof, gable and dormer faces get metric UVs in their own plane, `u` along the eave and `v` up the slope (`planeUv`), so courses follow the eave; façade boxes get theirs from `worldScaleUvs`. The exterior uploads its own copies of these maps, because it disposes its materials with their textures.

Vue 3D and Extérieur show a sky behind the transparent canvas: a gradient on the viewport, defined once in `src/scene/sky.ts`, kept at or below 0.9 so it reads as background, never as something that should bloom. Plan keeps the flat workshop background. The PNG export only copies canvas pixels, so it paints the same gradient itself, in the overview and unless the image is transparent.

The exterior is built from the lowest level, but the levels above stay part of the building. An exterior opening of an upper level shows from outside wherever something would otherwise cover it: the wall band opens where the opening's outer face stands within the thickness of the ground-floor wall under it, a gable opens where the opening lies in its plane, and the dormer front opens for its back wall's windows. Each opening that gets a cut also gets a glazed frame, 3 cm inside its wall's outer face, doors included. An opening in a wall set back under the slopes (a knee wall) stays inside: from outside, the roof covers it. Upper walls get no façade skin of their own: the band, the gables and the roof already draw their outline, so no rectangular wall pokes through a slope. An upper wall standing behind the ground-floor wall under it stays covered by the band: that is a plan to review, not a cut to force.

Façade openings use the same adjacent floor height as interior walls, whatever the category of the lowered room. During the walk, the visible ceiling takes part in sun shadows, and the roof stays displayed: the ceiling hides it from inside, it renders the whole house from the lawn. The preview stays simplified and simulates neither indirect light, weather nor neighbouring buildings.

## Framing the exterior view

The exterior view frames the **building**, not the plot: the union of the lowest level's outline
and the roof footprint (`src/scene/framing.ts`), plus a proportional setback of 10 % of the
building's largest dimension. The plot gives scale and setback; it stays entirely visible in
the background — panned then zoomed out behind the subject if needed — but no longer dictates
the framing. The azimuth is also a framing choice: among the current angle and the four
cardinal points, the view keeps the one where the house takes the most width on screen, which
keeps the view usable on a long, narrow plot with an off-centre building. Framing is always
computed from the lowest level: switching levels does not change it, and neither the floor nor
the lawn is ever cut by the image edge.

The walk leaves the house. Its limit is `boundary`: the visitor walks on the flat terrain, goes through an open exterior door, and is only sent back to the start when leaving the plot, going under the floor or above the ceiling. Without `site`, the level footprint stays the limit. The floor under the visitor follows the room inside and `elevation` outside; a lowered room keeps its own floor. The terrain adds no ramp, fence nor drawn step: when `elevation` places the terrain under the floor, the difference stays a step climbed by the threshold assistance, up to 20 cm. Beyond that, the visitor can no longer get back in: it signals that the terrain height needs review, not a collision defect.

Starting a walk checks the furniture's projected triangles with the visitor's margin: the free hollow of an L-shaped sofa and the spaces around a rotated piece stay reachable. The check runs when choosing the destination, not on every frame. Collisions while moving stay those of the Babylon meshes.
