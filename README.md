# Saleor CLI

Set up and manage Saleor stores in Saleor Cloud or locally with Docker, from your terminal or coding agent. Configurator and application scaffolding are out of scope.

## Get started

Requires Node.js 22.18+ and pnpm. From this checkout:

```sh
pnpm install
pnpm saleor login
pnpm saleor org list
pnpm saleor init --org my-org --project my-store --env dev
```

For local development, install and start Docker with Compose, then run:

```sh
pnpm saleor init --local
pnpm saleor local status
pnpm saleor local down
```

`init --local` starts the API, Dashboard, PostgreSQL, Valkey, worker and mail service, waits for the API, and links this directory. It prints the generated admin login. Credentials are also returned in JSON; treat saved command output as private. Cloud login is not required. The default local instance is named `default`; use `--name shop2` for another instance with separate ports and data. Sample data is off by default; add `--sample-data` on first setup to load it.

Login prints a link and code for browser approval. `init` creates or reuses a project and sandbox, waits for readiness, and saves their context in `.saleor/link.json` for subsequent commands.

For unattended use, set `SALEOR_CLOUD_TOKEN` to a Cloud API token from the Cloud dashboard. It overrides any saved login. Cloud tokens do not grant access to the store API.

## Examples

Find projects and environments:

```sh
pnpm saleor project list --org my-org
pnpm saleor env list --org my-org --project my-store
```

Link this directory to an existing environment, then get its addresses:

```sh
pnpm saleor link --org my-org --project my-store --env dev
pnpm saleor env get
```

Create another sandbox in the linked project:

```sh
pnpm saleor env create preview
```

Check provisioning once without waiting:

```sh
pnpm saleor env create preview --timeout 0 --json
```

Delete a sandbox:

```sh
pnpm saleor env delete preview --force
```

Deletion is permanent. Production environments cannot be deleted through the CLI. Paid projects require `--plan <slug> --confirm-paid-plan`; additional sandboxes in paid projects may also incur charges. Paid provisioning has not been tested live.

See `pnpm saleor --help` for more commands and [known limitations](docs/limitations.md).

## Local instances and targets

`init` is a shortcut to a running store, rather than a code generator. Cloud is the default for existing scripts; `--local` selects Docker. `--no-link` skips saving the directory target. For lifecycle control without changing the directory link:

```sh
pnpm saleor local up --name demo --sample-data
pnpm saleor link local:demo
pnpm saleor local status --name demo
pnpm saleor local down --name demo
pnpm saleor local up --name demo
```

Stopping preserves the database, media and login. To permanently remove them, use `local down --name demo --delete-data` and confirm (or pass `--force` for unattended use). A deleted instance's directory link remains until you replace it.

The first setup downloads pinned images and migrates the database, which can take several minutes. `--timeout` limits the GraphQL readiness wait after setup; exit 75 means the containers are still starting and the same command can be retried. `local status` reports readiness without waiting. Ports are allocated automatically and published on loopback only. State and private Docker environment files live under `SALEOR_CONFIG_DIR` (by default `~/.config/saleor`); generated credentials use the CLI secret store, and Docker also needs private environment files to start the services. These stacks are for local development.

The API defaults to 3.23.41; `--saleor-version <major.minor.patch>` chooses another version for a new instance. The bundled Dashboard stays pinned to 3.23.0, so compatibility with other API series is not guaranteed. Existing instances keep their version and sample-data setting; use a new name for different setup options.

Links support `local:<name>` and `cloud:<org>/<project>/<environment>` refs, plus the existing `link --org/--project/--env` shorthand. Version 2 links hold a core-owned `target` and Cloud defaults; old links remain readable and upgrade on the next write. Provider-neutral target resolution uses an explicit ref, then `SALEOR_TARGET`, then the directory link. Cloud management commands keep their existing scope flags. Cloud credentials authenticate with the Cloud API and cannot be used as store API credentials.
