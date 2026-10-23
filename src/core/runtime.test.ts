import { CANCEL_SYMBOL } from "@clack/prompts";
import { Effect, Layer } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { afterEach, expect, it, vi } from "vitest";
import { root as saleorRoot } from "../main.ts";
import { NoInputFlag, Prompts } from "./interaction.ts";
import { Invocation, rerunCommand } from "./invocation.ts";
import { OutputFlag } from "./output.ts";
import { createCliRuntime } from "./runtime.ts";

const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

afterEach(() => {
  for (const [stream, descriptor] of [
    [process.stdin, stdinTTY],
    [process.stdout, stdoutTTY],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(stream, "isTTY", descriptor);
    } else {
      Reflect.deleteProperty(stream, "isTTY");
    }
  }

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
});

const setup = (commandRoot?: Command.Command.Any) => {
  for (const key of [
    "AI_AGENT",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CURSOR_AGENT",
    "CODEX_SANDBOX",
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "GEMINI_CLI",
    "OPENCODE",
    "AMP_CURRENT_THREAD_ID",
    "CI",
    "SALEOR_NO_INPUT",
    "SALEOR_OUTPUT",
  ]) {
    vi.stubEnv(key, "");
  }

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const action = vi.fn();
  const text = vi.fn(async (): Promise<string | symbol> => "demo");
  const select = vi.fn(async (): Promise<string | symbol> => "list");

  const root = Command.make("saleor").pipe(
    Command.withSubcommands([
      Command.make("org").pipe(
        Command.withSubcommands([
          Command.make("list", {}, () => Effect.sync(action)),
          Command.make(
            "create",
            {
              dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
              name: Argument.String("name"),
            },
            ({ name }) => Effect.sync(() => action(name))
          ),
        ])
      ),
    ]),
    Command.withGlobalFlags([OutputFlag, NoInputFlag])
  );

  const execute = createCliRuntime(commandRoot ?? root, {
    services: Layer.empty,
    version: "1",
  });

  const run = (argv: readonly string[]) =>
    Effect.runPromise(
      execute(argv).pipe(
        Effect.provideService(Prompts, {
          confirm: async () => true,
          select,
          text,
        })
      )
    );

  return { action, run, select, text };
};

it("offers a bare group's actual commands and dispatches the selection", async () => {
  const { action, select, run } = setup();
  await run(["org"]);
  expect(select).toHaveBeenCalledOnce();
  expect(select.mock.calls[0]).toBeDefined();
  expect(action).toHaveBeenCalledOnce();
});

it.each([
  ["org", "--help"],
  ["org", "--no-input"],
  ["org", "--json"],
  ["org", "--agent"],
  ["org", "list"],
  ["org", "invalid"],
])(
  "does not navigate explicit commands, help, errors or automation flags: %j",
  async (...argv) => {
    const { select, run } = setup();
    await run(argv);
    expect(select).not.toHaveBeenCalled();
  }
);

it.each([
  "AI_AGENT",
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
  "CI",
  "SALEOR_NO_INPUT",
])("never prompts with %s even in text mode", async (key) => {
  const { action, select, run } = setup();
  vi.stubEnv(key, "1");
  await run(["org", "--output", "text"]);
  expect(select).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
});

it("offers the root command menu when no command is supplied", async () => {
  const { action, select, run } = setup();
  select.mockResolvedValueOnce("org");
  await run([]);
  expect(select).toHaveBeenCalledTimes(2);
  expect(action).toHaveBeenCalledOnce();
});

it("exits a group without executing a command", async () => {
  const { action, select, run } = setup();
  select.mockResolvedValueOnce("\0exit");
  await run(["org"]);
  expect(action).not.toHaveBeenCalled();
});

it("treats cancellation as exit 130", async () => {
  const { action, select, run } = setup();
  select.mockImplementationOnce(async () => CANCEL_SYMBOL);
  await run(["org"]);
  expect(process.exitCode).toBe(130);
  expect(action).not.toHaveBeenCalled();
});

it("keeps bare groups noninteractive when input is piped", async () => {
  const { select, run } = setup();
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: false,
  });
  await run(["org", "--output", "text"]);
  expect(select).not.toHaveBeenCalled();
});

it("continues from group selection through missing input to the action", async () => {
  const { action, run, select, text } = setup();
  select.mockResolvedValueOnce("create");
  await run(["org", "--output", "text"]);
  expect(select).toHaveBeenCalledOnce();
  expect(text).toHaveBeenCalledOnce();
  expect(action).toHaveBeenCalledExactlyOnceWith("demo");
});

it("asks for missing positional input on direct commands too", async () => {
  const { action, run, select, text } = setup();
  await run(["org", "create"]);
  expect(select).not.toHaveBeenCalled();
  expect(text).toHaveBeenCalledOnce();
  expect(action).toHaveBeenCalledExactlyOnceWith("demo");
});

it.each(["--dry-run", "--no-input", "--json", "--agent", "--agent=true"])(
  "never asks for missing positional input with %s",
  async (flag) => {
    const { action, run, text } = setup();
    await run(["org", "create", flag]);
    expect(text).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  }
);

it.each(
  saleorRoot.subcommands
    .flatMap((group) => group.commands)
    .filter((command) => command.subcommands.length > 0)
)(
  "offers all registered actions for $name without executing any",
  async (group) => {
    const { select, run } = setup(saleorRoot);
    select.mockResolvedValueOnce("\0exit");
    await run([group.name]);
    expect(select).toHaveBeenCalledExactlyOnceWith({
      choices: [
        ...group.subcommands
          .flatMap((entry) => entry.commands)
          .filter((entry) => !entry.unlisted)
          .map((entry) => ({
            hint: `saleor ${group.name} ${entry.name}`,
            label: entry.shortDescription ?? entry.description ?? entry.name,
            value: entry.name,
          })),
        { label: "Exit", value: "\0exit" },
      ],
      message: `What would you like to do? (saleor ${group.name})`,
    });
    expect(process.exitCode).toBe(0);
  }
);

it.each(["--help", "--json", "--agent", "--version", "--output=json"])(
  "treats prompted %s as positional input, never as a flag",
  async (answer) => {
    const { action, run, text } = setup();
    text.mockResolvedValueOnce(answer);
    await run(["org", "create"]);
    expect(action).toHaveBeenCalledExactlyOnceWith(answer);
  }
);

it("preserves an explicit end-of-options marker when selecting an action", async () => {
  const { action, run } = setup();
  await run(["org", "--"]);
  expect(action).toHaveBeenCalledOnce();
});

it("cancels missing input without executing the selected action", async () => {
  const { action, run, text } = setup();
  text.mockImplementationOnce(async () => CANCEL_SYMBOL);
  await run(["org", "create"]);
  expect(action).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(130);
});

it("puts retry flags before the positional input separator", async () => {
  const command = await Effect.runPromise(
    rerunCommand(["--force"]).pipe(
      Effect.provideService(Invocation, ["project", "delete", "--", "demo"])
    )
  );

  expect(command).toBe("saleor project delete --force -- demo");
});
