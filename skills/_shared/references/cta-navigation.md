# Store navigation: implementation and acceptance

Both manual CTA and explicitly requested automatic navigation must call the actual
`window.mraid.open(confirmedStoreUrl)` when MRAID is available and ready. AppLovin
supplies MRAID; do not load an external mraid.js. Do not return early through a
`playable.openUrl` or other wrapper unless its real SDK forwarding is verified.
Some imported bridges silently do nothing without an SDK. Outside the ad container,
provide a browser fallback using `window.open(confirmedStoreUrl, '_blank', 'noopener,noreferrer')`
from the manual CTA click. Never use `location.href`, `location.assign`,
`location.replace`, a `_self` link, or parent/top navigation as a fallback:
Studio embeds the playable in an iframe, and store pages reject embedded loading.
If using an anchor, set `target="_blank"` and `rel="noopener noreferrer"`.
Browsers may block automatic popups without a user gesture; leave manual CTA retry
available instead of falling back to same-frame navigation. Never permanently disable manual retry before a
navigation attempt has succeeded; a failed automatic attempt must not consume CTA.

Automatic navigation is optional and has no default delay. Implement it only when
explicitly confirmed, with the confirmed duration and timer-start condition.
Start one timer on that state transition, never repeatedly on each render.
Cancel obsolete timers when leaving/restarting that state and avoid duplicate
opens. Use the same destination and MRAID path for the timer and button. Preserve
other gameplay and native UI.

Full browser acceptance must test real input, not just find a URL or function name.
The runner provides `navigation.verify` and isolated fresh MRAID test pages; its
mock records SDK calls without opening the store. In work/scenario.mjs, call:

```js
await navigation.verify({
  reachCta: async ({ page, probe }) => {
    // Reach the actual CTA / timer-start state through real gameplay.
    // Return immediately when that state appears; do not wait out the timer.
  },
  clickCta: async ({ page, probe }) => {
    // Click the actual visible CTA using a locator or observed native target.
  },
})
```

The callbacks receive fresh pages, so never use an outer scenario's page/probe.
Do not invoke handlers directly, change engine state, call mraid.open from a test,
replace navigation methods, or fabricate evidence. When automatic navigation is
confirmed, add automaticDelayMs with the confirmed duration; it is mandatory and reachCta must reach its actual start
state. The runner independently tests the click and a no-click wait on fresh runs,
checks timing, exactly one SDK call and the exact confirmed URL. A missing click
check blocks full acceptance. Keep smoke scenarios focused on gameplay; do not
run this full navigation check in preview smoke scenarios.
