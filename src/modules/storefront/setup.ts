import { Effect, Option } from "effect";
import path from "node:path";
import { option } from "../../core/inputs.ts";
import { askConfirm, isInteractive } from "../../core/interaction.ts";
import { recordAnswer } from "../../core/invocation.ts";
import { projectChannel, storefrontPath } from "./project.ts";
import { projectAt, projectFolder } from "../../core/project.ts";
import {
  type Downloaded,
  downloadTemplate,
  templateSource,
} from "../../core/scaffold.ts";
import { defineSetupExtension } from "../../core/setup.ts";
import {
  connectedElsewhere,
  DEFAULT_CHANNEL,
  finish,
  inspect,
  notStorefront,
  TEMPLATE,
} from "./storefront.ts";
import { shown } from "../../core/output.ts";

// `saleor init --storefront`: next to the store, a folder for the project with the
// storefront in it, connected to the store `init` made. Asked last in a terminal, once
// everything about the store is known.
export const storefrontSetup = defineSetupExtension({
  description: `With --storefront (asked in a terminal), it also downloads the Saleor storefront template (${TEMPLATE.repository}) into <project>/storefront, connects it to the store, makes the folder a git repository and installs dependencies.`,
  inputs: {
    storefront: option.boolean(
      "storefront",
      "Also create a storefront connected to the store, in a folder for the project. Asked in a terminal."
    ),
  },
  plan: (input, store) =>
    Effect.gen(function* () {
      const asked = !input.storefront && (yield* isInteractive);

      const wanted =
        input.storefront ||
        (asked &&
          (yield* askConfirm(
            "Also set up a storefront for this store?",
            true
          )));

      if (!wanted) {
        return Option.none();
      }

      if (asked) {
        yield* recordAnswer({ flag: "--storefront" });
      }

      const root = projectFolder(
        store.target.scope.project ?? store.target.name
      );

      const dir = path.resolve(
        root,
        Option.match(projectAt(root), {
          onNone: () => "storefront",
          onSome: storefrontPath,
        })
      );

      const found = yield* inspect(dir);

      if (found.kind === "other") {
        return yield* notStorefront(dir);
      }

      const downloading = found.kind === "absent";

      // A storefront whose setup finishes in this run counts as created, as when an
      // earlier run downloaded it and then stopped waiting for the store.
      const created = found.kind === "absent" || found.ref === undefined;

      // Filled in by `prepare`, which downloads while the store is set up.
      const downloads: Downloaded[] = [];

      return Option.some({
        apply: (made) =>
          Effect.gen(function* () {
            if (
              found.kind === "storefront" &&
              found.ref !== undefined &&
              found.ref !== made.ref
            ) {
              return yield* connectedElsewhere(dir, found.ref, made.ref);
            }

            // A project's configuration says which channel the store sells in.
            const configured = Option.getOrElse(
              projectChannel(root),
              () => DEFAULT_CHANNEL
            );

            const outcome = yield* finish({
              channel:
                found.kind === "storefront"
                  ? (found.channel ?? configured)
                  : configured,
              created,
              dir,
              downloaded: downloads[0],
              install: true,
              record: true,
              // `init` commits the project once, with everything in it.
              repository: undefined,
              source: undefined,
              store: made,
            });

            return {
              brief: {
                next: [outcome.data.next.join(" && ")],
                rows: [
                  [
                    "Storefront",
                    `${shown(dir)}/ (${created ? "created" : "already existed"}, channel ${outcome.data.channel})`,
                  ],
                ],
                warnings: outcome.data.warnings,
              },
              data: outcome.data,
              source:
                downloads[0] === undefined
                  ? undefined
                  : templateSource(TEMPLATE, downloads[0]),
            };
          }),
        changes: true,
        details: {
          directory: dir,
          install: true,
          template: TEMPLATE.repository,
        },
        name: "storefront",
        prepare: downloading
          ? Effect.map(downloadTemplate(TEMPLATE, dir), (downloaded) => {
              downloads.push(downloaded);
            })
          : Effect.void,
        summary: [
          [
            "Storefront",
            `${shown(dir)} (${downloading ? `${TEMPLATE.repository}, ${TEMPLATE.ref}` : "existing"})`,
          ] as const,
        ],
      });
    }),
});
