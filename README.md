# Saleor CLI

Set up and manage Saleor stores in Saleor Cloud or locally with Docker.

## Get started

Requires Node.js 22.18+ and pnpm. From this checkout:

```sh
pnpm install
pnpm saleor login
pnpm saleor init
```

The CLI guides you through setup and offers to open your dashboard when your store is ready.

Not sure what to run? Use `pnpm saleor` to explore, or `pnpm saleor org` to see organization actions. Add `--help` to any command for details.

## Run locally

Install and start Docker with Compose, then run:

```sh
pnpm saleor init --local
```

No Cloud account is needed. The first setup can take several minutes. When ready, the CLI shows your dashboard, API address, and admin login.

Manage your local stores:

```sh
pnpm saleor local list
pnpm saleor local status
pnpm saleor local down
```

You'll be asked which instance to use. To choose it directly, add `--name my-store`. Stopping an instance keeps its data; restart it with `pnpm saleor local up --name my-store`.

## Manage Cloud stores

```sh
# List projects and environments
pnpm saleor project list --org my-org
pnpm saleor env list --org my-org --project my-store

# Get a store's addresses
pnpm saleor env get dev --org my-org --project my-store

# Create a sandbox
pnpm saleor env create preview --org my-org --project my-store
```

Preview changes with `--dry-run` before creating or deleting resources. Deletion is permanent, and paid resources require confirmation.

## Scripts and coding agents

Pass `--agent` (shorthand for `--json --no-input`) on agent and script invocations for structured output without prompts; do not rely on automatic agent detection. Discover commands and their inputs with `pnpm saleor commands --agent`. Supply the resource names and options your command needs. For unattended Cloud access, set `SALEOR_CLOUD_TOKEN` to a Cloud API token.

See the [CLI reference](docs/reference.md) for automation and advanced options, or [known limitations](docs/limitations.md).
