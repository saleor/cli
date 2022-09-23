## `saleor checkout` command

```
saleor checkout [command]

Commands:
  saleor checkout deploy  Deploy `saleor-checkout` to Vercel

Options:
      --json             Output the data as JSON                       [boolean]
  -u, --instance, --url                                                 [string]
  -V, --version          Show version number                           [boolean]
  -h, --help             Show help                                     [boolean]
```

### saleor checkout deploy

```
saleor checkout deploy

Deploy `saleor-checkout` to Vercel

Options:
      --json             Output the data as JSON                       [boolean]
  -u, --instance, --url                                                 [string]
      --github-prompt    specify prompt presence for repository creation on Gith
                         ub                          [boolean] [default: "true"]
  -V, --version          Show version number                           [boolean]
  -h, --help             Show help                                     [boolean]
```

Example usage in non-interactive mode

```
saleor checkout deploy \
  --organization=organization-slug \
  --environment=env-id-or-name \
  --no-github-prompt
```