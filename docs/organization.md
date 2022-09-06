## saleor organization

```
saleor organization [command]

Commands:
  saleor org show [slug|organization]       Show a specific organization
  saleor org list                           List organizations
  saleor org remove [slug]                  Remove the organization
  saleor org permissions [slug|organizatio  List organization permissions
  n]
  saleor org switch [slug]                  Make the provided organization the d
                                            efault one

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor org show

```
saleor org show [slug|organization]

Show a specific organization

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor org list

```
saleor org list

List organizations

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor org remove

```
saleor org remove [slug]

Remove the organization

Positionals:
  slug  slug of the organization                                        [string]

Options:
      --json     Output the data as JSON                               [boolean]
      --force    skip confirmation prompt                              [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor org permissions

```
saleor org permissions [slug|organization]

List organization permissions

Positionals:
  slug, organization  slug of the organization                          [string]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor org switch

```
saleor org switch [slug]

Make the provided organization the default one

Positionals:
  slug  slug of the organization                                        [string]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```
