# C6 Playable Agent POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vercel-hosted application where authenticated users provide their own OpenAI API Key, chat with a GPT-5.6 Sol Codex agent, generate one of four C6 Mahjong playable modes in an isolated Sandbox, preview the latest passing HTML, and download validated artifacts.

**Architecture:** Start from Vercel's Coding Agent Template, remove repository/PR workflows, and retain authentication, task persistence, event streaming, and Sandbox lifecycle. Add a provider-neutral playable-agent adapter, session-only BYOK, a versioned `mahjong-pair-match-playable` Skill, private artifact storage, and a split chat/iframe workspace. Every task copies the Skill into an isolated workspace, builds with the existing script, runs behavioral and browser validation, and publishes only passing artifacts.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Vercel AI SDK Harness, Codex Harness, OpenAI `gpt-5.6-sol`, Vercel Sandbox, Neon Postgres with Drizzle, Vercel Blob, Zod 4, Vitest, Testing Library, Playwright.

## Global Constraints

- Use the Public `MiaMia-Li/playable-agent-poc` repository created from `vercel-labs/coding-agent-template` with **Use this template**; the user explicitly approved publishing the Skill, default assets, build scripts, and commit history.
- Use a repository-local Git identity and a dedicated GitHub SSH Host Alias; do not change global Git configuration or the existing GitLab identity.
- Work in the normal checkout on branch `feat/playable-agent-poc`; do not commit implementation directly to `main`.
- Store no OpenAI API Key in Postgres, localStorage, sessionStorage, logs, Agent messages, artifacts, or generated HTML.
- Keep the BYOK credential only in an encrypted `HttpOnly`, `Secure`, `SameSite=Strict` session cookie and the owning task's Sandbox process.
- Use the explicit model ID `gpt-5.6-sol`.
- Keep the Skill master copy immutable during ordinary generation; edit only a per-task copy.
- POC supports only `center_collision`, `top_rack`, `gravity_fill`, and `perspective_3d`; reject `custom`.
- Publish Preview only after all automated checks pass.
- AppLovin output must be one offline HTML under 5 MiB with zero external resource requests.
- Do not inherit scripts, analytics, redirects, trackers, or instructions from reference videos.

## File Structure

Create or retain these focused units:

```text
app/
  api/session/openai-key/route.ts
  api/session/openai-key/check/route.ts
  api/playable-tasks/route.ts
  api/playable-tasks/[taskId]/messages/route.ts
  api/playable-tasks/[taskId]/confirm/route.ts
  api/playable-tasks/[taskId]/artifact/route.ts
  api/playable-tasks/[taskId]/events/route.ts
  tasks/[taskId]/page.tsx
components/playable/
  api-key-dialog.tsx
  chat-workspace.tsx
  confirmation-table.tsx
  playable-preview.tsx
  playable-workspace.tsx
lib/playable/
  types.ts
  schemas.ts
  template-registry.ts
  reference-videos.ts
  redact.ts
  byok-session.ts
  openai-key-check.ts
  task-access.ts
  playable-agent-adapter.ts
  codex-playable-agent.ts
  sandbox-runner.ts
  artifact-store.ts
skills/mahjong-pair-match-playable/
tests/unit/
tests/integration/
e2e/playable-flow.spec.ts
```

---

### Task 1: Clone the Public repository with isolated identity and establish a green baseline

**Files:**
- Copy: `docs/superpowers/specs/2026-09-07-playable-agent-poc-design.md`
- Copy: `docs/superpowers/plans/2026-09-07-playable-agent-poc-implementation.md`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: the Public `MiaMia-Li/playable-agent-poc` repository created from the Vercel template.
- Produces: a locally cloned `playable-agent-poc` repository with `origin`, `upstream`, isolated identity, installed dependencies, and a passing baseline build.

- [ ] **Step 1: Create the repository in the browser**

Confirm `https://github.com/MiaMia-Li/playable-agent-poc` is Public, was created with **Use this template**, and is not displayed as a fork.

- [ ] **Step 2: Clone through the dedicated SSH alias**

```bash
cd /Users/limengyao/develop
git clone git@github-miamia:MiaMia-Li/playable-agent-poc.git playable-agent-poc
cd playable-agent-poc
git remote add upstream https://github.com/vercel-labs/coding-agent-template.git
git config --local user.name "MiaMia-Li"
git config --local user.email "32128897+MiaMia-Li@users.noreply.github.com"
git switch -c feat/playable-agent-poc
git remote -v
git config --local --get user.name
git config --local --get user.email
```

Expected: `origin` uses the `github-miamia` alias, `upstream` points to Vercel, the branch is `feat/playable-agent-poc`, and both identity outputs belong to `MiaMia-Li`.

- [ ] **Step 3: Verify the unmodified template**

```bash
corepack enable
pnpm install
pnpm type-check
pnpm build
```

Expected: dependency installation, TypeScript checking, and production build all succeed before customization.

- [ ] **Step 4: Copy the approved documents**

```bash
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp /Users/limengyao/develop/playable-factory/docs/superpowers/specs/2026-09-07-playable-agent-poc-design.md docs/superpowers/specs/
cp /Users/limengyao/develop/playable-factory/docs/superpowers/plans/2026-09-07-playable-agent-poc-implementation.md docs/superpowers/plans/
```

- [ ] **Step 5: Replace the README introduction and document required environment**

Add this exact environment contract to `.env.example`:

```dotenv
DATABASE_URL=
JWE_SECRET=
BLOB_READ_WRITE_TOKEN=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
MAX_SANDBOX_DURATION=300
PLAYABLE_AGENT_MODEL=gpt-5.6-sol
```

Document in `README.md` that end users provide their own OpenAI API Key after login and that no project-wide OpenAI key is required.

- [ ] **Step 6: Commit the baseline**

```bash
git add README.md .env.example docs
git commit -m "docs: define playable agent POC"
```

Expected: one documentation-only commit under the repository-local GitHub identity.

---

### Task 2: Vendor the C6 Skill and register video provenance

**Files:**
- Create: `skills/mahjong-pair-match-playable/**`
- Create: `lib/playable/types.ts`
- Create: `lib/playable/template-registry.ts`
- Create: `lib/playable/reference-videos.ts`
- Create: `tests/unit/template-registry.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `PLAYABLE_MODES`, `getPlayableMode(mode)`, `REFERENCE_VIDEOS`, and `PlayableMode`.
- Consumes: the complete local Skill directory supplied by the user.

- [ ] **Step 1: Add Vitest and write the failing registry test**

```bash
pnpm add -D vitest
```

Create `tests/unit/template-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getPlayableMode, PLAYABLE_MODES } from '@/lib/playable/template-registry'

describe('template registry', () => {
  it('registers exactly the four approved C6 modes', () => {
    expect(PLAYABLE_MODES.map((mode) => mode.id)).toEqual([
      'center_collision',
      'top_rack',
      'gravity_fill',
      'perspective_3d',
    ])
  })

  it('rejects custom generation in the POC', () => {
    expect(() => getPlayableMode('custom')).toThrow('Unsupported playable mode: custom')
  })
})
```

Add `"test": "vitest run"` to `package.json`, then run:

```bash
pnpm test tests/unit/template-registry.test.ts
```

Expected: FAIL because the registry does not exist.

- [ ] **Step 2: Define the mode type and registry**

Create `lib/playable/types.ts`:

```ts
export const playableModeIds = [
  'center_collision',
  'top_rack',
  'gravity_fill',
  'perspective_3d',
] as const

export type PlayableModeId = (typeof playableModeIds)[number]

export interface PlayableMode {
  id: PlayableModeId
  label: string
  description: string
  configPath: string
  referencePath: string
}
```

Create `lib/playable/template-registry.ts`:

```ts
import type { PlayableMode } from './types'

const skillRoot = 'skills/mahjong-pair-match-playable'

export const PLAYABLE_MODES: readonly PlayableMode[] = [
  { id: 'center_collision', label: '中心碰撞', description: '相同牌向中心碰撞、破碎并计分', configPath: `${skillRoot}/assets/templates/center_collision/config.json`, referencePath: `${skillRoot}/references/modes/center_collision.md` },
  { id: 'top_rack', label: '上方牌架', description: '可见牌进入四槽牌架，配对后清除', configPath: `${skillRoot}/assets/templates/top_rack/config.json`, referencePath: `${skillRoot}/references/modes/top_rack.md` },
  { id: 'gravity_fill', label: '下落补位', description: '网格配对消除后列下落并从上方补位', configPath: `${skillRoot}/assets/templates/gravity_fill/config.json`, referencePath: `${skillRoot}/references/modes/gravity_fill.md` },
  { id: 'perspective_3d', label: '3D 纵深', description: '移除立体牌墙顶面并揭示下层', configPath: `${skillRoot}/assets/templates/perspective_3d/config.json`, referencePath: `${skillRoot}/references/modes/perspective_3d.md` },
]

export function getPlayableMode(value: string): PlayableMode {
  const mode = PLAYABLE_MODES.find((candidate) => candidate.id === value)
  if (!mode) throw new Error(`Unsupported playable mode: ${value}`)
  return mode
}
```

- [ ] **Step 3: Record the exact reference-video mapping**

Create `lib/playable/reference-videos.ts`:

```ts
import type { PlayableModeId } from './types'

export const REFERENCE_VIDEOS: ReadonlyArray<{
  filename: string
  mode: PlayableModeId
  regressionFocus: string
}> = [
  { filename: 'Mahjong Match：Classic Tiles！-360 X 640-2026-09-01-c2f1079b9cd7c5090195cbb97ac59e5f.mp4', mode: 'perspective_3d', regressionFocus: '立体塔体、中心开口、暴露顶面和下层揭示' },
  { filename: 'Vita Mahjong-360 X 640-2026-09-01-5a8ed5d387599541396edd43ed2336a7.mp4', mode: 'gravity_fill', regressionFocus: '密集平铺、选择高亮、列下落和补位' },
  { filename: 'Vita Mahjong-720 X 1280-2026-09-01-5712dfecddd48c49c51db9d56b2ab6ed.mp4', mode: 'top_rack', regressionFocus: '分层牌阵、上方牌架、配对清除和下层释放' },
  { filename: 'Mahjong Match：Classic Tiles！-360 X 640-2026-09-01-636b98221290a1df6cbdd961f80d9083 (1).mp4', mode: 'center_collision', regressionFocus: '交错堆叠、中心运动、碰撞破碎和计分' },
]
```

- [ ] **Step 4: Copy the complete Skill without modifying its contents**

```bash
mkdir -p skills
cp -R /Users/limengyao/Documents/Codex/2026-09-04/mahjong-pair-match-playable-skill/outputs/mahjong-pair-match-playable skills/
test -f skills/mahjong-pair-match-playable/SKILL.md
test -f skills/mahjong-pair-match-playable/assets/default-media/背景.jpg
test -f skills/mahjong-pair-match-playable/assets/default-endcard/endcard-bg.webp
```

- [ ] **Step 5: Run all existing Skill builds and behavior tests**

```bash
for mode in center_collision top_rack gravity_fill perspective_3d; do
  node skills/mahjong-pair-match-playable/assets/starter/build-playable.mjs "$mode" ".artifacts/$mode.html"
  node skills/mahjong-pair-match-playable/assets/starter/work/test-playable.mjs ".artifacts/$mode.html"
done
```

Expected: four `PASS mode=...` lines and four HTML files below 5 MiB.

- [ ] **Step 6: Run the registry test and commit**

```bash
pnpm test tests/unit/template-registry.test.ts
git add package.json pnpm-lock.yaml lib/playable tests skills
git commit -m "feat: register C6 playable skill"
```

---

### Task 3: Implement session-only user API keys

**Files:**
- Create: `lib/playable/byok-session.ts`
- Create: `lib/playable/openai-key-check.ts`
- Create: `lib/playable/redact.ts`
- Create: `app/api/session/openai-key/route.ts`
- Create: `app/api/session/openai-key/check/route.ts`
- Create: `tests/unit/byok-session.test.ts`
- Modify: `app/api/auth/signout/route.ts`

**Interfaces:**
- Produces: `setOpenAIKeyCookie`, `readOpenAIKeyCookie`, `clearOpenAIKeyCookie`, `checkOpenAIKey`, and `redactSecrets`.
- Consumes: existing `encryptJWE`, `decryptJWE`, authenticated server session, and `JWE_SECRET`.

- [ ] **Step 1: Write failing cookie and redaction tests**

Test that the encrypted token does not contain the plaintext key, expires, decrypts for the same secret, and that both complete and partial keys are removed from logs.

```ts
expect(token).not.toContain('sk-test-secret')
expect(await decryptOpenAIKey(token, secret)).toBe('sk-test-secret')
expect(redactSecrets('Bearer sk-test-secret', ['sk-test-secret'])).toBe('Bearer [REDACTED]')
```

Run:

```bash
pnpm test tests/unit/byok-session.test.ts
```

Expected: FAIL because the BYOK module does not exist.

- [ ] **Step 2: Implement the encrypted session payload**

Use the existing JWE helpers with this payload and a two-hour expiration:

```ts
interface OpenAIKeySession {
  userId: string
  apiKey: string
  model: 'gpt-5.6-sol'
}

export const OPENAI_KEY_COOKIE = '__Host-playable-openai-key'
export const OPENAI_KEY_TTL = '2h'
```

Set cookie options exactly to:

```ts
{
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge: 60 * 60 * 2,
}
```

Reject the decrypted credential when `payload.userId !== session.user.id`.

- [ ] **Step 3: Implement model-access validation**

`checkOpenAIKey(apiKey)` must make a minimal Responses API request with `model: 'gpt-5.6-sol'`, `input: 'Reply OK'`, and `max_output_tokens: 2`. Return one of:

```ts
type KeyCheckResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'model_access' | 'quota' | 'rate_limited' | 'network' }
```

Never include response headers, request authorization, or the raw provider body in the returned error.

- [ ] **Step 4: Add authenticated key routes**

`PUT /api/session/openai-key` validates the key, encrypts it, and sets the cookie. `DELETE` clears the cookie. `GET /api/session/openai-key/check` returns only `{ configured: boolean, model: 'gpt-5.6-sol' }`.

- [ ] **Step 5: Clear the BYOK cookie during sign-out**

Update the existing sign-out route so OAuth session cookies and `__Host-playable-openai-key` are removed in the same response.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test tests/unit/byok-session.test.ts
pnpm type-check
git add app/api/session app/api/auth/signout lib/playable tests/unit
git commit -m "feat: add session-only OpenAI BYOK"
```

---

### Task 4: Add the playable task domain and confirmation contract

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0022_playable_tasks.sql`
- Create: `lib/playable/schemas.ts`
- Create: `lib/playable/task-access.ts`
- Create: `tests/unit/playable-schemas.test.ts`
- Create: `tests/unit/task-access.test.ts`

**Interfaces:**
- Produces: `confirmationProposalSchema`, `assertTaskOwner`, and task phases `draft | awaiting_confirmation | building | validating | ready | failed | cancelled`.
- Consumes: existing users, tasks, task messages, and authenticated sessions.

- [ ] **Step 1: Write failing schema tests**

Cover all nine Skill confirmation categories, four resource statuses, exact store URL, delivery constraints, rejection of `custom`, and rejection of unknown modes.

- [ ] **Step 2: Add focused playable columns**

Add these columns to `tasks` while retaining the template's broad `status` field for compatibility:

```ts
playableMode: text('playable_mode'),
phase: text('phase').notNull().default('draft'),
confirmation: jsonb('confirmation'),
latestArtifactKey: text('latest_artifact_key'),
latestValidation: jsonb('latest_validation'),
```

Generate and inspect the Drizzle migration; the SQL must add only these columns and must not alter user OAuth data or create a persistent OpenAI key column.

- [ ] **Step 3: Define the confirmation schema**

The Zod schema must require:

```ts
{
  mode,
  gameplay,
  resources: {
    tileFaces, backgroundBoard, animationEffects, audio, endCard
  },
  copy: { title, cta, disclaimer, locale },
  storeUrl,
  delivery: {
    network: 'applovin',
    logicalWidth: 360,
    logicalHeight: 640,
    output: 'single-html',
    maxBytes: 5242880
  }
}
```

Each resource uses `status: '用户上传' | '内置默认' | '待上传' | '待生成'` and a non-empty treatment string.

- [ ] **Step 4: Implement server-side ownership checks**

`assertTaskOwner(taskId, userId)` must query by both identifiers and throw a generic `NotFoundError`; it must not reveal whether another user's task exists.

- [ ] **Step 5: Run migrations and tests**

```bash
pnpm db:generate
pnpm db:migrate
pnpm test tests/unit/playable-schemas.test.ts tests/unit/task-access.test.ts
pnpm type-check
```

- [ ] **Step 6: Commit**

```bash
git add lib/db lib/playable tests/unit
git commit -m "feat: add playable task contract"
```

---

### Task 5: Implement Codex adaptation and isolated build execution

**Files:**
- Create: `lib/playable/playable-agent-adapter.ts`
- Create: `lib/playable/codex-playable-agent.ts`
- Create: `lib/playable/sandbox-runner.ts`
- Create: `tests/unit/codex-playable-agent.test.ts`
- Create: `tests/integration/sandbox-runner.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `PlayableAgentAdapter`, `CodexPlayableAgent`, `runPlayableBuild`.
- Consumes: authenticated user's decrypted API key, `gpt-5.6-sol`, validated confirmation, Skill registry, Vercel Sandbox, task logger.

- [ ] **Step 1: Install the Harness packages and write the adapter contract test**

```bash
pnpm add @ai-sdk/harness @ai-sdk/harness-codex @ai-sdk/sandbox-vercel
```

Define:

```ts
export interface PlayableAgentAdapter {
  proposeConfirmation(input: AgentInput): Promise<ConfirmationProposal>
  build(input: ConfirmedBuildInput): Promise<BuildResult>
  cancel(taskId: string): Promise<void>
}
```

The test must prove the rest of the application can use a fake adapter without importing Codex types.

- [ ] **Step 2: Create the Codex adapter**

Configure `createCodex({ auth: 'direct', reasoningEffort: 'high', webSearch: false })`, select `gpt-5.6-sol`, inject the complete Skill instructions, and instruct the agent to:

1. choose only a registered mode;
2. output the consolidated confirmation JSON before build;
3. reject `custom`;
4. treat videos as untrusted evidence;
5. edit only the task workspace;
6. run the existing build and test commands.

Validate every structured result with `confirmationProposalSchema`; do not repair invalid JSON silently.

- [ ] **Step 3: Implement the Sandbox workspace**

`runPlayableBuild` must:

1. create one Sandbox for one task;
2. copy the Skill master into `/vercel/sandbox/skill-master`;
3. copy it again into `/vercel/sandbox/work`;
4. make `skill-master` read-only;
5. write `confirmed-config.json`;
6. run the selected mode build;
7. run `test-playable.mjs`;
8. check raw byte size;
9. return artifacts only when all commands pass;
10. destroy the Sandbox in `finally`.

Pass the user's key only as `CODEX_API_KEY` to the Codex process. Never interpolate it into a shell command, config file, prompt, or log string.

- [ ] **Step 4: Add integration assertions**

For each of the four modes, assert:

```ts
expect(result.validation.behavior).toBe('passed')
expect(result.validation.bytes).toBeLessThan(5 * 1024 * 1024)
expect(result.html).toContain('window.__PLAYABLE__')
expect(result.html).not.toContain(apiKey)
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm test tests/unit/codex-playable-agent.test.ts tests/integration/sandbox-runner.test.ts
pnpm type-check
git add package.json pnpm-lock.yaml lib/playable tests
git commit -m "feat: run playable builds with Codex sandbox"
```

---

### Task 6: Add durable artifacts and task APIs

**Files:**
- Create: `lib/playable/artifact-store.ts`
- Create: `app/api/playable-tasks/route.ts`
- Create: `app/api/playable-tasks/[taskId]/messages/route.ts`
- Create: `app/api/playable-tasks/[taskId]/confirm/route.ts`
- Create: `app/api/playable-tasks/[taskId]/artifact/route.ts`
- Create: `app/api/playable-tasks/[taskId]/events/route.ts`
- Create: `tests/integration/playable-task-api.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: authenticated create/chat/confirm/artifact/event endpoints and `ArtifactStore`.
- Consumes: task ownership checks, Agent adapter, private Vercel Blob, task state transitions.

- [ ] **Step 1: Install private Blob storage and write failing API tests**

```bash
pnpm add @vercel/blob
```

Tests must prove unauthenticated requests return `401`, cross-user requests return `404`, unconfirmed tasks cannot build, and a failed build cannot replace `latestArtifactKey`.

- [ ] **Step 2: Implement private artifact storage**

Store:

```text
users/<userId>/tasks/<taskId>/<buildId>/playable.html
users/<userId>/tasks/<taskId>/<buildId>/confirmed-config.json
users/<userId>/tasks/<taskId>/<buildId>/asset-manifest.json
users/<userId>/tasks/<taskId>/<buildId>/validation-report.json
```

Use random internal IDs, not usernames or uploaded filenames, in public-facing URLs. Keep Blob access private and stream downloads through the authenticated artifact route.

- [ ] **Step 3: Implement state-safe routes**

- `POST /api/playable-tasks`: creates `draft`.
- `POST /messages`: appends a user message and streams Agent events.
- `POST /confirm`: atomically stores validated confirmation, advances to `building`, runs build, then sets `validating` and finally `ready`.
- `GET /events`: returns only sanitized task events.
- `GET /artifact?kind=playable`: verifies ownership and serves `text/html` with `Content-Disposition` selected by `download=1`.

Use a compare-and-set update on phase so two confirmation requests cannot start duplicate builds.

- [ ] **Step 4: Protect Preview responses**

For inline HTML Preview, set:

```text
Content-Security-Policy: default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; sandbox allow-scripts; form-action 'none'; base-uri 'none'; frame-ancestors 'self'
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
```

Approved amendment (2026-09-07): prioritize Preview isolation. CSP sandboxing permits scripts but deliberately omits same-origin, forms, and top-navigation capabilities. `form-action`, `base-uri`, and `frame-ancestors` add defense in depth. This applies at the authenticated Preview response boundary and must not rewrite downloaded final HTML bytes.

- [ ] **Step 5: Verify and commit**

```bash
pnpm test tests/integration/playable-task-api.test.ts
pnpm type-check
git add app/api/playable-tasks lib/playable package.json pnpm-lock.yaml tests
git commit -m "feat: add playable task and artifact APIs"
```

---

### Task 7: Build the left-chat/right-preview workspace

**Files:**
- Create: `components/playable/api-key-dialog.tsx`
- Create: `components/playable/chat-workspace.tsx`
- Create: `components/playable/confirmation-table.tsx`
- Create: `components/playable/playable-preview.tsx`
- Create: `components/playable/playable-workspace.tsx`
- Modify: `app/page.tsx`
- Modify: `app/tasks/[taskId]/page.tsx`
- Create: `tests/unit/playable-workspace.test.tsx`

**Interfaces:**
- Produces: responsive two-pane production UI.
- Consumes: BYOK status, playable task APIs, confirmation schema, sanitized event stream, authenticated artifact URL.

- [ ] **Step 1: Add Testing Library and write the failing workspace test**

```bash
pnpm add -D @testing-library/react @testing-library/jest-dom jsdom
```

The test must assert:

- missing BYOK opens the API Key dialog;
- the left panel contains chat, upload, confirmation, and progress;
- the right panel contains Preview, orientation controls, refresh, mute, and download;
- failed builds keep the previous artifact URL.

- [ ] **Step 2: Implement the API Key dialog**

Use a password input held only in component memory. Submit directly to `PUT /api/session/openai-key`; clear local state in `finally`; never store the value in a global atom, URL, analytics event, or browser storage.

- [ ] **Step 3: Implement the chat and confirmation flow**

Render phases as:

```text
需求整理 → 等待确认 → 构建中 → 验证中 → 可预览
```

Render the full Skill confirmation table and require one explicit confirmation click. Disable build until no resource remains `待上传` and the store URL is an absolute HTTPS URL.

- [ ] **Step 4: Implement secure Preview**

Use:

```tsx
<iframe
  title="Playable preview"
  sandbox="allow-scripts"
  src={`/api/playable-tasks/${taskId}/artifact?kind=playable`}
/>
```

Do not add `allow-same-origin`, `allow-top-navigation`, or `allow-popups`. Orientation controls resize the containing frame between `360 × 640` and `640 × 360`; they do not modify generated HTML.

- [ ] **Step 5: Remove repository-centric navigation**

Replace home repository selectors and task Git/PR actions with a single “新建试玩” action and the playable task list. Remove links to issues, commits, pull requests, file editor, and terminal from user-facing navigation without deleting authentication or task persistence.

- [ ] **Step 6: Verify and commit**

```bash
pnpm test tests/unit/playable-workspace.test.tsx
pnpm type-check
pnpm build
git add app components package.json pnpm-lock.yaml tests
git commit -m "feat: add playable chat and preview workspace"
```

---

### Task 8: Add browser QA, security regression, and Vercel deployment

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/playable-flow.spec.ts`
- Create: `e2e/security.spec.ts`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Produces: a deployed Vercel Preview verified across the complete POC flow.
- Consumes: all prior tasks.

- [ ] **Step 1: Install Playwright and create authenticated test fixtures**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

Use a test-only authenticated session fixture and a fake `PlayableAgentAdapter` for deterministic CI. Keep one opt-in live test for the user's real API Key outside CI.

- [ ] **Step 2: Test the complete user journey**

`e2e/playable-flow.spec.ts` must cover:

1. login;
2. API Key entry;
3. selecting each of the four modes;
4. rendering and confirming the resource table;
5. build and validation progress;
6. iframe Preview;
7. portrait/landscape switching;
8. HTML download.

- [ ] **Step 3: Test security boundaries**

`e2e/security.spec.ts` must assert:

- API Key is absent from DOM, browser storage, API response bodies, task logs, downloaded HTML, and validation report;
- a second user receives `404` for task events, Preview, and downloads;
- iframe cannot read the parent document or cookies;
- generated HTML makes zero network requests;
- failed validation leaves the previous Preview active.

- [ ] **Step 4: Run the complete verification suite**

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
pnpm exec playwright test
```

Expected: all commands pass with no skipped security checks.

- [ ] **Step 5: Connect the correct GitHub account to Vercel**

In Vercel, authorize the GitHub App for the `MiaMia-Li` account and select `playable-agent-poc`. Configure `DATABASE_URL`, `JWE_SECRET`, `BLOB_READ_WRITE_TOKEN`, GitHub OAuth values, `MAX_SANDBOX_DURATION=300`, and `PLAYABLE_AGENT_MODEL=gpt-5.6-sol`. Do not configure a platform-wide OpenAI API Key.

- [ ] **Step 6: Run live acceptance**

Using a user-entered OpenAI API Key, generate one artifact for each mode and compare observable behavior with its mapped source video:

- `perspective_3d` ↔ Mahjong Match `c2f107...`
- `gravity_fill` ↔ Vita Mahjong `5a8ed...`
- `top_rack` ↔ Vita Mahjong `5712df...`
- `center_collision` ↔ Mahjong Match `636b98...`

Confirm every output is below 5 MiB, offline, muted until interaction, correctly scored, and reaches the end card.

- [ ] **Step 7: Commit and push**

```bash
git add playwright.config.ts e2e README.md .env.example
git commit -m "test: verify playable agent POC"
git push -u origin feat/playable-agent-poc
```

Expected: the Public GitHub repository and Vercel deployment use `MiaMia-Li`, while existing GitLab repositories remain unchanged.
