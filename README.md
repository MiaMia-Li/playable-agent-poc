# C6 Playable Agent POC

A proof-of-concept web application for planning C6 Mahjong pair-match playable ads with the OpenAI Responses API, then building them with a GPT-5.6 Sol agent in an isolated Vercel Sandbox.

## Credential model

Playable Studio uses one server-managed OpenRouter API Key for requirement planning, analysis, media generation, and confirmed Sandbox builds. Configure `OPENROUTER_API_KEY` only in the server runtime or deployment secret manager; the browser never asks visitors for a key and never receives the shared credential.

The application sends OpenAI-compatible requests to `https://openrouter.ai/api/v1` and intentionally does not fall back to `OPENAI_API_KEY` or `AI_GATEWAY_API_KEY`. Never store or expose the shared key in the database, user profile, browser storage, `NEXT_PUBLIC_*` variables, logs, generated HTML, or build artifacts.

The application defaults to the OpenRouter-qualified model ID `openai/gpt-5.6-sol`. The shared key must have access to the configured `PLAYABLE_AGENT_MODEL` before requirement planning or a Sandbox build can start.

## POC workflow

1. Open the public studio and describe the game idea conversationally. The requirement Agent answers informational messages without
   changing the Brief; requirement messages use domain tools to maintain a persistent Brief,
   inspect safe asset metadata, read Plugin capabilities, and request only the missing input.
2. Route the idea to an exact template match, an approximate template adaptation, or direct freeform generation.
3. Upload or select assets and confirm the complete production configuration.
4. Build and validate the playable in an isolated Sandbox.
5. Preview or switch between passing versions and download the offline single-file HTML.

Freeform generation uses the closest registered mode only as workspace scaffolding; it does not create a persistent
custom Plugin. The POC does not use repository selection, GitHub Issue input, automatic branches, commits, or pull
requests for playable tasks.

## Local setup

Requirements:

- Node.js and Corepack
- pnpm
- PostgreSQL
- Vercel Sandbox credentials

Install and verify the baseline:

```bash
corepack enable
pnpm install
pnpm type-check
pnpm build
```

Copy the checked-in environment template and fill in the infrastructure values. GitHub OAuth values are not required for Playable Studio:

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
MAX_SANDBOX_DURATION=300
OPENROUTER_API_KEY=
PLAYABLE_AGENT_MODEL=openai/gpt-5.6-sol
LOCAL_HARNESS_MODE=0
LOCAL_CODEX_MODE=0
```

Set `OPENROUTER_API_KEY` in `.env.local` for local server use and in the deployment secret manager for production. Do not commit its value. Tasks and uploaded assets are intentionally shared by all visitors in this public POC.

The deployment network must resolve `vercel.com` and allow outbound HTTPS traffic to `vercel.com:443`, which is the API origin used by `@vercel/sandbox` 3.x. Run the connectivity preflight inside the deployed runtime or its release job:

```bash
pnpm check:sandbox-connectivity
```

The command exits unsuccessfully with a static DNS-specific or HTTPS-egress-specific message. A failure must be fixed in the hosting provider's DNS, firewall, proxy, or outbound allowlist; application code cannot override a blocked network route.

### Production-equivalent local agent

To test the same shared-key Responses API structured streaming, Codex Harness build, PostgreSQL, Blob, and Vercel Sandbox path used by the
deployment while using the same public POC task identity, run:

```bash
pnpm local:harness
```

This mode reads `OPENROUTER_API_KEY` from the server environment and uses the same Agent implementation and API billing path
as production; only the shared identity is replaced with the fixed local development user. Requirement chat does not create
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
Vercel deployments and never forwards project environment variables to the Codex child process. Its identity and
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
