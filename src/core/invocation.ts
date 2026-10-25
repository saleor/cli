import { Context, Effect } from "effect";

// The arguments this process was started with, as the user typed them. Commands that
// stop early (NOT_READY, CONFIRMATION_REQUIRED) tell the caller to run exactly this
// again, so a resume hint can never drift from the flags a command accepts.
export const Invocation = Context.Reference<readonly string[]>(
  "saleor/Invocation",
  { defaultValue: () => [] }
);

// What kind of action is running. The kind decides the policy every command of that
// kind follows; see docs/design/commands.md.
//   list     lists a collection; needs only its parent scope
//   ensure   creates a resource or reuses an existing one, then waits until it works
//   remove   deletes or stops a resource; absent is success
//   session  works on the CLI's own login, not on a resource
export type ActionKind = "list" | "ensure" | "remove" | "session";

// An answer given at a prompt, as the words that would have supplied it on the command
// line. Hints that tell the caller what to run next include them, so the next run
// does not ask again and cannot pick something else.
export type Answer =
  | { readonly option: readonly [flag: string, value: string] }
  | { readonly flag: string }
  | { readonly positional: string };

export interface ActionState {
  readonly answers: Answer[];
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly kind: ActionKind;
}

export const ActionContext = Context.Reference<ActionState>(
  "saleor/ActionContext",
  {
    defaultValue: () => ({
      answers: [],
      dryRun: false,
      force: false,
      kind: "session",
    }),
  }
);

export const recordAnswer = (answer: Answer) =>
  Effect.map(ActionContext, (context) => {
    context.answers.push(answer);
  });

const SAFE_SHELL_WORD = /^[a-zA-Z0-9_./:=@,+-]+$/;
const PLACEHOLDER = /^<[a-z-]+>$/;

const quote = (word: string) =>
  SAFE_SHELL_WORD.test(word) || PLACEHOLDER.test(word)
    ? word
    : `'${word.replaceAll("'", "'\"'\"'")}'`;

// The only way to write a command into a hint, a suggestion or a result: every word is
// quoted for a POSIX shell, so a name with spaces is still one argument when pasted.
// Words like `<name>` are placeholders and stay as they are.
export const command = (...words: readonly string[]) =>
  ["saleor", ...words].map(quote).join(" ");

const splitAtSeparator = (argv: readonly string[]) => {
  const separator = argv.indexOf("--");
  const boundary = separator < 0 ? argv.length : separator;

  return {
    options: argv.slice(0, boundary),
    positionals: argv.slice(boundary),
  };
};

// Add options before the marker that starts literal positional arguments, and
// positional words after everything, behind a marker if they look like flags.
const withAnswers = (argv: readonly string[], answers: readonly Answer[]) => {
  const { options, positionals } = splitAtSeparator(argv);
  const addedOptions: string[] = [];
  const addedPositionals: string[] = [];

  for (const answer of answers) {
    if ("option" in answer) {
      addedOptions.push(...answer.option);
    } else if ("flag" in answer) {
      addedOptions.push(answer.flag);
    } else {
      addedPositionals.push(answer.positional);
    }
  }

  const needsMarker =
    positionals.length === 0 &&
    addedPositionals.some((word) => word.startsWith("-"));

  return [
    ...options,
    ...addedOptions,
    ...(needsMarker ? ["--"] : []),
    ...positionals,
    ...addedPositionals,
  ];
};

const dropZeroWait = (argv: readonly string[]) => {
  const { options, positionals } = splitAtSeparator(argv);

  return [
    ...options.filter(
      (arg, i) =>
        arg !== "--timeout=0" &&
        !(arg === "--timeout" && options[i + 1] === "0") &&
        !(arg === "0" && options[i - 1] === "--timeout")
    ),
    ...positionals,
  ];
};

// The command line of this run with every answer given at a prompt, so it runs again
// without questions. `add` appends flags the next run needs (`--force`); `resume`
// drops a zero wait budget, which would return at once again.
export const rerunCommand = (
  options: { readonly add?: readonly string[]; readonly resume?: boolean } = {}
) =>
  Effect.gen(function* () {
    const argv = yield* Invocation;
    const { answers } = yield* ActionContext;
    const full = withAnswers(argv, answers);
    const base = options.resume ? dropZeroWait(full) : full;
    const { options: present } = splitAtSeparator(base);

    return command(
      ...withAnswers(
        base,
        (options.add ?? [])
          .filter((flag) => !present.includes(flag))
          .map((flag) => ({ flag }))
      )
    );
  });
