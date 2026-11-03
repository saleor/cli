# Configurator in the CLI: plan

Status: working CLI prototype. The library integration below supersedes the original monorepo proposal; the remaining migration and release work is still a plan.

The CLI knows **where** Saleor stores run: Cloud environments and local stores in Docker, addressed by ref. [Saleor Configurator](https://github.com/saleor/configurator) knows **what** a store contains: product types, attributes, channels, warehouses and more, declared in `config.yml`. Today they are two CLIs with two auth models, two output contracts and no shared idea of a store. This plan makes Configurator a module of the CLI, keeps every existing Configurator user and pipeline working, and treats the move as a migration with an oracle, not as a rewrite.

## Decisions

Decided on 2026-10-28:

- **Home (updated 2026-10-30):** Configurator stays in its own repository and publishes the library. The CLI imports its public API; no Configurator source or legacy CLI is maintained here.
- **Word:** `saleor config`, with `configurator` as an alias.
- **Manifest:** a committed `saleor.yml` (name not final) names a project's environments.
- **Deprecation:** `@saleor/configurator` is soft-deprecated the day the config module ships in a published CLI.
- **Engine:** wrapped, not rewritten, for now. Moving it onto Effect is a later, separate track (section 4).
- **Store credentials:** supplied as today (`SALEOR_TOKEN` or a saved token); no sign-in through Cloud for now (section 2).

## Starting point

**The CLI** (`@saleor/cli` 2.0.0-poc, Effect). Modules declare commands, a service layer, and optional contributions: a store source (`cloud:<org>/<key>`, `local:<name>`), a setup provider for `init`, a setup extension (the storefront module). Every command is an action of one kind (`list`, `ensure`, `remove`, `session`) with plan → preview → confirm → apply. Output is `{ok, data}` / `{ok: false, error: {code, …}}`, exit codes are `0/1/2/75/130`, `--agent` means `--json --no-input`, and `saleor commands --json` describes everything. Gaps that matter here: the CLI cannot get credentials for a Cloud store's API, there are no URL targets for self-hosted stores, and the project folder `init` makes has no manifest.

**Configurator** (`@saleor/configurator` 3.23.2, Commander + zod + urql). About 35k lines of source and 34k of tests. Commands: `start`, `introspect`, `diff`, `deploy`, `validate`, `schema`, `recipe list|show|apply|export`. Inputs: `--url`, `--token`, `--config` (or `SALEOR_URL`, `SALEOR_TOKEN`, `SALEOR_CONFIG`, auto-loaded from `.env.local`). Exit codes `0–7`, where `diff` exits 1 when there are changes and 2 means an auth error. Its JSON envelope is `{command, version, exitCode, result, logs, errors}`, and reports are written to `.configurator/reports/`. Around it: a GitHub Action that installs `@saleor/configurator@latest`, nine agent skills, a Claude Code plugin, recipes, and `schema.json` for editors. Its version follows the Saleor minor (3.23.x targets Saleor 3.23).

Where the two disagree:

| | CLI | Configurator |
| --- | --- | --- |
| Target | ref (`cloud:…`, `local:…`), flag → env → prompt | `--url` + `--token` |
| Store credentials | none for Cloud; generated admin login for local | app token made by hand in the Dashboard |
| Exit 1 | failure | failure, or "`diff` found changes" |
| Exit 2 | the command line must change | authentication failed |
| JSON | `{ok, data}`, progress as JSON lines on stderr | `{command, version, exitCode, result, logs, errors}` |
| Deletions | need `--force` or a "yes" | happen unless `--fail-on-delete` |
| Non-interactive | explicit `--agent` / `--no-input` | inferred from TTY |
| Dry run | `--dry-run` | `--plan` (deploy), `--dry-run` (introspect) |
| Versioning | its own | tied to the Saleor minor |
| Node | ≥ 22.18 | ≥ 20 |

## 1. Vision: one workbench

Three nouns, each with one home:

- **Store**: where Saleor runs. Already a ref. Add a third source for self-hosted stores, so a URL is a ref too.
- **Configuration**: what the store contains. `config.yml`, Configurator's format, unchanged.
- **Project**: what binds them. A folder holding `config.yml`, maybe a storefront, and `saleor.yml`, which names its environments.

The modules then split cleanly: Cloud and local provide stores, the config module provides their contents, the storefront (and later app) modules provide code that runs against them.

### What a person does

```sh
saleor init                          # Cloud sandbox "staging", from the "fashion" recipe, with a storefront
cd shop                              # config.yml  saleor.yml  storefront/
$EDITOR config.yml
saleor config diff staging           # what would change
saleor config deploy staging         # apply; deletions ask first
saleor init --env pr-42 --from staging   # a preview sandbox with the same structure
saleor config deploy production --dry-run
saleor env remove pr-42
```

Already have a store? `saleor config pull cloud:acme/abc123` writes its `config.yml`, and the project is adopted. Run `saleor` inside such a folder and the menu offers the config tasks first, the way `storefront use` is offered only inside a storefront.

### The loops this enables

1. **Start.** `init` gets a store, deploys a recipe, an empty configuration or a copy of another store's configuration into it, and connects a storefront. One command instead of three tools. For a Cloud store, it asks once for the store token and saves it.
2. **Adopt.** Pull an existing store into a project.
3. **Change.** Edit, diff, deploy, against environments named in the project.
4. **Promote.** The same file goes to staging, then production. `config diff --against <env>` compares two stores directly.
5. **Preview environments.** In CI, a pull request gets its own sandbox (`init --env pr-<n> --from staging`), the branch's `config.yml` is deployed, the storefront runs against it, and the sandbox is deleted on merge. Review apps for commerce. This is the workflow that shows why one tool is better than two: it needs Cloud provisioning, store credentials, configuration and a storefront in one pipeline.
6. **Drift.** `config status` shows, for every environment in the project, whether it still matches `config.yml`.

## 2. Store credentials: supplied as today

Decided on 2026-10-28: the config module uses the store token people already supply to Configurator, usually an app token created in the Dashboard. The CLI does not get store access from the Cloud login. That keeps the Cloud team out of the critical path, and every existing Configurator user can switch without new setup.

Amended on 2026-11-02: Cloud stores now also get a token from the Cloud login, the way the previous Saleor CLI did. The login is sent in the store's `Authorization-Bearer` header to create (or reuse) an app named `Saleor CLI`, and that app's token is saved under the ref. It runs as step 3, so `SALEOR_TOKEN` and saved tokens still win, and a store that refuses the login falls through to the prompt.

There are two APIs with different credentials:

- **The Cloud API** (`cloud.saleor.io`) creates and lists environments. `saleor login` gets its token. It is never sent as a store's `Authorization`; only step 3 sends it, as `Authorization-Bearer`, to make an app token.
- **A store's API** (each environment's `…/graphql/`) is what Configurator reads and writes. It needs a store token.

Credentials are resolved like targets:

1. `SALEOR_TOKEN`, if set. This is how CI keeps working: the same secret it holds today, under the name the CLI uses.
2. The token saved for this ref in the secret store.
3. For local stores, the admin login the CLI generated: `tokenCreate`, silently, because the CLI made that store. It is not swapped for a lasting app token as Cloud's login is: Saleor lets only a staff user install or create apps, so `app add` and `webhook listen` need the sign-in itself. The sign-in lasts 5 minutes; `webhook listen` signs in again to delete its app. For Cloud stores, an app token made with the Cloud login, as described above. This works through an optional `access(id)` capability in core, so the config module does not import the local module.
4. Interactively, a hidden prompt for the token, which says where to create one in the Dashboard (**Apps → Create app**, with the permissions the configuration needs). The CLI offers to save it under the ref.
5. Otherwise `STORE_AUTH_REQUIRED`, whose suggestion names `SALEOR_TOKEN` and the prompt.

Security rules: tokens go to the secret store, never into project files. The native commands take no `--token` flag, because argv ends up in shell history and agent logs. `saleor logout` does not touch saved store tokens; a separate command forgets them (open question 2). The preflight reads the token's permissions and names the missing ones before any change.

**Out of scope for now: getting store access from the Cloud login.** Cloud's "Continue with Saleor Cloud" sign-in could give the CLI a staff token, but only through the Cloud API's redirect allowlist or a copy-and-paste step. We are not building on that. If Cloud later offers a supported way, it plugs into step 3 through the same `access` capability, and nothing in the config module changes.

**Preview environments (loop 5)** need a token for a sandbox that did not exist a moment ago. Supplied tokens cannot cover that in general. One stopgap to verify: a sandbox created from a backup of staging carries staging's database, apps included, so staging's app token may work on the copy. Otherwise loop 5 waits for headless store access from Cloud.

## 3. The native command surface

Word: **`config`**, with `configurator` as an alias so `saleor configurator deploy` also works. Per `commands.md`, the words are what users type and the module is how the code is organised, and `config.yml` is the thing these commands act on. `saleor config` could read like CLI settings, as in `git config`, but the CLI has no settings and keeps none by design.

| Command | Kind | Replaces | Plan / result |
| --- | --- | --- | --- |
| `config pull [env]` | `ensure` (target: the file) | `introspect`, `recipe export` | create, update or none for `config.yml`. **Risk** when it would discard local edits that are not in the store: confirm or `--force`. `--from recipe:<name>` writes a recipe instead. |
| `config diff [env]` | `list` | `diff` | One item per operation: entity, name, action, fields. Exit 0 either way. `--against <env>` compares two stores. |
| `config deploy [env]` | `ensure` (target: the store) | `deploy`, `recipe apply` | Plan = the diff, action `update` or `none`. **Risk** = what deletions remove. **Notice** = it is a production environment. `--dry-run` replaces `--plan`. A partial failure is `DEPLOY_PARTIAL`, with per-entity details. |
| `config validate` | see below | `validate` | Offline. `CONFIG_INVALID` with `details.errors[]` (path, message). |
| `config status` | `list` | `introspect --drift-check` | One row per environment in the manifest: state, Saleor version, in sync / drifted / unknown. |
| `config recipes` | `list` | `recipe list`, `recipe show` | |
| `config schema` | `session` | `schema` | Written files also get a `yaml-language-server` `$schema` line, so editors validate without being set up. |
| (menu) | | `start` | The context-aware home menu replaces the wizard. |

Shared inputs: `--config <path>` (`SALEOR_CONFIG`), `--include` / `--exclude` sections, `--entity <Type/name>`, `--skip-media`. The target is `<env>`, the word after the command, as in every command: a manifest environment name or a store ref (a URL is proposed), or `SALEOR_ENV`, resolved the way `target.ts` resolves every target. Deletions follow the CLI's single confirmation rule, so `--fail-on-delete` is not needed.

The kinds need one decision. `diff` fits `list`. `validate`, and a CI gate on drift (`diff --check`, failing with `DRIFT_DETECTED`), fit no kind cleanly. Adding a read-only **`check`** kind is a core change that `conventions.test.ts` would enforce. The alternative is to bend `list`. (Open question 5.)

New error codes, added to `ERRORS` and never repurposed: `CONFIG_INVALID`, `DEPLOY_PARTIAL`, `DRIFT_DETECTED`, `STORE_AUTH_REQUIRED`, `STORE_AUTH_INVALID`, `UNSUPPORTED_SALEOR_VERSION`. Rate limits and network failures reuse `NETWORK_ERROR` and `UNAVAILABLE` (retry).

### `init`

The config module adds a **setup extension**, like the storefront module. Its question comes after the provider's: start from *the store as it is*, *a recipe*, or *a copy of another store's configuration* (`--recipe <name>`, `--from <env|ref>`). Its plan joins `init`'s plan, so `--dry-run` and the review show it. It deploys once the store is ready and writes `config.yml` and the manifest into the project folder. Its result goes under `data.config`.

Pre-warmed Cloud environments come with whatever database Cloud chose (`limitations.md`), and deploy deletes entities in a section that are not in `config.yml`. So deploying into a pre-warmed environment must either request an empty database (`--domain-label`) or merge, never delete silently. Decide this before the extension ships.

### The project manifest

`init --storefront` already makes a project folder, and `storefront.md` says it has no manifest yet because nothing reads one. Configurator is the first reader. The manifest records only what has no other home: names for environments, and which configuration file they use.

```yaml
# saleor.yml (committed)
config: config.yml
environments:
  dev: local:demo
  staging: cloud:acme/abc123
  production:
    store: cloud:acme/def456
    protected: true   # deploy always shows its plan and asks, even without deletions
```

This does not break the rule that the CLI remembers nothing between commands (`local.md`). The manifest is the user's file, visible and versioned, like `package.json`. Nothing is written to `~/.config`. The storefront's backend stays in its `.env`. Old Configurator never reads this file. `config.yml` gets no new keys: Configurator silently drops unknown top-level keys, and `introspect` rewrites the file from the store, so anything else in it would be lost.

## 4. Architecture: one engine, two front doors

```
saleor config …  (Effect module, native contract)        configurator …  (legacy bin, frozen contract)
        │                                                          │
        └──────── @saleor/configurator engine (Promise API) ───────┘
                     validate · introspect · diff · plan · apply · serialize · recipes · schema
                                           │
                               GraphQL client (urql + governor) → Saleor
```

**Wrap the engine; do not rewrite it now.** 35k lines of tested domain logic (comparators, deployment stages, attribute resolution, rate limiting) carry no user value when rewritten during the migration, and carry all of its risk. The config module wraps the engine in a `ConfiguratorEngine` service with `Effect.tryPromise`, and passes an `AbortSignal` so Ctrl-C (exit 130) stops between stages. The CLI's Effect lint rules apply to the module, not to the engine.

The engine API, roughly:

```ts
createEngine({ url, auth, fetch?, logger?, onProgress?, governor?, signal? }) → {
  validate(config: unknown): ValidationResult
  introspect(sections): Promise<SaleorConfig>
  diff(config, options): Promise<DiffSummary>
  plan(config, options): Promise<DeployPlan>     // diff + ordering + what is destructive
  apply(plan, options): Promise<DeployResult>    // partial failures are data, not exits
  serialize(config): string                      // stable YAML: pulls do not churn git diffs
  parse(yaml): SaleorConfig
  recipes: { list(), get(name) }
  schema(): JsonSchema
  supportedSaleor: "3.23"
}
```

`auth` is a function that returns a current token, not a fixed string. Supplied app tokens do not expire, but the local admin login gives staff tokens that last 5 minutes, and a deploy can take longer, so the engine asks again when the store rejects a token. urql's auth exchange already has a `refreshAuth` hook for this. The legacy front door passes `() => token`.

Rules for the engine: no `process.exit`, `console`, prompts, `process.argv` or `process.env`; no side effects at import time; no module-level singletons; errors are values with a stable `code`; file I/O stays at the edges. Each front door maps engine results to its own contract.

What has to change in Configurator to get there (from reading 3.23.2):

- `src/lib/env.ts` imports `dotenv/config`, and `src/cli/main.ts` loads `.env.local`, both at import time. Inside the CLI this would silently load a storefront's `.env` into `process.env`. Move both to the legacy front door.
- `src/commands/deploy.ts` calls `process.exit` from deep inside the handler, in nine places. Return results instead.
- `src/core/configurator.ts` drives spinners (`cliConsole.progress`). Emit progress events instead.
- `src/lib/ci-mode.ts` reads `process.argv` for `--json` and checks TTYs. Pass these in explicitly.
- `globalLogCollector`, `resilienceTracker` and the GraphQL governor's `GRAPHQL_*` environment variables are process-wide. Make them per engine; the legacy front door maps the variables.
- `ServiceComposer.compose(client, configPath)` ties services to a file through `YamlConfigurationManager`. The engine should take configuration objects; reading and writing files belongs to the front doors.
- `src/lib/graphql/client.ts` takes a fixed token. Take the `auth` function above.
- `src/modules/recipe/recipe-repository.ts` reads recipes from `dist/recipes` relative to `import.meta.url`. The CLI bundles into one file, so recipes become embedded data.
- Load the engine with a dynamic `import()` from the module's layer, so `env list` does not pay for urql, zod and the schema. `limitations.md` notes there is no startup budget yet; this is where one starts to matter.

**Where the code lives (updated 2026-10-30).** Configurator owns its engine, generated declarations, legacy CLI and release flow in `saleor/configurator`. This repository owns the native command surface and `src/modules/config/engine.ts`, a lazy adapter around the public `@saleor/configurator` entry. Upstream tests cover engine behavior; CLI tests cover the integration and host contract.

### Later: moving the engine onto Effect

Configurator would gain from the CLI's stack on its own merits:

- Typed errors instead of exception classes and `process.exit`.
- Structured concurrency and interruption for deployment stages.
- Retries and rate limiting as schedules rather than `bottleneck` plus urql's retry exchange.
- Services as layers that tests replace, instead of spying on `fetch` and `process.exit`.
- One stack for the people who work on both.

This is its own track, not part of the migration. It starts after Phase 2, once the native module has shipped and the compatibility suites guard every change.

The method is a strangler. The engine's interface stays where it is, and its insides move one piece at a time. While the legacy front door exists, it keeps calling a Promise façade (`Effect.runPromise` at the edge). Every step must pass V1, V2 and V7 unchanged. Order, from most leverage and least risk:

1. **Transport.** The GraphQL client, governor, 429 handling and retries become a `SaleorClient` service with schedules. The `auth` function becomes a service that refreshes tokens.
2. **Errors.** A tagged error per module replaces the `BaseError` hierarchy. The stable codes the engine already needs become the tags.
3. **Deployment pipeline.** Stages become effects, with structured concurrency, interruption between stages, and a span per stage.
4. **Services and repositories.** `ServiceComposer` becomes layers, one entity module at a time (attributes, product types, …), each moving with its tests.
5. **Configuration schema.** zod becomes Effect Schema, last. It is the largest surface: `schema.json`, `SCHEMA.md` and validation messages are all part of the legacy contract. V1 goldens pin every message and path.
6. **Flip.** The engine exposes Effect natively. The Promise façade remains only for the legacy bin, until the sunset.

## 5. Compatibility

"Compatible" has three levels, and the plan commits to each separately:

1. **Configuration files: forever, both directions.** Every `config.yml` valid for Configurator 3.23.x is valid for the CLI and means the same. Files the CLI writes are read identically by Configurator of the same Saleor line, with the same key order and quoting, so a team where one person uses `npx @saleor/configurator` and CI uses `saleor config` sees no churn.
2. **Behavior: forever.** Same configuration plus same store state gives the same GraphQL mutations, the same resulting store and the same diff.
3. **Interface: legacy front door only.** `npx @saleor/configurator …` keeps every command, flag, environment variable, `.env.local` loading, exit code, JSON envelope, report path, and the output that scripts parse (the GitHub Action reads its JSON with `jq`). The Action keeps working unchanged.

**The legacy contract is frozen**, for a structural reason: Configurator's major and minor follow Saleor's, so `@saleor/configurator` has no semver slot for a breaking change, and the Action installs `@latest`. Every deliberate behavior change therefore goes into the native front door only.

**Soft deprecation starts the day the config module ships** in a published CLI, at the end of Phase 2. From that release:

- The legacy bin prints one line on stderr, never on stdout and never in JSON mode, naming the `saleor config` command and linking the mapping guide.
- The README, documentation, skills and plugin lead with the CLI.
- New commands and workflows land only in the CLI. The engine, and with it the configuration format, stays shared.
- Nothing stops working, and the contract stays frozen.

`npm deprecate` waits for hard deprecation: it warns on every install, including the Action's. Hard deprecation and end of life come at a declared Saleor line, announced at least one line ahead. (Open question 4.)

**Saleor versions.** Configurator pins one CLI install to one Saleor minor. A workbench talks to many stores, and local stores can run any `--saleor-version`. The CLI already knows each store's `saleorVersion`, so before any network operation the config commands compare it with `engine.supportedSaleor`. Outside the supported range, they fail with `UNSUPPORTED_SALEOR_VERSION` and suggest `npx @saleor/configurator@<minor>`. Later, the engine can support N and N-1, or the CLI can load a version-matched engine on demand. The engine interface should be designed now so that this is possible.

### Mapping for people migrating

| Legacy | Native |
| --- | --- |
| `introspect --url U --token T` | `SALEOR_TOKEN=T saleor config pull U` (proposed: `<env>` accepting a URL) |
| `diff` (exit 1 on changes) | `config diff` (exit 0; `data` lists operations); `--check` to gate CI |
| `deploy --plan` | `config deploy --dry-run` |
| `deploy` (deletes unless `--fail-on-delete`) | `config deploy` (deletions need `--force` unattended) |
| `deploy --fail-on-delete` | `config deploy` without `--force`: `CONFIRMATION_REQUIRED` |
| `introspect --drift-check` | `config diff --check` / `config status` |
| `recipe apply X` | `config deploy --config recipe:X`, or `init --recipe X` |
| `recipe export X --output f` | `config pull --from recipe:X --config f` |
| `SALEOR_URL` | `SALEOR_ENV` (proposed: accepting a URL) |
| `.env.local` auto-load | none; `saleor.yml` + secret store, `SALEOR_TOKEN` in CI |
| A token from the Dashboard | The same token: `SALEOR_TOKEN`, or saved once per store; local stores need none |
| exit 2 (auth) | exit 1, `STORE_AUTH_INVALID` |
| exit 4 / 5 / 6 / 7 | exit 1, `CONFIG_INVALID` / `DEPLOY_PARTIAL` / `CONFIRMATION_REQUIRED` / (breaking: open) |
| `{command, exitCode, result, logs, errors}` | `{ok, data}` / `{ok: false, error}`; progress as JSON lines on stderr |

Native commands answer legacy flags with a `USAGE_ERROR` whose suggestion is the exact native command: `--plan` → `--dry-run`, `--token` → `SALEOR_TOKEN`. `--url U` is answered with `config … U`. Nothing is silently reinterpreted.

The `configurator` alias means `saleor configurator deploy` works, but with the native contract. The contract comes from the front door, never from a flag, so no `--legacy-output` switch exists for anyone to forget.

## 6. Verification: prove it, don't assume it

Principle: **the published 3.23.2 release is the oracle.** Every step is checked against what the old tool actually does, not against what we believe it does. Each layer catches what the one before cannot.

**V0. Contract inventory.** A reviewed, machine-readable `compat/contract.json`: every command, flag (default, environment variable, precedence), exit code per scenario, a JSON Schema for each command's envelope, files written (config, backups, report paths and names), TTY and non-TTY behavior, and the Action's inputs and outputs. Sources: code, `COMMANDS.md`, `AGENTS.md`, the README, and observed behavior. The inventory is the checklist for every layer below, and the migration guide is generated from it.

**V1. Golden characterization tests (black box).** A harness runs any binary as a subprocess with an isolated directory and environment, against a stateful mock Saleor GraphQL server. It captures stdout, stderr, exit code, files written, and the ordered GraphQL operations with their variables. Record goldens by running the harness against `@saleor/configurator@3.23.2` from npm. Normalize timestamps, durations, versions and report names, and nothing else. Scenario matrix: every command × success, no changes, invalid configuration, auth failure, network failure, 429s, partial failure, deletions with and without `--fail-on-delete`, include/exclude, entity filters, TTY vs pipe, `--json` vs `--text`, flag vs environment vs `.env.local` precedence. This is the same pattern as `src/main.test.ts` here, which "checks the exact write sequence".
- The legacy bin must match goldens **byte for byte**. The one allowed difference, from the soft-deprecation release on, is the deprecation line on stderr in text mode.
- The native module must match the **GraphQL operation log** exactly, and its results through the mapping table.

**V2. Differential tests against real Saleor.** This is the decisive layer: mocks only know what we told them. Use stacks from this CLI's own `saleor init --local` at pinned Saleor versions, with a recording proxy in front of the API. The corpus: `example.yml`, every recipe, `testconfig.yml`, `test-configs/`, spec fixtures, generated configurations (property-based, from the zod schema, aimed at attributes and references), and anonymized configurations from internal and demo stores, with consent. For each configuration C:
- `deploy(old, C)` on fresh store A and `deploy(new, C)` on fresh store B. Then `introspect(A) ≡ introspect(B)` after stripping IDs, and the mutation logs are equal per stage. Compare logs as multisets where the engine runs requests in parallel.
- **Idempotency**: deploying C again sends zero mutations, with both tools.
- **Cross-reading**: `diff(new)` against A is empty, and `diff(old)` against B is empty. This is what makes mixed teams safe.
- **Serialization**: `pull(new)` and `pull(old)` from A are byte-identical.
- **Transitions**: pairs C1 → C2, including deletions, renames, reordering and attribute value removal.

Reset stores from a database snapshot (template database or volume snapshot), not by re-running setup. Run nightly and on every engine change, for each supported Saleor minor.

**V3. Engine suite.** Configurator's existing 34k lines of tests move with the engine and stay green throughout the extraction. They are the fastest feedback, and they run before V1 and V2.

**V4. Native conformance.** The config commands pass `conventions.test.ts` (kinds, targets, confirmation, dry runs). End-to-end tests in `src/main.test.ts` style cover mock Saleor plus mock Cloud. The credential matrix covers:
- `SALEOR_TOKEN`, a saved token, the prompt and its offer to save;
- local login with the admin account, including a staff token that expires mid-deploy;
- agent mode, which fails with `STORE_AUTH_REQUIRED` and never prompts;
- the existing rule that the Cloud token never reaches a store.

Plus a catalog snapshot, the agent JSON shapes, and a rule: **a dry run sends zero mutations**, asserted from the operation log.

**V5. Shadow runs.** `diff` is read-only, so comparing it in production carries no risk. A hidden `config diff --compare-legacy` runs both engines against the same store and reports any divergence. Run it on internal sandboxes, the demo store, and design partners' staging stores. Optionally add a `shadow: true` input to the Action that runs it next to the real step and writes divergences to the job summary. This finds what no corpus contains: real stores' data.

**V6. Live smoke.** Extend `pnpm test:live`: create a Cloud sandbox, give it a store token, `config deploy` a recipe, check that `config diff` is empty, delete the sandbox. Creating the token is manual until Cloud offers headless store access. Never run it in pull request CI.

**V7. Performance and rate limits.** Request count and wall time for each corpus configuration stay within a set tolerance of the legacy release. With the mock server injecting 429 responses, the governor's backoff behaves the same.

## 7. Phases and gates

Each phase ends at a gate. A gate is evidence, not a date.

**Phase 0: freeze the contract.** Build V0 and the V1 harness, and record goldens from 3.23.2.
*Gate:* goldens recorded and reviewed; the contract inventory signed off by the Configurator maintainers; the spike has answered the three unknowns in section 2.

**Phase 1: extract the engine (no visible change).** Move the code into the monorepo with its history. Apply the refactors listed in section 4 behind the legacy front door. Publish a 3.23.x patch release built from the new structure.
*Gate:* V3 green; V1 byte-identical; V2 old-vs-new green on the full corpus; the Action unchanged and passing on a sample repository.

**Phase 2: native module and the parity release.** `config validate|pull|diff|deploy|recipes|schema` for local, URL and Cloud stores, with `<env>`, `SALEOR_TOKEN`, local sign-in, error codes, catalog entries, menu entries and the version preflight. Every existing Configurator user can switch: they hold a token already. Make the CLI installable and publish it (`limitations.md`: it is not yet). Generate the mapping guide from V0, and point the skills and the Claude plugin at `saleor config`. **Soft-deprecate `@saleor/configurator` in the same release.**
*Gate:* V4 green; V1 operation logs equal for native; V2 native-vs-legacy green on local stacks; mapping guide complete; the team has used it for real work.

**Phase 3: the workbench loops.** The `saleor.yml` manifest, the `init` extension (`--recipe`, `--from`), `config status`, `--against`, the context-aware menu, and a v2 Action built on `saleor` while the v1 Action keeps working.
*Gate:* V6 green; V5 clean across an agreed set of real stores for an agreed period.

**Phase 4: preview environments.** Headless store access from a Cloud credential, when Cloud provides it, and the pull-request sandbox workflow (loop 5) as a documented Action recipe.
*Gate:* a pull request in an internal repository gets a sandbox, a deployed configuration and a storefront, and the sandbox is deleted on merge, without a person.

**Phase 5: hard deprecation and sunset.** At the declared Saleor line, run `npm deprecate` and publish a last legacy release whose output only points to the CLI. Keep the engine package.

**Track E: the engine onto Effect.** Starts after Phase 2 and runs alongside, in the order given in section 4. Each step passes V1, V2 and V7 unchanged.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A supplied token lacks permissions a configuration needs | The preflight reads the token's permissions and names the missing ones before any change |
| Preview environments wait on headless access from Cloud | Phase 4 depends on nothing else; CI against existing environments works with the app tokens it holds today |
| The extraction regresses deploy behavior (deep `process.exit`, singletons, import-time side effects) | Goldens and differential tests exist **before** the first refactor; Phase 1 has no visible change |
| A legacy regression reaches every pipeline at once (Action installs `@latest`) | Release legacy only after V1 and V2 pass; publish to a `next` dist-tag first |
| Mixed teams churn `config.yml` | Byte-identical serialization and cross-reading checks (V2) |
| A store's Saleor version is outside the engine's range | Preflight with `UNSUPPORTED_SALEOR_VERSION` and the pinned legacy command as the hint |
| Deploying a recipe into a pre-warmed Cloud environment deletes what Cloud put there | Empty database or merge semantics for the `init` extension, decided before it ships |
| Two output contracts to maintain | The legacy front door is a thin, frozen adapter; the engine is shared; V1 pins both |
| Startup cost for every command | Engine behind a dynamic `import()` |
| People migrating CI are surprised that deletions need `--force` | `CONFIRMATION_REQUIRED` says so and names the flag; the mapping guide leads with it |

## Prototype (2026-10-28)

Uncommitted, on `t3/configurator-workbench-migration`. It shows that the engine runs in-process behind the CLI's conventions; it is not the Phase 1 extraction.

- **Engine.** `packages/configurator` is Configurator 3.23.2's source (copied from the tag, without history), as a workspace package. Three small changes keep the legacy CLI's behavior and let a host stay silent: `dotenv` loads in `src/cli/main.ts` instead of at import time; the deploy pipeline takes a progress reporter. The new entry `src/engine.ts` (`validate`, `serialize`, `createEngine → pull, diff, deploy`, `classifyError`) prints, prompts and exits nothing. It builds with `pnpm build:engine` (tsup) to `dist/engine.js`. Its types are written by hand in `engine.d.ts`, because generated declarations cannot name the zod-derived config types.
- **CLI.** `src/modules/config` adds `config validate|pull|diff|deploy`, with the alias `configurator`, offered in the menu only beside a `config.yml`. The engine is loaded with `import()` on first use: the bundled build puts it in its own 800 KB chunk, and startup is unchanged. In core: the store token resolution from section 2 (`store-access.ts`), an optional `token` on store sources (local signs in as its admin), masked prompts, and `risk` on `ensure` so a deploy that deletes takes `--force`. New codes: `CONFIG_INVALID`, `DEPLOY_PARTIAL`, `STORE_AUTH_INVALID`, `STORE_AUTH_REQUIRED`, `STORE_ERROR`, `UNSUPPORTED_SALEOR_VERSION`.
- **Checked** against a disposable `local:cfgproto` (Saleor 3.23.41): pull, then diff with no differences; create an attribute, a product type and a category; a second deploy that does nothing; a deletion refused without `--force`; a pull refused when it would overwrite edits; a bad token (`STORE_AUTH_INVALID`), a missing file, an invalid file, an unknown store; the bundled `dist/saleor.mjs`. Lint, typecheck and the 237 existing tests pass. No new tests yet.

What it found, for the plan:

1. **`deploy` does less than `diff` says.** Some entity types are create-only: a category whose name changed is not updated, and a category removed from the file is not deleted. Legacy only says "some items marked for deletion may not have been removed". The prototype re-diffs after applying, reports what was applied, and lists what still differs. Before Phase 2, the engine needs a table of which entity types it can update and delete, so a plan shows only what it will do. Until then, a deletion that never happens keeps asking for `--force`.
2. **Every bundled recipe fails 3.23.2's own checks.** Four of seven fail the schema; `b2b`, `fashion` and `marketplace` pass the schema but fail the preflight checks `deploy` runs (inline attribute definitions). `recipe apply` still works, because it uses an older path (`configurator.push()`) without those checks. Two deploy paths have to be pinned by V1, and the recipes fixed or migrated before `init --recipe`.
3. **Legacy `validate` is weaker than `deploy`.** It checks the schema only; `deploy` adds preflight checks. Native `config validate` runs both, a stricter result to list in the mapping guide.
4. **Legacy refuses `http://` store URLs** (`Must use HTTPS`), so it cannot reach the CLI's local Docker stores at all. The native module can, which makes local stores the cheapest V2 targets.
5. **No way to replace a saved store token** yet; a rejected one has to be overridden with `SALEOR_TOKEN`. Open question 2 covers the command.

## Prototype, part 2: one experience (2026-10-29)

Same branch, uncommitted. The first prototype worked but felt like a second tool inside the CLI: a ref on every command, YAML written by hand, nothing linking `init` to configuration. This part makes store, configuration and storefront one journey.

**What a person sees now.**

```sh
saleor init --local                  # where the store runs, then: "What should the store contain?"
                                     #   Describe it in plain words (drafted by Claude Code or Codex)
                                     #   Copy another store's configuration · Use Saleor's sample data
                                     #   (without a coding agent, "Answer a few questions" replaces the first)
                                     # → review in words → deploy → storefront on the configuration's channel
saleor config edit "add a winter collection with the jacket and the shoes"
saleor config deploy                 # no ref: the project's environment
saleor config status                 # every environment: in sync, or how many changes to deploy
saleor                               # menu headline: "Project coffee · local · in sync as of 6 min ago"
```

**Who writes the configuration.**

- **An agent running the CLI** (`--agent`, or detected) writes it itself. `init --describe "…"` saves the new store's actual configuration as `config.yml` and hands back the description with next steps; `saleor config guide` has the rules and a complete example. The CLI starts no other agent unattended.
- **A person with Claude Code or Codex installed** gets a draft from it. The CLI runs `claude -p --tools ""` or `codex exec --sandbox read-only` with the guide, the description and (for edits) the current file. The agent only answers with YAML; it has no tools and sees no token. The CLI checks the answer with the engine, sends problems back for up to three attempts, shows a review in words, and writes only what the person accepts. Without a terminal, `--with claude|codex` is the consent to start one.
- **A person without one** answers three questions (what they sell, where, sample products or not). Building blocks (`blocks.ts`: five kinds of store × five regions) make a configuration that passes the engine's checks in every combination, and deploys: channels, warehouses, shipping, attributes, product types, categories, a few products, the `featured-products` collection and `navbar` menu the storefront template reads. They replace the recipes, which fail Configurator's own checks.

Drafts for a new store are merged onto what the store already has (by slug or name, never removing), so the first deploy never wants to delete anything. Edits keep the file's key and entry order, so their git diff is only the change (checked: three lines for "add a Gloves subcategory and put the tee in the winter collection").

**Sample data.** "Use Saleor's sample data" loads Saleor's demo catalog, orders and customers into the new store through an optional `populate` capability on store sources. Local stores run the same bootstrap as `init --local --sample-data`. Cloud stores call the Cloud API's `populate-database` action and wait for its task. The project's `config.yml` is then pulled from the store, so it starts in sync.

**What the agent did is visible.** Every drafting round prints one line, for example `Claude Code · claude-opus-5-5 · 33 s · $0.18 · session ad7f5869…7d62`, then the command that opens the conversation (`claude --resume <id>`, `codex resume <id>`). The details come from Claude Code's `--output-format json` (session, per-model usage, cost) and Codex's `--json` events (thread, tokens); Codex's model comes from its `config.toml`. Fix-up rounds continue the same session, so one session holds the whole draft. Results carry the same details as `session` in JSON.

**Projects.** `saleor.yml` (in `core/project.ts`) names environments; `init`, the first pull or deploy write it. Commands take an environment as their first word, default to the project's only one, or ask when there are several; a store ref works in its place. Which file was last deployed where is kept per user (`~/.config/saleor/projects.json`), for the menu headline and `config status`.

**Plans say what will happen, in words.** "Create product type "Apparel" (attributes)", with what a deploy leaves alone and why. After applying, the CLI compares again and reports what changed, what was planned but skipped, and runs one more pass when a first one left planned changes behind (stage order: a collection is created before its products). `pull` explains what changed in the store since the file was written; when the store already matches, it says the file is only reformatted instead of warning about lost edits.

**Checked live:**
- **The full `init` with a description**, drafted by Claude Code, on a new local store with a storefront. It took 4 min 40 s; the deploy created 26 entities for a coffee roaster (UK and EU channels, beans with origin and roast, brewing gear, six products), and the storefront got the `uk` channel. Status afterwards: in sync.
- **The agent path**: `init --describe` in agent mode, then a Claude Code session given the guide wrote the file. It validated and deployed (21 created), and was in sync after one run.
- **Two `config edit` rounds** with Claude Code. Both passed the checks on the first try, and both deployed to "no differences".
- **The building blocks** for clothing in the US and Canada, deployed and converged.
- **The questions path in a pseudo-terminal** (`expect`): the menu, the three questions and the review rendered correctly. The run did not get past "Use it?", because keystrokes through `expect` are unreliable with the CLI's menu prompt; the deploy after it is the same code the other paths checked.
- **Tests:** lint, the Effect diagnostics and typecheck pass; 300 CLI tests (56 new: every block combination through the engine's checks, merging, ordering, the difference filter, the capability rules, descriptions, projects); Configurator's 1,472 tests.

**What it found** (beyond part 1):

1. **The engine reports differences that are not changes**, so a file that `pull` did not write never converges: fields the file leaves out, values Saleor fills in (`publishedAt`), attributes in another key order, identical shipping methods. The adapter keeps only differences where the file asks for something the store lacks (`meaningful` in `engine.ts`). This belongs in the engine's comparators.
2. **Deploy never deletes a top-level entity**, of any type: the only deletions are nested (shipping methods, menu items, products in a collection). Of a category's changes, it adds subcategories but never renames. Plans now leave both out, so deploys no longer need `--force`. `--fail-on-delete` in the legacy tool guards against something that cannot happen.
3. **One invalid warehouse fails every warehouse in its chunk** (`Promise.all` per chunk), and every new store's default warehouse is "invalid" (no street address). So any deploy that touches warehouses failed on a freshly pulled store. Patched in the engine copy: existing warehouses without an address are left as they are, and only new ones are validated.
4. **Plain-text attribute values were never read back** (`value: ""` with `??` instead of `||`), so they showed as differences forever. One-character fix in the engine copy.
5. **The deploy stages run in a fixed order that does not respect references** (collections before products). The second pass covers it; the engine should order by dependency.
6. **Saleor requires a state or province for some countries** (US, CA). The guide says so; the blocks include it.
7. **Configurator's own docs teach the format its checks reject** (`example.yml` and `SCHEMA.md` define attributes inline). The guide states the rule explicitly; agents follow it.
8. **Unrelated to configuration:** the storefront template's `pnpm install` fails in projects `init` makes, because `husky install` looks for `.git` in `storefront/`, while the CLI puts the repository at the project root.

**Not done:**
- **The interactive flows have not been completed in a real terminal**: accepting a review ("Use it?"), the "Describe it" draft loop, and `config edit`'s review. Drafting, checking, writing and deploying behind them were exercised with `--with` and without a terminal.
- **The storefront switching channels after a deploy** is a hint (`saleor storefront use <env> --channel …`), not automatic.
- **Engine patches 3 and 4** originally lived only in the copied source. The library dependency now supplies those fixes upstream.

## Library integration (2026-10-30)

[Configurator PR #187](https://github.com/saleor/configurator/pull/187) merged the public library API. The CLI now imports the package root: `validate`, `serialize`, `SUPPORTED_SALEOR`, `classifyError` and `createConfigurator({ url, token })`. Pull uses `introspect()`; diff and deploy call the corresponding instance methods. The adapter maps failures to CLI codes and keeps the existing project, token, preview and output behavior. Returned deploy results must pass both `exitCode === 0` and `overallStatus === "success"`.

The copied `packages/configurator` workspace is removed. The library remains lazy-loaded and is bundled into the CLI build. The existing difference filter, capability descriptions and post-deploy comparison remain host policy until upstream exposes those guarantees. The library does not currently offer cancellation or safe concurrent deployment; the CLI does not add either guarantee.

**Published dependency.** The CLI pins `@saleor/configurator` to npm version `3.23.3`, which includes the public library API. The registry package supplies the library, declarations, and upstream license; no vendored archive or sibling checkout is required. `pnpm-lock.yaml` records the registry package integrity.

**Verified at library integration:** clean frozen-lockfile installation and public API import; 306 source tests; 73 tests against the bundled CLI; TypeScript, CLI-scoped Biome/Oxlint and Effect diagnostics (no errors or warnings). New integration tests run the installed library against a mocked GraphQL transport for pull, diff, deploy, convergence and returned deployment failures. Process tests check both command names, offline validation, JSON output, errors and dotenv isolation. No live-store verification was repeated for this change. Generated storefront projects are not part of the CLI source or this integration.

## Open questions

1. **Preview environments.** Does a sandbox created from a backup of staging accept staging's app token? If not, loop 5 waits for Cloud to offer store tokens for new environments; until then, it is not planned.
2. **Store token commands.** Saving and forgetting a store token belong to core, because storefronts need them too. What are they called, for example `saleor token set|remove <env>`?
3. **Sunset:** which Saleor line is the last for `@saleor/configurator`?
4. **Kinds:** add a read-only `check` kind for `validate` and `diff --check`, or bend `list`?
5. **Breaking changes:** legacy `--fail-on-breaking` (exit 7) has no native equivalent yet. Is it a risk on the plan, or a separate code?
