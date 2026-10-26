# Local Saleor

Cloud and local own their provisioning. Modules import core and their own files; an import-boundary test enforces this. Each module contributes a setup provider, and `src/core/setup.ts` composes them into `init` (see [command conventions](commands.md)). Adding a provider does not require importing it from another module.

Nothing about the chosen organization, project, environment or local instance is remembered between commands; only credentials are stored (in the secret store). Every command takes its target from arguments, flags or `SALEOR_*` environment variables, and prompts for what is missing when a person is at a terminal.

Readiness probes, wait deadlines, the per-instance lock, timeout/confirmation flags and output are shared in core. Cloud owns its task polling and billing decisions. Local owns the Compose template, Docker subprocess service, instance configuration and lifecycle. Local Docker services have no Cloud API dependency; starting local does not request a Cloud session.

`init` retains the Cloud default and adds `--local`; it creates/reuses a running store and prints how to reach it. It records nothing in the directory; only with `--storefront` does it scaffold a storefront (see [storefronts](storefront.md)). Provider-specific flags used with the wrong provider fail explicitly. Running it again starts a stopped instance or prints how to reach a running one. `local list` and `local down` cover the rest of the lifecycle.

Local state is per user and per name. The generated Compose template pins all images, shares media between API/worker, and publishes only API/Dashboard on loopback. Ports and setup options persist across restarts. A per-instance PID lock serializes lifecycle commands; a command that finds it held fails with `BUSY`, and a lock left by a dead process is reclaimed atomically. Database migrations run on each up; sample data and initial admin creation run transactionally with a database marker and advisory lock, so retries preserve the login and do not seed twice. `down` preserves volumes by default. Confirmed data deletion removes volumes, credentials and instance files.

The readiness timeout begins after downloads and migrations. Setup failures return a typed error (`DOCKER_FAILED`, `IMAGE_PULL_FAILED`, `PORT_IN_USE`, `LOCAL_STATE_ERROR`); an API readiness timeout returns NOT_READY (75) while containers continue running. `local list` checks Docker state and the GraphQL payload separately.

This implements phases 1 and 2. Configurator, URL targets, local logs, automatic upgrades and Cloud store-token exchange are deferred. Local stack behavior must be checked with real Docker in addition to fake-service tests; arbitrary version overrides have no compatibility guarantee with the pinned Dashboard.

Compose derives from [saleor-platform](https://github.com/saleor/saleor-platform/blob/main/docker-compose.yml), with backend settings from its [backend environment](https://github.com/saleor/saleor-platform/blob/main/backend.env). The bootstrap uses Saleor's [populatedb command](https://github.com/saleor/saleor/blob/3.23.41/saleor/core/management/commands/populatedb.py).
