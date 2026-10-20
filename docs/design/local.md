# Local Saleor

Cloud and local own their provisioning. Modules import core and their own files; an import-boundary test enforces this. `src/workspace.ts` is the composition root for the shared `init` journey and combines provider flags and handlers. Adding a provider does not require importing it from another module.

Nothing about the chosen organization, project, environment or local instance is remembered between commands; only credentials are stored (in the secret store). Every command takes its target from arguments, flags or `SALEOR_*` environment variables, and prompts for what is missing when a person is at a terminal.

Readiness probes, wait deadlines, timeout/confirmation flags and output are shared in core. Cloud owns its task polling and billing decisions. Local owns the Compose template, Docker subprocess service, instance configuration and lifecycle. Local Docker services have no Cloud API dependency; starting local does not request a Cloud session.

`init` retains the Cloud default and adds `--local`; it creates/reuses a running store and prints how to reach it. It does not scaffold source files. Provider-specific flags used with the wrong provider fail explicitly. `local up/status/down` expose lifecycle control separately.

`init` retains the Cloud default and adds `--local`; it creates/reuses a running store and links the directory. It does not scaffold source files. Provider-specific flags used with the wrong provider fail explicitly. `local up/status/down` expose lifecycle control separately. Local linking validates saved instance metadata and is allowed while the stack is stopped.

Local state is per user and per name. The generated Compose template pins all images, shares media between API/worker, and publishes only API/Dashboard on loopback. Ports and setup options persist across restarts. A per-instance PID lock serializes lifecycle commands. Database migrations run on each up; sample data and initial admin creation run transactionally with a database marker and advisory lock, so retries preserve the login and do not seed twice. `down` preserves volumes by default. Confirmed data deletion removes volumes, credentials and instance files.

The readiness timeout begins after downloads and migrations. Setup failures return a typed error; an API readiness timeout returns NOT_READY (75) while containers continue running. `status` checks Docker state and the GraphQL payload separately.

This implements phases 1 and 2. Configurator, storefront generation, URL targets, local logs/list commands, automatic upgrades and Cloud store-token exchange are deferred. Local stack behavior must be checked with real Docker in addition to fake-service tests; arbitrary version overrides have no compatibility guarantee with the pinned Dashboard.

Compose derives from [saleor-platform](https://github.com/saleor/saleor-platform/blob/main/docker-compose.yml), with backend settings from its [backend environment](https://github.com/saleor/saleor-platform/blob/main/backend.env). The bootstrap uses Saleor's [populatedb command](https://github.com/saleor/saleor/blob/3.23.41/saleor/core/management/commands/populatedb.py).
