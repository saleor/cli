## `saleor app` command

```
saleor app [command]

Commands:
  saleor app list                 List installed Saleor Apps for an environment
  saleor app install              Install a Saleor App by URL
  saleor app create [name]        Create a Saleor App template
  saleor app tunnel [port]        Expose your Saleor app remotely via tunnel
  saleor app token                Create a Saleor App token
  saleor app permission           Add or remove permission for a Saleor App
  saleor app deploy               Deploy this Saleor App repository to Vercel
  saleor app generate <resource>  Generate a resource for a Saleor App

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor app list

```
saleor app list

List installed Saleor Apps for an environment

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor app install

```
saleor app install

Install a Saleor App by URL

Options:
      --json           Output the data as JSON                         [boolean]
      --via-dashboard                                 [boolean] [default: false]
      --app-name       Application name                                 [string]
      --manifest-URL   Application Manifest URL                         [string]
  -V, --version        Show version number                             [boolean]
  -h, --help           Show help                                       [boolean]
```

Example usage in non-interactive mode

```
saleor app install --app-name="Saleor app" --manifest-URL="https://my-saleor-app.com/api/manifest"
```

### saleor app create

```
saleor app create [name]

Create a Saleor App template

Positionals:
  name                                       [string] [default: "my-saleor-app"]

Options:
      --json                  Output the data as JSON                  [boolean]
      --dependencies, --deps                           [boolean] [default: true]
  -V, --version               Show version number                      [boolean]
  -h, --help                  Show help                                [boolean]
```

### saleor app tunnel

```
saleor app tunnel [port]

Expose your Saleor app remotely via tunnel

Positionals:
  port                                                  [number] [default: 3000]

Options:
      --json     Output the data as JSON                               [boolean]
      --name     The application name for installation in the Dashboard [string]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor app token

```
saleor app token

Create a Saleor App token

Options:
      --json     Output the data as JSON                               [boolean]
      --app-id   The Saleor App id                                      [string]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor app permission

```
### saleor app permission

Add or remove permission for a Saleor App

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

### saleor app deploy

```
### saleor app deploy

Deploy this Saleor App repository to Vercel

Options:
      --json          Output the data as JSON                          [boolean]
      --dispatch      dispatch deployment and don't wait till it ends
                                                      [boolean] [default: false]
      --register-url  specify your own endpoint for registering apps
             [string] [default: "https://appraptor.vercel.app/api/register-app"]
      --encrypt-url   specify your own endpoint for encrypting tokens
                  [string] [default: "https://appraptor.vercel.app/api/encrypt"]
  -V, --version       Show version number                              [boolean]
  -h, --help          Show help                                        [boolean]
```

### saleor app generate

```
saleor app generate <resource>

Generate a resource for a Saleor App

Positionals:
  resource
   [string] [required] [choices: "webhook", "query", "mutation", "subscription"]

Options:
      --json     Output the data as JSON                               [boolean]
  -V, --version  Show version number                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

Example usage in non-interactive mode

```
<!-- TODO -->
```