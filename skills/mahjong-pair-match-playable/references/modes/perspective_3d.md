# perspective_3d — 3D纵深

Use this mode for a deep extruded Mahjong wall with an open center and selectable top faces.

## Template behavior

- Seven-by-seven top plane with a three-by-three center opening.
- Repeated front and side faces create an 18-layer stack without WebGL; Canvas 2D keeps the package small and avoids context-loss handling.
- Only visible faces are selectable. A matching pair creates a recessed cavity and reveals a smaller, lowered face from the next layer at those positions.
- Tile faces preserve the supplied source art without tint overlays. Recess walls, dark vignette, glowing score, and square fragments provide the depth and impact language.
- Default completion: four matches, 408 points each, 1632 total, then the shared end card.

## Mode assets and config

- Config: `assets/templates/perspective_3d/config.json`
- Shared runtime: `assets/starter/src/playable.template.html`
- Reference visual traits: black background, original tile art, warm side edges, deep vertical extrusion, hollow center, top-down perspective.

## Acceptance focus

Verify the top plane reads separately from the side stack, removed positions are visibly excavated, the next-layer source image has no tint/gray overlay, and hit testing is limited to visible faces.
