# Command behavior

## Input rules

| Command type | Required input | Missing input |
| --- | --- | --- |
| Command group (`org`, `local`) | A subcommand | Offers available actions in a terminal; otherwise shows help. No action runs until selected. |
| Collection query (`org list`, `local list`) | No individual target | Lists the collection. Cloud project/environment lists still require their parent organization scope. |
| Resource query or action (`local status`, `local down`, environment operations) | A specific target and any parent scope | Uses explicit flags/arguments or documented environment variables; prompts where supported, otherwise gives a missing-input error. Never picks the first or sole resource. |
| Setup (`init`, `local up`) | The existing target or a name for a new resource | Asks to select or name a resource in a terminal; unattended local setup requires `--name`. |
| Session operations (`login`, `logout`, `whoami`) | Current CLI account/session | Operates on that session without a store target. |

Resource identity has no implicit default. Cloud scope uses flags before `SALEOR_ORG`, `SALEOR_PROJECT`, and `SALEOR_ENV`; deletion retains its stricter explicit-target requirements. Local commands require `--name` or an interactive answer. Even a single available organization or local instance must be selected. Version, timeout, region and other documented configuration defaults do not select existing resources.

JSON output, pipes, CI and `--no-input` never prompt. Dry runs require enough explicit input to resolve a target without questions. `--force` confirms a destructive operation; it never supplies a missing target. An explicit nonexistent local target may still return an idempotent success from `down`.

### Interactive command flow

Running `saleor` or a bare group (`saleor org`, `saleor project`, `saleor env`, `saleor local`) offers that group's registered actions, with the equivalent command shown beside each choice. Selecting another group opens its actions. Exit leaves without running an action; Ctrl-C cancels with exit code 130.

After selection, the normal command parser and handler run. Missing required positional arguments are requested one at a time, then validated by the same parser. Target selection and confirmations follow the rules above. Flags already supplied are preserved. The command runs once and finishes; the post-login menu remains a separate persistent session.

Complete commands execute directly. Explicit help always shows documentation. Unknown commands, invalid values, and missing required flags report their usual errors. Dry runs and unattended invocations never open the picker or request positional input. New command groups inherit this flow from the shared runtime; they do not define separate menus.
