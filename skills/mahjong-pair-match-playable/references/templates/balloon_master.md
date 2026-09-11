# 彩球转盘消除 (`balloon_master`)

Source: `assets/templates/balloon_master/source.html`. Read [adaptation.md](adaptation.md) before editing.

## Original interaction and code entry

This Laya template uses horizontal disc rotation to align a central same-color column, followed by downward swiping to peel a shell. The baseline ends after two shells and uses a 720 × 1280 logical layout. Preserve the gesture model unless explicitly changed.

The HTML embeds `__LAYA_URL_MAP`, `__LAYA_BIN_DATA`, `__LAYA_TEXT_DATA`, and `__LAYA_SCRIPT_DATA`, loaded by `__PLAYABLE_BOOTSTRAP`. Decode the base64 raw-DEFLATE `js/bundle.js` entry in `__LAYA_SCRIPT_DATA` to inspect and modify business logic, then recompress and replace that entry in `output.html`. Preserve engine entries, resource maps, and the conditional `playable-storage-fallback` used in sandboxed previews.

The business script contains configuration keys `rowCount`, `slotCount`, `shellCount`, `rowsRemovedPerShell`, `slotsRemovedPerShell`, and `radiusRemovedPerShell`. Useful behavioral anchors include `updateMatchState`, `destroyMatchedColumn`, `tryPeelLayer`, `peelOuterShell`, `revealNextShell`, and `advanceShell`. Trace the matching and gesture conditions before changing counts or transitions; geometry and input hit areas must agree with the resulting shell sizes.

## Acceptance

Rotate horizontally and verify alignment updates the central match state. Test downward swipes in both eligible and ineligible states against the source/confirmed rules, then verify peeling reveals the next shell exactly once. Check input during animations, remaining-shell geometry, the approved shell count, and end-card timing. This is not a slot machine or a tap-to-pair Mahjong game.
