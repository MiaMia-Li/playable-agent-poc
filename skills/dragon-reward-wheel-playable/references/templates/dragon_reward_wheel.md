# 金龙转盘集奖 (`dragon_reward_wheel`)

Source: `assets/templates/dragon_reward_wheel/source.html`. Read the shared `references/templates/adaptation.md` supplied by the platform before editing.

## Original interaction and code entry

This Cocos template presents a gold-dragon reward wheel and reward collection. Preserve the wheel interaction, reward progress, and original feedback unless the confirmed requirements override them. It is separate from Mahjong reels and the shared pair-matching runtime.

The HTML stores a base64 ZIP in `window.__zip`. Decode it into a working copy; the packaged `assets/main/index.js` contains the business logic. Useful anchors include `PlayTurnSpin`, `ProgressBar_rewards`, `ad77_wheel`, and `ad77_reward`. Trace the spin handler, stopping outcome, reward update, and animation completion callbacks. `super_html` is the outer host bridge; changing it alone does not change wheel outcomes.

Modify the requested outcome/progression/timing in the packaged business script and re-embed the ZIP. Preserve entry names, Cocos/Spine engine files, resource IDs, and wheel artwork. Inspect the actual reward mapping before choosing a segment or adjusting a reward.

## Acceptance

Exercise the wheel through a complete reward cycle. Verify the requested stopping outcome agrees with the displayed reward, progress increments exactly once, and repeated input cannot duplicate a pending reward. Check the confirmed continuation or end-card condition and retained wheel/dragon effects. Derive exact amounts and round counts from the confirmed request and source, not from the other dragon template.

## Source provenance

Imported on 2026-09-11, unchanged from the supplied source.

| Template | Source | SHA-256 |
| --- | --- | --- |
| dragon_reward_wheel | DI_Playable_20260724_JT_自制_A_原创_游戏展示_转盘收集奖励-applovin_0x0_YZZ__106119 (2).html | bac46a1ec3c2ddfb4eb097ac27a72049f68227683cccb72200fd809d379f192e |

The original AppLovin bridge may report a missing host SDK during browser previews. Preserve gameplay and perform the delivery checks against the confirmed store URL.
