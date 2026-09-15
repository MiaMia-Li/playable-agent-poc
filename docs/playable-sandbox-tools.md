# Playable browser snapshot

The remote Harness build uses `PLAYABLE_SANDBOX_SNAPSHOT_ID` when configured.
Each task gets an independent, nonpersistent sandbox restored from that snapshot.
Without this setting, the existing Node 24 runtime remains the fallback. Local
Codex CLI builds do not use the remote snapshot.

## Create once

Run from the repository root with the existing `SANDBOX_VERCEL_TOKEN`,
`SANDBOX_VERCEL_TEAM_ID`, and `SANDBOX_VERCEL_PROJECT_ID` in `.env.local`, or valid
Vercel OIDC authentication:

```bash
pnpm sandbox:prepare-playable
```

This creates cloud resources: a temporary Ubuntu sandbox and a reusable snapshot.
It installs pinned Playwright 1.63.0 (supports Ubuntu 26.04), its Chromium binaries and OS dependencies,
Noto CJK fonts, jq, zip and unzip. It checks browser launch, clicking and screenshots
in both orientations, then repeats that check in a fresh sandbox restored from the
snapshot. Only a verified snapshot ID is saved to `.env.playable-sandbox.local`.
The snapshot has no automatic expiry; delete unused versions in Vercel when retired.
Temporary sandboxes are stopped, and an unsuccessful snapshot is deleted.

Setup reports each installation stage separately. Failed command output is saved
locally to `.playable-sandbox-setup.log` after credential redaction, rather than
streamed into logs. This file is ignored by Git. The older 1.58.2 recipe does not
support the current Ubuntu 26.04 managed image; recreate snapshots with this recipe.

Host credentials, user assets, project sources and task artifacts are not copied
into the snapshot. Only the tool files in `scripts/playable-sandbox/` are uploaded.

## Enable

Copy the generated `PLAYABLE_SANDBOX_SNAPSHOT_ID` setting into `.env.local` for
local Harness builds, or into the deployment's server environment variables and
redeploy. The generated file is not automatically loaded by Next.js. Do not add
a `NEXT_PUBLIC_` prefix. Keep the snapshot in the same Vercel project as builds.

Each build checks the installed recipe version and browser binary before starting
the agent. An inaccessible snapshot or incompatible tool installation fails during
preparation; it does not silently fall back to repeated browser installation.
Remove the setting to explicitly return to the old environment.

The agent reads `/opt/playable-tools/README.md` and imports
`/opt/playable-tools/playwright.cjs`. This wrapper resolves the package and selects
the same browser cache used at install time, including when called from an ES module.
The readiness check is not a substitute for gameplay acceptance.

## Update

Change the pinned version in `lib/playable/sandbox-tools.ts` and increment the
recipe version when changing tools or wrapper behavior. Move the old generated
configuration file aside, run the preparation command again, then switch the
deployment setting to the newly verified ID. The script refuses to overwrite an
existing configuration file. Keep the previous snapshot available for rollback.

Actual speedup depends on how much a build previously spent installing browser
tools. Animation time, gameplay debugging and model execution still remain.

## Optional fast diagnostic mode

Set `PLAYABLE_SANDBOX_VALIDATION_ENABLED=0` in the server environment to skip
the host behavioral validation command, Codex browser acceptance, its validation
checklist, and the two-phase preview flow. This is intended for build-latency
diagnosis. The host still checks the artifact contract, offline resources,
responsive viewport, and credentials. Remove the setting or set it to `1` to
restore full validation; full validation is the default.

References: [Vercel snapshots](https://vercel.com/docs/sandbox/concepts/snapshots),
[system packages](https://vercel.com/kb/guide/how-to-install-system-packages-in-vercel-sandbox),
[Playwright browser dependencies](https://playwright.dev/docs/browsers).
