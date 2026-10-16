# PoC validation and remaining limits

## Scope

The transcript's final decisions authorize a Cloud PoC, flat resource commands, Node 22+ with Effect, a simple `{ok,data|error}` result envelope, device login using Jolly's temporary client, and real Cloud testing. Configurator, backups, restores, upgrades, organization creation, backend changes and publication remain outside scope.

The source is run directly with Node's native TypeScript stripping (22.18+). There is no bundle or installer yet. All module code currently loads at startup; lazy loading and a startup performance budget remain later work. Effect's CLI parser supplies shell completions via `--completions`.

## Evidence

Automated checks run with `pnpm check`. Command tests use the real process and isolated local HTTP servers; readiness tests inject Effect services. They do not prove deployed behavior. The production smoke script independently checks account/resource discovery and, when explicitly enabled, real creation, timeout, reuse, readiness and cleanup.

Production API token authentication has been exercised. The previous session's `cli-poc` project and sandbox were found again, reused with a fresh GraphQL readiness probe, and deleted in this continuation. The fresh production smoke run created `cli-poc-mvb3ci8k` on the free `dev` plan, returned `NOT_READY` on its first zero-timeout invocation, then reused both resources and verified GraphQL readiness. It deleted the sandbox and project and confirmed the project was absent afterward. Local evidence is in `.context/live/smoke.log`; it contains no credentials.

Device approval, denial, expiry, saved pending approval, automatic token refresh, logout and file permissions have automated coverage. Browser approval and the OS keyring have not been tested end to end against production in this continuation. No paid resources or production environments were created or deleted.

## Behaviour worth knowing

- Selection: flags, then `SALEOR_ORG` / `SALEOR_PROJECT` / `SALEOR_ENV`, then the nearest `.saleor/link.json`. The linked project and environment apply only when the selected organization is the linked one, so `--org other` in a linked directory never picks up a project from elsewhere. `env delete` is narrowed only by an explicit `--project`, so it never reports an environment in another project as already gone.
- Only sandboxes are deleted. This is an allowlist: production and any service type the CLI does not recognise are refused.
- `NOT_READY` and `CONFIRMATION_REQUIRED` suggestions repeat the exact command line the process was started with (plus `--force` where needed), so they keep `--timeout` and every other flag.
- Ctrl-C at a confirmation prompt exits 130 like any other interruption.

## Limits and backend observations

- The production API omits `login` and `password` from environment responses even though the copied schema requires them. Generator overrides make those fields optional; the backend snapshot itself stays intact.
- `/estimated-costs/` serializes the organization's existing projects. It is not a hypothetical new-project quote. The PoC displays plan rates before a confirmed paid-project write. A true cost preview remains a backend/product follow-up; paid provisioning was not tested live.
- Readiness uses Cloud's `is_blocking` task filter, which returns blocking tasks still running *and* a failed environment creation (`saleor_cloud/resources/filters.py`, `Environment.blocking_tasks_filter`). Recovery after a lost create reply therefore needs no local task id, and a creation that failed before a restart is reported as `TASK_FAILED` instead of timing out. `FAILED` and `TIMED_OUT` stop waiting when observed.
- Name lookup handles interruption, but the backend has no idempotency key. Two simultaneous creates or a stale resource list can still race. Non-idempotent writes are not retried after transport errors/5xx.
- Cloud rejects environment and project deletion with HTTP 400 while a task runs ("There are active tasks…") or during maintenance. Only those messages are treated as retryable; other 400s are `API_VALIDATION_ERROR`.
- The wait timeout bounds polling, not the whole command including every API request and retry. GraphQL readiness checks are anonymous and return addresses only.
- The pre-warmed path lets Cloud choose database contents. The smoke test checks the store answers; it does not promise an empty database.
- Keyring selection probes readability. Writes the keyring refuses fall back to the private file, and reads check both. The credentials file is replaced atomically (temp file + rename). When two processes refresh at once and Keycloak refuses the slower one's rotated refresh token, that process uses the tokens the other one stored. There is no lock, so other concurrent credential writes are last-writer-wins.
- The command catalogue uses Effect's internal `buildHelpDoc` to derive input metadata. Effect is pinned; a catalogue process test protects this integration on dependency upgrades.
- Effect's subcommand list is typed `Command.Any`, which drops what each command needs to run. `defineModule` checks at compile time that a module's layer builds those services before they are dropped, and `main.ts` merges every module's layer. Global flags the root provides are listed in `CoreServices` (`src/core/module.ts`); a new global flag must be added there.
