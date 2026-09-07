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
