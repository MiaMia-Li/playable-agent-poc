# C6 Playable Agent POC

A proof-of-concept web application for planning C6 Mahjong pair-match playable ads with the OpenAI Responses API, then building them with a GPT-5.6 Sol agent in an isolated Vercel Sandbox.

## Credential model

Every end user provides their own OpenAI API Key after login. The key is session-only: it is encrypted into a secure server-managed session cookie, used server-side for requirement planning, supplied to the owning task's Sandbox only after build confirmation, and removed when the session ends.

Do not configure a project-wide `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY`. This project has no shared OpenAI credential or provider-key fallback. OpenAI and other provider keys must not be stored in the application database, user profile, browser storage, logs, generated HTML, or build artifacts.

The application always requests the explicit model ID `gpt-5.6-sol`. A user key must have access to that model before requirement planning or a Sandbox build can start.

## POC workflow

1. Sign in and enter an OpenAI API Key for the current session.
2. Ask questions or describe the game idea conversationally. The requirement Agent answers informational messages without
   changing the Brief; requirement messages use domain tools to maintain a persistent Brief,
   inspect safe asset metadata, read Plugin capabilities, and request only the missing input.
3. Route the idea to an exact template match, an approximate template adaptation, or direct freeform generation.
4. Upload or select assets and confirm the complete production configuration.
5. Build and validate the playable in an isolated Sandbox.
6. Preview only the latest passing artifact and download the offline single-file HTML.

Freeform generation uses the closest registered mode only as workspace scaffolding; it does not create a persistent
custom Plugin. The POC does not use repository selection, GitHub Issue input, automatic branches, commits, or pull
requests for playable tasks.

## Local setup

Requirements:

- Node.js and Corepack
- pnpm
- PostgreSQL
- Vercel Sandbox credentials
- GitHub OAuth credentials

Install and verify the baseline:

```bash
corepack enable
pnpm install
pnpm type-check
pnpm build
```

Copy the checked-in environment template and fill in the infrastructure and OAuth values:

```bash
cp .env.example .env.local
```

The environment contract is:

```dotenv
POSTGRES_URL=
JWE_SECRET=
BLOB_READ_WRITE_TOKEN=
SANDBOX_VERCEL_TOKEN=
SANDBOX_VERCEL_TEAM_ID=
SANDBOX_VERCEL_PROJECT_ID=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
MAX_SANDBOX_DURATION=300
PLAYABLE_AGENT_MODEL=gpt-5.6-sol
LOCAL_HARNESS_MODE=0
LOCAL_CODEX_MODE=0
```

No project-wide OpenAI credential belongs in `.env.local` or the deployment environment. Users enter their own key only after authentication.

### Production-equivalent local agent

To test the same BYOK, Responses API structured streaming, Codex Harness build, PostgreSQL, Blob, and Vercel Sandbox path used by the
deployment while bypassing local GitHub OAuth, run:

```bash
pnpm local:harness
```

Enter the user OpenAI API Key in the session dialog. This mode uses the same Agent implementation and API billing path
as production; only authentication is replaced with the fixed local development user. Requirement chat does not create
a Sandbox. A confirmed build requires all three `SANDBOX_VERCEL_*` values because the local process does not receive
Vercel's deployment OIDC identity. For an end-to-end OAuth check, use `pnpm dev` instead.

### Local Codex CLI agent

To run the real local workflow with saved Codex CLI authentication and without GitHub OAuth, link the project, pull the
shared POC variables, migrate the database, and start the dedicated mode. The Vercel environment selector is only used
as a configuration source here; this POC uses the same Postgres and Blob resources in every environment.

```bash
npx vercel link --yes --scope make-money --project playable-agent-poc
npx vercel env pull .env.local --environment=development --yes --scope make-money
node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate
pnpm smoke:local-codex
pnpm local:codex
```

This mode uses the real PostgreSQL repository, private Blob store, Codex CLI, and Vercel Sandbox. It is disabled on
Vercel deployments and never forwards project environment variables to the Codex child process. Its authentication and
event stream differ from production, so use `pnpm local:harness` for deployment-parity Agent testing.

Run the development server:

```bash
pnpm dev
```

## Local demo prototype

To exercise the complete UI without login, PostgreSQL, Blob, OpenAI, or Vercel Sandbox credentials, run:

```bash
pnpm demo
```

This explicitly temporary mode uses an in-memory task repository and artifact store plus the vendored local Skill
builder. It performs the real four-mode build and behavior check, but its confirmation Agent is deterministic and all
tasks disappear when the development server restarts. Do not enable `LOCAL_DEMO_MODE` in a deployed environment.

## Design and implementation

- [Current capabilities, user flow, technical architecture, and roadmap](docs/playable-poc-capabilities-user-flow-and-roadmap.md)
- [Approved design](docs/superpowers/specs/2026-09-07-playable-agent-poc-design.md)
- [Implementation plan](docs/superpowers/plans/2026-09-07-playable-agent-poc-implementation.md)

## License

This repository retains the template's license and required attribution. See [LICENSE](LICENSE).
