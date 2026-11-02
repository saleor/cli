# Saleor CLI

Set up and manage Saleor stores in Saleor Cloud or locally with Docker, and storefronts connected to them.

## Get started

Requires Node.js 22.18+ and pnpm. From this checkout:

```sh
pnpm install
pnpm saleor init
```

Choose where to create your new store. Cloud setup asks you to log in when needed. In Cloud, you can use an existing project as its destination. The CLI offers to open your dashboard when your store is ready.

Run `pnpm saleor` for a short first-run welcome: connect to Cloud, continue locally, or browse commands without setup. Browsing skips login and skills installation. Revisit setup with `pnpm saleor onboard`. Onboarding can install Saleor skills for Claude Code, Codex, or Cursor, either in your current project or for all your projects. The Cloud path also offers MCP installation. In this prototype, the MCP backend is mocked: the prompts show the intended setup experience, but no app is installed and no MCP configuration is written. Later runs open the command menu: the same commands whether you work locally or in Cloud, with login offered until you have one. Every command still works when typed. `init` always asks where the new store should run. When you are logged in, it first shows which Cloud account it would use and lists Cloud first; otherwise local comes first. Press Esc at any question to go back a step: to the first onboarding question, to where `init`'s store should run, or to the menu you came from. Press Ctrl+C to exit. After a command finishes, the CLI returns to your shell. Add `--help` to any command for details.

Small terminals and `NO_COLOR` use a compact welcome.

## How commands read

Every command is a short sentence: `saleor <noun> <verb> [<env>]`.

```sh
pnpm saleor env start local
pnpm saleor config deploy staging
pnpm saleor storefront use staging
```

`<env>` names a store the same way everywhere: by its name in the project's `saleor.yml` (`local`, `staging`), or by its ref (`local:demo`, `cloud:acme/abc123`) as `env list` prints it. Inside a project with one environment, you can leave it out.

## Run locally

Install and start Docker with Compose, then run:

```sh
pnpm saleor init --local
```

`init` asks for a new instance name. Passing an existing name explicitly lets you retry setup safely.

No Cloud account is needed. The first setup can take several minutes. When ready, the CLI shows your dashboard, API address, and admin login.

## Manage environments

Local instances and Cloud environments answer the same commands:

```sh
pnpm saleor env list              # every store, local and Cloud, with its state
pnpm saleor env start local       # start it, or print its addresses again
pnpm saleor env stop local        # stop it and keep its data
pnpm saleor env remove local      # delete it and its data, after confirmation
pnpm saleor env add staging       # a new Cloud sandbox, named in saleor.yml
pnpm saleor env add review --local
```

Inside a project, `env start local` creates the local environment from `saleor.yml` when this checkout does not have it yet, and applies `config.yml` unless the definition says `configure: never`. Stopping keeps data. Removing deletes the store and its data: a Cloud environment's name leaves `saleor.yml` with it, while a local definition stays so `env start` can create it again. Saleor Cloud runs its environments itself, so they cannot be started or stopped here, and only sandboxes can be removed.

Preview any change with `--dry-run`. Removals ask for confirmation, need `--force` without a terminal, and never read `SALEOR_ENV`: name what to delete.

## Create a storefront

```sh
pnpm saleor storefront create
```

Pick a store (Cloud or local) and the CLI downloads the [Saleor storefront template](https://github.com/saleor/storefront) into the project's `storefront/` folder (`./storefront` outside a project), points its `.env` at the store's API and channel, and makes it a git repository. Dependencies are installed automatically. Then `cd storefront && pnpm dev`.

`pnpm saleor init` also offers a storefront for the store it sets up (`--storefront`), in a folder for the project: `<project>/storefront`.

Run `pnpm saleor storefront use staging` to point the storefront at another environment, or leave out the name to choose interactively; it shows the current backend before asking. Target a directory explicitly with `--dir path/to/storefront`. Restart the storefront development server after switching. This updates local configuration; hosted deployments keep their own settings.

## Talk to a store's API

```sh
pnpm saleor api call local --query '{ shop { name } }'
pnpm saleor api call staging --file products.graphql --variables '{"first": 10}'
```

`api call` sends one GraphQL request and prints the data. It finds the token for you: `SALEOR_TOKEN`, a token saved for the store, a local store's own admin login, or a prompt that offers to save what you paste. Make that token in the store's Dashboard (Apps → Create app). `--anonymous` sends none, for public data.

## Receive webhooks while you build

```sh
pnpm saleor webhook listen local --events order_created
pnpm saleor webhook listen local --subscription order.graphql --forward-to http://localhost:3000/api/webhooks/order
```

`webhook listen` creates a temporary app on the store, subscribes it to the events (or to a subscription query, which shapes the payload as your app's webhook would), and prints each delivery as it arrives. With `--forward-to`, each delivery also goes to your app, signature included, and the store gets your app's answer. Ctrl+C deletes the app; `--count <n>` stops after that many deliveries. The token needs `MANAGE_APPS` plus the permissions the events need.

Local stores reach your computer through Docker. For a Cloud store, run a tunnel to a local port and pass it: `--port 4141 --public-url https://<tunnel>`. A local store made before this version refuses to deliver to your computer until you run `env stop` and `env start` on it once.

## Cloud stores

```sh
# Create a project and a sandbox, or reuse them and print their addresses
pnpm saleor init --org my-org --project my-store --env preview

# Delete a sandbox by its ref
pnpm saleor env remove cloud:my-org/<env key>
```

## Scripts and coding agents

Pass `--agent` (shorthand for `--json --no-input`) on agent and script invocations for structured output without prompts; do not rely on automatic agent detection. Discover commands and their inputs with `pnpm saleor commands --agent`. Supply the resource names and options your command needs. For unattended Cloud access, set `SALEOR_CLOUD_TOKEN` to a Cloud API token.

See the [CLI reference](docs/reference.md) for automation and advanced options, or [known limitations](docs/limitations.md).

## Development checks

Run `pnpm check` for lint, types, and tests, or `pnpm test:e2e` to test the built CLI against mock Cloud and Saleor servers. See [testing](docs/testing.md) for CI coverage and its boundaries.
