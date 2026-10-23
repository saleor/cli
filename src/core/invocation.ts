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
  Effect.map(Invocation, (argv) => {
    const separator = argv.indexOf("--");
    const boundary = separator < 0 ? argv.length : separator;
    const options = argv.slice(0, boundary);

    return shellCommand([
      ...options,
      ...extraFlags.filter((flag) => !options.includes(flag)),
      ...argv.slice(boundary),
    ]);
  });

// The current command line without a zero wait budget: after `--timeout 0` returns
// NOT_READY, running the same line again would return at once instead of waiting.
export const resumeCommand = Effect.map(Invocation, (argv) => {
  const separator = argv.indexOf("--");
  const boundary = separator < 0 ? argv.length : separator;

  return shellCommand([
    ...argv
      .slice(0, boundary)
      .filter(
        (arg, i) =>
          arg !== "--timeout=0" &&
          !(arg === "--timeout" && argv[i + 1] === "0") &&
          !(arg === "0" && argv[i - 1] === "--timeout")
      ),
    ...argv.slice(boundary),
  ]);
});

// Add resolved options before the marker that starts literal positional arguments.
export const appendOptions = (
  argv: readonly string[],
  options: readonly string[]
) => {
  const separator = argv.indexOf("--");
  const boundary = separator < 0 ? argv.length : separator;

  return [...argv.slice(0, boundary), ...options, ...argv.slice(boundary)];
};
