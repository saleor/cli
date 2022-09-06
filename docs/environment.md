## saleor environment

```
saleor environment [command]

Commands:
  saleor env show [key|environment]      Show a specific environment
  saleor env list                        List environments
  saleor env create [name]               Create a new environment
  saleor env switch [key|environment]    Make the provided environment the defau
                                         lt one
  saleor env remove [key|environment]    Delete an environment
  saleor env upgrade [key|environment]   Upgrade a Saleor version in a specific
                                         environment
  saleor env clear <key|environment>     Clear database for environment
  saleor env populate <key|environment>  Populate database for environment
  saleor env promote [key|environment]   Promote environment to production

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor env show

```
saleor env show [key|environment]

Show a specific environment

Positionals:
  key, environment  key of the environment                              [string]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor env list

```
saleor env list

List environments

Options:
      --json      Output the data as JSON                              [boolean]
      --extended  show extended table                 [boolean] [default: false]
  -V, --version   Show version number                                  [boolean]
  -h, --help      Show help                                            [boolean]
```

### saleor env create

```
saleor env create [name]

Create a new environment

Positionals:
  name  name for the new environment                                    [string]

Options:
      --json          Output the data as JSON                          [boolean]
      --project       create this environment in this project           [string]
      --database      specify how to populate the database              [string]
      --saleor        specify the Saleor version                        [string]
      --domain        specify the domain for the envronment             [string]
      --email         specify the dashboard access email                [string]
      --login         specify the api Basic Auth login                  [string]
      --pass          specify the api Basic Auth password               [string]
      --deploy        specify Vercel deployment                        [boolean]
      --restore_from  specify snapshot id to restore database from      [string]
  -V, --version       Show version number                              [boolean]
  -h, --help          Show help                                        [boolean]
```

### saleor env switch

```
saleor env switch [key|environment]

Make the provided environment the default one

Positionals:
  key, environment  key of the environment                              [string]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
  ```

  ### saleor env remove

  ```
  saleor env remove [key|environment]

Delete an environment

Positionals:
  key, environment  key of the environment                              [string]

Options:
      --json     Output the data as JSON                               [boolean]
      --force    skip confirmation prompt                              [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
  ```

  ### saleor env upgrade

  ```
  saleor env upgrade [key|environment]

Upgrade a Saleor version in a specific environment

Positionals:
  key, environment  key of the environment                              [string]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
  ```

### saleor env clear

```
saleor env clear <key|environment>

Clear database for environment

Positionals:
  key, environment  key of the environment                   [string] [required]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor env populate

```
saleor env populate <key|environment>

Populate database for environment

Positionals:
  key, environment  key of the environment                   [string] [required]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor env promote

```
saleor env promote [key|environment]

Promote environment to production

Positionals:
  key, environment  key of the environment                              [string]

Options:
      --json     Output the data as JSON                               [boolean]
      --saleor   specify the Saleor version                             [string]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]

```