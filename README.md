# Saleor CLI

## Getting Started

### Install 

Use `npm` to install `saleor-cli`:

```
npm i -g saleor-cli
```

You can also use `npx` to execute the Saleor CLI commands on the spot without installing the package. 

```
npx saleor-cli environment list
```

> If you're using `nvm`, make sure that the `NVM_BIN` path is added to `PATH`

### Login

The `saleor` binary requires the **Cloud API Token**. You can obtain it via OAuth with the `login` command:

```
saleor login
```

This command will open a browser and ask for your Saleor Cloud credentials. Once logged in, it will store your Cloud API Token locally for the CLI to use it.

You can now start executing any of the available commands. 

### Create a storefront

Let's create a new React.js storefront that is automatically configured with your Saleor Cloud environment:

```
saleor store create my-brand-new-storefront
```

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
  saleor storefront [command]
  saleor telemetry [command]                                     [aliases: tele]
  saleor webhook [command]                                       [aliases: hook]
  saleor app [command]
  saleor token [command]

Options:
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]

for more information, find the documentation at https://saleor.io
```

## Available commands

### `info`

### `login`

### `configure`

### `organization`

### `environment`

### `backup`

### `job`

### `project`

### `storefront`

### `telemetry`



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
