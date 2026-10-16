import { spawn } from "node:child_process";
import { confirm, isCancel } from "@clack/prompts";
import { Effect } from "effect";
import { fail } from "./errors.ts";
import { rerunCommand } from "./invocation.ts";
import { currentOutputFormat } from "./output.ts";

export const isInteractive = Effect.map(
  currentOutputFormat,
  (format) =>
    format === "text" &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !process.env.CI
);

// Opens a URL for the person working alongside the agent. Failure is fine: the URL is
// always printed as well.
export const openBrowser = (url: string) =>
  Effect.sync(() => {
    if (process.env.CI || process.env.SALEOR_NO_BROWSER) {
      return false;
    }

    const launchers = {
      darwin: ["open", [url]],
      win32: ["cmd", ["/c", "start", "", url]],
    } satisfies Partial<Record<NodeJS.Platform, [string, string[]]>>;

    const [command, args] = (process.platform === "darwin" ||
    process.platform === "win32"
      ? launchers[process.platform]
      : undefined) ?? ["xdg-open", [url]];

    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
      });

      child.on("error", () => {
        /* The printed URL is the fallback. */
      });
      child.unref();

      return true;
    } catch {
      return false;
    }
  });

// Destructive actions: `--force` is the only way to skip the question. Without a person
// at a terminal there is nobody to ask, so the command refuses instead of guessing.
export const confirmDestructive = (question: string, force: boolean) =>
  Effect.gen(function* () {
    if (force) {
      return;
    }

    if (!(yield* isInteractive)) {
      return yield* fail(
        "CONFIRMATION_REQUIRED",
        `${question} Refusing without confirmation.`,
        {
          suggestion: `Re-run with --force to confirm: ${yield* rerunCommand(["--force"])}`,
        }
      );
    }

    const answer = yield* Effect.promise(() =>
      confirm({ initialValue: false, message: question })
    );

    // Ctrl-C at the prompt is an interruption (exit 130), not a refusal.
    if (isCancel(answer)) {
      return yield* Effect.interrupt;
    }

    if (answer !== true) {
      return yield* fail(
        "CONFIRMATION_REQUIRED",
        "Cancelled; nothing was deleted."
      );
    }
  });
