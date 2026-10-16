# Saleor CLI PoC

A fresh Saleor CLI on Node 22.18+ and Effect. Cloud is the first internal module; its commands are flat (`saleor project create`, `saleor env create`). Configurator and publication are outside this PoC.

## Run locally

```sh
pnpm install
pnpm saleor --help
pnpm saleor commands --json
pnpm saleor login
pnpm saleor org list
pnpm saleor init --org my-org --project my-store --env dev
```

`pnpm saleor` runs the checked-out source. Nothing is installed globally. The private package's version is a development label; there is no publishing workflow.

Login prints a device link and code to stderr and waits for browser approval. Pending approval survives interruption. The temporary OAuth client is `jolly`; switch `SALEOR_AUTH_CLIENT_ID` to `saleor-cli` once device grant is enabled there. Login credentials use the OS keyring, with a private file fallback at `~/.config/saleor/credentials.json` (or `$XDG_CONFIG_HOME/saleor`). Access tokens refresh automatically.

For unattended use, set `SALEOR_CLOUD_TOKEN` to a Cloud API token from the Cloud dashboard. It takes precedence over a saved login and is never persisted by the CLI. `logout` removes the saved login; unset the variable separately. This token accesses the Cloud API; provisioning returns addresses, not store credentials.

## Commands

| Command | Purpose |
| --- | --- |
| `login`, `logout`, `whoami` | Account authentication |
| `org list` | Discover organizations |
| `project list --org <slug>` | Discover projects |
| `project create <name> --org <slug>` | Create or reuse by name; defaults to `dev` in `us-east-1` |
| `project delete <slug> --org <slug> --force` | Delete an empty project |
| `env list --org <slug> [--project <slug>]` | Discover environments |
| `env get [name-or-key]` | Get addresses and service details |
| `env create <name> --project <slug>` | Create or reuse a sandbox and check readiness |
| `env delete <name-or-key> --force` | Delete a sandbox and wait until absent |
| `link --org <slug> --project <slug> --env <name-or-key>` | Save directory context |
| `init --org <slug> --project <name> --env <name>` | Create/reuse, wait, and link |
| `commands --json` | Discover commands, arguments and flags |

Read each command's `--help` for all flags. `--json` is shorthand for `--output json`. Explicit `--output text` selects human output.

Organization, project and environment selection uses flags, then `SALEOR_ORG` / `SALEOR_PROJECT` / `SALEOR_ENV`, then the nearest `.saleor/link.json`. An account with one organization can select it automatically. With multiple organizations, selection must be explicit. The link contains a `cloud` section with names and keys, never credentials. Other module sections are preserved. `init --no-link` skips this write.

`env create` uses the pre-warmed `obtain` route when `--domain-label` is omitted. Cloud picks the domain and database contents. Supplying a domain label uses ordinary creation. `--service` must identify an available sandbox service; otherwise the newest available sandbox version is selected.

Existing resources are reused only when explicit settings agree. Environment names are scoped to a project; ambiguous lookups fail. Reused environments undergo the readiness check again. Interrupted creation is recovered by querying Cloud, without a local task journal. Creation requests that fail ambiguously are not automatically retried; re-run the command to look up the result first. The backend has no idempotency keys, so concurrent creates with identical names are not guaranteed safe.

Paid project creation requires `--plan <slug> --confirm-paid-plan`. Without confirmation, the CLI returns published plan pricing without creating anything. When confirmed, pricing is printed before the write. These are plan rates, **not a quote for future usage**: the backend's `/estimated-costs/` reports existing costs. Paid provisioning has not been tested live. Creating additional sandboxes in an existing paid project may also incur charges.

Deletion requires `--force` in automation. A person at an interactive text terminal can confirm instead. Production deletion is refused, projects must be empty, and already absent targets succeed with `deleted: false`. No organization deletion exists.

## Automation contract

Pipes and detected coding agents get JSON automatically. `SALEOR_OUTPUT=json|text` can set a default. Progress and browser instructions go to stderr; stdout has one result document. Help, version and completion requests are parser output rather than result envelopes.

```json
{ "ok": true, "data": { "created": false, "ready": true } }
```

```json
{
  "ok": false,
  "error": {
    "code": "NOT_READY",
    "message": "Provisioning is still in progress.",
    "suggestion": "Run the same command again.",
    "retry": true
  }
}
```

Errors may also include `details`. Branch on `error.code`, not message text. Exit codes are `0` success, `1` failure, `75` unfinished work that can be resumed, and `130` interruption. Provisioning waits up to 600 seconds by default; `--timeout 0` checks once and returns unfinished work immediately. API request timeouts and retries can extend the wall time beyond this polling budget.

## Development and checks

```sh
pnpm check       # all lint passes, generated contracts, TypeScript and tests
pnpm lint       # Biome + anti-slop + Effect 4 diagnostics
pnpm lint:fix   # anti-slop spacing fixes, then Biome lint/format fixes
pnpm generate:api
```

Ultracite's Biome core preset covers authored source, tests, scripts and configuration. The copied OpenAPI snapshot and generated contracts are excluded; change the generator instead of editing generated code.

Anti-slop is opt-in and requires Oxlint. `anti-slop.config.ts` extends the pinned `ultracite/oxlint/anti-slop` preset; it runs as a separate pass so Biome remains the general linter and formatter. All five additional Effect rules are enabled from the vendored upstream plugin in `tools/oxlint/anti-slop/effect/` (revision and license in the parent directory). Vendored code is excluded from local lint/format policy. Oxlint and `@oxlint/plugins` must be upgraded together.

`pnpm lint:effect` runs the official `@effect/tsgo` diagnostics for Effect 4 and TypeScript 7, with warnings failing the check. `tsconfig.json` also enables the Effect editor plugin. The CLI, HTTP and NodeServices APIs this PoC depends on are explicitly allowed unstable APIs; the stability check remains enabled elsewhere. No compiler patch is required for the standalone diagnostics command. Suggested improvements are reported too; all current diagnostics are resolved.

The API snapshot comes from the backend revision in `schemas/cloud-api.source`. Replace the snapshot and revision together to refresh it, then run `pnpm generate:api`. `schemas/cloud-api.overrides.json` records known differences with production (write-only Basic Auth fields missing from responses). Schemas validate responses at runtime. Generation is deterministic; `pnpm check:generated` verifies that checked-in contracts match the snapshot and generator.

`src/main.test.ts` starts the real executable against a local HTTP fixture, using temporary credentials and link files. No real account, keyring or production API is used. It covers authentication/refresh, selection, output, errors, paid-plan confirmation, destructive-action guards, task failures, bounded waits and uncertain writes. Tests live beside the modules they cover: `src/core/module.test.ts` and `src/modules/cloud/provision.test.ts`. Provisioning tests inject Effect services to check GraphQL readiness and recovery. Shared sanitized API samples live in `src/modules/cloud/api/fixtures/`.

Live tests are separate and **read-only by default**:

```sh
SALEOR_CLOUD_TOKEN=... pnpm test:live --org my-org
```

To create a uniquely named free test project and sandbox, exercise timeout/resume, and delete both afterward:

```sh
SALEOR_CLOUD_TOKEN=... pnpm test:live --org my-org --allow-create-delete
```

Use your shell's secret management or Node's `--env-file` rather than placing tokens in shell history. An interrupted live test may leave a `cli-poc-<timestamp>` resource; inspect it before cleanup. See [PoC validation and limits](docs/poc.md).

## Code ownership

- `src/main.ts`: composes the root command, registered modules and runtime service layers.
- `src/core/runtime.ts`: CLI execution policy, argument aliases, console routing, parser failures and interruption handling.
- `bin/saleor.mjs`: passes process arguments to the composed application and starts Effect.
- `src/core`: output, command rendering, module collision checks, credential storage and link files.
- `src/modules/cloud/api`: generated API contracts and HTTP transport.
- `src/modules/cloud/auth`: device flow, stored sessions and refresh.
- `src/modules/cloud/provision.ts`: resource lookup, creation, polling and deletion.
- `src/modules/cloud/commands`: input parsing and thin workflow adapters.

Handlers return data; the shared runner renders results and exit codes. Modules own top-level command words, and registration rejects collisions with each other or the core. This is an internal module boundary, not a public plugin API. The CLI is the public integration surface for clients such as Jolly.
