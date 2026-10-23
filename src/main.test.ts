import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { Predicate } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import samples from "./modules/cloud/api/fixtures/cloud-samples.json" with {
  type: "json",
};

const ENV_VARIABLE = /\b(SALEOR_[A-Z_]+)\b/;
const PROMISED_DEFAULT = /\(default |Defaults to "/;
const NOT_FROM_ENV = /never use/;

// SALEOR_CLI_BIN runs the same tests against another entry, such as the build output.
const executable = path.resolve(process.env.SALEOR_CLI_BIN ?? "bin/saleor.mjs");
let cwd: string;
let base: string;

let requests: Array<{
  method: string;
  path: string;
  auth: string | undefined;
  body: any;
}>;

let handler: (method: string, url: URL, body: any) => [number, unknown];
let close: () => Promise<void>;
let credentials: Record<string, string>;

const project = () => ({
  ...structuredClone(samples.project),
  name: "poc",
  plan: samples.plans[0],
  slug: "poc",
});

const environment = (key = "env1", name = "dev") => ({
  ...structuredClone(samples.environment),
  key,
  name,
  project: project(),
});

const task = (status: string) => ({
  ...samples.taskStatus,
  job_name: "test-task",
  status,
});

beforeEach(async () => {
  cwd = mkdtempSync(path.join(os.tmpdir(), "saleor-cli-test-"));
  credentials = {};
  credentials.SALEOR_CLOUD_TOKEN = "test.secret";
  requests = [];
  handler = (_method, url) => {
    if (url.pathname.endsWith("/user/")) {
      return [200, samples.user];
    }

    if (url.pathname.endsWith("/organizations/")) {
      return [200, [samples.organization]];
    }

    if (url.pathname.endsWith("/plans/")) {
      return [200, samples.plans];
    }

    return [404, { detail: "Not found" }];
  };

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString();
    let body: any;

    if (raw) {
      body = req.headers["content-type"]?.includes("json")
        ? JSON.parse(raw)
        : Object.fromEntries(new URLSearchParams(raw));
    }

    const url = new URL(req.url ?? "/", base);
    requests.push({
      auth: req.headers.authorization,
      body,
      method: req.method ?? "GET",
      path: req.url ?? "/",
    });
    const [status, value] = handler(req.method ?? "GET", url, body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(value === undefined ? undefined : JSON.stringify(value));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("Expected TCP address");
  }

  base = `http://127.0.0.1:${address.port}`;
  close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
});

afterEach(async () => {
  await close();
  rmSync(cwd, { force: true, recursive: true });
});

const cli = (args: string[], extra: Record<string, string> = {}) =>
  new Promise<{
    code: number | null;
    data: any;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    // Deliberately do not inherit real credentials, context, or auth URLs.
    const child = spawn(process.execPath, [executable, ...args], {
      cwd,
      env: {
        PATH: process.env.PATH ?? "",
        SALEOR_AUTH_URL: base,
        SALEOR_CLOUD_API_URL: base,
        SALEOR_CONFIG_DIR: path.join(cwd, "config"),
        SALEOR_CREDENTIAL_STORE: "file",
        SALEOR_NO_BROWSER: "1",
        SALEOR_POLL_INTERVAL_SECONDS: "0.001",
        ...credentials,
        ...extra,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "",
      stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      let data: any;

      try {
        data = stdout.trim() ? JSON.parse(stdout) : undefined;
      } catch {
        /* Text output. */
      }

      resolve({ code, data, stderr, stdout });
    });
  });

const resourceRoutes = (envs: ReturnType<typeof environment>[] = []) => {
  const fallback = handler;
  handler = (method, url, body) => {
    if (url.pathname.endsWith("/projects/")) {
      return [200, [project()]];
    }

    if (url.pathname.endsWith("/environments/")) {
      return [200, envs];
    }

    if (url.pathname.endsWith("/services/")) {
      return [200, samples.services];
    }

    if (url.pathname.endsWith("/tasks/")) {
      return [200, { count: 0, next: null, previous: null, results: [] }];
    }

    return fallback(method, url, body);
  };
};

describe("real CLI process", () => {
  it("initializes a local store without Cloud credentials or requests", async () => {
    credentials = {};
    const fakeBin = path.join(cwd, "fake-bin");
    mkdirSync(fakeBin);
    const fakeDocker = path.join(fakeBin, "docker");
    writeFileSync(
      fakeDocker,
      `#!${process.execPath}
if (process.argv.includes("ps")) console.log(JSON.stringify({Service:"api", State:"running"}));
`
    );
    chmodSync(fakeDocker, 0o700);
    const instance = path.join(cwd, "config/local/demo");
    mkdirSync(instance, { recursive: true });
    writeFileSync(
      path.join(instance, "instance.json"),
      JSON.stringify({
        apiPort: Number(new URL(base).port),
        dashboardPort: 9000,
        initialized: true,
        name: "demo",
        saleorVersion: "3.23.41",
        sampleData: false,
      })
    );
    handler = () => [200, { data: { shop: { name: "Local" } } }];

    // An exported SALEOR_ORG is not a Cloud flag and must not block a local setup.
    const out = await cli(["init", "--local", "--name", "demo"], {
      PATH: fakeBin,
      SALEOR_ORG: "acme",
      SALEOR_PROJECT: "poc",
    });

    expect(out.code).toBe(0);
    expect(out.data.data.ref).toBe("local:demo");
    expect(out.data.data.ready).toBe(true);
    expect(
      requests.every((request) => request.path === "/graphql/" && !request.auth)
    ).toBe(true);
  });

  it("rejects provider-specific init flags before provisioning", async () => {
    const outcomes = await Promise.all(
      [
        ["init", "--local", "--project", "shop"],
        ["init", "--sample-data", "--project", "shop", "--env", "dev"],
        ["init"],
      ].map((args) => cli(args))
    );

    expect(outcomes.map((outcome) => outcome.data.error.code)).toEqual([
      "USAGE_ERROR",
      "USAGE_ERROR",
      "CONTEXT_MISSING",
    ]);
    expect(outcomes.map((outcome) => outcome.code)).toEqual([2, 2, 1]);
    expect(outcomes[2]?.data.error.message).toBe(
      "Cloud setup needs --project <project> and --env <env>."
    );

    expect(requests).toEqual([]);
  });

  it("follows standard help and version conventions", async () => {
    const help = await cli(["help", "env"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("saleor env <command>");
    expect(help.stdout).not.toContain("GLOBAL FLAGS");

    const version = await cli(["--version", "--json"]);
    expect(version.data).toEqual({
      data: { version: expect.any(String) },
      ok: true,
    });

    // The last output flag wins.
    const text = await cli(["commands", "--json", "--output", "text"]);
    expect(text.data).toBeUndefined();
    expect(text.stdout).toContain("saleor env create");
  });

  it("shows Cloud environments with the shared instance fields", async () => {
    resourceRoutes([environment()]);
    const [listed] = (await cli(["env", "list", "--org", "acme"])).data.data;

    expect(listed).toMatchObject({
      kind: "cloud",
      name: "dev",
      ready: false,
      ref: "cloud:acme/env1",
      state: "running",
    });
    expect(Object.keys(listed)).toEqual(
      expect.arrayContaining([
        "dashboardUrl",
        "graphqlUrl",
        "saleorVersion",
        "key",
        "project",
      ])
    );
  });

  it("stops a local instance that does not exist without failing", async () => {
    const out = await cli(["local", "down", "--name", "missing"]);
    expect(out.code).toBe(0);
    expect(out.data.data).toMatchObject({ existed: false, state: "absent" });
  });

  it("reads SALEOR_PROJECT and SALEOR_ENV in init", async () => {
    resourceRoutes([environment()]);
    const fallback = handler;
    handler = (method, url, body) => {
      if (url.pathname.endsWith("/tasks/")) {
        return [
          200,
          { count: 1, next: null, previous: null, results: [task("PENDING")] },
        ];
      }

      if (url.pathname.includes("/task-status/")) {
        return [200, task("PENDING")];
      }

      return fallback(method, url, body);
    };

    const out = await cli(["init", "--org", "acme", "--timeout", "0"], {
      SALEOR_ENV: "dev",
      SALEOR_PROJECT: "poc",
    });

    expect(out.code).toBe(75);
    expect(requests.some((req) => req.method === "POST")).toBe(false);
  });

  it("names an organization the account does not belong to", async () => {
    const out = await cli(["project", "list", "--org", "nope"]);

    expect(out.data.error.code).toBe("NOT_FOUND");
    expect(out.data.error.message).toContain('Organization "nope"');
    expect(out.data.error.details.organizations).toEqual([
      samples.organization.slug,
    ]);
  });

  it("does not report a write as failed when only its answer is unreadable", async () => {
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) =>
      method === "POST"
        ? [201, { unexpected: true }]
        : fallback(method, url, body);

    const out = await cli([
      "env",
      "create",
      "dev",
      "--org",
      "acme",
      "--project",
      "poc",
      "--domain-label",
      "mine",
    ]);

    expect(out.data.error).toMatchObject({ code: "API_ERROR", retry: true });
    expect(out.data.error.message).toContain("accepted the request");
  });

  it("lists the regions when one does not exist", async () => {
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/regions/")
        ? [
            200,
            [
              {
                name: "us-east-1",
                root_domain: "saleor.cloud",
                services: "",
                url: "",
              },
            ],
          ]
        : fallback(method, url, body);

    const out = await cli([
      "project",
      "create",
      "shop",
      "--org",
      "acme",
      "--region",
      "mars-1",
    ]);

    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(out.data.error.message).toContain("Available regions: us-east-1");
    expect(requests.some((req) => req.method === "POST")).toBe(false);
  });

  it("lists commands with input metadata, including the agreed --json shortcut", async () => {
    const out = await cli(["commands", "--json"]);
    expect(out.code).toBe(0);
    expect(out.data.ok).toBe(true);
    const { commands, exitCodes, errorCodes, globalFlags } = out.data.data;
    expect(commands.map((item: any) => item.command)).toContain(
      "saleor env create"
    );
    expect(
      commands.find((item: any) => item.command === "saleor project create")
        .arguments[0].required
    ).toBe(true);
    expect(globalFlags.map((flag: any) => flag.name)).toEqual([
      "--help",
      "--version",
      "--completions",
      "--output",
      "--no-input",
    ]);
    expect(exitCodes.map((exit: any) => exit.code)).toEqual([0, 1, 2, 75, 130]);
    expect(errorCodes).toContain("NOT_READY");
    expect(requests).toEqual([]);
  });

  // Defaults and environment variables are recorded by hand next to each flag, so
  // check them against what the help text promises.
  it("publishes every default and environment variable the help text mentions", async () => {
    const { commands, globalFlags } = (await cli(["commands", "--json"])).data
      .data;

    const inputs = [
      ...globalFlags.map((flag: any) => ["global", flag]),
      ...commands.flatMap((command: any) =>
        [...command.flags, ...command.arguments].map((input: any) => [
          command.command,
          input,
        ])
      ),
    ];

    for (const [command, input] of inputs) {
      const where = `${command} ${input.name}`;

      const variable = ENV_VARIABLE.exec(input.description ?? "")?.[1];

      const promisesDefault = PROMISED_DEFAULT.test(input.description ?? "");

      if (variable !== undefined && !NOT_FROM_ENV.test(input.description)) {
        expect(input.env, where).toBe(variable);
      }

      if (promisesDefault) {
        expect(input.default, where).not.toBeNull();
      }
    }
  });
  it("renders usage failures as one JSON result", async () => {
    const out = await cli(["env", "create", "--unknown"]);
    expect(out.code).toBe(2);
    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(requests).toEqual([]);
  });
  it("renders a text usage error as one message, without the help page", async () => {
    const out = await cli(["env", "lst", "--output", "text"]);

    expect(out.code).toBe(2);
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe(
      [
        '✗ Unknown command "saleor env lst".',
        "  Did you mean: saleor env list",
        "  See all options with: saleor env --help",
        "",
      ].join("\n")
    );
  });
  it("leaves Effect's wizard and log-level flags out of help", async () => {
    const out = await cli(["--help", "--output", "text"]);

    expect(out.code).toBe(0);
    expect(out.stdout).toContain("--output <text|json>");
    expect(out.stdout).not.toContain("--wizard");
    expect(out.stdout).not.toContain("--log-level");
    expect((await cli(["--wizard"])).data.error.code).toBe("USAGE_ERROR");
  });
  it("rejects negative timeouts before any Cloud action", async () => {
    const out = await cli([
      "env",
      "create",
      "dev",
      "--org",
      "acme",
      "--project",
      "poc",
      "--timeout=-1",
    ]);

    expect(out.code).toBe(2);
    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(requests).toEqual([]);
  });
  it("requires auth and never prints credentials", async () => {
    credentials = {};
    const out = await cli(["whoami"]);
    expect(out.data.error.code).toBe("AUTH_REQUIRED");
    expect(requests).toEqual([]);
  });
  it("uses the environment token without persisting it", async () => {
    const out = await cli(["whoami"]);
    expect(out.code).toBe(0);
    expect(out.data.data.email).toBe(samples.user.email);
    expect(out.stdout + out.stderr).not.toContain("test.secret");
    expect(requests.every((req) => req.auth === "Token test.secret")).toBe(
      true
    );
    expect(await cli(["logout"])).toMatchObject({
      code: 0,
      data: { data: { envTokenStillSet: true } },
    });
  });
  it.each([401, 403])("classifies HTTP %i", async (status) => {
    handler = () => [status, {}];
    const out = await cli(["org", "list"]);
    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe(
      status === 401 ? "AUTH_INVALID" : "FORBIDDEN"
    );
  });
  it("refuses a mismatched project without writing anything", async () => {
    resourceRoutes();

    const out = await cli([
      "project",
      "create",
      "poc",
      "--org",
      "acme",
      "--region",
      "different",
    ]);

    expect(out.data.error.code).toBe("NAME_CONFLICT");
    expect(requests.every((req) => req.method === "GET")).toBe(true);
  });
  it("does not create a paid project without explicit cost acceptance", async () => {
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/projects/")
        ? [200, []]
        : fallback(method, url, body);

    const out = await cli([
      "project",
      "create",
      "paid",
      "--org",
      "acme",
      "--plan",
      "pro",
    ]);

    expect(out.data.error.code).toBe("PAID_PLAN_NOT_CONFIRMED");
    expect(out.data.error.details.pricing.flat_fee).toBe("1599.00");
    expect(requests.some((req) => req.method === "POST")).toBe(false);
  });
  it("refuses ambiguous environment names instead of selecting the first", async () => {
    resourceRoutes([environment(), environment("env2")]);
    const out = await cli(["env", "delete", "dev", "--org", "acme", "--force"]);
    expect(out.data.error.code).toBe("NAME_CONFLICT");
    expect(requests.some((req) => req.method === "DELETE")).toBe(false);
  });
  it.each([
    ["env", "delete", "dev", "--project", "poc"],
    ["project", "delete", "poc"],
    ["env", "create", "new", "--project", "poc"],
  ])(
    "previews %s %s without confirmation or writes, even with text output",
    async (...args) => {
      resourceRoutes(
        args[0] === "env" && args[1] === "delete" ? [environment()] : []
      );

      const out = await cli([
        ...args,
        "--org",
        "acme",
        "--dry-run",
        "--output",
        "text",
      ]);

      expect(out.code).toBe(0);
      expect(out.data.data).toMatchObject({
        dryRun: true,
        organization: "acme",
        project: "poc",
      });
      expect(requests.every((req) => req.method === "GET")).toBe(true);
    }
  );
  it("previews a paid project without accepting its cost", async () => {
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/projects/")
        ? [200, []]
        : fallback(method, url, body);

    const out = await cli([
      "project",
      "create",
      "paid",
      "--org",
      "acme",
      "--plan",
      "pro",
      "--dry-run",
    ]);

    expect(out.code).toBe(0);
    expect(out.data.data).toMatchObject({
      action: "create",
      costsMoney: true,
      dryRun: true,
      plan: "pro",
      state: "absent",
    });
    expect(requests.every((req) => req.method === "GET")).toBe(true);
  });
  it.each([false, true])(
    "previews a missing delete target (project=%s)",
    async (isProject) => {
      resourceRoutes();

      const out = await cli([
        isProject ? "project" : "env",
        "delete",
        "missing",
        "--org",
        "acme",
        "--dry-run",
      ]);

      expect(out.code).toBe(0);
      expect(out.data.data).toMatchObject({
        action: "none",
        dryRun: true,
        state: "absent",
      });
      expect(requests.every((req) => req.method === "GET")).toBe(true);
    }
  );
  it.each(["production", "nonempty", "conflict"] as const)(
    "keeps %s safety checks in dry runs",
    async (kind) => {
      const env = environment();

      if (kind === "production") {
        env.service.service_type = "PRODUCTION";
      }

      resourceRoutes([env]);

      const cases = {
        conflict: {
          args: [
            "env",
            "create",
            "dev",
            "--project",
            "poc",
            "--service",
            "different",
          ],
          code: "NAME_CONFLICT",
        },
        nonempty: {
          args: ["project", "delete", "poc"],
          code: "PROJECT_NOT_EMPTY",
        },
        production: {
          args: ["env", "delete", "dev"],
          code: "PRODUCTION_DELETE_REFUSED",
        },
      };

      const { args, code } = cases[kind];
      const out = await cli([...args, "--org", "acme", "--dry-run", "--force"]);
      expect(out.data.error.code).toBe(code);
      expect(requests.every((req) => req.method === "GET")).toBe(true);
    }
  );
  it.each([false, true])(
    "requires confirmation for a paid environment, including init (init=%s)",
    async (init) => {
      resourceRoutes();
      const fallback = handler;
      handler = (method, url, body) =>
        url.pathname.endsWith("/projects/")
          ? [200, [{ ...project(), plan: samples.plans[1] }]]
          : fallback(method, url, body);
      const args = init ? ["init", "--env", "new"] : ["env", "create", "new"];
      const out = await cli([...args, "--org", "acme", "--project", "poc"]);
      expect(out.data.error.code).toBe("CONFIRMATION_REQUIRED");
      expect(out.data.error.message).toContain("acme / poc");
      expect(out.data.error.suggestion).toContain("--force");
      expect(requests.every((req) => req.method === "GET")).toBe(true);
    }
  );
  it("previews paid environment creation with scope and cost", async () => {
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/projects/")
        ? [200, [{ ...project(), plan: samples.plans[1] }]]
        : fallback(method, url, body);

    const out = await cli(["env", "create", "new", "--dry-run"], {
      SALEOR_ORG: "acme",
      SALEOR_PROJECT: "poc",
    });

    expect(out.code).toBe(0);
    expect(out.data.data).toMatchObject({
      costsMoney: true,
      dryRun: true,
      organization: "acme",
      plan: "pro",
      project: "poc",
    });
    expect(requests.every((req) => req.method === "GET")).toBe(true);
  });
  it("publishes safety metadata and preview flags for all five actions", async () => {
    const out = await cli(["commands", "--json"]);

    for (const command of [
      "env delete",
      "project delete",
      "local down",
      "project create",
      "env create",
    ]) {
      const entry = out.data.data.commands.find(
        (item: any) => item.command === `saleor ${command}`
      );

      expect(entry.warning).toBeTruthy();
      expect(
        entry[command.endsWith("create") ? "costsMoney" : "destructive"]
      ).toBe(true);
      expect(entry.flags.some((flag: any) => flag.name === "--dry-run")).toBe(
        true
      );
    }
  });
  it("requires --force for noninteractive deletion", async () => {
    resourceRoutes([environment()]);
    const out = await cli(["env", "delete", "env1", "--org", "acme"]);
    expect(out.data.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(requests.some((req) => req.method === "DELETE")).toBe(false);
  });
  it("refuses production deletion even with --force", async () => {
    const env = environment();
    env.service.service_type = "PRODUCTION";
    resourceRoutes([env]);

    const out = await cli([
      "env",
      "delete",
      "env1",
      "--org",
      "acme",
      "--force",
    ]);

    expect(out.data.error.code).toBe("PRODUCTION_DELETE_REFUSED");
    expect(requests.some((req) => req.method === "DELETE")).toBe(false);
  });
  it("refuses a production service before creating an environment", async () => {
    resourceRoutes();

    const out = await cli([
      "env",
      "create",
      "dev",
      "--org",
      "acme",
      "--project",
      "poc",
      "--service",
      samples.services[0]?.name ?? "missing",
    ]);

    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(requests.some((req) => req.method === "POST")).toBe(false);
  });
  it("refuses deletion of a nonempty project", async () => {
    resourceRoutes([environment()]);
    expect(
      (await cli(["project", "delete", "poc", "--org", "acme", "--force"])).data
        .error.code
    ).toBe("PROJECT_NOT_EMPTY");
  });
  it("deleting an absent environment succeeds", async () => {
    resourceRoutes();
    expect(
      await cli(["env", "delete", "missing", "--org", "acme", "--force"])
    ).toMatchObject({ code: 0, data: { data: { deleted: false } } });
  });
  it.each(["FAILED", "TIMED_OUT"])(
    "stops on a %s task (anonymous status call)",
    async (status) => {
      resourceRoutes([environment()]);
      const fallback = handler;
      handler = (method, url, body) => {
        if (url.pathname.endsWith("/tasks/")) {
          return [
            200,
            {
              count: 1,
              next: null,
              previous: null,
              results: [task("PENDING")],
            },
          ];
        }

        if (url.pathname.includes("/task-status/")) {
          return [200, task(status)];
        }

        return fallback(method, url, body);
      };

      const out = await cli([
        "env",
        "create",
        "dev",
        "--org",
        "acme",
        "--project",
        "poc",
        "--timeout",
        "0",
      ]);

      expect(out.data.error.code).toBe("TASK_FAILED");
      expect(
        requests.find((req) => req.path.includes("/task-status/"))?.auth
      ).toBeUndefined();
    }
  );
  it("returns NOT_READY and a resumable command for pending work", async () => {
    resourceRoutes([environment()]);
    const fallback = handler;
    handler = (method, url, body) => {
      if (url.pathname.endsWith("/tasks/")) {
        return [
          200,
          { count: 1, next: null, previous: null, results: [task("PENDING")] },
        ];
      }

      if (url.pathname.includes("/task-status/")) {
        return [200, task("PENDING")];
      }

      return fallback(method, url, body);
    };

    const out = await cli([
      "env",
      "create",
      "dev",
      "--org",
      "acme",
      "--project",
      "poc",
      "--timeout",
      "0",
    ]);

    expect(out.code).toBe(75);
    expect(out.data.error).toMatchObject({ code: "NOT_READY", retry: true });
    expect(out.data.error.suggestion).toContain(
      "run the same command again: saleor env create dev --org acme --project poc"
    );
    expect(out.data.error.suggestion).not.toContain("--timeout");
    expect(requests.some((req) => req.method === "POST")).toBe(false);
  });
  it.each([false, true])(
    "creates using obtain or explicit domain (explicit=%s), without retrying an uncertain write",
    async (explicit) => {
      resourceRoutes();
      const fallback = handler;
      handler = (method, url, body) =>
        method === "POST" ? [500, {}] : fallback(method, url, body);

      const args = [
        "env",
        "create",
        "dev",
        "--org",
        "acme",
        "--project",
        "poc",
      ];

      if (explicit) {
        args.push("--domain-label", "my-store");
      }

      expect((await cli(args)).data.error.code).toBe("API_ERROR");
      const writes = requests.filter((req) => req.method === "POST");
      expect(writes).toHaveLength(1);
      expect(writes[0]?.path).toBe(
        `/api/organizations/acme/environments/${explicit ? "" : "obtain/"}`
      );
      expect(writes[0]?.body).toMatchObject({
        name: "dev",
        project: "poc",
        service: samples.services[1]?.name,
      });
    }
  );
  it.each([
    [
      "domain_label",
      "This domain label is already taken.",
      "DOMAIN_LABEL_TAKEN",
    ],
    ["detail", "Sandbox limit reached", "ENVIRONMENT_LIMIT_REACHED"],
  ])("maps create validation (%s)", async (field, message, code) => {
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) =>
      method === "POST"
        ? [400, { [field]: [message] }]
        : fallback(method, url, body);
    expect(
      (
        await cli([
          "env",
          "create",
          "dev",
          "--org",
          "acme",
          "--project",
          "poc",
          "--domain-label",
          "mine",
        ])
      ).data.error.code
    ).toBe(code);
  });
  it("recovers a committed create whose response failed without posting twice", async () => {
    resourceRoutes();
    let committed = false;
    const fallback = handler;
    handler = (method, url, body) => {
      if (method === "POST") {
        committed = true;

        return [500, {}];
      }

      if (url.pathname.endsWith("/environments/")) {
        return [200, committed ? [environment()] : []];
      }

      if (url.pathname.endsWith("/tasks/")) {
        return [
          200,
          { count: 1, next: null, previous: null, results: [task("PENDING")] },
        ];
      }

      if (url.pathname.includes("/task-status/")) {
        return [200, task("PENDING")];
      }

      return fallback(method, url, body);
    };

    const args = [
      "env",
      "create",
      "dev",
      "--org",
      "acme",
      "--project",
      "poc",
      "--timeout",
      "0",
    ];

    expect((await cli(args)).data.error.code).toBe("API_ERROR");
    expect((await cli(args)).code).toBe(75);
    expect(requests.filter((req) => req.method === "POST")).toHaveLength(1);
  });
  it("waits out a delete blocked by another task, then reports NOT_READY with the same command", async () => {
    resourceRoutes([environment()]);
    const fallback = handler;
    handler = (method, url, body) =>
      method === "DELETE"
        ? [400, { __all__: "There are active tasks in the environment" }]
        : fallback(method, url, body);

    const out = await cli([
      "env",
      "delete",
      "env1",
      "--org",
      "acme",
      "--force",
      "--timeout",
      "0",
    ]);

    expect(out.code).toBe(75);
    expect(out.data.error.code).toBe("NOT_READY");
    // The resume hint drops `--timeout 0`, which would return at once again.
    expect(out.data.error.suggestion).toContain(
      "run the same command again: saleor env delete env1 --org acme --force"
    );
    expect(out.data.error.suggestion).not.toContain("--timeout");
  });
  it("retries a busy delete until Cloud accepts it, then waits until gone", async () => {
    let envs = [environment()];
    resourceRoutes();
    let deletes = 0;
    const fallback = handler;
    handler = (method, url, body) => {
      if (method === "DELETE") {
        deletes += 1;

        if (deletes === 1) {
          return [
            400,
            { __all__: "There are active tasks in the environment" },
          ];
        }

        envs = [];

        return [202, { task_id: "delete" }];
      }

      return url.pathname.endsWith("/environments/")
        ? [200, envs]
        : fallback(method, url, body);
    };

    const out = await cli([
      "env",
      "delete",
      "env1",
      "--org",
      "acme",
      "--force",
    ]);

    expect(out.code).toBe(0);
    expect(out.data.data.deleted).toBe(true);
    expect(deletes).toBe(2);
  });
  it("does not retry a delete Cloud rejects for another reason", async () => {
    resourceRoutes([environment()]);
    const fallback = handler;
    handler = (method, url, body) =>
      method === "DELETE"
        ? [400, { detail: "Environment is protected" }]
        : fallback(method, url, body);

    const out = await cli([
      "env",
      "delete",
      "env1",
      "--org",
      "acme",
      "--force",
    ]);

    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe("API_VALIDATION_ERROR");
  });
  it("refuses deleting any environment that is not a sandbox", async () => {
    const env = environment();
    env.service.service_type = "STAGING";
    resourceRoutes([env]);

    const out = await cli([
      "env",
      "delete",
      "env1",
      "--org",
      "acme",
      "--force",
    ]);

    expect(out.data.error.code).toBe("PRODUCTION_DELETE_REFUSED");
    expect(requests.some((req) => req.method === "DELETE")).toBe(false);
  });
  it("reports a creation that failed while nobody was watching", async () => {
    resourceRoutes([environment()]);
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/tasks/")
        ? [
            200,
            { count: 1, next: null, previous: null, results: [task("FAILED")] },
          ]
        : fallback(method, url, body);

    const out = await cli([
      "env",
      "create",
      "dev",
      "--org",
      "acme",
      "--project",
      "poc",
    ]);

    expect(out.data.error.code).toBe("TASK_FAILED");
    expect(
      requests.find((req) => req.path.includes("/tasks/"))?.path
    ).toContain("is_blocking=true");
    expect(requests.some((req) => req.path.includes("/task-status/"))).toBe(
      false
    );
  });
  it("finds an environment to delete in any project of the organization", async () => {
    const elsewhere = environment("env9", "other");
    elsewhere.project = { ...elsewhere.project, slug: "other-project" };
    let envs = [environment(), elsewhere];
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) => {
      if (method === "DELETE") {
        envs = envs.filter((env) => !url.pathname.includes(env.key));

        return [202, { task_id: "delete" }];
      }

      return url.pathname.endsWith("/environments/")
        ? [200, envs]
        : fallback(method, url, body);
    };

    const out = await cli([
      "env",
      "delete",
      "env9",
      "--org",
      "acme",
      "--force",
    ]);

    expect(out.data.data).toMatchObject({ deleted: true, environment: "env9" });
  });
  it("names the account once when it has no display name", async () => {
    handler = (_method, url) => {
      if (url.pathname.endsWith("/user/")) {
        return [200, { ...samples.user, first_name: null, last_name: null }];
      }

      return url.pathname.endsWith("/organizations/")
        ? [200, [samples.organization]]
        : [404, {}];
    };

    const out = await cli(["whoami", "--output", "text"]);

    expect(out.code).toBe(0);
    expect(out.stdout.split(samples.user.email)).toHaveLength(2);
  });
  it("uses tokens another process refreshed when its own refresh is refused", async () => {
    credentials = {};
    const file = path.join(cwd, "config/credentials.json");

    const stored = (refreshToken: string, accessExpiresAt: number) =>
      JSON.stringify({
        "cloud:credentials": JSON.stringify({
          accessExpiresAt,
          accessToken: `jwt.${refreshToken}.token`,
          clientId: "jolly",
          refreshToken,
        }),
      });

    mkdirSync(path.join(cwd, "config"));
    writeFileSync(file, stored("old", 0));
    const fallback = handler;
    handler = (method, url, body) => {
      if (url.pathname.endsWith("/token")) {
        // The other process wins the race: it rotated the refresh token first.
        writeFileSync(file, stored("new", Date.now() + 600_000));

        return [400, { error: "invalid_grant" }];
      }

      return fallback(method, url, body);
    };

    const out = await cli(["whoami"]);

    expect(out.code).toBe(0);
    expect(requests.at(-1)?.auth).toBe("Bearer jwt.new.token");
  });
  it("resumes a pending device login, stores private credentials, refreshes and logs out", async () => {
    credentials = {};
    mkdirSync(path.join(cwd, "config"));
    writeFileSync(
      path.join(cwd, "config/credentials.json"),
      JSON.stringify({
        "cloud:pending-device-grant": JSON.stringify({
          deviceCode: "device",
          expiresAt: Date.now() + 60_000,
          intervalSeconds: 0.001,
          userCode: "ABCD",
          verificationUri: `${base}/verify`,
        }),
      })
    );
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/token")
        ? [
            200,
            {
              access_token: "jwt.access.token",
              expires_in: 0,
              refresh_expires_in: 3600,
              refresh_token: "refresh-secret",
            },
          ]
        : fallback(method, url, body);
    const login = await cli(["login", "--no-browser"]);
    expect(login.code).toBe(0);
    expect(requests.some((req) => req.path.endsWith("/auth/device"))).toBe(
      false
    );
    expect(
      requests
        .filter((req) => req.path.endsWith("/token"))
        .map((req) => req.body.grant_type)
    ).toEqual([
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ]);
    const file = path.join(cwd, "config/credentials.json");
    // biome-ignore lint/suspicious/noBitwiseOperators: Inspect POSIX permission bits.
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain("pending-device-grant");
    expect(login.stdout + login.stderr).not.toContain("refresh-secret");
    expect((await cli(["logout"])).data.data.removed).toBe(true);
    expect((await cli(["whoami"])).data.error.code).toBe("AUTH_REQUIRED");
  });
  it.each(["access_denied", "expired_token"])(
    "handles device login %s",
    async (error) => {
      credentials = {};
      handler = (_method, url) =>
        url.pathname.endsWith("/auth/device")
          ? [
              200,
              {
                device_code: "device",
                expires_in: 60,
                interval: 0.001,
                user_code: "ABCD",
                verification_uri: `${base}/verify`,
              },
            ]
          : [400, { error }];
      const out = await cli(["login", "--no-browser"]);
      expect(out.code).toBe(1);
      expect(out.data.error.code).toBe(
        error === "access_denied"
          ? "AUTH_DEVICE_ACCESS_DENIED"
          : "AUTH_DEVICE_CODE_EXPIRED"
      );
    }
  );
});
