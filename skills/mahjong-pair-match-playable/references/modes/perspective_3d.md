# perspective_3d — 3D纵深

Use this mode for a deep extruded Mahjong wall with an open center and selectable top faces.

## Template behavior

- Eight-by-eight top plane with a four-by-four center opening, matching the supplied `MahjongMatch_3D_Playable.html` gameplay reference.
- A mode-specific single-file Three.js/WebGL template renders the supplied Mahjong GLB geometry and its eight-layer stack.
- Only visible faces are selectable. A matching pair lifts, arcs toward the center, collides, breaks into fragments, and reveals the next face lower in the same stack position.
- Tile faces preserve the supplied source art without tint overlays. Recess walls, dark vignette, glowing score, and square fragments provide the depth and impact language.
- Default completion: four matches, 500 points each, 2000 total, then the shared end card.

## Mode assets and config

- Config: `assets/templates/perspective_3d/config.json`
- Mode-specific runtime: `assets/templates/perspective_3d/playable.template.html`
- Reference visual traits: black background, original tile art, warm side edges, deep vertical extrusion, hollow center, top-down perspective, and center-collision fragments.

## Acceptance focus

Verify the 8 × 8 outer ring and 4 × 4 opening, center-collision motion, 500-point increment, visible excavation, untinted next-layer face, and hit testing limited to visible faces.
