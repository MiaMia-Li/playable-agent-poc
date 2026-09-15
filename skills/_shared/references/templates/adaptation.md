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

## Validate once

If the build prompt says full validation is disabled, skip this section: do not run validation commands, open a browser, or create a checklist.

Otherwise perform one bounded pass:

1. Run `node assets/starter/work/test-freeform-playable.mjs output.html` once for structural compatibility.
2. Write `work/scenario.mjs` with real inputs and `check(name, observedCondition)` assertions for each confirmed change. Cover only affected state transitions; do not explore unrelated branches.
3. Run `node assets/starter/work/browser-acceptance.mjs output.html work/scenario.mjs` once. Use its network/console results and portrait/landscape screenshots instead of starting a separate visual review.
4. Write `work/validation-checklist.md` once with four columns: requirement, expected, observed, pass/fail. Tie it to the final artifact hash.

The same browser pass must cover offline loading, initial mute, parent mute messages, first-interaction gameplay, responsive layout, ending, and the stored CTA destination without opening it. Use bounded waits based on animation duration. After a failure, make at most one focused repair and rerun only the failed assertion and affected downstream transitions. Never force success state, replay unchanged passing checks, or rerun tests for report-only edits. Report size-limit warnings without restarting acceptance.
