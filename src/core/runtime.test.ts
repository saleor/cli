import { CANCEL_SYMBOL } from "@clack/prompts";
import { Context, Effect, Layer } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { root as saleorRoot } from "../main.ts";
import { NoInputFlag, Prompts } from "./interaction.ts";
import { HideFromMenu } from "./menu.ts";
import { BACK } from "./navigation.ts";
import { onboardCommand } from "./onboarding.ts";
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

  const run = async (argv: readonly string[]) => {
    await Effect.runPromise(
      execute(argv).pipe(
        Effect.provideService(Prompts, {
          multiselect: async () => [],
          confirm: async () => true,
          select,
          text,
        })
      )
    );
  };

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
      back: true,
      choices: group.subcommands
        .flatMap((entry) => entry.commands)
        .filter(
          (entry) =>
            !(
              entry.unlisted ||
              Context.get(entry.annotations, HideFromMenu) ||
              (group.name === "storefront" && entry.name === "use")
            )
        )
        .map((entry) => ({
          hint: `saleor ${group.name} ${entry.name}`,
          label: entry.shortDescription ?? entry.description ?? entry.name,
          value: entry.name,
        })),
      message: `What would you like to do? (saleor ${group.name})`,
    });
    expect(process.exitCode).toBe(0);
  }
);

it("preserves an explicit end-of-options marker when selecting an action", async () => {
  const { action, run } = setup();
  await run(["org", "--"]);
  expect(action).toHaveBeenCalledOnce();
});

// Environments are one group wherever they run, so the menu is the same for Cloud and
// local work; only the login is left out once there is one.
it.each([
  {
    cloud: false,
    expected: [
      "init",
      "env",
      "backup",
      "storefront",
      "api",
      "app",
      "webhook",
      "login",
      "commands",
    ],
    local: false,
  },
  {
    cloud: true,
    expected: [
      "init",
      "env",
      "backup",
      "storefront",
      "api",
      "app",
      "webhook",
      "commands",
    ],
    local: false,
  },
  {
    cloud: true,
    expected: [
      "init",
      "env",
      "backup",
      "storefront",
      "api",
      "app",
      "webhook",
      "commands",
    ],
    local: true,
  },
])(
  "offers the same menu wherever the person works (cloud=$cloud, local=$local)",
  async ({ cloud, expected, local }) => {
    const config = mkdtempSync(path.join(tmpdir(), "saleor-config-"));
    const originalDirectory = process.cwd();

    try {
      process.chdir(config);
      const { select, run } = setup(saleorRoot);
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      vi.stubEnv("SALEOR_CONFIG_DIR", config);
      vi.stubEnv("SALEOR_CREDENTIAL_STORE", "file");
      vi.stubEnv("SALEOR_CLOUD_TOKEN", cloud ? "token" : "");

      if (local) {
        mkdirSync(path.join(config, "local", "demo"), { recursive: true });
        writeFileSync(
          path.join(config, "local", "demo", "instance.json"),
          "{}"
        );
      }

      select.mockResolvedValueOnce("\0exit");
      await run([]);

      const printed = stderr.mock.calls
        .map(([chunk]) => String(chunk))
        .join("");

      if (cloud) {
        expect(printed).toContain(
          "Using Saleor Cloud with SALEOR_CLOUD_TOKEN."
        );
      } else {
        expect(printed).not.toContain("Saleor Cloud");
      }

      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: expected.map((value) => expect.objectContaining({ value })),
        })
      );
    } finally {
      process.chdir(originalDirectory);
      rmSync(config, { force: true, recursive: true });
    }
  }
);

const jwt = (claims: { readonly email: string }) =>
  [
    "e30",
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "sig",
  ].join(".");

it.each([
  {
    cloud: "none",
    hints: ["Docker on this computer", "you will log in"],
    status: undefined,
  },
  {
    cloud: "token",
    hints: ["projects and environments", "Docker on this"],
    status: "Using Saleor Cloud with SALEOR_CLOUD_TOKEN.",
  },
  {
    cloud: "login",
    hints: ["projects and environments", "Docker on this"],
    status: "Logged in to Saleor Cloud as ada@example.com.",
  },
])(
  "always asks where init's store runs, ready providers first (cloud=$cloud)",
  async ({ cloud, hints, status }) => {
    const config = mkdtempSync(path.join(tmpdir(), "saleor-config-"));

    try {
      const { select, run } = setup(saleorRoot);
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      vi.stubEnv("SALEOR_CONFIG_DIR", config);
      vi.stubEnv("SALEOR_CREDENTIAL_STORE", "file");
      vi.stubEnv("SALEOR_CLOUD_TOKEN", cloud === "token" ? "token" : "");

      if (cloud === "login") {
        writeFileSync(
          path.join(config, "credentials.json"),
          JSON.stringify({
            "cloud:credentials": JSON.stringify({
              accessExpiresAt: 0,
              accessToken: jwt({ email: "ada@example.com" }),
              clientId: "cli",
              refreshToken: "refresh",
            }),
          })
        );
      }

      select.mockResolvedValueOnce(CANCEL_SYMBOL);
      await run(["init"]);
      expect(select).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          choices: hints.map((hint) =>
            expect.objectContaining({ hint: expect.stringContaining(hint) })
          ),
          message: "Where should the new store run?",
        })
      );

      const printed = stderr.mock.calls
        .map(([chunk]) => String(chunk))
        .join("");

      if (status === undefined) {
        expect(printed).not.toContain("Saleor Cloud");
      } else {
        expect(printed).toContain(status);
      }
    } finally {
      rmSync(config, { force: true, recursive: true });
    }
  }
);

it.each([false, true])(
  "offers storefront use only inside a storefront (inside=%s)",
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
          expect.objectContaining({ value: "use" }),
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
    .mockResolvedValueOnce(BACK)
    .mockResolvedValueOnce("org")
    .mockResolvedValueOnce("list");
  await run([]);
  expect(select).toHaveBeenCalledTimes(4);
  expect(action).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(0);
});

it("returns to the menu when a prompt inside the opened command goes Back", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "saleor-config-"));

  try {
    const { select, run } = setup(saleorRoot);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.stubEnv("SALEOR_CONFIG_DIR", config);
    vi.stubEnv("SALEOR_CREDENTIAL_STORE", "file");
    vi.stubEnv("SALEOR_CLOUD_TOKEN", "");
    select
      .mockResolvedValueOnce("init")
      .mockResolvedValueOnce(BACK)
      .mockResolvedValueOnce("\0exit");
    await run([]);

    expect(select).toHaveBeenCalledTimes(3);

    for (const [call, back, message] of [
      [1, false, "What would you like to do? (saleor)"],
      [2, true, "Where should the new store run?"],
      [3, false, "What would you like to do? (saleor)"],
    ] as const) {
      expect(select).toHaveBeenNthCalledWith(
        call,
        expect.objectContaining({ back, message })
      );
    }

    expect(stderr).not.toHaveBeenCalledWith(
      expect.stringContaining("Cancelled")
    );
    expect(process.exitCode).toBe(0);
  } finally {
    rmSync(config, { force: true, recursive: true });
  }
});

it("returns to where init's store runs when a later question goes Back", async () => {
  const config = mkdtempSync(path.join(tmpdir(), "saleor-config-"));

  try {
    const { select, run, text } = setup(saleorRoot);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.stubEnv("SALEOR_CONFIG_DIR", config);
    vi.stubEnv("SALEOR_CREDENTIAL_STORE", "file");
    vi.stubEnv("SALEOR_CLOUD_TOKEN", "");
    select.mockResolvedValueOnce("local").mockResolvedValueOnce(CANCEL_SYMBOL);
    text.mockResolvedValueOnce(BACK);
    await run(["init"]);

    expect(text).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ back: true })
    );
    expect(select).toHaveBeenCalledTimes(2);

    for (const call of [1, 2]) {
      expect(select).toHaveBeenNthCalledWith(
        call,
        expect.objectContaining({
          back: false,
          message: "Where should the new store run?",
        })
      );
    }
  } finally {
    rmSync(config, { force: true, recursive: true });
  }
});

it("offers the parent menu when a directly invoked group goes Back", async () => {
  const { action, select, run } = setup();
  select.mockResolvedValueOnce(BACK).mockResolvedValueOnce("\0exit");
  await run(["org"]);
  expect(select).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      choices: expect.not.arrayContaining([
        expect.objectContaining({ value: BACK }),
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

  select.mockResolvedValueOnce(BACK).mockResolvedValueOnce("\0exit");
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

it("runs onboarding only for a bare interactive root and supports revisiting it", async () => {
  const { select } = setup();
  select.mockResolvedValue("\0exit");
  const onboarding = vi.fn(() => Effect.succeed(true));

  const root = Command.make("saleor").pipe(
    Command.withSubcommands([onboardCommand, Command.make("list")]),
    Command.withGlobalFlags([OutputFlag, NoInputFlag])
  );

  const execute = createCliRuntime(root, {
    onboard: onboarding,
    services: Layer.empty,
    version: "1",
  });

  const run = async (argv: readonly string[]) => {
    await Effect.runPromise(
      execute(argv).pipe(
        Effect.provideService(Prompts, {
          multiselect: async () => [],
          confirm: async () => false,
          select,
          text: async () => "",
        })
      )
    );
  };

  await run([]);
  expect(onboarding).toHaveBeenLastCalledWith(expect.any(Function), false);
  onboarding.mockClear();
  await run(["--help"]);
  await run(["--no-input"]);
  await run(["--json"]);
  await run(["list"]);
  expect(onboarding).not.toHaveBeenCalled();
  await run(["onboard"]);
  expect(onboarding).toHaveBeenLastCalledWith(expect.any(Function), true);
});
