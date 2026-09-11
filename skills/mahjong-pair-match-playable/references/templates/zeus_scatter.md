# 宙斯 Scatter 转轴 (`zeus_scatter`)

Source: `assets/templates/zeus_scatter/source.html`. Read [adaptation.md](adaptation.md) before editing.

## Original interaction and code entry

This LayaAir template uses Spin to stop the last reel, trigger Scatter animation, and present Mega Win with Collect. The bundled baseline displays 1,000,000; preserve or change that amount according to confirmation. Its 720 × 1280 layout scales into the portrait preview.

Embedded JSON script blocks include `__LAYA_URL_MAP`, `__LAYA_BIN_DATA`, `__LAYA_TEXT_DATA`, and `__LAYA_SCRIPT_DATA`; `__PLAYABLE_BOOTSTRAP` loads them. Inside `__LAYA_SCRIPT_DATA`, `js/bundle.js` is the business script encoded as base64 raw-DEFLATE. Decode and inflate it in a working copy, edit it, then raw-deflate and base64-encode the replacement entry in the final HTML. Keep the other entries and resource maps intact.

Useful business-script anchors include `bindSpinEvents`, `onSpinClicked`, `stopWithScatter`, `onScatterWinComplete`, `FullScreenScatterEffect`, `MegaWinVisual`, and `onCollectClicked`. Trace the input-to-reel-to-win callbacks before changing the sequence. Preserve the conditional `playable-storage-fallback` script needed by sandboxed previews. Do not rerun an upstream finalizer on the only source copy; provenance and reproduction details are in `assets/templates/README.md`.

## Acceptance

Trigger Spin through the real UI, observe the last reel stopping, Scatter feedback, the approved win amount, and Collect appearing at the right time. Verify repeated taps do not start overlapping wins and Collect uses the approved destination after gameplay. Check the requested differences against this sequence rather than testing Mahjong match/mismatch rules.
