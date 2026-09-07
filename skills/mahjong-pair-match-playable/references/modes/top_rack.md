# top_rack — 上方牌架

Use this mode for the Vita Mahjong-style layered board where every tapped tile moves into a rack above the pile.

## Template behavior

- Four-slot dark wood rack above a dense, irregular Mahjong pile.
- The rack starts empty. Every visible tile, including the lower numbered layer, is fully opaque and selectable.
- Tile faces use the supplied art at full opacity with no Canvas shadow or tint overlay.
- A tapped tile flies into the next rack slot. Tiles already in the rack remain visible while the player searches for a mate.
- When two rack tiles match, they burst at the rack and are removed; remaining rack tiles compact left.
- If four rack slots fill without a match, the rack gives error feedback and returns the tiles to their original board positions.
- Removing a pair exposes the visual layer below; the whole board does not fall or refill.
- Default score starts at 240. Four matches add 280 points each, ending at 1360 before the shared end card.

## Mode assets and config

- Config: `assets/templates/top_rack/config.json`
- Shared runtime: `assets/starter/src/playable.template.html`
- Reference visual traits: green felt, pale tiles with green sides, wooden rack, ceramic burst, compact score at the top.

## Acceptance focus

Verify the empty initial rack, full-board clickability, rack capacity, left-to-right placement, matched-pair removal, mismatch recovery, full-opacity/no-shadow tile rendering, and that lower tiles are revealed without gravity movement.
