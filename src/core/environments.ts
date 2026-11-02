import { Effect, Option } from "effect";
import { existsSync, readFileSync } from "node:fs";
import {
  defineActions,
  defineGroup,
  type Ensured,
  listing,
  type Planned,
  type RemoveResult,
} from "./action.ts";
import { type CliFailure, fail } from "./errors.ts";
import { type Input, type InputValue, option } from "./inputs.ts";
import {
  type InstanceSource,
  InstanceSources,
  type Lifecycle,
  type Started,
} from "./instance.ts";
import { envInput, resolveStore, withSignIn } from "./instances.ts";
import { command } from "./invocation.ts";
import { notice } from "./output.ts";
import { recordInSync } from "./deployments.ts";
import {
  addEnvironment,
  configPath,
  findProject,
  forgetEnvironment,
  type Project,
} from "./project.ts";
import { providerChoice, type SetupProvider } from "./setup.ts";
import { target } from "./target.ts";
import { WorkspaceConfiguration } from "./workspace-configuration.ts";
import { envWord } from "./workspace.ts";

// `saleor env`: the stores a project works with, wherever they run. The commands are
// the same for every store; each one names its store with `<env>` (see
// core/instances.ts) and hands the work to the source that runs it, as Rails hands a
// migration to whichever database adapter is configured. A source that cannot do
// something (stop a Cloud environment) is refused with a usage error.

const env = defineActions();

// What a source offers for one step; resolveStore only returns sources that offer it.
const step = <L extends Lifecycle>(source: InstanceSource<never>, which: L) => {
  const offered = source[which];

  return offered === undefined
    ? Effect.fail(
        fail("USAGE_ERROR", `${source.label} stores do not support ${which}.`)
      )
    : Effect.succeed(offered);
};

const projectNames = (project: Option.Option<Project>) =>
  new Map(
    Option.match(project, {
      onNone: () => [],
      onSome: (found) => found.environments.map(([name, ref]) => [ref, name]),
    })
  );

const listCommand = env.list({
  description:
    "List every store the CLI can reach, with its state and URLs: local instances in Docker and Saleor Cloud environments. Inside a project, its environments come first, with their names from saleor.yml. Cloud environments need a login; without one they are left out, with a note saying so.",
  examples: [
    { command: "saleor env list", description: "See every store" },
    {
      command: "saleor env list --agent",
      description: "The same, as JSON with every field",
    },
  ],
  inputs: {},
  name: "list",
  run: () =>
    Effect.gen(function* () {
      const sources = yield* InstanceSources;
      const names = projectNames(findProject());

      const lists = yield* Effect.forEach(sources, (source) =>
        source.list.pipe(
          Effect.catchTag("CliFailure", (failure: CliFailure) =>
            Effect.as(
              notice(
                failure.code === "AUTH_REQUIRED"
                  ? `${source.label} stores are not listed: you are not logged in. Log in with: ${command("login")}`
                  : `Could not list ${source.label} stores: ${failure.message}`
              ),
              []
            )
          )
        )
      );

      const order = [...names.keys()];

      const rank = (ref: string) =>
        names.has(ref) ? order.indexOf(ref) : order.length;

      const rows = lists
        .flat()
        .map((found) => ({
          environment: names.get(found.ref) ?? null,
          ...found,
        }))
        .toSorted((a, b) => rank(a.ref) - rank(b.ref));

      return listing(
        rows,
        [
          ["ENV", (row) => row.environment],
          ["NAME", (row) => row.name],
          ["REF", (row) => row.ref],
          ["STATE", (row) => row.state],
          ["VERSION", (row) => row.saleorVersion],
          ["GRAPHQL API", (row) => row.graphqlUrl],
          ["DASHBOARD", (row) => row.dashboardUrl],
        ],
        `No stores yet. Create one with: ${command("init")}`
      );
    }),
  summary: "List every store and its state.",
});

const startCommand = env.ensure({
  description:
    "Start a store and print how to reach it. A local environment that saleor.yml defines but this checkout does not have yet is created first, with the Saleor version it names; with configure: on-create, the project's configuration is applied before it counts as ready. Starting a running store prints its addresses again. Saleor Cloud runs its environments itself, so they cannot be started here.",
  examples: [
    {
      command: "saleor env start local",
      description: "Start the project's local environment",
    },
    {
      command: "saleor env start local:demo",
      description: "Start a local instance by its ref",
    },
  ],
  inputs: {
    env: envInput,
    newPorts: option.boolean(
      "new-ports",
      "Local stores: move to new free ports, keeping data, for when another program took one. Its URLs change."
    ),
  },
  name: "start",
  plan: (input) =>
    Effect.gen(function* () {
      const { id, source } = yield* resolveStore(input.env, { can: "start" });
      const start = yield* step(source, "start");

      return yield* withSignIn(
        source,
        start(id, { newPorts: input.newPorts, timeout: input.timeout })
      );
    }),
  summary: "Start a store, creating it from saleor.yml if needed.",
  waits: true,
});

// What stopping and removing add to their results.
interface Stopped {
  // The command that starts it again.
  readonly next: string;
}

interface Removed {
  // Its name in saleor.yml, if it had one, and whether that name was removed.
  readonly environment: string | null;
  readonly forgotten: boolean;
}

const stopCommand = env.remove({
  description:
    "Stop a store and keep its data; start it again with env start. Stopping one that is stopped or does not exist succeeds. Saleor Cloud runs its environments itself, so they cannot be stopped here.",
  examples: [
    {
      command: "saleor env stop local",
      description: "Stop the project's local environment",
    },
  ],
  inputs: { env: envInput },
  name: "stop",
  note: (data: RemoveResult & Partial<Stopped>) =>
    data.action === "stop" && data.next !== undefined
      ? `Its data is kept; start it again with: ${data.next}`
      : undefined,
  plan: (input) =>
    Effect.gen(function* () {
      const { id, ref, source } = yield* resolveStore(input.env, {
        can: "stop",
      });

      const stop = yield* step(source, "stop");
      const planned = yield* withSignIn(source, stop(id));

      return {
        ...planned,
        apply: Effect.map(planned.apply, (extra) => ({
          ...extra,
          next: command("env", "start", envWord(ref)),
        })),
      } satisfies Planned<Stopped, never>;
    }),
  summary: "Stop a store, keeping its data.",
});

const removeCommand = env.remove({
  description:
    "Delete a store and all its data. Asks for confirmation in a terminal; needs --force otherwise. Never reads SALEOR_ENV: name what to delete. A Cloud environment's name is removed from saleor.yml with it; a local definition stays, so env start creates the environment again. Only Cloud sandboxes can be deleted here; production environments are deleted in the dashboard. Removing a store that does not exist succeeds.",
  examples: [
    {
      command: "saleor env remove local",
      description: "Delete the project's local environment",
    },
    {
      command: "saleor env remove cloud:acme/abc123 --force",
      description: "Delete a Cloud sandbox without a question",
    },
    {
      command: "saleor env remove staging --dry-run",
      description: "Show what would be deleted",
    },
  ],
  inputs: { env: envInput },
  name: "remove",
  note: (data: RemoveResult & Partial<Removed>) => {
    if (data.environment === undefined || data.environment === null) {
      return;
    }

    return data.forgotten === true
      ? `Removed "${data.environment}" from saleor.yml.`
      : `saleor.yml still defines "${data.environment}"; create it again with: ${command("env", "start", data.environment)}`;
  },
  plan: (input) =>
    Effect.gen(function* () {
      const { id, ref, source } = yield* resolveStore(input.env, {
        can: "remove",
      });

      const remove = yield* step(source, "remove");

      const planned = yield* withSignIn(
        source,
        remove(id, { timeout: input.timeout })
      );

      return {
        ...planned,
        apply: Effect.gen(function* () {
          const extra = yield* planned.apply;
          const project = findProject();
          const environment = projectNames(project).get(ref) ?? null;

          const forgotten =
            environment !== null && Option.isSome(project)
              ? yield* forgetEnvironment(project.value.root, environment)
              : false;

          return { ...extra, environment, forgotten };
        }),
      } satisfies Planned<Removed, never>;
    }),
  risk: "Deletes the store and all its data. This cannot be undone.",
  summary: "Delete a store and all its data.",
  waits: true,
});

// ── env add ──────────────────────────────────────────────────────────────

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

const nameTarget = target({
  check: (value) =>
    NAME.test(value)
      ? undefined
      : "Environment names start with a lowercase letter and contain only lowercase letters, digits and hyphens (up to 40 characters).",
  identifiedBy: "name, as saleor.yml and every command will call it",
  metavar: "name",
  name: "name",
  noun: "environment",
});

const nameInput = nameTarget.input({ creates: true, positional: true });

const requireProject = Effect.suspend(() =>
  Option.match(findProject(), {
    onNone: () =>
      Effect.fail(
        fail(
          "NOT_FOUND",
          "Not in a project: there is no saleor.yml here or above.",
          { suggestion: `Start one with: ${command("init")}` }
        )
      ),
    onSome: (project: Project) => Effect.succeed(project),
  })
);

const hasContent = (file: string) =>
  existsSync(file) && !["", "{}"].includes(readFileSync(file, "utf-8").trim());

// A new environment starts as the project describes it: its configuration is applied
// when the store's source can sign in without asking (local stores). Otherwise, the
// line says how to deploy it.
const configureNew = (project: Project, alias: string, made: Started) =>
  Effect.gen(function* () {
    const file = configPath(project);

    if (!hasContent(file)) {
      return undefined;
    }

    const sources = yield* InstanceSources;
    const source = sources.find((each) => each.kind === made.kind);

    const token =
      source?.access === undefined
        ? Option.none<string>()
        : yield* source.access(made);

    if (Option.isNone(token)) {
      return `Give it the project's configuration with: ${command("config", "deploy", alias)}`;
    }

    yield* (yield* WorkspaceConfiguration).apply(made, token.value, file);
    yield* recordInSync(file, made.ref);

    return "Applied the project's configuration.";
  });

// Adding a name saleor.yml already has makes sure its store is there: started (and
// created, for a local definition) when its source can, else found.
const existingPlan = (alias: string, ref: string, timeout: number) =>
  Effect.gen(function* () {
    const { id, source } = yield* resolveStore(Option.some(ref));

    if (source.start !== undefined) {
      return yield* withSignIn(
        source,
        source.start(id, { newPorts: false, timeout })
      );
    }

    const found = yield* withSignIn(source, source.find(id));

    if (Option.isNone(found)) {
      return yield* fail(
        "NOT_FOUND",
        `saleor.yml names "${alias}" as ${ref}, which does not exist.`,
        {
          suggestion:
            "Remove it from saleor.yml, or add the environment under another name.",
        }
      );
    }

    return {
      action: "reuse",
      apply: Effect.succeed({
        data: { ...found.value, created: false },
        text: "",
      }),
      details: { environment: alias },
      risk: null,
      state: found.value.state,
      target: { id: ref, name: alias, scope: {}, type: "environment" },
    } satisfies Planned<Ensured<Started>, never>;
  });

const addCommand = <R>(providers: readonly SetupProvider<R>[]) => {
  const { fallback, others, selectors, decided, ask } =
    providerChoice(providers);

  const merged = new Map<string, Input<InputValue>>(Object.entries(selectors));

  for (const provider of providers) {
    for (const [key, input] of Object.entries(provider.inputs)) {
      if (key !== provider.naming.input && !merged.has(key)) {
        merged.set(key, input);
      }
    }
  }

  merged.set("alias", nameInput);

  return env.ensure({
    description: `Add an environment to the project: set up a store for it and name it in saleor.yml. Uses ${fallback.label} by default${others.map((p) => `; pass --${p.flag} for ${p.label}`).join("")}. A local environment is saved as a definition each checkout creates its own instance from; a Cloud one by its ref. The project's configuration is applied to a new local store; for a Cloud one, the result says how to deploy it. Adding a name saleor.yml already has makes sure its store is there.`,
    examples: [
      {
        command: "saleor env add staging --org acme --project my-store",
        description: "Add a Cloud sandbox called staging",
      },
      {
        command: "saleor env add review --local",
        description: "Add a second local environment",
      },
    ],
    inputs: Object.fromEntries(merged),
    name: "add",
    plan: (input) =>
      Effect.gen(function* () {
        const project = yield* requireProject;

        const supplied = input.alias;

        const alias = yield* nameInput.resolve(
          Option.isOption(supplied) ? supplied : Option.none(),
          {
            choices: Effect.succeed([]),
            create: {
              label: "Add an environment",
              prompt: "New environment name",
            },
          }
        );

        const existing = project.environments.find(([name]) => name === alias);

        if (existing !== undefined) {
          return yield* existingPlan(alias, existing[1], input.timeout);
        }

        const { provider } = yield* Option.match(yield* decided(input), {
          onNone: () => ask,
          onSome: Effect.succeed,
        });

        yield* provider.before;

        const file = configPath(project);

        if (hasContent(file)) {
          yield* (yield* WorkspaceConfiguration).validate(file);
        }

        const store = yield* provider.plan({
          ...input,
          [provider.naming.input]: Option.some(
            provider.naming.name(project.name, alias)
          ),
        });

        return {
          ...store,
          apply: Effect.gen(function* () {
            const made = yield* store.apply;
            yield* addEnvironment(project.root, alias, made.data);
            const configured = yield* configureNew(project, alias, made.data);

            return {
              ...made,
              text: [
                made.text,
                `Added "${alias}" to saleor.yml; commands call it ${alias}.`,
                ...(configured === undefined ? [] : [configured]),
              ]
                .filter(Boolean)
                .join("\n"),
            };
          }),
          details: { ...store.details, environment: alias },
          summary: [
            ["Environment", `${alias} (saleor.yml)`],
            ...(store.summary ?? []),
          ],
        };
      }),
    summary: "Add an environment to the project.",
    waits: true,
  });
};

export const environmentCommand = <R>(providers: readonly SetupProvider<R>[]) =>
  defineGroup({
    actions: [
      listCommand,
      addCommand(providers),
      startCommand,
      stopCommand,
      removeCommand,
    ],
    description:
      "Environments are the stores a project works with, wherever they run: local instances in Docker and Saleor Cloud environments. Every command names one with the word after it: a name from saleor.yml (local, staging) or a store ref (local:<name>, cloud:<org>/<env key>), as env list prints them. The first environment comes from saleor init.",
    name: "env",
    summary: "List, add, start, stop and remove environments.",
  });
