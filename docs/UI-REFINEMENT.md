# Interface: the house comes first

Interface labels and messages are quoted in French, as the user sees them.

The MyBob brand appears in the header; Bob welcomes in the project panel and introduces the help. Illustrations are decorative, controls stay accessible and data stays local. The tab title also carries the MyBob name.

On first launch, a « Premiers pas » card offers three real actions — orbit around the house, see the plan, enter the walk — with no overlay nor modal window: the scene stays usable behind it and the card only disappears with its close button: a click in the scene is exploration, not an answer, and the three actions leave it open so they can be tried in a row. On a short screen it is hidden so as not to cover the tool column: the « Premiers pas » entry in the sidebar stays the only access, and the state is not marked as seen. It is not anchored on interface elements, so touching a control does not break it. Its state lives in `maison-atelier:onboarding`, versioned. The same state remembers the Visite welcome (« Bienvenue chez vous »): it shows on the first visit only, then never again in that browser; a click in the view captures the mouse and the control hint keeps the keys on screen. The ? button's help now opens on three gestures; « Tout voir » shows the full detailed text, kept as it was. The « Premiers pas » entry stays at the bottom of the sidebar, which makes the card replayable without a reset mechanism.

Contextual hints are not a separate layer: they already exist as one-off notifications at the moment of the action — « Meuble ajouté. Glissez-le dans la vue pour le placer. » in `src/furniture/panel.ts`, « Chaises ajoutées. Ctrl Z annule l’ensemble. », « Cliquez sur un point libre du sol pour y commencer la visite. » The empty state of the Meubles panel gives the same instruction before the first addition. No additional hint system is planned: it would duplicate these messages and age badly.

Plan now lays out room names avoiding the selected piece, distance tags and overlaid controls. Distances keep a 24 px size; their labels are moved nearby or hidden when space runs out, without changing lines or values.

Plan pans with a simple drag (mouse or finger) and zooms with a pinch or the wheel. 3D gestures stay Babylon's. On a short viewport the tool column scrolls so that every control stays reachable. Navigation hints adapt to touch pointers; walking in Visite still requires a keyboard. Confirming a variant's unchanged name closes its form without a needless write.

In Meubles, the variant selector, Dupliquer and Renommer come before adding. Variants cover all levels and keep the camera when switching. The Placement précis pane gathers multiple selection, alignment, distribution and the optional grid/wall snapping. The individual edit popup keeps its transactional behaviour.

The Image button exports a PNG of the current camera, without the interface, with optional names/areas and exterior dimensions. A title block identifies the project, level and variant. The capture restores the current display, stays local and uses the scene resolution, capped at 2400 × 1800.

The panel separates Maison (projects, levels, rooms) and Meubles (adding, selection, placement aids). Navigation is global, in the scene's Navigation button. Selecting a piece no longer unfolds a form in the sidebar: a double click, the pencil of its row or that of the contextual bar opens the same popup. During the walk, F edits the nearby aimed piece.

Dimension fields share an aligned input row even with multi-line labels. Units are attached to the right of the inputs, sofa labels are short and the diagram illustrates the two depths. The grid shrinks on a small screen. The popup keeps native menus while typing.

In the popup, every edit action, including link, separate, duplicate, align, add a TV on a stand and remove, stays in a draft. Enregistrer applies them as a single undoable operation; Annuler discards them. Unedited controls keep their exact values in metres, despite display rounding to centimetres. Errors appear in the popup, where global notifications would be hidden by the native dialog.

The selected piece's bar directly offers rotations, Dupliquer and Retirer. Snapping while dragging (wall contact, alignment of centres and edges) replaces the old button: holding Alt suspends it. These out-of-popup actions are immediately undoable. Clicking empty space and Escape clear the selection; Ctrl Z stays available when a button keeps focus and with no selection. Keyboard focus never falls back to `<body>`: a panel that rebuilds its HTML notes the focused control first and restores it (`ui/focusKeeper.ts`), and closing a popup hands focus back to the control that opened it, or to the selected piece's row. Measuring shows a preview after the first click, with snapping to the plan axes, Shift to force a straight line and Alt to keep a free angle.

The Ensemble block now gathers the linked names, the explicit choice of a piece and separation. The Annuler/Enregistrer buttons sit after every draft action, in a sticky footer. The text reminds that a prepared link still needs Enregistrer. The bar announces « n liés ». On a table, Chaises opens a compact distribution dialog; Ctrl C/V stay reserved for the piece outside input controls and outside dialogs.

The list shows a pencil per piece, a single counter in the tab, and collapsed warnings. No clearance is imposed automatically: margins are entered on purpose. The simplified delivery checks are no longer presented as placement warnings. The save status moved into the header and no longer covers the scene. Move and delete shortcuts ignore interface controls.

The bundled project is called Démonstration. A bin next to the selector deletes an imported project after confirmation and first offers an export. It only removes its local data and arrangements; bundled examples cannot be deleted.

## Cutaway and lighting

Navigation → Affichage des murs offers Automatique (default), Murs complets and Murs bas. In automatic mode, only the façades facing the camera are cut at 0.85 m, below the window sills (0.90 m): they disappear entirely instead of being sliced. The cut face is solid along the whole wall, openings and doors included, and the joinery stops flush with that face. Other walls, floors and furniture keep their materials. Walk and exterior keep full volumes; an explicit cutaway keeps priority. Collisions do not change.

Plan uses uniform white lighting without shadows. Shadows are also disabled in the automatic view with lowered walls: a truncated façade must not cast the shadow of its original volume. Full views get their shadows back.

The Soleil button opens location, north, date and local time. An explicit town search uses Open-Meteo; only the search text is sent, never the plan or the furniture. Enter in the Commune field runs that search. Editing the town clears the draft's old coordinates to avoid applying a new name to the old place; picking a result fills them again. Manual coordinate entry works without that service. The location is not inferred from the browser and no personal place is built into the public site. Preferences, including the chosen instant, are local per project and included in its export.

The sun position follows the NOAA equations; a test compares it to the NREL reference case. IANA time zones and daylight-saving changes are taken into account. North orientation comes from an explicit entry: 0° towards the top of the plan, 90° to the right. Relief, weather and neighbouring buildings are not simulated. To judge sunlight, prefer the exterior and full volumes: a hidden roof or ceiling changes the light received.

Once a location is applied, a collapsible Soleil panel stays in the scene, bottom left above the piece's controls. The slider changes the time and shadows without moving the camera. The date and the Été/Hiver shortcuts keep the local time and the framing; the markers are 21 June and 21 December, swapped in the southern hemisphere. They compare seasons, without claiming to give the exact astronomical instant of the solstices. Every change is kept per project and included in the export.

The slider covers the real instants of the local day: 23 or 25 hours on daylight-saving changes, with the UTC offset shown to tell repeated hours apart. Changing the date to a non-existent or ambiguous local time produces an explanation and keeps the previous instant. The approximate sunrise/sunset times match the passage of the sun's apparent centre across the model's theoretical horizon, computed as for the scene lighting; they do not replace an astronomical reading that accounts for the disc, relief or obstacles. Polar days with no sunrise or sunset are flagged. No time panel is shown without an explicitly applied location; Annuler in the settings keeps the previous state.

## Plans and precision

The « Plans et précision » button opens on the areas, not on the document notes: that is what you come to check. The table compares the area stated on the plan with the reconstructed area, with an Écart column — « équivalent » under 0.1 m², otherwise the signed difference in square metres, flagged in amber. A project stating no area on the plan only shows the reconstructed area, with a sentence explaining it, rather than a column of dashes. Document and terrain notes stay below the table.
