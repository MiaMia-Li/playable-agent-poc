# center_collision — 中心碰撞

Use this mode when two selected identical tiles should leave the board, converge at a shared center point, collide, fracture, and disappear.

## Template behavior

- Dense irregular pile with decorative lower layers and eight guaranteed selectable tiles.
- First selection lifts and glows; mismatch flashes red and changes neither board state nor score.
- A match flies to the canvas center, bursts into fragments, adds 500 points, and exposes the pile beneath.
- Default completion: four matches, 2000 points, then the shared end card.

## Mode assets and config

- Config: `assets/templates/center_collision/config.json`
- Shared runtime: `assets/starter/src/playable.template.html`
- Recommended art: standard light Mahjong faces, green felt background, ceramic fragments.

## Acceptance focus

Verify both tiles arrive at the same center, the score increments once after impact, and the end card waits until the fourth collision finishes.
