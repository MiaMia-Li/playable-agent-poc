# Adapting a standalone HTML template

Read this with the reference selected by `confirmed-config.json.sourceTemplateId`.

## Apply the confirmed changes

1. Read the confirmed configuration, asset manifest, and revision plan when present. Extract actionable requirements from `gameplay`, resource treatments, copy, delivery, and revision changes. `routing.differences` can contain only a generic template-binding sentence; it is not an exhaustive change list.
2. Inspect the selected source's embedded business scripts. Work on an extracted copy under `work/` when scripts are compressed. Keep the engine, resource keys, and packaging intact. For patch revisions inspect the current artifact, so previous changes survive.
3. Map each requested behavior to its actual state transition, result data, input handler, or animation callback before editing. Preserve existing rules except where the confirmed request overrides them. Apply changes to the script that the bootstrap actually loads and re-embed it into `output.html`; editing an unused extracted file has no effect.
4. Adapt delivery interfaces and copy as well. Changing the document title or adding `window.__PLAYABLE__` does not implement gameplay changes. Do not edit the confirmed configuration to match an unchanged artifact.

The initial source has already been copied into `output.html` for non-patch builds. Its existence is not evidence of completed work. Keep all master template files unchanged.

## Validate the requested behavior

Run `node assets/starter/work/test-freeform-playable.mjs output.html` for structural compatibility. This script checks strings only; it does not exercise the engine, confirm mute behavior, or validate a spin, reward, or stage sequence.

Use a browser to exercise the real input path and every confirmed change. For a requested sequence, inspect the board before and after each transition, including input locking, refill/clear timing, rewards, and ending. Observe real game state through read-only QA hooks when useful; do not return hard-coded success snapshots disconnected from the engine.

Keep a requirement-to-evidence checklist in `work/`: each change, the implementation location, the input sequence, expected result, and observed result. Compare the final artifact with its base to confirm the relevant business script changed. A byte difference alone is insufficient. Do not report completion when requested gameplay is unchanged or has not been verified; describe missing evidence or failures accurately.

Also verify offline loading, responsive portrait/landscape layout, initial mute and parent mute messages, first-interaction gameplay, and the confirmed CTA destination without opening it during tests. Preserve source logical coordinates and scale responsively unless the confirmed delivery requires changing them. Report soft size-limit warnings separately from functional failures.
