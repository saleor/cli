# Command conventions

The CLI covers the tasks people come to it for, and nothing else: get a store (`init`), log in and out, see what stores exist (`env list`, `local list`) and get rid of one (`env delete`, `local down`), and start a storefront connected to one (`storefront create`) or choose its backend (`storefront env`). `init` creates a store and supports retries by explicit name. `local up` starts an existing local store. Login is a step within Cloud actions when required; explicit login and logout commands remain available outside the exploratory menu. Anything rarer (plans, projects, production environments) is in the Saleor Cloud dashboard. A new command must be a task of that weight, not a second way to do one of these.

Every command is an action of one **kind**. The kind is the policy: which flags exist, how targets are found, when it asks for confirmation, what `--dry-run` does, how its result is shaped and what the catalog says about its safety. A command declares its kind and supplies only what is specific to it. It does not implement any of the rules below itself.

The rules live in `src/core/action.ts` (kinds), `src/core/target.ts` (targets), `src/core/errors.ts` (error codes) and `src/core/invocation.ts` (hints). `src/core/conventions.test.ts` checks every registered command against them.

## Kinds

| Kind | Examples | Adds | Result `data` | Text |
| --- | --- | --- | --- | --- |
| `list` | `env list`, `local list` | — | array of items | table, or an empty-state line |
| `ensure` | `init`, `local up`, `storefront create`, `storefront env` | `--dry-run`; `--timeout` if it waits | the resource plus `created` | `✓ <target> is ready (created \| already existed).` then details |
| `remove` | `env delete`, `local down` | `--dry-run`, `--force`; `--timeout` if it waits | `{ action, existed, target, … }` | `✓ Deleted <target>.`, `✓ Stopped <target>.`, or `✓ <target> does not exist; nothing to do.` |
| `session` | `login`, `logout`, `commands` | — | about the CLI or its login | free text |

A module gets its definers from `defineActions(policy)`. A policy applies to every action of the module. For example, Cloud offers a browser login before any Cloud action. Groups (`env`, `local`) are declared with `defineGroup` and have no behavior of their own.

## Targets

A target is anything a command acts on: an organization, project, environment or local instance. Every target is declared once with `target()` and resolved the same way:

1. The flag or argument, if given.
2. Its environment variable (`SALEOR_ORG`, `SALEOR_PROJECT`, `SALEOR_ENV`). **`remove` actions never read these**: a deletion acts only on what the command line or a person named.
3. In a terminal, a list of the existing ones to pick from, plus "create a new one" where the action creates it. Nothing is pre-selected, not even when only one exists.
4. Otherwise `CONTEXT_MISSING` (exit 2). The error lists the choices in `details.choices` and says how to pass the target.

The parser never requires a target. A positional target is optional to the parser so that step 4, not a parser error, reports it. Filters such as `env list --project` take only steps 1 and 2 and are never asked for. Validation (`check`) applies however a value arrived, typed or answered.

Answers given at prompts are recorded. Every hint that says what to run next includes them, so the next run asks nothing and cannot pick something else.

## Changes: plan, preview, confirm, apply

`ensure` and `remove` actions return a **plan**: what they will do (`create`, `reuse`, `update`, `delete`, `stop`, `none`), the target, its current state, the **risk** if any (what is lost), and a **notice** if any (something to know before it happens, such as that it might be billed). Planning only reads. The plan carries an `apply` effect that does the work.

- `--dry-run` prints the plan and stops. It follows `--output` like any result, and it never asks questions.
- A plan with a risk needs confirmation: `--force`, or "yes" at a terminal. Without a terminal it fails with `CONFIRMATION_REQUIRED`, and the suggested command adds `--force`. This is the only confirmation mechanism; there is no per-command consent flag.
- A plan with a notice says it once, right before the change: in the dry-run preview, in the review below, or on stderr when there is no review. A notice never asks; only lost data does. The CLI does not price anything: Cloud's notice only says that a new environment outside the free plan might be charged, depending on the plan.
- A plan that creates something after questions were answered is shown for review ("Continue?") first.
- `reuse` and `none` never ask anything. Removing something absent succeeds, so retries and cleanups are safe.
- After an `ensure` produces a store, a person at a terminal is offered its dashboard.

## Waiting

`--timeout <seconds>` bounds waiting for work that continues without the CLI, such as Cloud provisioning or containers starting. It does not bound work the CLI does itself, such as downloading images or running migrations. When it runs out, the command fails with `NOT_READY` (exit 75), and running it again continues the wait. The hint drops `--timeout 0`.

## Errors

Every error code, with its exit code and whether retrying can help, is listed in `ERRORS` (`src/core/errors.ts`) and published by `saleor commands --json`. Pick a code by its meaning there:

- exit 2 means the command line must change: `USAGE_ERROR` for invalid values, `CONTEXT_MISSING` for missing targets, `AMBIGUOUS_TARGET` for a name that matches several;
- `UNAVAILABLE` (retry) is for the service's current state;
- `BUSY` (retry) is for another operation in progress;
- `LOCAL_STATE_ERROR` is for the CLI's own files;
- `DOCKER_FAILED` is for Docker commands;
- `TASK_FAILED` is only for failed provisioning tasks.

## Hints

Any command written into a message, suggestion or result is built with `command(...)` or `rerunCommand(...)`. These quote every word, so a pasted hint is the same command. Cloud hints carry the scope they need (`--org`, `--project`).

## Menus

Menus are generated from the registered commands, never written by hand:

- `saleor` alone, or a person finishing `login`, opens the **home menu**. It lists every top-level command and is offered again after each one, until Exit.
- A bare group (`saleor env`) offers that group's actions once; the chosen one runs and the command finishes.
- Help, `--dry-run`, unattended runs and invalid commands never open a menu.
- Ctrl-C exits 130.

## `init`

`init` is composed in `src/core/setup.ts` from **setup providers** that modules contribute through `defineModule({ setup })`. The default provider (Cloud) needs no flag; every other provider has one (`--local`).

The provider is chosen in this order:

1. its flag;
2. which provider's own flags were typed;
3. a question at a terminal;
4. the default.

Environment variables never choose a provider. Typing flags of two providers is a `USAGE_ERROR`. Adding a provider needs no change to `init`.

Modules that build on a store contribute a **setup extension** (`defineModule({ setupExtension })`) instead of a provider. Its questions come after the provider's, once everything needed for the store is known. Its plan joins the store's plan, so `--dry-run` and the review show it. Its preparation runs while the store is set up, and it finishes with whichever store the provider made. Its result sits under its name in `init`'s result (`data.storefront`).

## Stores across modules

A command that works with a store wherever it runs takes it as a ref with `--instance` (`SALEOR_INSTANCE`): `cloud:<org>/<env key>` or `local:<name>`. Modules that run stores contribute an **instance source** (`defineModule({ instances })`) that lists and finds their instances; `src/core/instances.ts` resolves the ref through them and builds the picker from all of them. A source that needs a login shows a "Log in to …" row in the picker instead of failing it (a **detour** in `target.ts`: a row that does something and then asks again). Modules never import each other.
