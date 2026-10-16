# Saleor CLI

Manage Saleor Cloud projects and sandbox environments from your terminal or coding agent. It runs from source and does not include Configurator.

## Get started

Requires Node.js 22.18+ and pnpm. From this checkout:

```sh
pnpm install
pnpm saleor login
pnpm saleor org list
pnpm saleor init --org my-org --project my-store --env dev
```

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
