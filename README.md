# Saleor CLI

## Install

```
npm i -g saleor-cli
```

> If you're using `nvm`, make sure that the `NVM_BIN` path is added to `PATH`

The `saleor` binary requires the **Cloud API Token**. Once you obtain it from your Cloud instance administrator, run `saleor configure` to set it up

```
saleor configure
```

From now on, you can start executing any CLI commands.

## Usage

```
Usage: saleor <command> [options]

Commands:
  saleor configure [token]       Configure Saleor CLI
  saleor organization [command]                                   [aliases: org]
  saleor environment [command]                                    [aliases: env]
  saleor backup [command]
  saleor job [command]
  saleor project [command]
  saleor storefront [command]

Options:
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]

for more information, find the documentation at https://saleor.io
```

## Available commands

### `configure`

### `organization`

### `environment`

### `backup`

### `job`

### `project`

### `storefront`