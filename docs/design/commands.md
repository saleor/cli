# Command conventions

The CLI covers the tasks people come to it for, and nothing else: get a store (`init`), see the stores there are and start, stop, add or remove one (`env`), keep a store's configuration as code (`config`), connect a storefront to one (`storefront`), talk to its API (`api`) and receive its webhooks while building an app (`webhook`). Login is a step within Cloud actions when required; explicit `login` and `logout` remain available outside the exploratory menu. Anything rarer (plans, projects, production environments) is in the Saleor Cloud dashboard. A new command must be a task of that weight, not a second way to do one of these.

## Grammar

A command reads as a short sentence: `saleor <noun> <verb> [<env>] [flags]`.

```
saleor init                         saleor config status
saleor env list                     saleor config diff     [<env>]
saleor env add <name>               saleor config deploy   [<env>]
saleor env start  [<env>]           saleor config pull     [<env>]
saleor env stop   [<env>]           saleor config edit     "<description>"
saleor env remove [<env>]           saleor storefront create [<env>]
saleor login | logout               saleor storefront use    [<env>]
saleor api call [<env>]             saleor webhook listen    [<env>]
```

- **Five nouns.** `env` (the stores a project works with), `config` (their configuration), `storefront`, `api` (a store's own GraphQL API) and `webhook` (its webhooks, received here). Top-level verbs (`init`, `login`, `logout`, `onboard`, `commands`) are about the CLI or a new project, not a resource.
- **One way to name a store.** The word after the verb, `<env>`: a name from `saleor.yml` (`local`, `staging`) or a store ref (`local:<name>`, `cloud:<org>/<env key>`) for any store, inside a project or not. No command but `init` names a store with a flag. `<env>` defaults to `SALEOR_ENV`, then the project's only environment, then a question.
- **Where a store runs is configuration, not a command.** Local and Cloud stores answer the same commands. Each module that runs stores is an adapter behind `env` (an instance source, below), as a database adapter is behind Rails' `db:migrate`. A source that cannot do something (stop a Cloud environment) is refused with a usage error, not given its own command.
- **A closed set of verbs, in pairs.** Each kind has its verbs, and a verb means the same change everywhere: `add`/`remove`, `start`/`stop`, `pull`/`deploy`. A new verb is a decision made in `src/core/conventions.test.ts`, not in passing.

Every command is an action of one **kind**. The kind is the policy: which flags exist, how targets are found, when it asks for confirmation, what `--dry-run` does, how its result is shaped and what the catalog says about its safety. A command declares its kind and supplies only what is specific to it. It does not implement any of the rules below itself.

The rules live in `src/core/action.ts` (kinds), `src/core/target.ts` (targets), `src/core/instances.ts` and `src/core/workspace.ts` (`<env>`), `src/core/errors.ts` (error codes) and `src/core/invocation.ts` (hints). `src/core/conventions.test.ts` checks every registered command against them, grammar included.

## Kinds

| Kind | Examples | Adds | Result `data` | Text |
| --- | --- | --- | --- | --- |
| `list` | `env list`, `config status`, `config diff` | — | array of items | table, or an empty-state line |
| `ensure` | `init`, `env add`, `env start`, `config deploy`, `storefront create`, `storefront use` | `--dry-run`; `--timeout` if it waits | the resource plus `created` | `✓ <target> is ready (created \| already existed).` then details |
| `remove` | `env stop`, `env remove` | `--dry-run`; `--force` if it can lose data; `--timeout` if it waits | `{ action, existed, target, … }` | `✓ Deleted <target>.`, `✓ Stopped <target>.`, or `✓ <target> does not exist; nothing to do.` |
| `session` | `login`, `logout`, `config validate`, `commands`, `api call`, `webhook listen` | — | whatever it is about: the login, a check, an API answer, deliveries | free text |

A module gets its definers from `defineActions(policy)`. A policy applies to every action of the module. Groups (`env`, `config`, `storefront`) are declared with `defineGroup` and have no behavior of their own.

## Targets

A target is anything a command acts on: a store (`<env>`), or, in `init`, an organization, project or new instance. Every target is declared once with `target()` and resolved the same way:

1. The flag or argument, if given.
2. Its environment variable (`SALEOR_ENV`; `SALEOR_ORG` and `SALEOR_PROJECT` in `init`). **`remove` actions never read these**: a stop or deletion acts only on what the command line or a person named.
3. For `<env>` inside a project: the project's only environment (not for `remove` actions), else a pick among its environments.
4. In a terminal, a list of the existing ones to pick from, plus "create a new one" where the action creates it. Nothing is pre-selected, not even when only one exists.
5. Otherwise `CONTEXT_MISSING` (exit 2). The error lists the choices in `details.choices` and says how to pass the target.

The parser never requires a target. A positional target is optional to the parser so that step 5, not a parser error, reports it. Validation (`check`) applies however a value arrived, typed or answered.

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

Any command written into a message, suggestion or result is built with `command(...)` or `rerunCommand(...)`. These quote every word, so a pasted hint is the same command. A hint names a store as a person would type it here: its name in `saleor.yml` when it has one (`envWord`), else its ref.

## Menus

Menus are generated from the registered commands, never written by hand:

- `saleor` alone, or a person finishing `login`, opens the **home menu**. It lists every top-level command and is offered again after each one, until Exit.
- A bare group (`saleor env`) offers that group's actions once; the chosen one runs and the command finishes. The menu is the same wherever a person works: local and Cloud stores are one `env` group.
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

## Environments and sources

`env` is core, like `init`: modules never own it. A module that runs stores contributes an **instance source** (`defineModule({ instances })`, `src/core/instance.ts`): how to list and find its stores, and the lifecycle steps it can carry out (`start`, `stop`, `remove`), each returning a plan like any other action. `env` resolves `<env>` to a ref, picks the source by the ref's kind and hands it the step; `src/core/environments.ts` holds the commands and knows no provider. Today the local source starts, stops and removes; the Cloud source removes sandboxes.

A source that needs a login shows a "Log in to …" row in the picker instead of failing it (a **detour** in `target.ts`: a row that does something and then asks again), and an explicit ref that needs one offers it at a terminal. Modules never import each other.

`env add <name>` sets up a store with the same **setup providers** as `init` (each says how a project's environment names its store: a Cloud environment of the same name, a local instance named after the project), then names it in `saleor.yml`: a Cloud store by its ref, a local one as a definition every checkout creates its own instance from. `env remove` deletes the store and, for a ref, its name; a local definition stays, so `env start` creates it again.
