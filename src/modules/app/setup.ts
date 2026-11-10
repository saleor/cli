import { Effect, Option } from "effect";
import path from "node:path";
import { askConfirm, isInteractive } from "../../core/interaction.ts";
import { shown } from "../../core/output.ts";
import { projectAt, projectFolder } from "../../core/project.ts";
import { type Downloaded, downloadTemplate } from "../../core/scaffold.ts";
import { defineSetupExtension } from "../../core/setup.ts";
import { type Given, named } from "../../core/target.ts";
import { optionalNewAppInput, resolveNewApp } from "./targets.ts";
import {
  appIdentifier,
  appSlug,
  finishApp,
  inspect,
  notApp,
  TEMPLATE,
} from "./template.ts";

// `saleor init --app <name>`: next to the store, an app of your own in the project's
// apps/<name> folder, as `app create` makes it. Asked in a terminal. It is not
// installed on the store: that needs it running at an address the store can reach.

// The app's name: the one given, else in a terminal, when a person wants an app.
const wantedName = (given: Given) =>
  Effect.gen(function* () {
    if (
      !named(given) &&
      !(
        (yield* isInteractive) &&
        (yield* askConfirm("Also create an app of your own?", false))
      )
    ) {
      return Option.none<string>();
    }

    return Option.some(yield* resolveNewApp(optionalNewAppInput, given));
  });

export const appSetup = defineSetupExtension({
  description: `With --app <name> (asked in a terminal), it also downloads the Saleor app template (${TEMPLATE.repository}) into <project>/apps/<name>, gives it a manifest id of its own and installs dependencies.`,
  inputs: {
    app: optionalNewAppInput,
  },
  plan: (input, store) =>
    Effect.gen(function* () {
      const wanted = yield* wantedName(input.app);

      if (Option.isNone(wanted)) {
        return Option.none();
      }

      const name = wanted.value;
      const slug = yield* appSlug(name);

      const projectName = store.target.scope.project ?? store.target.name;
      const root = projectFolder(projectName);
      const dir = path.resolve(root, "apps", slug);
      const found = inspect(dir);

      if (found.kind === "other") {
        return yield* notApp(dir, "Choose another name with --app.");
      }

      const identifier =
        found.kind === "app" && found.id !== undefined
          ? found.id
          : appIdentifier(
              slug,
              Option.some(
                Option.match(projectAt(root), {
                  onNone: () => projectName,
                  onSome: (project) => project.name,
                })
              )
            );

      const created = found.kind === "absent";

      // Filled in by `prepare`, which downloads while the store is set up.
      const downloads: Downloaded[] = [];

      return Option.some({
        apply: (made) =>
          Effect.gen(function* () {
            const outcome = yield* finishApp({
              created,
              dir,
              downloaded: downloads[0],
              identifier,
              name,
              repository: root,
              store: made.ref,
            });

            // Starting it is one line; installing it on the store, once it runs, another.
            const { next } = outcome.data;

            return {
              brief: {
                next: [next.slice(0, -1).join(" && "), ...next.slice(-1)],
                rows: [
                  [
                    "App",
                    `${shown(dir)}/ (${created ? "created" : "already existed"}, manifest id ${identifier})`,
                  ],
                ],
                warnings: outcome.data.warnings,
              },
              data: outcome.data,
            };
          }),
        changes: true,
        details: { directory: dir, identifier, template: TEMPLATE.repository },
        name: "app",
        prepare: created
          ? Effect.map(downloadTemplate(TEMPLATE, dir), (downloaded) => {
              downloads.push(downloaded);
            })
          : Effect.void,
        summary: [
          [
            "App",
            `${shown(dir)} (${created ? `${TEMPLATE.repository}, ${TEMPLATE.ref}` : "existing"})`,
          ] as const,
        ],
      });
    }),
});
