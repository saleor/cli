import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "../../core/command.ts";
import { forceFlag, timeoutFlag } from "../../core/flags.ts";
import { down, status, up } from "./lifecycle.ts";

export const nameFlag = Flag.String("name").pipe(
  Flag.withDescription('Local instance name (default "default").'),
  Flag.withDefault("default")
);

export const localSetupFlags = {
  name: nameFlag,
  saleorVersion: Flag.String("saleor-version").pipe(
    Flag.withDescription(
      "Saleor API version for a new instance (default 3.23.41)."
    ),
    Flag.optional
  ),
  sampleData: Flag.Boolean("sample-data").pipe(
    Flag.withDescription("Load sample products and orders on first setup."),
    Flag.withDefault(false)
  ),
};

export const localUpText = (data: Effect.Success<ReturnType<typeof up>>) =>
  [
    `✓ Local instance "${data.name}" is ready (${data.created ? "created" : "already existed"}).`,
    `  GraphQL API: ${data.graphqlUrl}`,
    `  Dashboard:   ${data.dashboardUrl}`,
    `  Admin email: ${data.admin.email}`,
    `  Password:    ${data.admin.password}`,
    data.linkFile
      ? "This directory now uses this instance; saved in .saleor/link.json."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

const localUp = Command.make(
  "up",
  {
    ...localSetupFlags,
    link: Flag.Boolean("link").pipe(
      Flag.withDescription("Use this instance in the current directory."),
      Flag.withDefault(false)
    ),
    timeout: timeoutFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const data = yield* up({
          ...flags,
          saleorVersion: Option.getOrUndefined(flags.saleorVersion),
        });

        return result(data, localUpText(data));
      })
    )
).pipe(
  Command.withDescription(
    "Create or restart a local Saleor stack in Docker. Keeps existing data. --timeout limits the GraphQL wait after image downloads and database setup."
  )
);

const localStatus = Command.make("status", { name: nameFlag }, (flags) =>
  run(
    Effect.gen(function* () {
      const data = yield* status(flags.name);

      return result(
        data,
        `Local instance "${data.name}": ${data.state}.\n  GraphQL API: ${data.graphqlUrl}\n  Dashboard:   ${data.dashboardUrl}`
      );
    })
  )
).pipe(
  Command.withDescription(
    "Show local containers and check whether the Saleor API responds."
  )
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
    force: forceFlag,
    name: nameFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const data = yield* down(flags.name, flags.deleteData, flags.force);

        return result(
          data,
          `✓ Local instance "${flags.name}" stopped. ${flags.deleteData ? "Its data was deleted." : "Its data is kept; run local up to restart it."}`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Stop a local instance. Data is kept unless --delete-data is confirmed."
  )
);

export const localCommand = Command.make("local").pipe(
  Command.withDescription("Run local Saleor instances with Docker."),
  Command.withSubcommands([localUp, localStatus, localDown])
);
