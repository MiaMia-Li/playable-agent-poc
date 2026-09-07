# gravity_fill — 下落补位

Use this mode for a full-screen rectangular Mahjong grid where removed tiles cause their columns to drop and refill from above.

## Template behavior

- Seven columns by nine rows by default, with tight rounded Mahjong cells.
- First selection uses a bright green state; mismatch flashes red and does not move tiles or add score.
- A match bursts in place. Every affected column collapses toward the bottom, preserving tile order, then new tiles enter from above.
- Seeded replacement keeps QA reproducible. The initial board contains at least four guaranteed pairs.
- Default completion: four matches, 500 points each, 2000 total, then the shared end card.

## Mode assets and config

- Config: `assets/templates/gravity_fill/config.json`
- Shared runtime: `assets/starter/src/playable.template.html`
- Reference visual traits: pale mint background, edge-to-edge grid, strong green selection, gold/green burst feedback.

## Acceptance focus

Verify only the affected columns move, no holes remain after settling, new cells enter from above, and input stays locked during the collapse.
