# CLI reference

Detailed output formats, automation conventions, and local instance options.

## Conventions

Agents and scripts should explicitly pass `--agent` (shorthand for `--json --no-input`). Discover commands and their inputs with `saleor commands --agent`; automatic agent detection is only a fallback. Missing inputs produce errors rather than questions. These flags do not bypass confirmation of deletions.

Explicit `login` still waits for browser approval until the device code expires. Use `login --no-browser` to print the link without launching a browser, or supply `SALEOR_CLOUD_TOKEN` for unattended authentication.

- **Output.** Results go to stdout: text in a terminal, JSON (`{"ok": true, "data": …}`) otherwise or with `--json`. Errors are `{"ok": false, "error": {code, message, suggestion, retry, details?}}` in JSON, or a `✗` line on stderr in text. Progress goes to stderr; in JSON mode each progress message is one JSON line (`{"event": "progress", "message": …}`), and `login` emits `{"event": "login", "verificationUrl", "userCode", "expiresAt"}` before it waits for approval. Help (`--help` or `saleor help <command>`) and `--version` go to stdout. `saleor commands --json` describes every command (its kind and safety), flag (with defaults and environment variables), exit code, error code (with its exit code and whether retrying helps) and instance state.
- **Instances.** Every command that shows a store, Cloud or local, returns the same fields: `kind` (`cloud` or `local`), `ref`, `name`, `state`, `ready`, `graphqlUrl`, `dashboardUrl` and `saleorVersion`, with provider-specific fields next to them (`key`, `organization`, `project`, … for Cloud; `mailUrl`, `admin`, … for local). `state` is `ready` (the API answered during the command), `running` (the provider reports it running; not contacted, as in `env list`), `starting`, `busy`, `maintenance`, `stopped` or `incomplete`.
- **Exit codes.** `0` success, `1` failure (see `error.code`), `2` the command line must change: an invalid value (`USAGE_ERROR`), a missing target (`CONTEXT_MISSING`, with the choices in `error.details.choices`) or an ambiguous name (`AMBIGUOUS_TARGET`). `75` started but not finished yet (`NOT_READY`; run the same command again to keep waiting), `130` interrupted.
- **Environment variables.** `SALEOR_ORG`, `SALEOR_PROJECT` and `SALEOR_ENV` fill `--org`, `--project` and the environment in every command that takes them, `init` included, except deletions: `env delete` and `local down` act only on what the command line names. `SALEOR_INSTANCE` fills `--instance` in the storefront commands.
- **Create and delete.** Creating something that exists with the same settings reuses it; different settings fail with `NAME_CONFLICT` naming the setting. Creates return the resource with `created`. Deletes and stops return `{action, existed, target}`; something that does not exist gives `action: "none"` and succeeds.
- **Confirmation.** Anything that deletes data asks in a terminal and needs `--force` otherwise (`CONFIRMATION_REQUIRED`, with the command to run). Nothing else asks for confirmation.
- **Notices.** Something worth knowing before a change, such as that a new environment in a project outside the free plan might be charged depending on the plan, is said once right before it happens: in the `--dry-run` preview (`notice`), in the review before creating, or on stderr.
- **Waiting.** `--timeout <seconds>` bounds how long a command waits for work it started; the work carries on after that. `--timeout 0` checks once.

For unattended use, set `SALEOR_CLOUD_TOKEN` to a Cloud API token from the Cloud dashboard. It overrides any saved login. Cloud tokens do not grant access to the store API.

## Examples

The CLI provides these commands:

| Command | Does |
| --- | --- |
| `init` | Creates a store and prints how to reach it: a project and sandbox in Saleor Cloud, or with `--local` an instance in Docker. Explicit names support retries. |
| `login`, `logout` | Saves or removes the Cloud login. |
| `env list`, `env delete` | Lists Cloud environments with their URLs; deletes a sandbox. |
| `local list`, `local up`, `local down` | Lists local instances with their URLs; starts or stops one, or deletes it with `--delete-data`. |
| `storefront env` | Chooses the backend used by a local storefront, updating its API URL and channel. Separate from `env list` and `env delete`, which manage Cloud environments. |
| `storefront create` | Creates a storefront from the Saleor template connected to a store. |

`saleor commands` describes them for agents. Organizations and projects are chosen with `--org` and `--project`, or at a prompt; manage plans, production environments and empty projects in the Saleor Cloud dashboard.

Find environments:

```sh
pnpm saleor env list --org my-org --project my-store
```

Create another sandbox in a project, or print the addresses of an existing one:

```sh
pnpm saleor init --org my-org --project my-store --env preview
```

Check provisioning once without waiting:

```sh
pnpm saleor init --org my-org --project my-store --env preview --timeout 0 --json
```

Delete a sandbox:

```sh
pnpm saleor env delete preview --org my-org --force
```

Deletion is permanent. Production environments cannot be deleted through the CLI. New projects use the free plan. Before creating an environment in a project on another plan, the CLI says that you might be charged, depending on your plan; it does not ask.

Every command that creates or removes something takes `--dry-run`: `init`, `env delete`, `local down` and the storefront commands. It resolves the target and validates the request without changing anything or asking questions, then prints the plan in the requested output format. Cloud previews need authentication and make read requests. The JSON is `{dryRun, action, state, target, destructive, warning, notice, details}`; `target` is `{type, name, id, scope}`, and a new resource has no `id` yet.

```sh
pnpm saleor env delete preview --org acme --project my-store --dry-run
pnpm saleor init --org acme --project my-store --env preview --dry-run
pnpm saleor local down --name demo --delete-data --dry-run
```

`saleor commands --json` publishes `kind`, `destructive` and `warning` for each command. The warning describes conditional risks, such as deleting local data only with `--delete-data`.

See `pnpm saleor --help` for more commands and [known limitations](limitations.md).

## Local instances

`init` creates a store, with an optional storefront. Cloud is the default for existing scripts; `--local` selects Docker:

```sh
pnpm saleor init --local --name demo --sample-data
pnpm saleor local list
pnpm saleor local down --name demo
pnpm saleor local up --name demo
```

`init --local` prints the addresses and the admin login. Use `local up` to start an existing instance or print its connection details again. `local list` shows each instance's state and URLs. Stopping preserves the database, media and login. To permanently remove them, use `local down --name demo --delete-data` and confirm (or pass `--force` for unattended use).

The first setup downloads pinned images and migrates the database, which can take several minutes. `--timeout` limits the GraphQL readiness wait after setup; exit 75 means the containers are still starting and the same command can be retried. `local list` reports readiness without waiting. Ports are allocated automatically and published on loopback only: the API, the Dashboard and a Mailpit inbox for the store's emails. If another program takes one of them while the instance is stopped, `init --local` names the port; stop that program or add `--new-ports`. State and private Docker environment files live under `SALEOR_CONFIG_DIR` (by default `~/.config/saleor`); generated credentials use the CLI secret store, and Docker also needs private environment files to start the services. These stacks are for local development.

The API defaults to 3.23.41; `--saleor-version <major.minor.patch>` chooses another version for a new instance. The bundled Dashboard stays pinned to 3.23.0, so compatibility with other API series is not guaranteed. Existing instances keep their version; use a new name for another version. `--sample-data` can be added to an existing instance. If the first setup failed (for example, a version that does not exist), running `init --local` again with corrected options replaces them.

Cloud credentials authenticate with the Cloud API and cannot be used as store API credentials.

## Storefronts

`storefront create` downloads [saleor/storefront](https://github.com/saleor/storefront) as it is on `main` (a fresh copy, without the template's history) and connects it to one store:

```sh
pnpm saleor storefront create --instance local:demo
pnpm saleor storefront create --instance cloud:acme/env1 --dir shop --channel eu
```

- **Stores** are given by `ref`, as `env list` and `local list` print it: `cloud:<org>/<environment key>` or `local:<name>`. In a terminal, a person picks from every Cloud environment and local instance; Cloud offers a login first when needed.
- **`.env`.** The CLI creates `.env` from the template's `.env.example`, as the template's README says, so its documented defaults stay. It sets `NEXT_PUBLIC_SALEOR_API_URL` and `NEXT_PUBLIC_DEFAULT_CHANNEL` (default `default-channel`), and writes the store it is connected to in a header line: `# saleor: instance=<ref>`. The template's `.gitignore` keeps `.env` out of git.
- **Checks.** The channel is checked against the store when it answers. A store that is stopped, a channel that does not exist, a template that no longer mentions a key the CLI sets, a missing git or a failed install are warnings in `data.warnings`, never failures: the files are written either way.
- **Git and packages.** A new storefront becomes a git repository with the template committed, unless it is inside one already. Dependencies are installed automatically with pnpm, through Corepack if pnpm itself is missing. Existing dependencies are kept on retries; a failed install can be retried.
- **Running it again** on the same directory and store reuses the files and retries dependency installation. A directory with other files is refused (`NAME_CONFLICT`), and so is a storefront connected to another store; use `storefront env` to switch its backend, or choose another directory with `--dir`.
- The result lists the next commands (`next`) and the environment variables a host needs to deploy it.

`init --storefront` (asked last in a terminal) does the same for the store `init` sets up, in a folder for the project: the current directory when it is empty, else `./<project>`, with the storefront in `storefront/` and one git repository for the folder. The template downloads while the store is being set up; if `init` stops waiting for the store, running it again connects the downloaded storefront.

`pnpm saleor storefront env` shows the current backend and asks which store to use. Defaults to the current storefront directory; pass `--dir` when running elsewhere. `--instance cloud:<org>/<key>` or `--instance local:<name>` selects the backend explicitly. `--channel` overrides the current channel. `--dry-run` previews the change without writing. Restart the development server afterward. This command only updates the local storefront's `.env`; it does not modify Cloud environments or hosted deployments. Exploratory navigation offers it only inside a storefront directory.
