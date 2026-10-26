import path from "node:path";
import { Effect, Option } from "effect";
import { describeTarget } from "../../core/action.ts";
import { option } from "../../core/inputs.ts";
import { askConfirm, isInteractive } from "../../core/interaction.ts";
import { recordAnswer } from "../../core/invocation.ts";
import { directoryState, downloadTemplate } from "../../core/scaffold.ts";
import { defineSetupExtension } from "../../core/setup.ts";
import {
  askInstall,
  connectedElsewhere,
  DEFAULT_CHANNEL,
  finish,
  inspect,
  notStorefront,
  shown,
  storefrontTarget,
  TEMPLATE,
} from "./storefront.ts";

const UNSAFE_NAME = /[^a-z0-9._-]+/g;

const capitalize = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// The project's folder, holding the storefront (and later its apps and config): the
// current directory when it already holds the storefront or is empty, else a folder
// named after the project, created or found next to the current files.
const projectFolder = (name: string) =>
  Effect.gen(function* () {
    const here = process.cwd();

    const named = path.join(
      here,
      name.toLowerCase().replace(UNSAFE_NAME, "-") || "saleor"
    );

    if ((yield* inspect(path.join(here, "storefront"))).kind === "storefront") {
      return here;
    }

    if (directoryState(named) !== "absent") {
      return named;
    }

    return directoryState(here) === "used" ? named : here;
  });

// `saleor init --storefront`: next to the store, a folder for the project with the
// storefront in it, connected to the store `init` made. Asked last in a terminal, once
// everything about the store is known.
export const storefrontSetup = defineSetupExtension({
  description: `With --storefront (asked in a terminal), it also downloads the Saleor storefront template (${TEMPLATE.repository}) into <project>/storefront, connects it to the store and makes the folder a git repository.`,
  inputs: {
    install: option.boolean(
      "install",
      "With --storefront, install the storefront's dependencies with pnpm. Asked in a terminal."
    ),
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
            "Also set up a storefront for this store, in a folder for the project?",
            true
          )));

      if (!wanted) {
        return Option.none();
      }

      if (asked) {
        yield* recordAnswer({ flag: "--storefront" });
      }

      const root = yield* projectFolder(
        store.target.scope.project ?? store.target.name
      );

      const dir = path.join(root, "storefront");
      const found = yield* inspect(dir);

      if (found.kind === "other") {
        return yield* notStorefront(dir);
      }

      const install = yield* askInstall(input.install);
      const downloading = found.kind === "absent";

      // A storefront whose setup finishes in this run counts as created, as when an
      // earlier run downloaded it and then stopped waiting for the store.
      const created = found.kind === "absent" || found.ref === undefined;

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

            const outcome = yield* finish({
              channel:
                found.kind === "storefront"
                  ? (found.channel ?? DEFAULT_CHANNEL)
                  : DEFAULT_CHANNEL,
              created,
              dir,
              install,
              repository: created ? root : undefined,
              source: undefined,
              store: made,
            });

            return {
              ...outcome,
              text: [
                `✓ ${capitalize(describeTarget(storefrontTarget(dir)))} is ready (${created ? "created" : "already existed"}).`,
                outcome.text,
              ].join("\n"),
            };
          }),
        changes: created,
        details: {
          directory: dir,
          install,
          template: TEMPLATE.repository,
        },
        name: "storefront",
        prepare: downloading ? downloadTemplate(TEMPLATE, dir) : Effect.void,
        summary: [
          [
            "Storefront",
            `${shown(dir)} (${downloading ? `${TEMPLATE.repository}, ${TEMPLATE.ref}` : "existing"})`,
          ] as const,
        ],
      });
    }),
});
