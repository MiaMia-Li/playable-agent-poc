# Adapting a standalone HTML template

Read this with the reference selected by `confirmed-config.json.sourceTemplateId`.

## Apply the confirmed changes

1. Read the confirmed configuration, asset manifest, and revision plan when present. Extract actionable requirements from `gameplay`, resource treatments, copy, delivery, and revision changes. `routing.differences` can contain only a generic template-binding sentence; it is not an exhaustive change list.
2. Inspect the selected source's embedded business scripts. Work on an extracted copy under `work/` when scripts are compressed. Keep the engine, resource keys, and packaging intact. For patch revisions inspect the current artifact, so previous changes survive.
3. Map each requested behavior to its actual state transition, result data, input handler, or animation callback before editing. Preserve existing rules except where the confirmed request overrides them. Apply changes to the script that the bootstrap actually loads and re-embed it into `output.html`; editing an unused extracted file has no effect.
4. Adapt delivery interfaces and copy as well. Changing the document title or adding `window.__PLAYABLE__` does not implement gameplay changes. Do not edit the confirmed configuration to match an unchanged artifact.

The initial source has already been copied into `output.html` for non-patch builds. Its existence is not evidence of completed work. Keep all master template files unchanged.

## Reuse native CTA and ending

When `template-ui-policy.json` is present, preserve the template's existing CTA and ending.
The supported flows include 金龙麻将转轴 You Win, 金龙转盘集奖 reward/claim,
宙斯 Scatter Mega Win/Collect, and 彩球转盘消除 EndCard/DownloadButton.
Do not append a generic CTA button, HTML overlay, end-card stage or duplicate ending.
For revisions, remove any previously added duplicate conversion UI. Explicit copy,
artwork and store URL changes belong in the existing native controls and handlers.
A default end-card resource means the original template ending; an empty CTA means
preserve its original text/artwork. If a campaign field has no native counterpart,
do not invent visible UI to bind it; omit the campaign binding contract instead.

During acceptance, reach the native ending via real gameplay, verify that no duplicate
CTA/ending appears, and check the native CTA destination without navigating to it.
Do not require generic DOM selectors for engine-rendered controls. Add
`playable-native-ui-preserved-v1` only after verifying and fixing duplicate UI;
this marker permits future copy-only updates to reuse the accepted native layout.

## Validate the requested behavior

Run `node assets/starter/work/test-freeform-playable.mjs output.html` for structural compatibility. This script checks strings only; it does not exercise the engine, confirm mute behavior, or validate a spin, reward, or stage sequence.

Use a browser to exercise the real input path and every confirmed change. For a requested sequence, inspect the board before and after each transition, including input locking, refill/clear timing, rewards, and ending. Observe real game state through read-only QA hooks when useful; do not return hard-coded success snapshots disconnected from the engine.

Keep a requirement-to-evidence checklist in `work/`: each change, the implementation location, the input sequence, expected result, and observed result. Compare the final artifact with its base to confirm the relevant business script changed. A byte difference alone is insufficient. Do not report completion when requested gameplay is unchanged or has not been verified; describe missing evidence or failures accurately.

Also verify offline loading, responsive portrait/landscape layout, initial mute and parent mute messages, first-interaction gameplay, and the confirmed CTA destination without opening it during tests. Preserve source logical coordinates and scale responsively unless the confirmed delivery requires changing them. Report soft size-limit warnings separately from functional failures.

## Keep acceptance bounded

Run browser acceptance through `node assets/starter/work/browser-acceptance.mjs output.html work/scenario.mjs`.
Write only the scenario module: export a default async function receiving `{ page, context, check, capture, clickCanvas }`.
Use real inputs, bounded `page.waitForFunction` waits and `check('requirement', observedCondition)` assertions for
every requested change; `clickCanvas(x, y)` takes normalized coordinates from 0 to 1. `capture('stage')` records a
stage screenshot. The runner supplies offline loading, request/console collection, popup blocking, orientation
screenshots and an artifact-hash-bound JSON report in `work/browser-acceptance/`. It fails when the scenario has
no assertions. Inspect its screenshots and include any required layout/mute/CTA assertions in the scenario;
the runner does not prove those game-specific properties automatically. Every invocation is timed by the host.

- Before testing, collect the requested changes into one short checklist. For a patch, focus gameplay assertions on those changes and the transitions they affect; keep the delivery smoke checks above. Do not explore unrelated game branches.
- Use one browser session to collect gameplay state, console/network failures, and portrait/landscape screenshots. Review these same screenshots for visual acceptance rather than replaying the game for a separate final review.
- Wait for observable engine states with explicit timeouts derived from the expected animation duration. On timeout, capture the current state and diagnose the failed transition before retrying; do not repeatedly replay the whole sequence with longer sleeps. Never skip animations or force success states in the delivered game to make a test pass.
- After a fix, rerun the failed check and affected downstream transitions. A state-machine change requires the affected sequence to pass end to end; unrelated passing checks need not be repeated. Tie evidence to the tested output hash and check scope. Reuse it only while the artifact and relevant test assertions remain unchanged; never carry stale evidence across builds.
- Generate the concise requirement-to-evidence checklist from collected results once. Stop when required checks pass. Editing only reports does not require another structural check, ZIP extraction, screenshot run, or full gameplay replay. Report optional size warnings without restarting acceptance.
- Use the available Node.js runtime for JSON summaries and hashes instead of assuming tools such as `jq` are installed. Keep report formatting separate from test exit status. A report-rendering failure does not invalidate already recorded test results, and a required test failure must never be reported as passed.
