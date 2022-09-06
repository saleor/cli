## saleor project

```
saleor project [command]

Commands:
  saleor project list            List projects
  saleor project create [name]   Create a new project
  saleor project remove [slug]   Remove the project
  saleor project show [project]  Show a specific project

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor project list

```
saleor project list

List projects

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor project create

```
saleor project create [name]

Create a new project

Positionals:
  name  name for the new backup                                         [string]

Options:
      --json     Output the data as JSON                               [boolean]
      --plan     specify the plan                                       [string]
      --region   specify the region                                     [string]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor project remove

```
saleor project remove [slug]

Remove the project

Positionals:
  slug  slug of the project                                             [string]

Options:
      --json     Output the data as JSON                               [boolean]
      --force    skip confrimation prompt                              [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor project show

```
saleor project show [project]

Show a specific project

Positionals:
  project                                                               [string]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```