# 彩球转盘消除 (`balloon_master`)

Source: `assets/templates/balloon_master/source.html`. Read the shared `references/templates/adaptation.md` supplied by the platform before editing.

## Original interaction and code entry

This Laya template uses horizontal disc rotation to align a central same-color column, followed by downward swiping to peel a shell. The baseline ends after two shells and uses a 720 × 1280 logical layout. Preserve the gesture model unless explicitly changed.

The HTML embeds `__LAYA_URL_MAP`, `__LAYA_BIN_DATA`, `__LAYA_TEXT_DATA`, and `__LAYA_SCRIPT_DATA`, loaded by `__PLAYABLE_BOOTSTRAP`. Decode the base64 raw-DEFLATE `js/bundle.js` entry in `__LAYA_SCRIPT_DATA` to inspect and modify business logic, then recompress and replace that entry in `output.html`. Preserve engine entries, resource maps, and the conditional `playable-storage-fallback` used in sandboxed previews.

The business script contains configuration keys `rowCount`, `slotCount`, `shellCount`, `rowsRemovedPerShell`, `slotsRemovedPerShell`, and `radiusRemovedPerShell`. Useful behavioral anchors include `updateMatchState`, `destroyMatchedColumn`, `tryPeelLayer`, `peelOuterShell`, `revealNextShell`, and `advanceShell`. Trace the matching and gesture conditions before changing counts or transitions; geometry and input hit areas must agree with the resulting shell sizes.

## Acceptance

Rotate horizontally and verify alignment updates the central match state. Test downward swipes in both eligible and ineligible states against the source/confirmed rules, then verify peeling reveals the next shell exactly once. Check input during animations, remaining-shell geometry, the approved shell count, and end-card timing. This is not a slot machine or a tap-to-pair Mahjong game.

## Source provenance

Source: `BalloonMaster/release/single-html/index.html`, supplied on 2026-09-11. This Laya single-HTML build already includes the project's AppLovin finalizer. The original project is unchanged.

Template adaptations: title `Balloon Master Playable`, static bootstrap error logging, and the same conditional in-memory localStorage fallback as Zeus Scatter for sandboxed previews. All engine, scene, image and audio resources remain embedded. Preserve the 720 × 1280 layout, horizontal disc rotation, central color-column matching, downward swipe to peel a shell, and end card after two shells.

To reproduce, copy the finalized source HTML, apply these three adaptations, validate with the source project's `tools/validate-playable.mjs` in a temporary project copy, and keep public and build-workspace HTML copies identical. The cover PNG is a 360 × 640 screenshot of the idle sandboxed game.

Final HTML: 1,409,447 bytes. SHA-256: `a4886f5d8500e24ce32202a24e73eed5e9b17c1aa4c9a026ca0264ae5c4b0354`.
