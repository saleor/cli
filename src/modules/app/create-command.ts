import { Effect, Option } from "effect";
import { defineActions, type Planned } from "../../core/action.ts";
import type { CommandResult } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { askText, isInteractive, required } from "../../core/interaction.ts";
import { recordAnswer } from "../../core/invocation.ts";
import { slugify } from "../../core/project.ts";
import {
  appFolder,
  appIdentifier,
  createApp,
  finishApp,
  inspect,
  shown,
  TEMPLATE,
} from "./template.ts";

const app = defineActions();

// The app's name: --app, else asked in a terminal.
const nameFrom = (given: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isSome(given)) {
      return given.value;
    }

    if (!(yield* isInteractive)) {
      return yield* fail("USAGE_ERROR", "Name the app to create.", {
        suggestion: "Pass its name with --app <name>, such as --app loyalty.",
      });
    }

    const name = yield* askText({
      message: "What is the app called?",
      placeholder: "loyalty",
      validate: required("A name"),
    });

    yield* recordAnswer({ option: ["--app", name] });

    return name;
  });

interface AppCreated {
  readonly created: boolean;
}

export const createCommand = app.ensure({
  description: `Start an app of your own from the Saleor app template (${TEMPLATE.repository}, as it is on ${TEMPLATE.ref}). Inside a project it goes in apps/<name> and is listed in saleor.yml as a component, so a project can have several apps; elsewhere in ./<name>. Its manifest gets an id of its own (<project>.<name>), since a store has one app per id. The directory becomes a git repository unless it is inside one, and dependencies are installed. Running it again on the same directory reuses the files and retries the install. Then start it with pnpm dev and install it on a store with app add --manifest <url>/api/manifest, where <url> is http://localhost:3000 for a local store and a tunnel to port 3000 for a Saleor Cloud store.`,
  examples: [
    {
      command: "saleor app create --app loyalty",
      description: "Create apps/loyalty in the project",
    },
  ],
  inputs: {
    app: option.string("app", {
      description: "The app's name; its folder and manifest id come from it.",
      metavar: "name",
    }),
    dir: option.string("dir", {
      description:
        "Directory to create it in, relative to the current one. Must be new or empty.",
      metavar: "path",
    }),
  },
  name: "create",
  plan: (input) =>
    Effect.gen(function* () {
      const name = yield* nameFrom(input.app);
      const slug = slugify(name);

      if (slug === "") {
        return yield* fail(
          "USAGE_ERROR",
          `"${name}" has no letters or digits to name a folder after.`
        );
      }

      const dir = appFolder(input.dir, slug);
      const found = inspect(dir);

      if (found.kind === "other") {
        return yield* fail(
          "NAME_CONFLICT",
          `${shown(dir)} is not empty and is not a Saleor app.`,
          {
            suggestion:
              "Choose another name with --app, or an empty or new directory with --dir.",
          }
        );
      }

      const identifier =
        found.kind === "app" && found.id !== undefined
          ? found.id
          : appIdentifier(slug);

      const spec = {
        created: found.kind === "absent",
        dir,
        identifier,
        name,
      };

      return {
        action: found.kind === "absent" ? "create" : "reuse",
        apply: Effect.map(
          found.kind === "absent" ? createApp(spec) : finishApp(spec),
          (made) => ({
            ...made,
            headline: `App "${name}" in ${shown(dir)} is ready (${spec.created ? "created" : "already existed"}).`,
          })
        ),
        details: { directory: dir, identifier, template: TEMPLATE.repository },
        risk: null,
        state: found.kind === "absent" ? "absent" : "exists",
        summary: [
          ["Template", `${TEMPLATE.repository} (${TEMPLATE.ref})`],
          ["Directory", shown(dir)],
          ["Manifest id", identifier],
        ],
        target: { id: identifier, name, scope: {}, type: "app" },
      } satisfies Planned<
        CommandResult<AppCreated> & { headline: string },
        unknown
      >;
    }),
  summary: "Create your own app from the Saleor app template.",
});
