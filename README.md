# Saleor CLI

Set up and manage Saleor stores in Saleor Cloud or locally with Docker, and storefronts connected to them.

## Get started

Requires Node.js 22.18+ and pnpm. From this checkout:

```sh
pnpm install
pnpm saleor login
pnpm saleor init
```

The CLI guides you through setup and offers to open your dashboard when your store is ready.

Not sure what to run? Use `pnpm saleor` to explore. Add `--help` to any command for details.

## Run locally

Install and start Docker with Compose, then run:

```sh
pnpm saleor init --local
```

No Cloud account is needed. The first setup can take several minutes. When ready, the CLI shows your dashboard, API address, and admin login.

Manage your local stores:

```sh
pnpm saleor local list
pnpm saleor local down
```

You'll be asked which instance to use. To choose it directly, add `--name my-store`. Stopping an instance keeps its data. Run `pnpm saleor init --local --name my-store` to start it again, or to print its addresses and admin login.

## Create a storefront

```sh
pnpm saleor storefront create
```

Pick a store (Cloud or local) and the CLI downloads the [Saleor storefront template](https://github.com/saleor/storefront) into `./storefront`, points its `.env` at the store's API and channel, and makes it a git repository. Then `cd storefront && pnpm install && pnpm dev`. Point an existing storefront at another store with `pnpm saleor storefront connect`.

`pnpm saleor init` also offers a storefront for the store it sets up (`--storefront`), in a folder for the project: `<project>/storefront`.

## Manage Cloud stores

```sh
# List environments and their addresses
pnpm saleor env list --org my-org --project my-store

# Create another sandbox, or reuse it and print its addresses
pnpm saleor init --org my-org --project my-store --env preview

# Delete a sandbox
pnpm saleor env delete preview --org my-org
```

Preview changes with `--dry-run` before creating or deleting resources. Deletion is permanent and asks for confirmation. Deletions never read `SALEOR_ORG`, `SALEOR_PROJECT` or `SALEOR_ENV`; name what to delete.

## Scripts and coding agents

Pass `--agent` (shorthand for `--json --no-input`) on agent and script invocations for structured output without prompts; do not rely on automatic agent detection. Discover commands and their inputs with `pnpm saleor commands --agent`. Supply the resource names and options your command needs. For unattended Cloud access, set `SALEOR_CLOUD_TOKEN` to a Cloud API token.

See the [CLI reference](docs/reference.md) for automation and advanced options, or [known limitations](docs/limitations.md).

## Development checks

Run `pnpm check` for lint, types, and tests, or `pnpm test:e2e` to test the built CLI against mock Cloud and Saleor servers. See [testing](docs/testing.md) for CI coverage and its boundaries.
