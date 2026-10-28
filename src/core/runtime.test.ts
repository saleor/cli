import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CANCEL_SYMBOL } from "@clack/prompts";
import { Effect, Layer } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { afterEach, expect, it, vi } from "vitest";
import { root as saleorRoot } from "../main.ts";
import { NoInputFlag, Prompts } from "./interaction.ts";
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

it("runs one command from the home menu and returns to the shell", async () => {
  const { action, select, run } = setup();
  select
    .mockResolvedValueOnce("org")
    .mockResolvedValueOnce("list")
    .mockResolvedValueOnce("org")
    .mockResolvedValueOnce("list")
    .mockResolvedValueOnce("\0exit");
  await run([]);
  expect(select).toHaveBeenCalledTimes(2);
  expect(action).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(0);
});

it("preserves a selected command's failure exit code without reopening the menu", async () => {
  const { select, run } = setup(
    Command.make("saleor").pipe(
      Command.withSubcommands([
        Command.make("fail", {}, () =>
          Effect.sync(() => {
            process.exitCode = 2;
          })
        ),
      ]),
      Command.withGlobalFlags([OutputFlag, NoInputFlag])
    )
  );

  select.mockResolvedValueOnce("fail");
  await run([]);
  expect(select).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(2);
});

it("exits the home menu without executing a command", async () => {
  const { action, select, run } = setup();
  select.mockResolvedValueOnce("\0exit");
  await run([]);
  expect(select).toHaveBeenCalledOnce();
  expect(action).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(0);
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

it.each(["--dry-run", "--no-input", "--json", "--agent", "--agent=true"])(
  "reports a missing required argument as a usage error, never a question: %s",
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
          .filter(
            (entry) =>
              !(
                entry.unlisted ||
                (group.name === "storefront" && entry.name === "env")
              )
          )
          .map((entry) => ({
            hint: `saleor ${group.name} ${entry.name}`,
            label: entry.shortDescription ?? entry.description ?? entry.name,
            value: entry.name,
          })),
      ],
      message: `What would you like to do? (saleor ${group.name})`,
      navigation: { back: "\0back" },
    });
    expect(process.exitCode).toBe(0);
  }
);

it("preserves an explicit end-of-options marker when selecting an action", async () => {
  const { action, run } = setup();
  await run(["org", "--"]);
  expect(action).toHaveBeenCalledOnce();
});

it("offers outcomes without login or logout in the exploratory menu", async () => {
  const { select, run } = setup(saleorRoot);
  select.mockResolvedValueOnce("\0exit");
  await run([]);
  expect(select).toHaveBeenCalledOnce();
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({
      choices: expect.arrayContaining([
        expect.objectContaining({ value: "init" }),
      ]),
    })
  );

  for (const value of ["login", "logout"]) {
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.not.arrayContaining([
          expect.objectContaining({ value }),
        ]),
      })
    );
  }
});

it.each([false, true])(
  "offers storefront env only inside a storefront (inside=%s)",
  async (inside) => {
    const directory = mkdtempSync(path.join(tmpdir(), "saleor-menu-"));

    try {
      if (inside) {
        writeFileSync(path.join(directory, "package.json"), "{}");
        writeFileSync(
          path.join(directory, ".env.example"),
          "NEXT_PUBLIC_SALEOR_API_URL=http://localhost/graphql/\n"
        );
      }

      const { select, run } = setup(saleorRoot);
      vi.spyOn(process, "cwd").mockReturnValue(directory);
      select.mockResolvedValueOnce("\0exit");
      await run(["storefront"]);

      const match = expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({ value: "env" }),
        ]),
      });

      if (inside) {
        expect(select).toHaveBeenCalledWith(match);
      } else {
        expect(select).not.toHaveBeenCalledWith(match);
      }
    } finally {
      vi.restoreAllMocks();
      rmSync(directory, { force: true, recursive: true });
    }
  }
);

it("returns to the home menu with Back and exits after the selected action", async () => {
  const { action, select, run } = setup();
  select
    .mockResolvedValueOnce("org")
    .mockResolvedValueOnce("\0back")
    .mockResolvedValueOnce("org")
    .mockResolvedValueOnce("list");
  await run([]);
  expect(select).toHaveBeenCalledTimes(4);
  expect(action).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(0);
});

it("offers the parent menu when a directly invoked group goes Back", async () => {
  const { action, select, run } = setup();
  select.mockResolvedValueOnce("\0back").mockResolvedValueOnce("\0exit");
  await run(["org"]);
  expect(select).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      choices: expect.not.arrayContaining([
        expect.objectContaining({ value: "\0back" }),
      ]),
      message: "What would you like to do? (saleor)",
    })
  );
  expect(action).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(0);
});

it("goes Back one level in nested groups without running an action", async () => {
  const executed = vi.fn();

  const { select, run } = setup(
    Command.make("saleor").pipe(
      Command.withSubcommands([
        Command.make("parent").pipe(
          Command.withSubcommands([
            Command.make("child").pipe(
              Command.withSubcommands([
                Command.make("run", {}, () => Effect.sync(executed)),
              ])
            ),
          ])
        ),
      ]),
      Command.withGlobalFlags([OutputFlag, NoInputFlag])
    )
  );

  select.mockResolvedValueOnce("\0back").mockResolvedValueOnce("\0exit");
  await run(["parent", "child"]);
  expect(select).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      message: "What would you like to do? (saleor parent)",
    })
  );
  expect(executed).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(0);
});
