# Requirement Agent quality checks

## Incremental Requirement Brief

New model outputs use `update_requirement_brief` with `brief.kind: "patch"`.
Unchanged fields and sections are `null`; the host merges the patch with the
persisted Requirement Brief. Empty strings intentionally clear text. Constraints
and open questions use `{ "add": [], "remove": [] }`, so leaving out an old
constraint cannot silently delete it. To resolve an open question, remove its
exact existing text. Routing is replaced as one complete decision or retained
with `null`. The merged result is validated before anything is persisted.

The parser still accepts older full-brief plans for compatibility; the schema
sent to both production and local Codex models only permits patches. Host-owned
source-template, source-HTML and imported-asset bindings cannot be set in a patch.

## Build handoff

Confirmation captures a detached `requirement-context.json` snapshot containing
the complete Requirement Brief, the last eight user messages (at most 3,000
characters each, with truncation indicators), and acceptance targets derived from
the approved gameplay and revision changes/preserved behavior. Credentials are
redacted. Both local CLI and remote Sandbox builds receive this file in every
build phase.

The current Confirmation Proposal and revision remain authoritative. The brief
and historical user statements provide context; they cannot authorize new work,
override confirmation-table edits or change a manually selected revision base.
Acceptance targets must be checked against the artifact; their presence is not
validation evidence. Messages arriving after confirmation do not enter that build.

## Replay real conversations

Export a task's recorded user/agent messages without changing the task:

```bash
pnpm replay:requirements export <taskId>
```

This reads `POSTGRES_URL` from the server environment or `.env.local` and writes
`.requirement-replays/<taskId>.json` with private file permissions. The directory
is ignored by Git. Existing exports are not overwritten. Each case uses the
historical brief and confirmation available **before** its user message; it does
not use the task's latest state as an answer key.

Review a small selection of cases before replaying them:

1. Check `input.hasArtifact`, `pendingRevision`, version selection and any supplied
   `sourceHtml` against the actual state at that turn. Message records alone do
   not establish these, so exports default to no artifact/no pending revision.
2. Add exact `toolSnapshots` for analysis or historical-version reads if needed.
   The runner only serves snapshots; it never performs live tool actions. Cases
   requiring image/video/asset context that the text-state input cannot represent
   must remain unreviewed until the fixture format is extended for that evidence.
3. Add independent assertions for the desired behavior and set
   `contextReviewed: true`. Do not assume that the old agent's answer was correct.
   For example, preserve an existing constraint with
   `{ "path": ["brief", "constraints"], "operator": "contains", "value": "保留胜利动画" }`,
   or require an Indonesian locale using
   `{ "path": ["brief", "launch", "locale"], "operator": "equals", "value": "id-ID" }`.

Run the reviewed cases against the real requirement model:

```bash
pnpm replay:requirements run .requirement-replays/reviewed.json
```

This makes model calls with the configured server-side `OPENROUTER_API_KEY`,
model, step budget and reasoning effort, and therefore consumes model usage.
Each case has a three-minute timeout. It does not build a playable, update task
state or write anything to the database. Replies, assertion results and model
configuration are saved to `.requirement-replays/report.json`, with credentials
redacted. Save a copy of the report before comparing another configuration.

`passed` means all supplied assertions passed with reviewed context and complete
tool snapshots. `failed` means an assertion failed. Unreviewed/missing-evidence
cases are `incomplete`; cases without assertions are `unscored`; model errors are
`error`. Any result other than `passed` causes a nonzero exit. A passing fixture
is evidence for its specific assertions, not proof of overall intelligence or
better playable quality.

The unit tests include synthetic multi-turn preservation cases and checks that
missing context cannot be reported as a passing replay.
