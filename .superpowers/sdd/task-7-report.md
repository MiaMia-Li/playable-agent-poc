# Task 7 Report

## Status

Complete on `feat/playable-agent-poc`.

Implementation commit: `4baca27c3550e3d05c13a376a83f3286b30b2253`

## Files

- `app/page.tsx`
- `app/tasks/page.tsx`
- `app/tasks/[taskId]/page.tsx`
- `components/app-layout.tsx`
- `components/playable/api-key-dialog.tsx`
- `components/playable/chat-workspace.tsx`
- `components/playable/confirmation-table.tsx`
- `components/playable/playable-preview.tsx`
- `components/playable/playable-workspace.tsx`
- `tests/unit/playable-workspace.test.tsx`
- `package.json`
- `pnpm-lock.yaml`

## UI behavior

- `/` is now a focused Playable Studio landing page with one “新建试玩” composer and a persisted playable-only task list.
- `/tasks` redirects to the playable landing page, removing the legacy repository task list from this path.
- `/tasks/[taskId]` verifies authentication and ownership server-side, then renders a responsive ChatGPT-style workspace.
- The left pane contains requirement chat, local asset selection, the full Skill confirmation table, explicit confirmation, and the five-stage progress display.
- Confirmation remains disabled while any resource is `待上传` or the store URL is not absolute HTTPS.
- The workspace calls the real Task 6 create, message, confirmation, event, BYOK-check, and artifact APIs.
- The API key is held only in `ApiKeyDialog` component state, submitted directly to `PUT /api/session/openai-key`, and cleared in `finally`.
- The right pane includes portrait/landscape sizing, refresh, autoplay-blocking mute, and authenticated download.
- The preview iframe uses exactly `sandbox="allow-scripts"` and only `/api/playable-tasks/{taskId}/artifact?kind=playable`.
- A failed build does not clear an already successful artifact URL.
- Desktop uses two panes; mobile stacks chat above preview. Controls and state have accessible names, pressed states, live/error states, and iframe title.
- Existing authentication and database persistence remain intact. Repository/Git/PR/editor/terminal controls are hidden from the playable paths.

## TDD and verification

No live OpenAI calls, external credentials, or production artifacts were used.

1. `pnpm add -D @testing-library/react @testing-library/jest-dom jsdom`
   - Exit 0; added 55 packages.
2. `pnpm test tests/unit/playable-workspace.test.tsx`
   - RED, exit 1: playable workspace module did not exist.
3. `pnpm test tests/unit/playable-workspace.test.tsx`
   - GREEN, exit 0: 1 file, 4 tests passed.
4. Added the regression test for removing the legacy `/tasks` workspace.
5. `pnpm test tests/unit/playable-workspace.test.tsx`
   - RED, exit 1: `TasksListClient` was still present.
6. `pnpm test tests/unit/playable-workspace.test.tsx`
   - GREEN, exit 0: 1 file, 5 tests passed.
7. Added the secure mute behavior test.
8. `pnpm test tests/unit/playable-workspace.test.tsx`
   - RED, exit 1: iframe lacked the autoplay-blocking permission policy.
9. `pnpm test tests/unit/playable-workspace.test.tsx`
   - GREEN, exit 0: 1 file, 6 tests passed.
10. `pnpm test`
    - Exit 0: 13 files, 139 tests passed.
11. `pnpm type-check`
    - Exit 0; no TypeScript errors.
12. `pnpm lint -- app/page.tsx 'app/tasks/[taskId]/page.tsx' app/tasks/page.tsx components/app-layout.tsx components/playable tests/unit/playable-workspace.test.tsx`
    - Exit 0; no lint errors or warnings.
13. `pnpm build`
    - Exit 0; Next.js production compilation, type checking, page-data collection, and 32 static page generations succeeded.
14. `git diff --check`
    - Exit 0; no whitespace errors.
15. Security self-review searches:
    - No `allow-same-origin`, top-navigation, popup, form sandbox permissions, storage calls, global atoms, analytics, or repository/Git terminology in `components/playable`.
    - Exactly one iframe sandbox declaration: `sandbox="allow-scripts"`.
16. Final post-commit verification: `pnpm test && pnpm type-check && pnpm build`
    - Exit 0: 13 files/139 tests passed, TypeScript passed, and the optimized production build completed.

## Concerns

- `pnpm build` emits the existing informational warning that `baseline-browser-mapping` data is over two months old; it does not affect the successful build.
- Browser-level visual/E2E testing was not run because this task prohibited live APIs and credentials. Component tests cover the required controls, sandbox, authenticated URL, mute policy, and artifact retention behavior.

---

## Review correction — 2026-09-07

### Status and commits

All Critical and Important review findings are corrected.

- `3b559d6` — `feat: add private playable assets and runtime control`
- `0d2e286` — `fix: make playable workspace state and controls truthful`

### Functional corrections

- Added authenticated `POST /api/playable-tasks/[taskId]/assets` multipart upload with ownership checks,
  a 4 MiB file bound, an exact image/audio/video MIME allowlist, sanitized metadata, private Blob storage, and no
  provider URL in any response.
- Added `playable_task_assets` metadata persistence and migration `0025_playable_task_assets.sql`, including task and
  owner foreign keys, private storage key uniqueness, and task/slot indexing.
- Bound each upload to one explicit confirmation resource slot. Server confirmation now rejects pending resources and
  rejects `用户上传` slots without matching task-owned metadata.
- Loaded persisted private bytes into `work/user-assets/<slot>/` before agent execution. The build agent receives
  `asset-manifest.json`; the validated build returns and persists a truthful provider-URL-free manifest.
- Added projected authenticated `GET /api/playable-tasks`; Playable Home no longer consumes raw `/api/tasks` rows.
- Event responses now include authoritative `{ phase, hasArtifact, artifactVersion }`, refreshed after event reads.
  The client polls immediately, guards against backward phase movement, and continues through terminal state.
- Server rendering initializes phase, artifact availability, and artifact version. Failed/validating reloads preserve
  the prior artifact; a changed ready version replaces the iframe and refreshes the preview.
- Replaced autoplay-policy “mute” with the narrow `playable:set-muted` parent-message protocol. The iframe adds no
  permissions, posts only the boolean protocol to its opaque origin, and does not reload on mute. Runtime v2 validates
  source and message shape and updates BGM plus every active one-shot audio instance.
- Updated and behavior-tested the shared vendored runtime for all four registered Skill modes; provenance/version is
  documented in `SKILL.md`.
- Added Chinese active-stage rendering, terminal labels, exact mode ID plus user-facing label, phase-gated composer and
  confirmation controls, distinct conflict messages, and new-task recovery.
- Added streaming `AbortController`, unmount cancellation, visible stop action, final-line/malformed NDJSON handling,
  and visibly failed optimistic messages.
- API-key validation remains component-local and clears in `finally`; the dialog can now close through its close,
  Escape, or “暂不配置” actions.
- Mobile chat is height-bounded with an independently scrolling transcript and fixed composer before Preview.
- Added explicitly labelled per-slot file inputs, live asset announcements, grouped preview controls, and disabled
  download/mute/refresh when no artifact exists.
- Stopped legacy AppLayout `/api/tasks` fetch and polling on playable routes. Removed the unreachable legacy task detail
  components containing permissive iframe sandboxes.
- No playable component writes message, key, asset form, or confirmation values to analytics, storage, URLs, or global
  atoms.

### TDD and exact evidence

No real API, Blob, Sandbox, credential, or other live service was used. All service boundaries used deterministic fakes
or local temporary directories.

1. `pnpm test tests/integration/playable-assets.test.ts`
   - RED: missing `task-assets` implementation.
   - GREEN: 1 file, 3 tests passed.
2. `pnpm test tests/integration/sandbox-runner.test.ts`
   - RED: uploaded file absent from Sandbox workspace.
   - GREEN after asset copy/manifest: 1 file, 19 tests passed.
3. `pnpm test tests/integration/sandbox-runner.test.ts`
   - RED after runtime assertions: all four modes failed because the parent mute protocol was absent.
   - GREEN after runtime v2: 1 file, 19 tests passed, including all four modes.
4. `pnpm test tests/unit/playable-workspace.test.tsx`
   - RED: five reviewed UI behaviors failed.
   - GREEN: behavioral workspace suite passed.
5. `pnpm test tests/integration/playable-task-api.test.ts`
   - RED: confirmation incorrectly accepted `用户上传` without owned slot metadata.
   - GREEN: 1 file, 34 tests passed.
6. `pnpm test tests/unit/codex-playable-agent.test.ts`
   - RED: build instructions did not mention `asset-manifest.json`.
   - GREEN after asset-aware build instructions.
7. `pnpm test tests/integration/playable-assets.test.ts tests/integration/playable-task-api.test.ts tests/integration/sandbox-runner.test.ts tests/unit/codex-playable-agent.test.ts tests/unit/playable-route-delegation.test.ts tests/unit/playable-route-wiring.test.ts tests/unit/playable-task-repository.test.ts`
   - Exit 0: 7 files, 70 tests passed.
8. `pnpm test tests/unit/playable-workspace.test.tsx tests/unit/playable-pages.test.tsx`
   - Exit 0: 2 files, 12 tests passed.
9. `tmpdir=$(mktemp -d) && for mode in center_collision top_rack gravity_fill perspective_3d; do node skills/mahjong-pair-match-playable/assets/starter/build-playable.mjs "$mode" "$tmpdir/$mode.html" "https://example.com/store" && node skills/mahjong-pair-match-playable/assets/starter/work/test-playable.mjs "$tmpdir/$mode.html"; done && rm -rf "$tmpdir"`
   - Exit 0.
   - `center_collision`: 3,805,607 bytes; PASS, score 2000, 4 matches, 10 interactions.
   - `top_rack`: 3,805,629 bytes; PASS, score 1360, 4 matches, 18 interactions.
   - `gravity_fill`: 3,805,624 bytes; PASS, score 2000, 4 matches, 10 interactions.
   - `perspective_3d`: 3,805,638 bytes; PASS, score 1632, 4 matches, 10 interactions.
10. `pnpm test`
    - Exit 0: 15 files, 154 tests passed.
11. `pnpm type-check`
    - Exit 0; no TypeScript errors.
12. `pnpm lint`
    - Exit 0; 0 errors and 20 pre-existing warnings in legacy repository/editor files.
13. `pnpm format:check`
    - Exit 0; all matched TypeScript/TSX files use Prettier style.
14. `pnpm build`
    - Exit 0; optimized Next.js production compilation, TypeScript, page collection, and 32-page generation passed.
15. `git diff HEAD~2..HEAD --check`
    - Exit 0; no whitespace errors.
16. Security self-review:
    - Exactly one remaining component iframe, with exactly `sandbox="allow-scripts"`.
    - No same-origin, form, popup, top-navigation, or added iframe permissions remain.
    - No storage/global-atom/analytics calls exist in `components/playable`.
    - No private Blob provider URL or storage key crosses the asset/task response boundary.

### Remaining concerns

- Migration `0025_playable_task_assets.sql` must be applied before deploying the corrected upload path.
- Full lint retains 20 unrelated pre-existing warnings in legacy repository/editor modules; Task 7 correction files are
  lint-clean.
- The existing `baseline-browser-mapping` staleness notice remains during lint/build.
- No credential-dependent or live browser E2E run was performed; deterministic component, API, private-store, Sandbox,
  and four-mode runtime tests cover the corrected behavior.
