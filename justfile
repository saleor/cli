alias p := publish

publish version:
  #!/usr/bin/env bash
  set -euo pipefail
  pnpm compile 
  newversion=`pnpm version {{version}} -m "Release %s" --tag-version-prefix=`
  echo Preparing $newversion
  pnpm publish --no-git-checks {{ if version == "prerelease" { "--tag next" } else { "" } }}
  node -e "let pkg=require('./package.json'); pkg.name='saleor'; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2));"
  pnpm publish --no-git-checks {{ if version == "prerelease" { "--tag next" } else { "" } }}
  node -e "let pkg=require('./package.json'); pkg.name='saleor-cli'; require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2));"

