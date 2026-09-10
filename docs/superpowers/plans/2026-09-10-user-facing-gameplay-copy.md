# User-facing Gameplay Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent newly generated confirmation gameplay text from exposing internal registered mode IDs while matching user-facing copy to the user's language.

**Architecture:** Keep routing metadata unchanged. At the requirement-plan acceptance boundary, sanitize only `confirmation.gameplay` by dropping sentences containing exact registered mode IDs and falling back to the requirement brief's gameplay when necessary; reinforce this invariant in the Agent instructions.

**Tech Stack:** TypeScript, Zod, Vitest

## Global Constraints

- Do not rewrite confirmations already stored in the database.
- Do not change build routing or the mode passed to the Sandbox.
- User-facing copy follows the language of the user's latest request.
- Do not run a production build.

---

### Task 1: Isolate user-facing gameplay copy

**Files:**
- Modify: `lib/playable/requirement-tools.ts`
- Test: `tests/unit/requirement-tools.test.ts`

**Interfaces:**
- Consumes: `playableModeIds`, `RequirementBrief`, and parsed `ConfirmationProposal`
- Produces: sanitized `confirmation.gameplay` from `validateConfirmationAlignment`

- [ ] **Step 1: Write failing regression tests**

Add tests that submit a freeform confirmation through `executeRequirementToolPlan` and assert:

```typescript
expect(result.reply.confirmation.gameplay).toBe('点击物体采集资源。')
expect(result.reply.confirmation.gameplay).not.toContain('gravity_fill')
```

Add a second case where the entire generated gameplay is internal and assert:

```typescript
expect(result.reply.confirmation.gameplay).toBe(brief.gameplay.coreLoop)
```

Assert the Agent instructions contain the latest-request language rule and do not contain `Use concise Chinese user-facing copy`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm test tests/unit/requirement-tools.test.ts
```

Expected: FAIL because internal mode sentences remain and the instructions still force Chinese.

- [ ] **Step 3: Implement minimal sanitization**

Import `playableModeIds`, split generated gameplay into natural-language sentences, remove sentences containing an exact mode ID, and fall back to `brief.gameplay.coreLoop` when the result is empty. Apply this only inside `validateConfirmationAlignment`.

Replace the fixed-Chinese instruction and add an explicit rule that `confirmation.gameplay` contains only player-visible controls, rules, objectives, and feedback.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm test tests/unit/requirement-tools.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Verify repository quality**

Run:

```bash
pnpm format
pnpm type-check
pnpm lint
pnpm test
```

Expected: formatting, type checking, linting, and all tests pass; pre-existing lint warnings are reported separately.

### Task 2: Present bundled resources as system assets

**Files:**
- Modify: `components/playable/confirmation-table.tsx`
- Modify: `components/playable/chat-workspace.tsx`
- Modify: `lib/playable/requirement-tools.ts`
- Modify: `lib/playable/local-demo-prototype.ts`
- Test: `tests/unit/playable-workspace.test.tsx`
- Test: `tests/unit/requirement-tools.test.ts`

**Interfaces:**
- Consumes: persisted resource status `内置默认`
- Produces: user-facing label `系统素材` and explanation `系统提供，无需上传，可直接构建`

- [ ] **Step 1: Write failing display and instruction tests**

Render an existing confirmation containing the persisted status and assert the resource row shows `系统素材`, the explanatory copy, and an action labelled `使用系统素材`. Assert the requirement Agent instructions prohibit exposing `内置默认`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm test tests/unit/playable-workspace.test.tsx tests/unit/requirement-tools.test.ts
```

Expected: FAIL because the confirmation table and instructions still expose `内置默认`.

- [ ] **Step 3: Implement display mapping**

Map `内置默认` to `系统素材` only at user-facing boundaries. Standardize the explanation and update local-demo choices while preserving the persisted status and production contract.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the focused test command from Step 2 and expect all tests to pass.

- [ ] **Step 5: Run repository verification**

Run `pnpm format`, `pnpm type-check`, `pnpm lint`, and `pnpm test`. Do not run `pnpm build`.
