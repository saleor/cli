import { spawn } from "node:child_process";
import { emitKeypressEvents } from "node:readline";
import { confirm, isCancel, password, text } from "@clack/prompts";
import { Context, Effect, Option } from "effect";
import { Flag, GlobalFlag } from "effect/cli";
import { ActionContext } from "./invocation.ts";
import { menuPrompt } from "./menu-prompt.ts";
import { BACK, canGoBack, goBack } from "./navigation.ts";
import { currentOutputFormat, detectAgent } from "./output.ts";

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

// A person is at a terminal and has not opted out. JSON output, CI, pipes, dry runs
// and `--no-input` never prompt, so automation cannot hang waiting for an answer and a
// preview never depends on answers.
export const isInteractive = Effect.gen(function* () {
  const format = yield* currentOutputFormat;
  const { dryRun } = yield* ActionContext;

  // Optional so that commands do not depend on the global flag being provided.
  const noInput = Option.getOrElse(
    yield* Effect.serviceOption(NoInputFlag),
    () => false
  );

  return (
    format === "text" &&
    !dryRun &&
    !noInput &&
    !envDisablesInput() &&
    detectAgent() === undefined &&
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

// Prompt operations as a service so tests can script the answers. `back` says whether
// Escape leads anywhere; when it does, a prompt answers BACK to it.
export interface PromptOperations {
  readonly confirm: (options: {
    back: boolean;
    message: string;
    initialValue?: boolean;
  }) => Promise<boolean | symbol>;
  readonly select: (options: {
    back: boolean;
    message: string;
    choices: readonly Choice<string>[];
    initialValue?: string | undefined;
  }) => Promise<string | symbol>;
  readonly text: (options: {
    back: boolean;
    message: string;
    initialValue?: string | undefined;
    placeholder?: string | undefined;
    // Masks what is typed, for tokens.
    secret?: boolean | undefined;
    validate?: (value: string) => string | undefined;
  }) => Promise<string | symbol>;
}

// Clack's text and confirm cancel on Escape as on Ctrl+C. Watching the keys first
// tells the two apart, so Escape can mean BACK where there is a way back.
const escapable = async <A>(
  back: boolean,
  ask: () => Promise<A | symbol>
): Promise<A | symbol> => {
  if (!back) {
    return ask();
  }

  let escaped = false;

  const onKey = (
    _value: string | undefined,
    key: { readonly name?: string } = {}
  ) => {
    escaped = key.name === "escape";
  };

  emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", onKey);

  try {
    const answer = await ask();

    return isCancel(answer) && escaped ? BACK : answer;
  } finally {
    process.stdin.off("keypress", onKey);
  }
};

export const Prompts = Context.Reference<PromptOperations>("saleor/Prompts", {
  defaultValue: () => ({
    confirm: ({ back, ...options }) => escapable(back, () => confirm(options)),
    select: async (options) => (await menuPrompt(options)) ?? "",
    text: ({ back, ...options }) =>
      escapable(back, async () => {
        const base = {
          message: options.message,
          validate: (value: string | undefined) =>
            options.validate?.(value ?? ""),
        };

        if (options.secret === true) {
          return (await password({ ...base, mask: "•" })) ?? "";
        }

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
      }),
  }),
});

// Escape goes back; Ctrl-C at a prompt is an interruption (exit 130), not an answer.
const answered = <A extends string | boolean>(answer: A | symbol) => {
  if (answer === BACK) {
    return goBack;
  }

  if (isCancel(answer)) {
    return Effect.andThen(
      Effect.sync(() =>
        process.stderr.write("Cancelled. Nothing was changed.\n")
      ),
      Effect.interrupt
    );
  }

  return Effect.sync(() => {
    process.stdout.write("\n");

    // SAFETY: the cancel and back symbols are ruled out first, leaving the answer type.
    return answer as A;
  });
};

export const askSelect = <A extends string>(options: {
  message: string;
  choices: readonly Choice<A>[];
  initialValue?: A | undefined;
}) =>
  Effect.gen(function* () {
    const prompts = yield* Prompts;
    const back = yield* canGoBack;

    const answer = yield* Effect.promise(() =>
      prompts.select({ ...options, back })
    );

    // SAFETY: the answer is one of `options.choices`, whose values are all `A`.
    return (yield* answered(answer)) as A;
  });

export const askText = (options: {
  message: string;
  initialValue?: string | undefined;
  placeholder?: string | undefined;
  secret?: boolean | undefined;
  validate?: (value: string) => string | undefined;
}) =>
  Effect.gen(function* () {
    const prompts = yield* Prompts;
    const back = yield* canGoBack;

    const answer = yield* Effect.promise(() =>
      prompts.text({ ...options, back })
    );

    return (yield* answered(answer)).trim();
  });

export const askConfirm = (message: string, initialValue = true) =>
  Effect.gen(function* () {
    const prompts = yield* Prompts;
    const back = yield* canGoBack;

    const answer = yield* Effect.promise(() =>
      prompts.confirm({ back, initialValue, message })
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
