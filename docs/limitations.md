# Known limitations

- Not installable yet: `pnpm build` produces a standalone `dist/saleor.mjs`, but the package (`bin`, `files`, `private`) is not set up to publish it, and `pnpm saleor` runs the TypeScript sources on Node 22.18+.
- Configurator, backups, restores, upgrades and organization creation are not supported.
- Login uses Jolly's OAuth client (`jolly`) until device login is enabled for `saleor-cli`.
- Browser approval and the OS keyring have not been tested end to end against production.
- Paid projects have not been provisioned live. Before a paid project is created, only the plan's published rates are shown, not a cost estimate.
- Extra sandboxes in a paid project may incur charges without a confirmation step.
- Cloud has no idempotency keys: two simultaneous creates with the same name can both succeed.
- A create that fails ambiguously (timeout, 5xx) is not retried; re-run the command to find out whether it happened.
- `--timeout` bounds waiting, not the whole command; API timeouts and retries can add to it.
- Pre-warmed environments (no `--domain-label`) come with whatever database contents Cloud chose; an empty database is not guaranteed.
- Readiness only checks that the GraphQL endpoint answers; no store credentials are returned.
- Concurrent CLI processes writing credentials are last-writer-wins (no file lock).
- `saleor commands` reads an internal Effect API to list arguments and flags; an Effect upgrade can break it (a test catches this).
- All modules load at startup; there is no startup-time budget yet.
- The production API omits `login` and `password` from environment responses, which the published schema marks required; the CLI treats them as optional.
