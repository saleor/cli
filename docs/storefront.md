## `saleor storefront` command

```
saleor storefront [command]

Commands:
  saleor storefront create [name]  Bootstrap example [name]
  saleor storefront deploy         Deploy this `react-storefront` to Vercel

Options:
      --json             Output the data as JSON                       [boolean]
  -u, --instance, --url                                                 [string]
  -V, --version          Show version number                           [boolean]
  -h, --help             Show help                                     [boolean]
```

### saleor storefront create

```
saleor storefront create [name]

Bootstrap example [name]

Positionals:
  name                                         [string] [default: "saleor-demo"]

Options:
      --json             Output the data as JSON                       [boolean]
  -u, --instance, --url                                                 [string]
      --demo             specify demo process         [boolean] [default: false]
      --environment      specify environment id                         [string]
  -V, --version          Show version number                           [boolean]
  -h, --help             Show help                                     [boolean]
```

### saleor storefront deploy

```
saleor storefront deploy

Deploy this `react-storefront` to Vercel

Options:
      --json             Output the data as JSON                       [boolean]
  -u, --instance, --url                                                 [string]
      --dispatch         dispatch deployment and don't wait till it ends
                                                      [boolean] [default: false]
      --with-checkout    Deploy with checkout         [boolean] [default: false]
      --github-prompt    specify prompt presence for repository creation on Gith
                         ub                          [boolean] [default: "true"]
  -V, --version          Show version number                           [boolean]
  -h, --help             Show help                                     [boolean]
```

Example usage in non-interactive mode

```
saleor storefront deploy \
  --organization=organization-slug \
  --environment=env-id-or-name \
  --no-github-prompt
  --with-checkout
```