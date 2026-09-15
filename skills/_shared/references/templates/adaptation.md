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

## Inspect and patch obfuscated Cocos business scripts

For the dragon templates' array/offset/rotation obfuscation, use the bundled helper after extracting the **current** business script:

```sh
node assets/starter/work/inspect-cocos-bundle.mjs work/base/files/assets/main/index.js
```

Read `work/cocos-inspection/latest.json` for the report location. `inspection.json` contains the source SHA-256, decoder name, offset, rotation, and hexadecimal-index-to-string dictionary. Look up only the indices or gameplay names needed for the confirmed change; do not print the entire minified script or dictionary into the conversation. The helper uses bundled Acorn 8.15.0 (MIT; license beside the parser); it needs no install, network access or Sandbox snapshot update.

The helper statically evaluates only a supported string-table rotation pattern. It never runs the bundle, engine, or extracted initialization. AST ranges identify source locations, **not independently executable snippets**. Do not reconstruct initialization by string slicing, guessed closing parentheses or `vm.runInContext`. Unsupported structures and exhausted analysis budgets return exit zero with `status: unsupported` and a diagnostic `code` in `work/cocos-inspection/latest.json`; zero only means the report was saved, not successful decoding. Missing inputs and report write failures still return nonzero. Read the fixed JSON entry directly, without a temporary pretty file; inspect the specific structure before choosing another approach, rather than repeatedly retrying an unchanged input.

Analysis is cached by tool version and exact source hash. Reuse it for unchanged input; changes to a revision's business script automatically select a new report. This cache is analysis only, never browser acceptance evidence.

Apply targeted literal replacements through a checked patch plan when useful:

```sh
node assets/starter/work/patch-cocos-bundle.mjs work/base/files/assets/main/index.js work/patch-plan.json work/patched/assets/main/index.js
```

The JSON plan is `{ "sourceSha256": "hash from inspection", "patches": [{ "before": "exact source fragment", "after": "replacement fragment" }] }`. Each fragment must match exactly once in sequence. The helper rejects stale source hashes, missing/ambiguous matches and invalid final JavaScript before writing the separate output. Never patch the master source. Re-embed the changed file into `output.html`, then run structural and browser checks; successful parsing alone is not acceptance.

## Use the common template package tools

For all four standalone source templates, unpack the current artifact once:

```sh
node assets/starter/work/template-package.mjs unpack output.html work/package
```

Use a new extraction directory. `manifest.json` records original hashes and resource destinations. Cocos ZIP entries are under `files/`, with `__res` content exposed separately under `resources/`; Laya script/text/binary maps are under `script_data/`, `text_data/`, `bin_data/` and data-URI assets under `url/`. Keep resource names, `source.html` and `manifest.json` unchanged. Edit only the extracted resource representing the actual loaded script. Do not edit both raw `files/__res` and its exposed resources.

```sh
node assets/starter/work/template-package.mjs pack work/package output.html
```

No-change round trips preserve the exact original HTML bytes. Changed scripts and JSON are syntax-checked; the tool preserves other entries and original HTML wrappers. Packing rejects unsafe paths, modified manifests, missing resources and conflicting edits. It replaces output only after validation. Continue to validate the real re-embedded HTML in the browser; a successful pack is not gameplay acceptance. Apply any outer HTML changes after packing, or unpack that newer HTML into a fresh directory before another resource edit.

## Use the supplied state probe

The browser runner passes a `probe` to every scenario. `await probe.snapshot()` returns a bounded read-only snapshot: engine, readiness, current public state, native scene nodes/component state and visible input-target bounds. Cocos and Laya probes traverse the actual scene; the existing `__PLAYABLE__.snapshot()` contract supplies state for other templates. Missing fields remain absent, not fabricated.

Use `await probe.waitFor(s => s.state.ended === true, { timeout: 12000 })` only when that field is actually exposed. Otherwise use the observed native node/component field. Waiting is bounded; do not replace state waits with long fixed sleeps. `await probe.click('start')` targets the wheel's native start button; dragon slots and Zeus expose `spin`, Zeus exposes `collect`. Actual node names or unique scene paths from `snapshot().targets` are also accepted. Missing or ambiguous bounds fail instead of guessing coordinates. For Balloon Master, select an observed gameplay target from the scene; its `download` target is for inspection, not a gameplay start. Never click a store target during acceptance. Still assert the observed gameplay outcome with `check`; probe availability alone proves nothing.

## Tool availability and one repair

Read the host-generated `sandbox-tools.json`. Use `node assets/starter/work/node-tools.mjs header INPUT OUTPUT`, `json INPUT OUTPUT`, or `hash INPUT OUTPUT` instead of assuming `xxd`, `jq` or Python exist. Results are saved to files, not dumped into conversation. The inventory records actual command availability, not support for every possible flag. Do not install missing optional utilities during a build.

The host can request one preview repair after a current-artifact browser failure. Read `work/preview-repair.json` and the preserved `work/preview-failure-report.json`. Reuse the current artifact, unpacked files and analysis. Repair the failed transition or a demonstrably wrong observation; do not remove assertions, silence errors or alter the acceptance runner. The host rechecks the saved artifact once. Unchanged output/scenario, cancellation, missing/stale reports or a second failure stop the attempt and preserve the available version.
