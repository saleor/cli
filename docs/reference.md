# CLI reference

Detailed output formats, automation conventions, and local instance options.

## Conventions

Agents and scripts should explicitly pass `--agent` (shorthand for `--json --no-input`). Discover commands and their inputs with `saleor commands --agent`; automatic agent detection is only a fallback. Missing inputs produce errors rather than questions. These flags do not bypass destructive-action or paid-plan confirmation requirements.

Explicit `login` still waits for browser approval until the device code expires. Use `login --no-browser` to print the link without launching a browser, or supply `SALEOR_CLOUD_TOKEN` for unattended authentication.

- **Output.** Results go to stdout: text in a terminal, JSON (`{"ok": true, "data": …}`) otherwise or with `--json`. Errors are `{"ok": false, "error": {code, message, suggestion, retry}}` in JSON, or a `✗` line on stderr in text. Progress goes to stderr; in JSON mode each progress message is one JSON line (`{"event": "progress", "message": …}`), and `login` emits `{"event": "login", "verificationUrl", "userCode", "expiresAt"}` before it waits for approval. Help (`--help` or `saleor help <command>`) and `--version` go to stdout. `saleor commands --json` describes every command, flag (with defaults and environment variables), exit code, error code and instance state.
- **Instances.** Every command that shows a store, Cloud or local, returns the same fields: `kind` (`cloud` or `local`), `ref`, `name`, `state`, `ready`, `graphqlUrl`, `dashboardUrl` and `saleorVersion`, with provider-specific fields next to them (`key`, `organization`, `project`, … for Cloud; `mailUrl`, `admin`, … for local). `state` is `ready` (the API answered during the command), `running` (the provider reports it running; not contacted, as in `env list`), `starting`, `busy`, `maintenance`, `stopped` or `incomplete`.
- **Exit codes.** `0` success, `1` failure (see `error.code`), `2` a command line the CLI cannot run (`USAGE_ERROR`), `75` started but not finished yet (`NOT_READY`; run the same command again to keep waiting), `130` interrupted.
- **Environment variables.** `SALEOR_ORG`, `SALEOR_PROJECT` and `SALEOR_ENV` fill `--org`, `--project` and the environment in every command that takes them, `init` included. Deletes always need the environment named explicitly.
- **Create and delete.** Creating something that exists with the same settings reuses it; different settings fail with `NAME_CONFLICT` naming the setting. Deleting or stopping something that does not exist succeeds and says so.
- **Waiting.** `--timeout <seconds>` bounds how long a command waits for work it started; the work carries on after that. `--timeout 0` checks once.

For unattended use, set `SALEOR_CLOUD_TOKEN` to a Cloud API token from the Cloud dashboard. It overrides any saved login. Cloud tokens do not grant access to the store API.

## Examples

Find projects and environments:

```sh
pnpm saleor project list --org my-org
pnpm saleor env list --org my-org --project my-store
```

Get an environment's addresses:

```sh
pnpm saleor env get dev --org my-org --project my-store
```

Create another sandbox in a project:

```sh
pnpm saleor env create preview --org my-org --project my-store
```

Check provisioning once without waiting:

```sh
pnpm saleor env create preview --org my-org --project my-store --timeout 0 --json
```

Delete a sandbox:

```sh
pnpm saleor env delete preview --force
```

Deletion is permanent. Production environments cannot be deleted through the CLI. Paid projects require `--plan <slug> --confirm-paid-plan`. Creating an environment in a paid project asks for confirmation; unattended runs require `--force`. Additional sandboxes may incur charges. Paid provisioning has not been tested live.

Preview `env create`, `env delete`, `project create`, `project delete` or `local down` with `--dry-run`. It resolves the target and validates the request, then returns JSON without changing anything or asking for confirmation. Cloud previews need authentication and make read requests. The result includes the action, resolved scope, current state and plan/cost information where relevant; a new resource has no key or slug yet.

```sh
pnpm saleor env delete preview --org acme --project my-store --dry-run
pnpm saleor project create my-store --org acme --plan pro --dry-run
pnpm saleor local down --name demo --delete-data --dry-run
```

`saleor commands --json` publishes `destructive`, `costsMoney` and `warning` for each command. The warning describes conditional risks, such as deleting local data only with `--delete-data` or charges only on a paid plan.

See `pnpm saleor --help` for more commands and [known limitations](limitations.md).

## Local instances

`init` is a shortcut to a running store, rather than a code generator. Cloud is the default for existing scripts; `--local` selects Docker. For lifecycle control:

```sh
pnpm saleor local up --name demo --sample-data
pnpm saleor local list
pnpm saleor local status --name demo
pnpm saleor local down --name demo
pnpm saleor local up --name demo
```

`local status` shows the addresses, the admin login and each container. `local up` on a running instance returns at once. Stopping preserves the database, media and login. To permanently remove them, use `local down --name demo --delete-data` and confirm (or pass `--force` for unattended use).

The first setup downloads pinned images and migrates the database, which can take several minutes. `--timeout` limits the GraphQL readiness wait after setup; exit 75 means the containers are still starting and the same command can be retried. `local status` reports readiness without waiting. Ports are allocated automatically and published on loopback only: the API, the Dashboard and a Mailpit inbox for the store's emails. If another program takes one of them while the instance is stopped, `local up` names the port; stop that program or run `local up --new-ports`. State and private Docker environment files live under `SALEOR_CONFIG_DIR` (by default `~/.config/saleor`); generated credentials use the CLI secret store, and Docker also needs private environment files to start the services. These stacks are for local development.

The API defaults to 3.23.41; `--saleor-version <major.minor.patch>` chooses another version for a new instance. The bundled Dashboard stays pinned to 3.23.0, so compatibility with other API series is not guaranteed. Existing instances keep their version; use a new name for another version. `--sample-data` can be added to an existing instance. If the first setup failed (for example, a version that does not exist), running `local up` again with corrected options replaces them.

Cloud credentials authenticate with the Cloud API and cannot be used as store API credentials.
