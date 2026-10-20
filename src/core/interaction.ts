import { spawn } from "node:child_process";
import { confirm, isCancel, select, text } from "@clack/prompts";
import { Context, Effect, Option } from "effect";
import { Flag, GlobalFlag } from "effect/cli";
import { fail } from "./errors.ts";
import { rerunCommand } from "./invocation.ts";
import { currentOutputFormat } from "./output.ts";

export const NoInputFlag = GlobalFlag.Setting("no-input")({
  flag: Flag.Boolean("no-input").pipe(
    Flag.withDescription(
      "Never ask questions. A command missing required input fails instead. Also set by SALEOR_NO_INPUT."
    ),
    Flag.withDefault(false)
  ),
});

const envDisablesInput = () => {
  const value = process.env.SALEOR_NO_INPUT?.trim().toLowerCase();

  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
};

// A person is at a terminal and has not opted out. JSON output, CI, pipes and
// `--no-input` never prompt, so automation cannot hang waiting for an answer.
export const isInteractive = Effect.gen(function* () {
  const format = yield* currentOutputFormat;

  // Optional so that commands do not depend on the global flag being provided.
  const noInput = Option.getOrElse(
    yield* Effect.serviceOption(NoInputFlag),
    () => false
  );

  return (
    format === "text" &&
    !noInput &&
    !envDisablesInput() &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !process.env.CI
  );
});

export interface Choice<A extends string> {
  readonly hint?: string;
  readonly label: string;
  readonly value: A;
}

// Prompt operations as a service so tests can script the answers.
export interface PromptOperations {
  readonly confirm: (options: {
    message: string;
    initialValue?: boolean;
  }) => Promise<boolean | symbol>;
  readonly select: (options: {
    message: string;
    choices: readonly Choice<string>[];
    initialValue?: string | undefined;
  }) => Promise<string | symbol>;
  readonly text: (options: {
    message: string;
    initialValue?: string | undefined;
    placeholder?: string | undefined;
    validate?: (value: string) => string | undefined;
  }) => Promise<string | symbol>;
}

export const Prompts = Context.Reference<PromptOperations>("saleor/Prompts", {
  defaultValue: () => ({
    confirm: (options) => confirm(options),
    select: (options) => {
      const base = {
        message: options.message,
        options: options.choices.map(({ hint, label, value }) =>
          hint === undefined ? { label, value } : { hint, label, value }
        ),
      };

      return select(
        options.initialValue === undefined
          ? base
          : { ...base, initialValue: options.initialValue }
      );
    },
    text: async (options) => {
      const base = {
        message: options.message,
        validate: (value: string | undefined) =>
          options.validate?.(value ?? ""),
      };

      const answer = await text({
        ...base,
        ...(options.placeholder === undefined
          ? undefined
          : { placeholder: options.placeholder }),
        ...(options.initialValue === undefined
          ? undefined
          : { initialValue: options.initialValue }),
      });

      return answer ?? "";
    },
  }),
});

// Ctrl-C at a prompt is an interruption (exit 130), not an answer.
const answered = <A extends string | boolean>(answer: A | symbol) =>
  // SAFETY: the cancel symbol is ruled out first, leaving the answer type.
  isCancel(answer) ? Effect.interrupt : Effect.succeed(answer as A);

export const askSelect = <A extends string>(options: {
  message: string;
  choices: readonly Choice<A>[];
  initialValue?: A | undefined;
}) =>
  Effect.gen(function* () {
    const prompts = yield* Prompts;
    const answer = yield* Effect.promise(() => prompts.select(options));

    // SAFETY: the answer is one of `options.choices`, whose values are all `A`.
    return (yield* answered(answer)) as A;
  });

export const askText = (options: {
  message: string;
  initialValue?: string | undefined;
  placeholder?: string | undefined;
  validate?: (value: string) => string | undefined;
}) =>
  Effect.gen(function* () {
    const prompts = yield* Prompts;
    const answer = yield* Effect.promise(() => prompts.text(options));

    return (yield* answered(answer)).trim();
  });

export const askConfirm = (message: string, initialValue = true) =>
  Effect.gen(function* () {
    const prompts = yield* Prompts;

    const answer = yield* Effect.promise(() =>
      prompts.confirm({ initialValue, message })
    );

    return (yield* answered(answer)) === true;
  });

export const required = (what: string) => (value: string) =>
  value.trim() === "" ? `${what} is required.` : undefined;

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
export const confirmDestructive = (
  action: { readonly question: string; readonly refusal: string },
  force: boolean
) =>
  Effect.gen(function* () {
    if (force) {
      return;
    }

    if (!(yield* isInteractive)) {
      return yield* fail("CONFIRMATION_REQUIRED", action.refusal, {
        suggestion: `To confirm, run: ${yield* rerunCommand(["--force"])}`,
      });
    }

    if (!(yield* askConfirm(action.question, false))) {
      return yield* fail("CANCELLED", "Cancelled. Nothing was deleted.");
    }
  });
