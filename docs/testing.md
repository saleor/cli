# Testing the CLI

Run `pnpm check` for lint, type checks, and the source test suite. Run `pnpm test:e2e` to build the standalone CLI and exercise it as a separate Node process against mock servers. The latter is also available as `pnpm test:build`.

GitHub Actions runs checks on pull requests and pushes to `main`. One Linux job on Node 24 runs lint, type checks, the source suite, and the built CLI end-to-end suite. CI uses the locked pnpm version and a frozen lockfile, needs no secrets, and has read-only repository permissions.

## What the end-to-end suite covers

`src/main.test.ts` launches the actual CLI entry point with an isolated working directory, configuration directory, file credential store, and an allowlist of environment variables. Each test starts a loopback HTTP server on an ephemeral port. Real Cloud credentials and agent environment markers are not inherited. Every CLI process is killed and fails its test after ten seconds, so a stalled command cannot leave the test runner waiting indefinitely.

- Discovery: help, version, command catalog, argument validation, and explicit `--agent` output.
- Authentication: device grant approval/error responses, pending login recovery, token refresh, private credential persistence, logout, and missing credentials.
- Cloud lifecycle: `init` creating a project and sandbox and then reusing both, environment listing, readiness polling, previews, and deletion. A stateful mock preserves resources between CLI invocations and checks the exact write sequence, so repeated commands must reuse resources instead of creating duplicates.
- Store readiness: a local HTTPS server answers the Saleor `shop` GraphQL query. The test generates a short-lived certificate with OpenSSL and trusts it through `NODE_EXTRA_CA_CERTS`; TLS verification stays enabled. It checks that Cloud tokens are not sent to the store.
- Safety and recovery: the billing notice, production deletion refusal, dry runs without writes, explicit resource selection, ambiguous writes, busy tasks, retry suggestions, and resumable timeouts.
- Local commands: `init --local`, `local list` and `local down` run against a fake Docker executable and a mock GraphQL API. The test checks retained instance configuration after stopping and distinguishes ordinary shutdown from volume deletion.

The local lifecycle unit suite separately covers fresh initialization, migration failures, credentials, ports and recovery. Core suites cover the shared conventions: `action.test.ts` (confirmation, review after questions, dry runs, absent targets), `target.test.ts` (target resolution and prompts), `lock.test.ts`, `runtime.test.ts` (menus), and `conventions.test.ts`, which checks every registered command against the rules of its kind.

## Boundaries

These tests verify the CLI's process, filesystem, and HTTP behavior against the recorded API contract. They do not start real Saleor containers, validate Docker images or database migrations, exercise browser login approval, or use the OS keyring. They also do not prove that the live Cloud API still matches the fixtures. OpenSSL must be on `PATH` when running the end-to-end suite; it is available on the CI runners.

`pnpm test:live --org <slug>` is a separate, manually invoked smoke test against real services. It is not part of CI. With `--project <slug> --allow-create-delete` it creates a sandbox in that project and deletes it.
