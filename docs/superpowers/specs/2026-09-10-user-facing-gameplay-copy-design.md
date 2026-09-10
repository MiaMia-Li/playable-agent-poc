# User-facing gameplay copy isolation

## Problem

Freeform confirmations still carry a registered mode internally so the Sandbox can prepare a workspace. The requirement Agent can copy that internal implementation detail into `confirmation.gameplay`, which the confirmation table displays verbatim. This exposes values such as `gravity_fill` and terms such as “workspace scaffold” to users.

## Scope

- Fix confirmations generated after this change.
- Do not rewrite confirmations already stored in the database.
- Keep the internal route and mode unchanged for build orchestration.
- Make user-facing text follow the language of the user's request instead of forcing Chinese.

## Design

Use two protections at the requirement-plan boundary:

1. Prompt the requirement Agent to keep `confirmation.gameplay` limited to player-visible controls, rules, objectives, and feedback. Internal route names, registered mode IDs, templates, plugins, and workspace scaffolding must remain outside user-facing fields.
2. Before accepting a generated confirmation, remove gameplay sentences containing an exact registered mode ID. If nothing meaningful remains, fall back to the requirement brief's player-facing gameplay fields.

The sanitizer operates only while accepting newly generated confirmations. Persisted confirmations continue to parse unchanged.

## Testing

- Reproduce a freeform confirmation whose gameplay ends with a sentence containing `gravity_fill`.
- Verify the internal sentence is removed while the real gameplay remains.
- Verify a gameplay value made entirely of internal mode text falls back to the requirement brief.
- Verify the instructions require matching the user's language and no longer force Chinese.

## System asset terminology

The persisted resource status `内置默认` remains unchanged for compatibility, but user-facing surfaces present it as `系统素材`. The confirmation table uses:

- Status: `系统素材`
- Action: `使用系统素材`
- Explanation: `系统提供，无需上传，可直接构建`

Agent instructions and local-demo choices use equivalent wording in the user's language and do not expose the persisted status value. Existing confirmations benefit from the display mapping without a data migration.

After implementation, run the focused unit tests, formatter, type check, and lint. Do not run a production build.
