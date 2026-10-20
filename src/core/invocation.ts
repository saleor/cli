import { Context, Effect } from "effect";

// The arguments this process was started with, as the user typed them. Commands that
// stop early (NOT_READY, CONFIRMATION_REQUIRED) tell the caller to run exactly this
// again, so a resume hint can never drift from the flags a command accepts.
export const Invocation = Context.Reference<readonly string[]>(
  "saleor/Invocation",
  { defaultValue: () => [] }
);

const SAFE_SHELL_WORD = /^[a-zA-Z0-9_./:=@,+-]+$/;

const quote = (word: string) =>
  SAFE_SHELL_WORD.test(word) ? word : `'${word.replaceAll("'", "'\"'\"'")}'`;

export const shellCommand = (words: readonly string[]) =>
  ["saleor", ...words].map(quote).join(" ");

// The current command line, plus any flags it needs to succeed next time (`--force`).
export const rerunCommand = (extraFlags: readonly string[] = []) =>
  Effect.map(Invocation, (argv) =>
    shellCommand([
      ...argv,
      ...extraFlags.filter((flag) => !argv.includes(flag)),
    ])
  );

// The current command line without a zero wait budget: after `--timeout 0` returns
// NOT_READY, running the same line again would return at once instead of waiting.
export const resumeCommand = Effect.map(Invocation, (argv) =>
  shellCommand(
    argv.filter(
      (arg, i) =>
        arg !== "--timeout=0" &&
        !(arg === "--timeout" && argv[i + 1] === "0") &&
        !(arg === "0" && argv[i - 1] === "--timeout")
    )
  )
);
