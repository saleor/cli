import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { preview, result, run } from "../../core/command.ts";
import { dryRunFlag, forceFlag, waitFlag } from "../../core/flags.ts";
import { catalogInfo } from "../../core/input-info.ts";
import { offerDashboard } from "../../core/interaction.ts";
import { columns } from "../../core/output.ts";
import type { InstanceState } from "../../core/target.ts";
import { SALEOR_VERSION } from "./compose.ts";
import { resolveLocalName } from "./input.ts";
import { down, list, previewDown, status, up } from "./lifecycle.ts";

catalogInfo.flag("saleor-version", { default: SALEOR_VERSION });

export const nameFlag = Flag.String("name").pipe(
  Flag.withMetavar("name"),
  Flag.withDescription(
    "Local instance name. Required without interactive input."
  ),
  Flag.optional
);

export const localSetupFlags = {
  name: nameFlag,
  saleorVersion: Flag.String("saleor-version").pipe(
    Flag.withMetavar("version"),
    Flag.withDescription(
      `Saleor API version for a new instance (default ${SALEOR_VERSION}).`
    ),
    Flag.optional
  ),
  sampleData: Flag.Boolean("sample-data").pipe(
    Flag.withDescription(
      "Load sample products and orders. Can be added to an existing instance; never removed."
    ),
    Flag.withDefault(false)
  ),
};

const nameArgs = (name: string) => ` --name ${name}`;

const connection = (data: {
  readonly graphqlUrl: string;
  readonly dashboardUrl: string | null;
  readonly mailUrl: string | null;
  readonly admin: { readonly email: string; readonly password: string | null };
}) =>
  [
    `  GraphQL API: ${data.graphqlUrl}`,
    `  Dashboard:   ${data.dashboardUrl}`,
    data.mailUrl === null ? "" : `  Mail inbox:  ${data.mailUrl}`,
    `  Admin email: ${data.admin.email}`,
    data.admin.password === null ? "" : `  Password:    ${data.admin.password}`,
  ].filter(Boolean);

export const localUpText = (data: Effect.Success<ReturnType<typeof up>>) =>
  [
    `✓ Local instance "${data.name}" is ready (${data.created ? "created" : "already existed"}).`,
    ...connection(data),
  ].join("\n");

const localUp = Command.make(
  "up",
  {
    ...localSetupFlags,
    newPorts: Flag.Boolean("new-ports").pipe(
      Flag.withDescription(
        "Move the instance to new free ports, for when another program took one. Its URLs change; data is kept."
      ),
      Flag.withDefault(false)
    ),
    timeout: waitFlag(
      "How long to wait for the GraphQL API once the containers start (default 600). Image downloads and database setup come first and are not counted. When it runs out, the instance keeps starting; run the same command again to keep waiting (exit code 75 until then)."
    ),
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const data = yield* up({
          ...flags,
          name: yield* resolveLocalName(flags.name, "setup"),
          saleorVersion: Option.getOrUndefined(flags.saleorVersion),
        });

        return result(data, localUpText(data));
      }),
      offerDashboard
    )
).pipe(
  Command.withDescription(
    "Create a local Saleor stack in Docker, or start an existing one. Keeps existing data. Does nothing if it is already running."
  ),
  Command.withShortDescription("Create or start a local instance."),
  Command.withExamples([
    {
      command: "saleor local up --name demo --sample-data",
      description: "Start a second instance with sample products",
    },
  ])
);

const localList = Command.make("list", {}, () =>
  run(
    Effect.gen(function* () {
      const instances = yield* list;

      return result(
        instances,
        instances.length === 0
          ? "No local instances. Create one with: saleor local up"
          : columns([
              ["NAME", "STATE", "VERSION", "GRAPHQL API", "DASHBOARD"],
              ...instances.map((instance) => [
                instance.name,
                instance.state,
                instance.saleorVersion,
                instance.graphqlUrl,
                instance.dashboardUrl,
              ]),
            ])
      );
    })
  )
).pipe(
  Command.withDescription(
    "List local instances on this computer and whether each one is running."
  ),
  Command.withShortDescription("List local instances.")
);

const localStatus = Command.make("status", { name: nameFlag }, (flags) =>
  run(
    Effect.gen(function* () {
      const data = yield* status(
        yield* resolveLocalName(flags.name, "existing")
      );

      const hints: Partial<Record<InstanceState, string>> = {
        incomplete: `Its first setup did not finish. Finish it with: saleor local up${nameArgs(data.name)} (add --saleor-version <version> to change the version)`,
        starting: `Still starting. Wait for it with: saleor local up${nameArgs(data.name)}`,
        stopped: `Start it with: saleor local up${nameArgs(data.name)}`,
      };

      const hint = hints[data.state];

      return result(
        data,
        [
          `Local instance "${data.name}": ${data.state} (Saleor ${data.saleorVersion}).`,
          ...connection(data),
          ...data.containers.map(
            (container) => `  ${container.Service}: ${container.State}`
          ),
          hint ?? "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    })
  )
).pipe(
  Command.withDescription(
    "Show a local instance's addresses, admin login and containers, and whether its API responds. Does not start anything."
  ),
  Command.withShortDescription("Show a local instance and its admin login.")
);

const localDown = Command.make(
  "down",
  {
    deleteData: Flag.Boolean("delete-data").pipe(
      Flag.withDescription(
        "Permanently delete the instance's database, media and saved credentials."
      ),
      Flag.withDefault(false)
    ),
    dryRun: dryRunFlag,
    force: forceFlag,
    name: nameFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const name = yield* resolveLocalName(
          flags.name,
          "existing",
          flags.dryRun
        );

        if (flags.dryRun) {
          return preview(yield* previewDown(name, flags.deleteData));
        }

        const data = yield* down(name, flags.deleteData, flags.force);

        let text: string;

        if (!data.existed) {
          text = `✓ Local instance "${data.name}" does not exist, so there is nothing to stop.`;
        } else if (data.deletedData) {
          text = `✓ Local instance "${data.name}" ${data.wasRunning ? "stopped" : "was already stopped"}. Its data was deleted.`;
        } else {
          text = `✓ Local instance "${data.name}" ${data.wasRunning ? "stopped" : "was already stopped"}. Its data is kept; start it again with: saleor local up${nameArgs(data.name)}`;
        }

        return result(data, text);
      })
    )
).pipe(
  Command.withDescription(
    "Stop a local instance. Data is kept unless --delete-data is confirmed. Stopping an instance that does not exist succeeds."
  ),
  Command.withShortDescription(
    "Stop a local instance, optionally deleting it."
  ),
  Command.withExamples([
    {
      command: "saleor local down --name demo --delete-data --force",
      description: "Delete an instance and all its data",
    },
  ])
);

export const localCommand = Command.make("local").pipe(
  Command.withDescription("Run local Saleor instances with Docker."),
  Command.withSubcommands([localUp, localList, localStatus, localDown])
);

catalogInfo.command("saleor local down", {
  costsMoney: false,
  destructive: true,
  warning:
    "With --delete-data, permanently deletes the local database, media and saved credentials; otherwise keeps data.",
});
