# Saleor

Saleor is a rapidly growing all-out commerce API. Saleor is **fully open-source, and 100% focused on the GraphQL** interface. Our mission is to provide unparalleled extensibility.

We make it easy for front-end teams to **prototype fast, experiment, and build wonderful, unrestricted storefront experiences**.

We enable developers to [extend Saleor](https://docs.saleor.io/docs/3.x/developer/extending/apps/key-concepts) functionally with custom logic and async and sync webhooks, and in the Dashboard. 

We allow brands to own their data and go fast while staying fully flexible with [Saleor Cloud](https://cloud.saleor.io).

Composable all-out e-commerce.

---

**Saleor CLI** is designed to boost your productivity and improve development experience with Saleor and Saleor Cloud. It will take the burden of spawning new storefronts and apps locally, managing and connecting them with Saleor instances, or establishing tunnels for local developments in seconds.

To install the latest version of Saleor CLI, run this command:

```
npm i -g saleor@latest
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
saleor storefront create --auto
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


## Saleor Apps management

Coming soon 🦄


## Webhooks management

Coming soon 🔌



## Usage

```
Usage: saleor <command> [options]

Commands:
  saleor info                    Hello from Saleor
  saleor login                   Log in to the Saleor Cloud
  saleor configure [token]       Configure Saleor CLI
  saleor organization [command]                                   [aliases: org]
  saleor environment [command]                                    [aliases: env]
  saleor backup [command]
  saleor job [command]
  saleor project [command]
  saleor storefront [command]                                   [aliases: store]
  saleor telemetry [command]                                     [aliases: tele]
  saleor webhook [command]                                       [aliases: hook]
  saleor app [command]
  saleor vercel [command]

Options:
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]

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
