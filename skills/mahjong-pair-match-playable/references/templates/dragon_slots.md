# 金龙麻将转轴 (`dragon_slots`)

Source: `assets/templates/dragon_slots/source.html`. Read [adaptation.md](adaptation.md) before editing.

## Original interaction and code entry

This Cocos game uses Spin to drive Mahjong reels, stopping symbols and presenting wins and multiplier effects. Preserve this interaction unless the confirmed request changes it; `mode: gravity_fill` does not mean tile selection or pair matching.

The outer HTML contains `GameCanvas`, the `super_html` host bridge, and `window.__zip`, a base64 ZIP containing scripts and resources. Decode the ZIP into a working copy and inspect `assets/main/index.js` for business logic. Useful search anchors include `m_pBtnSpin`, `GetLastRoundNum`, `iRoundNum`, `SetWildIcon`, `CheckWildMultiple`, and `ShowWildEffect`. These are navigation anchors, not guaranteed public APIs: trace their callers and outcome data before editing. `application.js`, `index.js`, and the bootstrap load the packaged game; preserve their loading contract and ZIP entry names.

Modify the round/result data and corresponding clear/refill transitions inside the packaged business script, then re-encode the ZIP into the final HTML. Preserve tile-resource IDs, reel positioning, and the embedded Cocos/Spine assets. Editing only the outer script cannot change the packaged round sequence.

## Acceptance

Exercise Spin from the requested starting round. Check symbol outcomes, stopping/falling order, elimination, refill, multipliers, and when another Spin becomes available. Verify a clear fires once and the next stage waits for its animation to finish.

If the confirmed request specifies a scripted sequence (for example full red-center tiles, full wilds, mixed upper half with wild lower half, then mixed tiles), map each stage to explicit board results and clear masks and verify them in order. Apply this example only when requested; do not impose it on other builds. Confirm the actual source symbol ID for red-center and wild tiles instead of guessing from their names.
