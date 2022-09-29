## `saleor dev` command

```
saleor dev [command]

Commands:
  saleor dev prepare [branch|prURL]  Build cli from branch or pull request URL
  saleor dev info                    Show env info for debugging

Options:
      --json             Output the data as JSON                       [boolean]
  -u, --instance, --url                                                 [string]
  -V, --version          Show version number                           [boolean]
  -h, --help             Show help                                     [boolean]
```

### saleor dev info

```
saleor dev info

Show env info for debugging

Options:
      --json             Output the data as JSON                       [boolean]
  -u, --instance, --url                                                 [string]
  -V, --version          Show version number                           [boolean]
  -h, --help             Show help                                     [boolean]
```

`saleor dev info` command returns the information about the Saleor CLI for troubleshooting issues. It provides the information about currently installed Saleor CLI version and the system information such as OS, CPU, browsers version etc.

```
Saleor CLI v1.15.0-rc.1

  System:
    OS: macOS 12.4
    CPU: (8) arm64 Apple M1
    Memory: 91.61 MB / 16.00 GB
    Shell: 5.8.1 - /bin/zsh
  Binaries:
    Node: 18.8.0 - /opt/homebrew/bin/node
    Yarn: 1.22.19 - /opt/homebrew/bin/yarn
    npm: 8.18.0 - /opt/homebrew/bin/npm
  Browsers:
    Chrome: 105.0.5195.125
    Firefox: 104.0.2
    Safari: 15.5
```

### saleor dev prepare

```
saleor dev prepare [branch|prURL]

Build cli from branch or pull request URL

Options:
      --json             Output the data as JSON                       [boolean]
  -u, --instance, --url                                                 [string]
  -V, --version          Show version number                           [boolean]
  -h, --help             Show help                                     [boolean]
```

`saleor dev prepare` command allows to prepare the local build of the Saleor CLI from the Github repository. Command should be run in the directory of the cloned saleor-cli repository - https://github.com/saleor/saleor-cli.

The process steps of `saleor dev prepare` command:

1. get the chosen codebase (main, branch, PR)
2. run `pnpm i`
3. run `pnpm bulid`

Prepared build is available in the `dist` directory.

Use the build with `node ./dist/saleor.js command-name`


Usage:

prepare from the main:

`saleor dev prepare`

prepare from branch:

`saleor dev prepare some-branch`

prepare from pull request:

`saleor dev prepare https://github.com/saleor/saleor-cli/pull/PR-NUMBER`

