import { Effect } from "effect";
import { defineActions, type Planned } from "../../core/action.ts";
import type { CommandResult } from "../../core/command.ts";
import { option } from "../../core/inputs.ts";
import {
  appFolder,
  appSlug,
  appIdentifier,
  createApp,
  finishApp,
  inspect,
  notApp,
  TEMPLATE,
} from "./template.ts";
import { shown } from "../../core/output.ts";
import { newAppInput, resolveNewApp } from "./targets.ts";

const app = defineActions();

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
    app: newAppInput,
    dir: option.string("dir", {
      description:
        "Directory to create it in, relative to the current one. Must be new or empty.",
      metavar: "path",
    }),
  },
  name: "create",
  plan: (input) =>
    Effect.gen(function* () {
      const name = yield* resolveNewApp(newAppInput, input.app);

      const slug = yield* appSlug(name);

      const dir = appFolder(input.dir, slug);
      const found = inspect(dir);

      if (found.kind === "other") {
        return yield* notApp(
          dir,
          "Choose another name with --app, or an empty or new directory with --dir."
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
        repository: true,
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
