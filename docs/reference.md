# CLI reference

Detailed output formats, automation conventions, and local store options.

## Conventions

Agents and scripts should explicitly pass `--agent` (shorthand for `--json --no-input`). Discover commands and their inputs with `saleor commands --agent`; automatic agent detection is only a fallback. Missing inputs produce errors rather than questions. These flags do not bypass confirmation of deletions.

Explicit `login` still waits for browser approval until the device code expires. Use `login --no-browser` to print the link without launching a browser, or supply `SALEOR_CLOUD_TOKEN` for unattended authentication.

- **Output.** Results go to stdout: text in a terminal, JSON (`{"ok": true, "data": …}`) otherwise or with `--json`. Errors are `{"ok": false, "error": {code, message, suggestion, retry, details?}}` in JSON, or a `✗` line on stderr in text. Progress goes to stderr; in JSON mode each progress message is one JSON line (`{"event": "progress", "message": …}`), and `login` emits `{"event": "login", "verificationUrl", "userCode", "expiresAt"}` before it waits for approval. Help (`--help` or `saleor help <command>`) and `--version` go to stdout. `saleor commands --json` describes every command (its kind and safety), flag (with defaults and environment variables), exit code, error code (with its exit code and whether retrying helps) and store state.
- **Instances.** Every command that shows a store, Cloud or local, returns the same fields: `kind` (`cloud` or `local`), `ref`, `name`, `state`, `ready`, `graphqlUrl`, `dashboardUrl` and `saleorVersion`, with provider-specific fields next to them (`key`, `organization`, `project`, … for Cloud; `mailUrl`, `admin`, … for local). `state` is `ready` (the API answered during the command), `running` (the provider reports it running; not contacted, as in `env list`), `starting`, `busy`, `maintenance`, `stopped` or `incomplete`.
- **Exit codes.** `0` success, `1` failure (see `error.code`), `2` the command line must change: an invalid value (`USAGE_ERROR`), a missing target (`CONTEXT_MISSING`, with the choices in `error.details.choices`) or an ambiguous name (`AMBIGUOUS_TARGET`). `75` started but not finished yet (`NOT_READY`; run the same command again to keep waiting), `130` interrupted.
- **Environment variables.** `SALEOR_ENV` fills `<env>`, the store a command acts on (a name from `saleor.yml` or a ref), in every command that takes it, except removals: `env stop` and `env remove` act only on what the command line names. `SALEOR_ORG` and `SALEOR_PROJECT` fill `--org` and `--project` in `init` and `env add`.
- **Create and delete.** Creating something that exists with the same settings reuses it; different settings fail with `NAME_CONFLICT` naming the setting. Creates return the resource with `created`. Removals and stops return `{action, existed, target}`; something that does not exist gives `action: "none"` and succeeds.
- **Confirmation.** Anything that deletes data asks in a terminal and needs `--force` otherwise (`CONFIRMATION_REQUIRED`, with the command to run). Nothing else asks for confirmation.
- **Notices.** Something worth knowing before a change, such as that a new environment in a project outside the free plan might be charged depending on the plan, is said once right before it happens: in the `--dry-run` preview (`notice`), in the review before creating, or on stderr.
- **Waiting.** `--timeout <seconds>` bounds how long a command waits for work it started; the work carries on after that. `--timeout 0` checks once.

For unattended use, set `SALEOR_CLOUD_TOKEN` to a Cloud API token from the Cloud dashboard. It overrides any saved login. Cloud tokens do not grant access to the store API.

## Examples

Commands read as `saleor <noun> <verb> [<env>]`:

| Command | Does |
| --- | --- |
| `init` | Creates a project and its first store, and prints how to reach it: a project and sandbox in Saleor Cloud, or with `--local` a store in Docker. Explicit names support retries. |
| `env list` | Lists every store the CLI can reach, local and Cloud, with its state and URLs; a project's environments first, with their names. |
| `env add <name>` | Sets up a store for a new project environment (Cloud by default, `--local` for Docker) and names it in `saleor.yml`. |
| `env start`, `env stop` | Starts a local store (creating it from `saleor.yml` when needed) or stops it, keeping its data. |
| `env remove` | Deletes a store and its data: a local store, or a Cloud sandbox. |
| `config status`, `diff`, `deploy`, `pull`, `edit`, `validate` | Keeps a store's configuration as code in `config.yml`. |
| `storefront create`, `storefront use` | Creates a storefront from the Saleor template connected to a store, or points an existing one at another store. |
| `api call` | Sends one GraphQL request to a store's API, with its token, and prints the data. |
| `webhook listen` | Prints a store's webhooks as they arrive, through a temporary app, and can forward them to your app. |
| `login`, `logout` | Saves or removes the Cloud login. |

`<env>` names a store: a name from `saleor.yml`, or a ref (`local:<name>`, `cloud:<org>/<env key>`) as `env list` prints it. `saleor commands` describes every command for agents. Manage plans, production environments and empty projects in the Saleor Cloud dashboard.

See every store:

```sh
pnpm saleor env list
```

Create another sandbox in a project, or print the addresses of an existing one:

```sh
pnpm saleor init --org my-org --project my-store --env preview
```

Inside a project, add it as an environment instead, so commands can call it by name:

```sh
pnpm saleor env add preview --org my-org --project my-store
```

Check provisioning once without waiting:

```sh
pnpm saleor init --org my-org --project my-store --env preview --timeout 0 --json
```

Delete a sandbox:

```sh
pnpm saleor env remove cloud:my-org/<env key> --force
```

Deletion is permanent. Production environments cannot be deleted through the CLI. New projects use the free plan. Before creating an environment in a project on another plan, the CLI says that you might be charged, depending on your plan; it does not ask.

Every command that creates, starts, stops or removes something takes `--dry-run`. It resolves the target and validates the request without changing anything or asking questions, then prints the plan in the requested output format. Cloud previews need authentication and make read requests. The JSON is `{dryRun, action, state, target, destructive, warning, notice, details}`; `target` is `{type, name, id, scope}`, and a new resource has no `id` yet.

```sh
pnpm saleor env remove staging --dry-run
pnpm saleor init --org acme --project my-store --env preview --dry-run
pnpm saleor env remove local:demo --dry-run
```

`saleor commands --json` publishes `kind`, `destructive` and `warning` for each command. Only commands that can lose data are destructive and take `--force`: `env remove`, and `config pull` when it replaces edits. `env stop` keeps data and asks nothing.

See `pnpm saleor --help` for more commands and [known limitations](limitations.md).

## Local stores

`init` creates a store, with an optional storefront. Cloud is the default for existing scripts; `--local` selects Docker, and `--cloud` selects Cloud without the question a terminal otherwise asks:

```sh
pnpm saleor init --local --name demo --sample-data
pnpm saleor env list
pnpm saleor env stop local:demo
pnpm saleor env start local:demo
```

`init --local` prints the addresses and the admin login. Use `env start` to start an existing store or print its connection details again. `env list` shows each store's state and URLs. Stopping preserves the database, media and login. To permanently remove them, use `env remove local:demo` and confirm (or pass `--force` for unattended use).

The first setup downloads pinned images and migrates the database, which can take several minutes. `--timeout` limits the GraphQL readiness wait after setup; exit 75 means the containers are still starting and the same command can be retried. `env list` reports readiness without waiting. Ports are allocated automatically and published on loopback only: the API, the Dashboard and a Mailpit inbox for the store's emails. If another program takes one of them while the store is stopped, `init --local` names the port; stop that program or add `--new-ports` (to `init --local` or `env start`). State and private Docker environment files live under `SALEOR_CONFIG_DIR` (by default `~/.config/saleor`); generated credentials use the CLI secret store, and Docker also needs private environment files to start the services. These stacks are for local development.

The API defaults to 3.23.41; `--saleor-version <major.minor.patch>` chooses another version for a new store. The bundled Dashboard stays pinned to 3.23.0, so compatibility with other API series is not guaranteed. Existing stores keep their version; use a new name for another version. `--sample-data` can be added to an existing store. If the first setup failed (for example, a version that does not exist), running `init --local` again with corrected options replaces them.

Cloud credentials authenticate with the Cloud API and cannot be used as store API credentials.

## Storefronts

`storefront create` downloads [saleor/storefront](https://github.com/saleor/storefront) as it is on `main` (a fresh copy, without the template's history) and connects it to one store:

```sh
pnpm saleor storefront create local:demo
pnpm saleor storefront create cloud:acme/env1 --dir shop --channel eu
```

- **Stores** are given as `<env>`: a name from `saleor.yml`, or a ref as `env list` prints it: `cloud:<org>/<environment key>` or `local:<name>`. In a terminal, a person picks from every Cloud environment and local store; Cloud offers a login first when needed.
- **`.env`.** The CLI creates `.env` from the template's `.env.example`, as the template's README says, so its documented defaults stay. It sets `NEXT_PUBLIC_SALEOR_API_URL` and `NEXT_PUBLIC_DEFAULT_CHANNEL` (default `default-channel`), and writes the store it is connected to in a header line: `# saleor: store=<ref>`. The template's `.gitignore` keeps `.env` out of git.
- **Checks.** The channel is checked against the store when it answers. A store that is stopped, a channel that does not exist, a template that no longer mentions a key the CLI sets, a missing git or a failed install are warnings in `data.warnings`, never failures: the files are written either way.
- **Git and packages.** A new storefront becomes a git repository with the template committed, unless it is inside one already. Dependencies are installed automatically with pnpm, through Corepack if pnpm itself is missing. Existing dependencies are kept on retries; a failed install can be retried.
- **Running it again** on the same directory and store reuses the files and retries dependency installation. A directory with other files is refused (`NAME_CONFLICT`), and so is a storefront connected to another store; use `storefront use` to switch its backend, or choose another directory with `--dir`.
- The result lists the next commands (`next`) and the environment variables a host needs to deploy it.

`init --storefront` (asked last in a terminal) does the same for the store `init` sets up, in a folder for the project: the current directory when it is empty, else `./<project>`, with the storefront in `storefront/` and one git repository for the folder. The template downloads while the store is being set up; if `init` stops waiting for the store, running it again connects the downloaded storefront.

`pnpm saleor storefront use` shows the current backend and asks which store to use. Defaults to the project's storefront, or the current directory outside a project; pass `--dir` when running elsewhere. `storefront use staging` or `storefront use cloud:<org>/<key>` selects the backend explicitly. `--channel` overrides the current channel. `--dry-run` previews the change without writing. Restart the development server afterward. This command only updates the local storefront's `.env`; it does not modify Cloud environments or hosted deployments. Exploratory navigation offers it only inside a storefront directory.

## Store API and webhooks

`api call` and `webhook listen` use the store's own API. Its token comes from `SALEOR_TOKEN` (only for commands that reach one store), then a token saved for the store, then the store's own sign-in (local stores sign in as the admin the CLI created), then a prompt in a terminal that offers to save it. Without a terminal and without a token, they fail with `STORE_AUTH_REQUIRED`, saying which permissions to give the token. Saleor Cloud does not issue store tokens to the CLI yet: create an app token in the store's Dashboard.

- **`api call`.** The document comes from `--query`, or `--file <path>` (`--file -` reads stdin); `--variables` takes a JSON object. Queries and mutations are sent as given, without asking. `data` is the GraphQL answer's data. An answer with errors fails: `STORE_AUTH_INVALID` when the token lacks a permission (Saleor's message names it), `STORE_ERROR` otherwise; both carry `{data, errors}` in `error.details`. `--anonymous` sends no token.
- **`webhook listen`.** It needs `--events` (comma-separated; `order_created`, `ORDER_CREATED` and `order.created` are the same) or `--subscription <file>`, whose events are used when `--events` is left out. It makes an app named `Saleor CLI listener <id>` with every permission the token's owner may grant, adds a webhook to a local HTTP listener on a random path, and deletes the app on Ctrl+C, SIGTERM or after `--count` deliveries; Ctrl+C exits 130. Each delivery shows Saleor's event, its payload and, with `--forward-to <url>`, your app's answer; the store gets that answer, so retries behave as they would for your app. In json mode, each delivery is a JSON line on stderr (`{"event": "webhook", "delivery": {event, receivedAt, headers, payload, forwarded}}`), and the result lists the deliveries with the app and webhook.
- **Reaching this computer.** A local store delivers to `host.docker.internal`; local stores allow it (`HTTP_IP_FILTER_ENABLED=False`). On Linux the listener accepts connections from the Docker bridge, so it listens on every interface; the random path keeps others out. Any other store needs a tunnel: `--port <n>` for the local port, `--public-url <url>` for the tunnel's address.

## Project context

`init` creates a project with `saleor.yml`, `config.yml`, a short `AGENTS.md`,
`CLAUDE.md`, and ignore rules. Existing configuration and agent instructions are
preserved. Commands discover the project from nested directories. Explicit
`--dir` paths remain relative to the current directory.

```yaml
name: my-shop
environments:
  local:
    kind: local
    saleor: "3.23.41"
  staging: cloud:acme/environment-key
components:
  storefront:
    kind: storefront
    config: config/saleor/storefront-content.config.yml
```

Every key is there because a command reads it. Keys with a default are written
only when they differ from it: `config` (`config.yml`), a component's `path` (its
name, so `storefront` lives in `storefront/`), a local environment's `configure`
(`on-create`; `never` opts out), and `version` (1).

`saleor.yml` says where things are, not how they are built, so a project works in
any repository layout (a plain folder, or a pnpm, Turborepo or Nx workspace the
project already uses). `components` lists what connects to the project's stores:
`init --storefront` and `storefront create` inside a project add the storefront,
with the template's own content configuration when it has one. The template
commit it was downloaded at goes in the first commit's message and the command's
result, not in `saleor.yml`, since no command reads it. Each component keeps its own packages, scripts and
lockfile; the CLI does not write workspace files. Which store a component is
connected to is not recorded here: that is each checkout's choice, in the
component's ignored `.env`. Commands find the storefront where `components` says,
else in `storefront/`. A manifest from before `components` with
`storefront: { path }` is still read, and moves to `components` the next time a
component is recorded. Unknown keys are reported on stderr, and a manifest with a
`version` newer than the CLI reads is refused.

`config validate`, `diff`, `deploy` and `status` cover every file the project
deploys: `config.yml` first, then each component's `config`, in order. `--config`
names one file instead. `config pull` writes `config.yml` only. A new store
(`init`, `env add`, and `env start` unless `configure: never`) gets `config.yml`
only; deploy component content to it with `config deploy <env>`.

`env start local` provisions this checkout's local environment using the declared Saleor
version. Unless `configure: never`, it applies `config.yml` before setup is considered
complete; failures can be retried with the same command. Subsequent starts preserve data and configuration changes; apply edits
explicitly with `config deploy local`. A version mismatch requires an explicit
recreation or migration; starting does not silently upgrade the database.

The environment definition is committed. Its binding to a local store lives
in the user's CLI state, keyed by checkout path. Separate clones get separate
stores. To adopt an existing named store, run `init --local --name <name>`
inside the project. Legacy string references remain supported.

`env stop` and `env remove` act only on the environment they are given
(`env remove local`); without one, they ask, or list the choices. Removing a
local environment retains its definition so `env start` can recreate it; removing
a Cloud environment removes its name from `saleor.yml` too. Removal still requires
confirmation. `env add review --local` adds another local definition, with an
store named after the project.

`storefront use staging` selects a project environment for the local storefront.
This does not select a deployment target for Configurator or other components.
`config diff staging` and `config deploy staging` use the same environment aliases.
Credentials remain outside the project manifest.
