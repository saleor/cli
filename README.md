
<div align="center">
  <img width="150" alt="saleor-cli" src="https://user-images.githubusercontent.com/200613/221163557-797cf981-3c65-4a0b-afd3-304b6d7ac537.png">
</div>

<div align="center">
  <h1>Saleor CLI</h1>
</div>

<div align="center">
  <p>Command-Line Interface for Saleor</p>
</div>

<div align="center">
  <a href="https://saleor.io/">Website</a>
  <span> | </span>
  <a href="https://docs.saleor.io/docs/3.x/cli">Docs</a>
</div>


**Saleor CLI** is designed to boost your productivity and improve development experience with Saleor and Saleor Cloud. It will take the burden of spawning new storefronts and apps locally, managing and connecting them with Saleor instances, or establishing tunnels for local development in seconds.

To install the latest version of Saleor CLI, run the following command:

```
npm i -g @saleor/cli
```

You can also use `npx` to execute the Saleor CLI commands on the spot without installing the package.

```
npx saleor env list
```

> If you're using `nvm`, make sure that the `NVM_BIN` path is added to `PATH`

## Getting Started with CLI

### A quick demo

If you're new to Saleor you might want to start by bootstrapping an end-to-end local storefront development environment (and Saleor Cloud sandbox API instance). Since it requires Cloud access, you will be asked to register to a free Saleor Cloud developer account or log in. Then the command will automatically create your new local storefront environment and connect it to a newly created Saleor API instance/sandbox:

```
saleor storefront create --demo
```

### Register

If you don't have a (free developer) Saleor Cloud account yet, create one with the following command:

```
saleor register
```

### Login

The `saleor` binary requires the Cloud API token that can be obtained via OAuth by running the `login` command:

```
saleor login
```

This command will open a browser and ask for your Saleor Cloud credentials. Once logged in, it will store your Cloud API token locally for the CLI to use.

You can now start executing any of the available commands.

Note: in order to log out you can use `saleor logout`.

### Create a storefront

The following command will take you through the process of creating a new [react-storefront](https://github.com/saleor/react-storefront) and configuring it with a chosen Saleor Cloud API instance:

```
saleor store create my-new-storefront
```

### Create an API sanbox

You can create new API endpoints by running:

```
saleor env create
```

## Saleor Apps management 🦄

Please check out the [Saleor App Template](https://github.com/saleor/saleor-app-template) [docs](https://github.com/saleor/saleor-app-template#readme) for the latest documentation.

## Webhooks management

Coming soon 🔌

## Usage

```
Usage: saleor <command> [options]

Commands:
  saleor info                    Hello from Saleor
  saleor status                  Show the login status for the systems that CLI depends on
  saleor login                   Log in to the Saleor Cloud
  saleor logout                  Log out from the Saleor Cloud
  saleor configure [token]       Configure Saleor CLI
  saleor register                Create a Saleor Cloud account  [aliases: signup]
  saleor trigger [event]         This triggers a Saleor event
  saleor organization [command]  [aliases: org]
  saleor environment [command]  [aliases: env]
  saleor backup [command]
  saleor job [command]
  saleor project [command]
  saleor storefront [command]  [aliases: store]
  saleor telemetry [command]  [aliases: tele]
  saleor webhook [command]  [aliases: hook]
  saleor app [command]
  saleor vercel [command]
  saleor github [command]
  saleor checkout [command]

Options:
      --json             Output the data as JSON  [boolean]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

for more information, find the documentation at https://saleor.io
```

## Development

### Install dependencies

This project uses [pnpm](https://pnpm.io) for managing dependencies

```
pnpm install
```

### Run Watch Mode

```
pnpm watch
```

### Run CLI

```
node build/cli.js ...
```

### Environment variables

`SALEOR_CLI_ENV`

Set to `staging` to use the CLI with staging Saleor Cloud


`RUN_FUNCTIONAL_TESTS`

Set to `true` to enable functional tests


`DEBUG`

Use it for debugging. Set to `saleor-cli:*` to show debug output for the Saleor CLI only. Set to `*` to show all debug output.

## Releasing CLI

Commands should be executed locally.

### Pre-Release

- pull latest changes from `main`, e.g.

```
git pull origin main
```

- check for the type errors with `pnpm tsc`
- check if the bundling finishes `pnpm bundle`

### Release

- change to the selected `release-*` branch; all `release-*` branches are protected

```
git checkout release/X.Y
```

where `X` and `Y` is the selected version

- compare the commits between latest release on that branch and the current `main`

```
git log --no-merges --cherry-pick --right-only release/X.Y...main
```

- cherry pick commits for the next release following the [Trunk Based Development Approach](https://trunkbaseddevelopment.com); do not include the `merge` commits

```
git cherry-pick SHA1 SHA2 SHA3
```

where `SHA1`, `SHA2`, `SHA3` are SHAs selected to be included in the upcoming version

- mark the new version in the package.json
- commit the new release + add the tag

```
git commit -m 'Release X.Y.0'
git tag X.Y.Z
```

- push the updated release branch to the origin

```
git push origin release/X.Y
```

- push the new tag to the origin

```
git push origin --tags
```

- publish from the release branch; use the `next` tag for the `RC` version

```
pnpm publish
```

or

```
pnpm publish --tag next
```
