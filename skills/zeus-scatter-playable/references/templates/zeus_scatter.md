# 宙斯 Scatter 转轴 (`zeus_scatter`)

Source: `assets/templates/zeus_scatter/source.html`. Read the shared `references/templates/adaptation.md` supplied by the platform before editing.

## Original interaction and code entry

This LayaAir template uses Spin to stop the last reel, trigger Scatter animation, and present Mega Win with Collect. The bundled baseline displays 1,000,000; preserve or change that amount according to confirmation. Its 720 × 1280 layout scales into the portrait preview.

Embedded JSON script blocks include `__LAYA_URL_MAP`, `__LAYA_BIN_DATA`, `__LAYA_TEXT_DATA`, and `__LAYA_SCRIPT_DATA`; `__PLAYABLE_BOOTSTRAP` loads them. Inside `__LAYA_SCRIPT_DATA`, `js/bundle.js` is the business script encoded as base64 raw-DEFLATE. Decode and inflate it in a working copy, edit it, then raw-deflate and base64-encode the replacement entry in the final HTML. Keep the other entries and resource maps intact.

Useful business-script anchors include `bindSpinEvents`, `onSpinClicked`, `stopWithScatter`, `onScatterWinComplete`, `FullScreenScatterEffect`, `MegaWinVisual`, and `onCollectClicked`. Trace the input-to-reel-to-win callbacks before changing the sequence. Preserve the conditional `playable-storage-fallback` script needed by sandboxed previews. Do not rerun an upstream finalizer on the only source copy; provenance and reproduction details are in `assets/templates/README.md`.

## Acceptance

Trigger Spin through the real UI, observe the last reel stopping, Scatter feedback, the approved win amount, and Collect appearing at the right time. Verify repeated taps do not start overlapping wins and Collect uses the approved destination after gameplay. Check the requested differences against this sequence rather than testing Mahjong match/mismatch rules.

## Source provenance

Source: `Slots_Zeus_Scatter/release/single-html/index.html`, LayaAir 3.4 project supplied on 2026-09-11. The source project is unchanged.

To reproduce: copy the source project's `release/` and `tools/` into a temporary build directory, run `node tools/finalize-applovin-html.mjs` followed by `node tools/validate-playable.mjs` in that copy, then apply the template adaptations below. Never run the finalizer on the only source copy: it removes the generated `src(CAN_DELETE)` directory.

Template adaptations:
- Title set to `Zeus Scatter Playable`.
- Bootstrap error logging uses a static message.
- A `playable-storage-fallback` script before engine initialization provides in-memory Storage only when accessing localStorage is unavailable. This lets Laya run inside the existing `sandbox="allow-scripts"` preview without granting same-origin access.
- All engine, scene, image and audio data remain embedded. The original 720 × 1280 layout scales into the 360 × 640 template preview.

Preview and build workspace copies must remain byte-identical. The PNG cover is captured from the sandboxed idle game. The first Spin stops the last reel and starts the Scatter animation; Mega Win shows 1,000,000 and Collect invokes the original MRAID store action. Template previews keep external navigation sandboxed.

Final HTML: 3,466,269 bytes. SHA-256: `b3eb06c30058c1707f97bbc9a42021294ec312806304a4c763f9336ab919b70d`.
