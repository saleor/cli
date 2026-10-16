# PoC validation and remaining limits

## Scope

The transcript's final decisions authorize a Cloud PoC, flat resource commands, Node 22+ with Effect, a simple `{ok,data|error}` result envelope, device login using Jolly's temporary client, and real Cloud testing. Configurator, backups, restores, upgrades, organization creation, backend changes and publication remain outside scope.

The source is run directly with Node's native TypeScript stripping (22.18+). There is no bundle or installer yet. All module code currently loads at startup; lazy loading and a startup performance budget remain later work. Effect's CLI parser supplies shell completions via `--completions`.

## Evidence

Automated checks run with `pnpm check`. Command tests use the real process and isolated local HTTP servers; readiness tests inject Effect services. They do not prove deployed behavior. The production smoke script independently checks account/resource discovery and, when explicitly enabled, real creation, timeout, reuse, readiness and cleanup.

Production API token authentication has been exercised. The previous session's `cli-poc` project and sandbox were found again, reused with a fresh GraphQL readiness probe, and deleted in this continuation. The fresh production smoke run created `cli-poc-mvb3ci8k` on the free `dev` plan, returned `NOT_READY` on its first zero-timeout invocation, then reused both resources and verified GraphQL readiness. It deleted the sandbox and project and confirmed the project was absent afterward. Local evidence is in `.context/live/smoke.log`; it contains no credentials.

Device approval, denial, expiry, saved pending approval, automatic token refresh, logout and file permissions have automated coverage. Browser approval and the OS keyring have not been tested end to end against production in this continuation. No paid resources or production environments were created or deleted.

## Limits and backend observations

- The production API omits `login` and `password` from environment responses even though the copied schema requires them. Generator overrides make those fields optional; the backend snapshot itself stays intact.
- `/estimated-costs/` serializes the organization's existing projects. It is not a hypothetical new-project quote. The PoC displays plan rates before a confirmed paid-project write. A true cost preview remains a backend/product follow-up; paid provisioning was not tested live.
- Active task queries allow recovery of tasks whose create reply was lost. `FAILED` and `TIMED_OUT` stop waiting when observed. The task list excludes completed failures from its `active` filter, so a failure already completed before restart may instead surface as a readiness timeout. The API does not identify the provisioning operation well enough to safely blame any old failed backup/task.
- Name lookup handles interruption, but the backend has no idempotency key. Two simultaneous creates or a stale resource list can still race. Non-idempotent writes are not retried after transport errors/5xx.
- The wait timeout bounds polling, not the whole command including every API request and retry. GraphQL readiness checks are anonymous and return addresses only.
- The pre-warmed path lets Cloud choose database contents. The smoke test checks the store answers; it does not promise an empty database.
- Keyring selection probes readability, not every platform's write support. File fallback exists for unavailable keyrings. Cross-process refresh coordination and atomic credential updates are not yet implemented.
- The command catalogue uses Effect's internal `buildHelpDoc` to derive input metadata. Effect is pinned; a catalogue process test protects this integration on dependency upgrades.
- `Command.Any` erases module service requirements at registration. The Cloud layer supplies them at runtime; process tests cover the commands. A stronger typed module/layer registration can replace that seam before more modules are added.
