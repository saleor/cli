# Saleor CLI

**Saleor CLI** is designed to boost your productivity and improve development experience with Saleor and Saleor Cloud. It will take the burden of spawning new storefronts and apps locally, managing and connecting them with Saleor instances, or establishing tunnels for local development in seconds.

## Install

with `pnpm`

```sh
$ pnpm i @saleor/cli -g
```

or

with `npm`

```sh
$ npm i @saleor/cli -g
```

## Usage

```sh
$ saleor --help
```

Help output:

```
Usage: saleor <command> [options]

Commands:
  saleor info                    Hello from Saleor
  saleor status                  Show the login status for the systems that CLI depends on
  saleor login                   Log in to the Saleor Cloud
  saleor logout                  Log out from the Saleor Cloud
  saleor example [name]          Setup an official Saleor example locally
  saleor register                Create a Saleor Cloud account  [aliases: signup]
  saleor trigger [event]         This triggers a Saleor event
  saleor organization [command]  Manage Saleor Cloud organizations  [aliases: org]
  saleor environment [command]   Manage Saleor Cloud environments  [aliases: env]
  saleor backup [command]        Manage Saleor Cloud backups
  saleor task [command]          Manage Saleor Cloud tasks
  saleor job [command]           Manage Saleor Cloud tasks
  saleor project [command]       Manage Saleor Cloud projects
  saleor storefront [command]    Create a Next.js Storefront  [aliases: store]
  saleor telemetry [command]     Manage telemetry preferences  [aliases: tele]
  saleor webhook [command]       Manage the environment's webhooks  [aliases: hook]
  saleor app [command]           Manage Saleor Apps
  saleor vercel [command]        Integrate with Vercel
  saleor github [command]        Integrate with GitHub
  saleor open [resource]         Open resource in a browser

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

for more information, find the documentation at https://saleor.io
```

---

## Available commands

* [info](#info)
* [status](#status)
* [login](#login)
* [logout](#logout)
* [example](#example)
* [register](#register)
* [trigger](#trigger)
* [organization](#organization)
  * [organization show](#organization-show)
  * [organization list](#organization-list)
  * [organization remove](#organization-remove)
  * [organization permissions](#organization-permissions)
  * [organization switch](#organization-switch)
* [environment](#environment)
  * [environment auth](#environment-auth)
  * [environment clear](#environment-clear)
  * [environment cors](#environment-cors)
  * [environment create](#environment-create)
  * [environment list](#environment-list)
  * [environment maintenance](#environment-maintenance)
  * [environment origins](#environment-origins)
  * [environment populate](#environment-populate)
  * [environment promote](#environment-promote)
  * [environment remove](#environment-remove)
  * [environment show](#environment-show)
  * [environment switch](#environment-switch)
  * [environment update](#environment-update)
  * [environment upgrade](#environment-upgrade)
* [backup](#backup)
  * [backup list](#backup-list)
  * [backup create](#backup-create)
  * [backup show](#backup-show)
  * [backup remove](#backup-remove)
  * [backup restore](#backup-restore)
* [task](#task)
  * [task list](#task-list)
* [job](#job)
  * [job list](#job-list)
* [project](#project)
  * [project list](#project-list)
  * [project create](#project-create)
  * [project remove](#project-remove)
  * [project show](#project-show)
* [storefront](#storefront)
  * [storefront create](#storefront-create)
  * [storefront deploy](#storefront-deploy)
* [telemetry](#telemetry)
  * [telemetry disable](#telemetry-disable)
  * [telemetry enable](#telemetry-enable)
  * [telemetry status](#telemetry-status)
* [webhook](#webhook)
  * [webhook list](#webhook-list)
  * [webhook create](#webhook-create)
  * [webhook edit](#webhook-edit)
  * [webhook update](#webhook-update)
  * [webhook dry-run](#webhook-dry-run)
* [app](#app)
  * [app list](#app-list)
  * [app install](#app-install)
  * [app uninstall](#app-uninstall)
  * [app create](#app-create)
  * [app tunnel](#app-tunnel)
  * [app token](#app-token)
  * [app permission](#app-permission)
  * [app template](#app-template)
  * [app remove](#app-remove)
* [vercel](#vercel)
  * [vercel login](#vercel-login)
* [github](#github)
  * [github login](#github-login)
* [open](#open)

### info

```sh
$ saleor info --help
```

Help output:

```
saleor info

Hello from Saleor

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### status

```sh
$ saleor status --help
```

Help output:

```
saleor status

Show the login status for the systems that CLI depends on

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### login

```sh
$ saleor login --help
```

Help output:

```
saleor login

Log in to the Saleor Cloud

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --token            use with headless flag, create a token at https://cloud.saleor.io/tokens  [string]
      --headless         login without the need for a browser  [boolean] [default: false]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor login
  saleor login --headless
  saleor login --headless --token=TOKEN
```

### logout

```sh
$ saleor logout --help
```

Help output:

```
saleor logout

Log out from the Saleor Cloud

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### example

```sh
$ saleor example --help
```

Help output:

```
saleor example [name]

Setup an official Saleor example locally

Positionals:
  name  [string] [default: "my-saleor-app"]

Options:
      --json                            Output the data as JSON  [boolean] [default: false]
      --short                           Output data as text  [boolean] [default: false]
  -u, --instance, --url                 Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --dependencies, --deps  [boolean] [default: true]
  -t, --template, --repo, --repository  [string]
  -V, --version                         Show version number  [boolean]
  -h, --help                            Show help  [boolean]

Examples:
  saleor example auth-sdk  Setup the auth-sdk example from saleor/examples on GitHub
```

### register

```sh
$ saleor register --help
```

Help output:

```
saleor register

Create a Saleor Cloud account

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --from-cli         specify sign up via CLI  [boolean] [default: false]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### trigger

```sh
$ saleor trigger --help
```

Help output:

```
saleor trigger [event]

This triggers a Saleor event

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --event  [string]
      --id  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### organization

```sh
$ saleor organization --help
```

Help output:

```
saleor organization [command]

Manage Saleor Cloud organizations

Commands:
  saleor organization show [slug|organization]         Show a specific organization
  saleor organization list                             List organizations
  saleor organization remove [slug]                    Remove the organization
  saleor organization permissions [slug|organization]  List organization permissions
  saleor organization switch [slug]                    Make the provided organization the default one

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### organization show

```sh
$ saleor organization show --help
```

Help output:

```
saleor organization show [slug|organization]

Show a specific organization

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### organization list

```sh
$ saleor organization list --help
```

Help output:

```
saleor organization list

List organizations

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### organization remove

```sh
$ saleor organization remove --help
```

Help output:

```
saleor organization remove [slug]

Remove the organization

Positionals:
  slug  slug of the organization  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --force            skip confirmation prompt  [boolean]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### organization permissions

```sh
$ saleor organization permissions --help
```

Help output:

```
saleor organization permissions [slug|organization]

List organization permissions

Positionals:
  slug, organization  slug of the organization  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### organization switch

```sh
$ saleor organization switch --help
```

Help output:

```
saleor organization switch [slug]

Make the provided organization the default one

Positionals:
  slug  slug of the organization  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### environment

```sh
$ saleor environment --help
```

Help output:

```
saleor environment [command]

Manage Saleor Cloud environments

Commands:
  saleor environment auth [key|environment]         Manage basic auth for a specific environment
  saleor environment clear <key|environment>        Clear database for an environment
  saleor environment cors [key|environment]         Manage environment's CORS
  saleor environment create [name]                  Create a new environment
  saleor environment list                           List environments
  saleor environment maintenance [key|environment]  Enable or disable maintenance mode in a specific environment
  saleor environment origins [key|environment]      Manage the environment's trusted client origins
  saleor environment populate [key|environment]     Populate database for an environment
  saleor environment promote [key|environment]      Promote environment to production
  saleor environment remove [key|environment]       Delete an environment
  saleor environment show [key|environment]         Show a specific environment
  saleor environment switch [key|environment]       Make the provided environment the default one
  saleor environment update [key|environment]       Update the name of the environment
  saleor environment upgrade [key|environment]      Upgrade a Saleor version in a specific environment

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### environment auth

```sh
$ saleor environment auth --help
```

Help output:

```
saleor environment auth [key|environment]

Manage basic auth for a specific environment

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json              Output the data as JSON  [boolean] [default: false]
      --short             Output data as text  [boolean] [default: false]
  -u, --instance, --url   Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --login             basic auth login of the environment  [string]
      --password, --pass  basic auth password of the environment  [string]
      --disable           disable basic auth for the environment  [boolean]
  -V, --version           Show version number  [boolean]
  -h, --help              Show help  [boolean]

Examples:
  saleor env auth
  saleor env auth my-environment
  saleor env auth my-environment --login=saleor --password=saleor
  saleor env auth my-environment --disable
```

#### environment clear

```sh
$ saleor environment clear --help
```

Help output:

```
saleor environment clear <key|environment>

Clear database for an environment

Positionals:
  key, environment  key of the environment  [string] [required]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### environment cors

```sh
$ saleor environment cors --help
```

Help output:

```
saleor environment cors [key|environment]

Manage environment's CORS

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --all              All origins are allowed  [boolean]
      --dashboard        Only dashboard is allowed  [boolean]
      --selected         Only specified origins are allowed  [array]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor env cors
  saleor env cors my-environment --all
  saleor env cors my-environment --dashboard
  saleor env cors my-environment --selected="https://example.com"
```

#### environment create

```sh
$ saleor environment create --help
```

Help output:

```
saleor environment create [name]

Create a new environment

Positionals:
  name  name for the new environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --project          create this environment in this project  [string]
      --database         specify how to populate the database  [string]
      --saleor           specify the Saleor version  [string]
      --domain           specify the domain for the environment  [string]
      --login            specify the API Basic Auth login  [string]
      --pass             specify the API Basic Auth password  [string]
      --restore-from     specify snapshot id to restore the database from  [string]
      --skip-restrict    skip Basic Auth restriction prompt  [boolean]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor env create my-environment
  saleor env create my-environment --project=project-name --database=sample --saleor=saleor-master-staging --domain=project-domain --skip-restrict
  saleor env create my-environment --organization=organization-slug --project=project-name --database=sample --saleor=saleor-master-staging --domain=project-domain --skip-restrict
```

#### environment list

```sh
$ saleor environment list --help
```

Help output:

```
saleor environment list

List environments

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --extended         show extended table  [boolean] [default: false]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### environment maintenance

```sh
$ saleor environment maintenance --help
```

Help output:

```
saleor environment maintenance [key|environment]

Enable or disable maintenance mode in a specific environment

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --enable           enable maintenance mode  [boolean]
      --disable          disable maintenance mode  [boolean]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor env maintenance
  saleor env maintenance my-environment
  saleor env maintenance my-environment --enable
  saleor env maintenance my-environment --disable
```

#### environment origins

```sh
$ saleor environment origins --help
```

Help output:

```
saleor environment origins [key|environment]

Manage the environment's trusted client origins

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --origins          Allowed domains  [array]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor env origins
  saleor env origins my-environment --origins=https://trusted-origin.com
```

#### environment populate

```sh
$ saleor environment populate --help
```

Help output:

```
saleor environment populate [key|environment]

Populate database for an environment

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### environment promote

```sh
$ saleor environment promote --help
```

Help output:

```
saleor environment promote [key|environment]

Promote environment to production

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --saleor           specify the Saleor version  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### environment remove

```sh
$ saleor environment remove --help
```

Help output:

```
saleor environment remove [key|environment]

Delete an environment

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --force            skip confirmation prompt  [boolean]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### environment show

```sh
$ saleor environment show --help
```

Help output:

```
saleor environment show [key|environment]

Show a specific environment

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### environment switch

```sh
$ saleor environment switch --help
```

Help output:

```
saleor environment switch [key|environment]

Make the provided environment the default one

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### environment update

```sh
$ saleor environment update --help
```

Help output:

```
saleor environment update [key|environment]

Update the name of the environment

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --name             name of the environment  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor env update
  saleor env update my-environment
  saleor env update my-environment --name=renamed-env
```

#### environment upgrade

```sh
$ saleor environment upgrade --help
```

Help output:

```
saleor environment upgrade [key|environment]

Upgrade a Saleor version in a specific environment

Positionals:
  key, environment  key of the environment  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### backup

```sh
$ saleor backup --help
```

Help output:

```
saleor backup [command]

Manage Saleor Cloud backups

Commands:
  saleor backup list [key|environment]    List backups of the environment
  saleor backup create [name]             Create a new backup
  saleor backup show [backup|backup-key]  Show a specific backup
  saleor backup remove <key|backup>       Remove the backup
  saleor backup restore [from]            Restore a specific backup

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### backup list

```sh
$ saleor backup list --help
```

Help output:

```
saleor backup list [key|environment]

List backups of the environment

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### backup create

```sh
$ saleor backup create --help
```

Help output:

```
saleor backup create [name]

Create a new backup

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --name             name for the new backup  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor backup create
  saleor backup create my-backup --environment=env-id-or-name
```

#### backup show

```sh
$ saleor backup show --help
```

Help output:

```
saleor backup show [backup|backup-key]

Show a specific backup

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### backup remove

```sh
$ saleor backup remove --help
```

Help output:

```
saleor backup remove <key|backup>

Remove the backup

Positionals:
  key, backup  key of the backup  [string] [required]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --force            skip confirmation prompt  [boolean]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### backup restore

```sh
$ saleor backup restore --help
```

Help output:

```
saleor backup restore [from]

Restore a specific backup

Options:
      --json                  Output the data as JSON  [boolean] [default: false]
      --short                 Output data as text  [boolean] [default: false]
  -u, --instance, --url       Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --from                  the key of the snapshot  [string]
      --skip-webhooks-update  skip webhooks update prompt  [boolean]
  -V, --version               Show version number  [boolean]
  -h, --help                  Show help  [boolean]
```

### task

```sh
$ saleor task --help
```

Help output:

```
saleor task [command]

Manage Saleor Cloud tasks

Commands:
  saleor task list  List tasks

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### task list

```sh
$ saleor task list --help
```

Help output:

```
saleor task list

List tasks

Options:
      --json                        Output the data as JSON  [boolean] [default: false]
      --short                       Output data as text  [boolean] [default: false]
  -u, --instance, --url             Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --env  [string]
      --page                        A page number within the paginated result set  [number]
      --page-size, --page_size      Number of results to return per page  [number]
      --is-blocking, --is_blocking  Filter by non/blocking tasks  [boolean]
      --status                      Filter by status: active, completed, failed, successful  [string]
  -V, --version                     Show version number  [boolean]
  -h, --help                        Show help  [boolean]

Examples:
  saleor task list
  saleor task list my-environment --page=2
  saleor task list my-environment --page-size=100
  saleor task list my-environment --is-blocking
  saleor task list my-environment --status=active
```

### job

```sh
$ saleor job --help
```

Help output:

```
saleor job [command]

Manage Saleor Cloud tasks

Commands:
  saleor job list  List tasks

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### job list

```sh
$ saleor job list --help
```

Help output:

```
saleor job list

List tasks

Options:
      --json                        Output the data as JSON  [boolean] [default: false]
      --short                       Output data as text  [boolean] [default: false]
  -u, --instance, --url             Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --env  [string]
      --page                        A page number within the paginated result set  [number]
      --page-size, --page_size      Number of results to return per page  [number]
      --is-blocking, --is_blocking  Filter by non/blocking tasks  [boolean]
      --status                      Filter by status: active, completed, failed, successful  [string]
  -V, --version                     Show version number  [boolean]
  -h, --help                        Show help  [boolean]

Examples:
  saleor task list
  saleor task list my-environment --page=2
  saleor task list my-environment --page-size=100
  saleor task list my-environment --is-blocking
  saleor task list my-environment --status=active
```

### project

```sh
$ saleor project --help
```

Help output:

```
saleor project [command]

Manage Saleor Cloud projects

Commands:
  saleor project list            List projects
  saleor project create [name]   Create a new project
  saleor project remove [slug]   Remove the project
  saleor project show [project]  Show a specific project

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### project list

```sh
$ saleor project list --help
```

Help output:

```
saleor project list

List projects

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### project create

```sh
$ saleor project create --help
```

Help output:

```
saleor project create [name]

Create a new project

Positionals:
  name  name for the new backup  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --plan             specify the plan  [string]
      --region           specify the region  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### project remove

```sh
$ saleor project remove --help
```

Help output:

```
saleor project remove [slug]

Remove the project

Positionals:
  slug  slug of the project  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --force            skip confirmation prompt  [boolean]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### project show

```sh
$ saleor project show --help
```

Help output:

```
saleor project show [project]

Show a specific project

Positionals:
  project  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### storefront

```sh
$ saleor storefront --help
```

Help output:

```
saleor storefront [command]

Create a Next.js Storefront

Commands:
  saleor storefront create [name]  Bootstrap example [name]
  saleor storefront deploy         Deploy this `react-storefront` to Vercel

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### storefront create

```sh
$ saleor storefront create --help
```

Help output:

```
saleor storefront create [name]

Bootstrap example [name]

Positionals:
  name  [string] [default: "saleor-storefront"]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --demo             specify demo process  [boolean] [default: false]
      --environment      specify environment id  [string]
  -t, --template  [string] [default: "saleor/storefront"]
  -b, --branch  [string] [default: "canary"]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### storefront deploy

```sh
$ saleor storefront deploy --help
```

Help output:

```
saleor storefront deploy

Deploy this `react-storefront` to Vercel

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --dispatch         dispatch deployment and don't wait till it ends  [boolean] [default: false]
      --github-prompt    specify prompt presence for repository creation on Github  [boolean] [default: "true"]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor storefront deploy --no-github-prompt
  saleor storefront deploy --organization=organization-slug --environment=env-id-or-name --no-github-prompt
```

### telemetry

```sh
$ saleor telemetry --help
```

Help output:

```
saleor telemetry [command]

Manage telemetry preferences

Commands:
  saleor telemetry disable  Disable the telemetry
  saleor telemetry enable   Enable the telemetry
  saleor telemetry status   Show the telemetry status  [default]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### telemetry disable

```sh
$ saleor telemetry disable --help
```

Help output:

```
saleor telemetry disable

Disable the telemetry

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### telemetry enable

```sh
$ saleor telemetry enable --help
```

Help output:

```
saleor telemetry enable

Enable the telemetry

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### telemetry status

```sh
$ saleor telemetry status --help
```

Help output:

```
saleor telemetry status

Show the telemetry status

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### webhook

```sh
$ saleor webhook --help
```

Help output:

```
saleor webhook [command]

Manage the environment's webhooks

Commands:
  saleor webhook list     List webhooks for an environment
  saleor webhook create   Create a new webhook
  saleor webhook edit     Edit a webhook
  saleor webhook update   Update webhooks for an environment
  saleor webhook dry-run  Webhook dry run

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### webhook list

```sh
$ saleor webhook list --help
```

Help output:

```
saleor webhook list

List webhooks for an environment

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### webhook create

```sh
$ saleor webhook create --help
```

Help output:

```
saleor webhook create

Create a new webhook

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### webhook edit

```sh
$ saleor webhook edit --help
```

Help output:

```
saleor webhook edit

Edit a webhook

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### webhook update

```sh
$ saleor webhook update --help
```

Help output:

```
saleor webhook update

Update webhooks for an environment

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### webhook dry-run

```sh
$ saleor webhook dry-run --help
```

Help output:

```
saleor webhook dry-run

Webhook dry run

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --object-id        Object ID to perform dry run on  [string]
      --query            Subscription query  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor webhook dry-run
  saleor webhook dry-run --query='subscription { event { ... on ProductCreated { product { id name } } } }'
  saleor webhook dry-run --object-id='UHJvZHVjdDo3Mg=='
```

### app

```sh
$ saleor app --help
```

Help output:

```
saleor app [command]

Manage Saleor Apps

Commands:
  saleor app list               List installed Saleor Apps for an environment
  saleor app install            Install a Saleor App by URL
  saleor app uninstall <appId>  Uninstall a Saleor App by ID. You need to provide `appId`. List available apps and their IDs with `saleor app list`.
  saleor app create [name]      Create a new Saleor Local App
  saleor app tunnel [port]      Expose your Saleor app remotely with ngrok tunnel
  saleor app token              Create a Saleor App token
  saleor app permission         Add or remove permission for a Saleor App
  saleor app template [name]    Create an App with Saleor App Template
  saleor app remove [app-id]    Create a new Saleor Local App

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### app list

```sh
$ saleor app list --help
```

Help output:

```
saleor app list

List installed Saleor Apps for an environment

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### app install

```sh
$ saleor app install --help
```

Help output:

```
saleor app install

Install a Saleor App by URL

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --via-dashboard  [boolean] [default: false]
      --app-name         Application name  [string]
      --manifest-URL     Application Manifest URL  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor app install --manifest-URL="https://my-saleor-app.com/api/manifest
  saleor app install --manifest-URL="https://my-saleor-app.com/api/manifest --app-name="Saleor app"
  saleor app install --organization=organization-slug --environment=env-id-or-name --app-name="Saleor app" --manifest-URL="https://my-saleor-app.com/api/manifest
```

#### app uninstall

```sh
$ saleor app uninstall --help
```

Help output:

```
saleor app uninstall <appId>

Uninstall a Saleor App by ID. You need to provide `appId`. List available apps and their IDs with `saleor app list`.

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### app create

```sh
$ saleor app create --help
```

Help output:

```
saleor app create [name]

Create a new Saleor Local App

Positionals:
  name  name for the new Local App  [string]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --permissions      The array of permissions  [array]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor app create --name=my-saleor-app --permissions=MANAGE_USERS --permissions=MANAGE_STAFF
  saleor app create --name=my-saleor-app --organization=organization-slug --environment=env-id-or-name --permissions=MANAGE_USERS --permissions=MANAGE_STAFF
```

#### app tunnel

```sh
$ saleor app tunnel --help
```

Help output:

```
saleor app tunnel [port]

Expose your Saleor app remotely with ngrok tunnel

Positionals:
  port  [number] [default: 3000]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --name             The application name for installation in the Dashboard  [string]
      --force-install    Force the Saleor App Install  [boolean] [default: false]
      --manifest-path    The application's manifest path  [string] [default: "/api/manifest"]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor app tunnel --name="Custom name"
  saleor app tunnel --force-install
  saleor app tunnel --manifest-path=/app/manifest
  saleor app tunnel --organization=organization-slug --environment=env-id-or-name
```

#### app token

```sh
$ saleor app token --help
```

Help output:

```
saleor app token

Create a Saleor App token

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --app-id           The Saleor App id  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### app permission

```sh
$ saleor app permission --help
```

Help output:

```
saleor app permission

Add or remove permission for a Saleor App

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --app-id           The Saleor App id  [string]
      --permissions      The array of permissions  [array]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor app permission --app-id=APP-ID --permissions=MANAGE_USERS --permissions=MANAGE_STAFF
  saleor app permission --organization=organization-slug --environment=env-id-or-name --app-id=APP-ID --permissions=MANAGE_USERS --permissions=MANAGE_STAFF
```

#### app template

```sh
$ saleor app template --help
```

Help output:

```
saleor app template [name]

Create an App with Saleor App Template

Positionals:
  name  [string] [default: "my-saleor-app"]

Options:
      --json                            Output the data as JSON  [boolean] [default: false]
      --short                           Output data as text  [boolean] [default: false]
  -u, --instance, --url                 Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --dependencies, --deps  [boolean] [default: true]
  -t, --template, --repo, --repository  [string] [default: "saleor/saleor-app-template"]
  -b, --branch  [string] [default: "main"]
  -e, --example  [string]
  -V, --version                         Show version number  [boolean]
  -h, --help                            Show help  [boolean]
```

#### app remove

```sh
$ saleor app remove --help
```

Help output:

```
saleor app remove [app-id]

Create a new Saleor Local App

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
      --app-id           The Saleor App id  [string]
      --force            skip confirmation prompt  [boolean]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor app remove
  saleor app remove --app-id=APP-ID --environment=env-id-or-name --force
```

### vercel

```sh
$ saleor vercel --help
```

Help output:

```
saleor vercel [command]

Integrate with Vercel

Commands:
  saleor vercel login  Add integration for Saleor CLI

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### vercel login

```sh
$ saleor vercel login --help
```

Help output:

```
saleor vercel login

Add integration for Saleor CLI

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### github

```sh
$ saleor github --help
```

Help output:

```
saleor github [command]

Integrate with GitHub

Commands:
  saleor github login  Add integration for Saleor CLI

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

#### github login

```sh
$ saleor github login --help
```

Help output:

```
saleor github login

Add integration for Saleor CLI

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]
```

### open

```sh
$ saleor open --help
```

Help output:

```
saleor open [resource]

Open resource in a browser

Positionals:
  resource  [string] [choices: "dashboard", "api", "docs", "docs/api", "docs/apps", "docs/webhooks", "docs/storefront", "docs/cli"]

Options:
      --json             Output the data as JSON  [boolean] [default: false]
      --short            Output data as text  [boolean] [default: false]
  -u, --instance, --url  Saleor instance API URL (must start with the protocol, i.e. https:// or http://)  [string]
  -V, --version          Show version number  [boolean]
  -h, --help             Show help  [boolean]

Examples:
  saleor open dashboard  Open instance dashboard
  saleor open api        Open instance GraphQL endpoint
  saleor open docs       Open Saleor documentation page
```