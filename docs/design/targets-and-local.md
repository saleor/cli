# Targets and local Saleor

Core owns the target contract and directory link. Cloud and local own provisioning and resolve their own refs. Modules import core and their own files; an import-boundary test enforces this. `src/workspace.ts` is the composition root for the shared `init` and `link` journeys and combines provider flags and handlers. Adding a provider does not require importing it from another module.

A target contains its canonical ref, display name, GraphQL URL, optional Dashboard URL and version, and a lazy store-credential effect. Each module registers an optional target provider with a resolver that closes over its own layer. Registration rejects duplicate kinds. Credentials are omitted from public target metadata. Local credentials perform a store login only when requested; Cloud resolution explicitly reports that store token exchange is unavailable.

Version 2 `.saleor/link.json` has a `target` ref and optional module defaults. Readers accept legacy Cloud links without changing the file. Writes upgrade atomically, retain unrelated sections and never include secrets. Switching to local retains Cloud organization/project defaults but drops the implicit Cloud environment selection. Cloud shorthand replaces the target, including clearing it for a partial link.

Readiness probes, wait deadlines, timeout/confirmation flags and output are shared in core. Cloud owns its task polling and billing decisions. Local owns the Compose template, Docker subprocess service, instance configuration and lifecycle. Local Docker services have no Cloud API dependency; starting local does not request a Cloud session.

`init` retains the Cloud default and adds `--local`; it creates/reuses a running store and links the directory. It does not scaffold source files. Provider-specific flags used with the wrong provider fail explicitly. `local up/status/down` expose lifecycle control separately. Local linking validates saved instance metadata and is allowed while the stack is stopped.

Local state is per user and per name. The generated Compose template pins all images, shares media between API/worker, and publishes only API/Dashboard on loopback. Ports and setup options persist across restarts. A per-instance PID lock serializes lifecycle commands. Database migrations run on each up; sample data and initial admin creation run transactionally with a database marker and advisory lock, so retries preserve the login and do not seed twice. `down` preserves volumes by default. Confirmed data deletion removes volumes, credentials and instance files.

The readiness timeout begins after downloads and migrations. Setup failures return a typed error; an API readiness timeout returns NOT_READY (75) while containers continue running. `status` checks Docker state and the GraphQL payload separately.

This implements phases 1 and 2. Configurator, storefront generation, URL targets, local logs/list commands, automatic upgrades and Cloud store-token exchange are deferred. Local stack behavior must be checked with real Docker in addition to fake-service tests; arbitrary version overrides have no compatibility guarantee with the pinned Dashboard.

Compose derives from [saleor-platform](https://github.com/saleor/saleor-platform/blob/main/docker-compose.yml), with backend settings from its [backend environment](https://github.com/saleor/saleor-platform/blob/main/backend.env). The bootstrap uses Saleor's [populatedb command](https://github.com/saleor/saleor/blob/3.23.41/saleor/core/management/commands/populatedb.py).
