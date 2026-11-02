import { Predicate } from "effect";
import { createTarGzip } from "nanotar";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createSecureServer } from "node:https";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import samples from "./modules/cloud/api/fixtures/cloud-samples.json" with { type: "json" };

const asyncHandler =
  (handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
  (req: IncomingMessage, res: ServerResponse) => {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection is an I/O boundary; the callback narrows the error.
    handle(req, res).catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  };

const ENV_VARIABLE = /\b(SALEOR_[A-Z_]+)\b/;
const PROMISED_DEFAULT = /\(default |Defaults to "/;
const NOT_FROM_ENV = /never use/;
const DRY_RUN_TEXT = /^Dry run: would (delete|create)/;
const DEMO_HEADER = /^# saleor: instance=local:demo /;

// SALEOR_CLI_BIN runs the same tests against another entry, such as the build output.
const executable = path.resolve(process.env.SALEOR_CLI_BIN ?? "bin/saleor.mjs");
let cwd: string;
let base: string;

let requests: {
  method: string;
  path: string;
  auth: string | undefined;
  body: any;
}[];

let handler: (method: string, url: URL, body: any) => [number, unknown];
let close: () => Promise<void>;
let credentials: Record<string, string>;

const project = () => ({
  ...structuredClone(samples.project),
  name: "poc",
  plan: samples.plans[0],
  sandboxes: { count: 0 },
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
  credentials.SALEOR_ORG = samples.organization.slug;
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

  const server = createServer(
    asyncHandler(async (req, res) => {
      // Local port-discovery tools probe new listeners; these are not API calls.
      if (req.method === "HEAD" && req.url === "/") {
        res.writeHead(204);
        res.end();

        return;
      }

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
    })
  );

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("Expected TCP address");
  }

  base = `http://127.0.0.1:${address.port}`;
  close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  };
});

afterEach(async () => {
  await close();
  rmSync(cwd, { force: true, recursive: true });
});

const cli = async (
  args: string[],
  extra: Record<string, string> = {},
  dir = cwd
) =>
  await new Promise<{
    code: number | null;
    data: any;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    // Deliberately do not inherit real credentials, context, or auth URLs.
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: dir,
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

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`CLI timed out: ${args.join(" ")}\n${stdout}\n${stderr}`)
      );
    }, 10_000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
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

// A fresh, trusted certificate for 127.0.0.1, for mock stores served over HTTPS as
// Cloud stores are; pass `cert` as NODE_EXTRA_CA_CERTS.
const testCertificate = () => {
  const cert = path.join(cwd, "cert.pem");
  const key = path.join(cwd, "key.pem");
  const config = path.join(cwd, "openssl.cnf");
  writeFileSync(
    config,
    `[req]
distinguished_name=dn
x509_extensions=extensions
prompt=no
[dn]
CN=CLI test server
[extensions]
subjectAltName=IP:127.0.0.1
basicConstraints=critical,CA:TRUE
`
  );
  // A fresh, trusted test certificate keeps production TLS verification enabled.
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-config",
      config,
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" }
  );

  return { cert, key };
};

describe("real CLI process", () => {
  it.each(["config", "configurator"])(
    "%s validates offline through the library with only the CLI JSON envelope",
    async (group) => {
      credentials = {};
      writeFileSync(
        path.join(cwd, "config.yml"),
        "shop:\n  defaultMailSenderName: Library store\n"
      );
      writeFileSync(path.join(cwd, ".env.local"), "SALEOR_CONFIG=wrong.yml\n");

      const out = await cli([group, "validate", "--agent"]);
      expect(out.code, out.stdout + out.stderr).toBe(0);
      expect(out.data).toStrictEqual({
        data: {
          config: "config.yml",
          configs: [
            { component: null, config: "config.yml", sections: { shop: 1 } },
          ],
          sections: { shop: 1 },
          valid: true,
        },
        ok: true,
      });
      expect(out.stderr).toBe("");
      expect(requests).toStrictEqual([]);
      expect(existsSync(path.join(cwd, ".configurator"))).toBe(false);
    }
  );

  it("reports invalid library configuration with the CLI error and exit code", async () => {
    writeFileSync(path.join(cwd, "config.yml"), "channels: invalid\n");
    const out = await cli(["config", "validate", "--agent"]);
    expect(out.code, out.stdout + out.stderr).toBe(1);
    expect(out.data).toMatchObject({
      error: { code: "CONFIG_INVALID", retry: false },
      ok: false,
    });
    expect(out.stderr).toBe("");
    expect(requests).toStrictEqual([]);
  });

  it("runs an agent's Cloud lifecycle against a stateful mock Saleor", async () => {
    const { cert, key } = testCertificate();

    const probes: {
      path: string | undefined;
      auth: string | undefined;
      body: string;
    }[] = [];

    const store = createSecureServer(
      { cert: readFileSync(cert), key: readFileSync(key) },
      asyncHandler(async (req, res) => {
        const chunks: Buffer[] = [];

        for await (const chunk of req) {
          chunks.push(chunk);
        }

        probes.push({
          auth: req.headers.authorization,
          body: Buffer.concat(chunks).toString(),
          path: req.url,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { shop: { name: "Mock Saleor" } } }));
      })
    );

    await new Promise<void>((resolve) => {
      store.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = store.address();

      if (address === null || Predicate.isString(address)) {
        throw new Error("Expected TCP address");
      }

      const domain = `127.0.0.1:${address.port}`;
      const projects: ReturnType<typeof project>[] = [];
      let environments: ReturnType<typeof environment>[] = [];
      let taskReads = 0;
      const fallback = handler;
      handler = (method, url, body) => {
        const route = url.pathname;

        if (route === "/api/organizations/acme/projects/") {
          if (method === "POST") {
            projects.push({
              ...project(),
              name: body.name,
              region: body.region,
            });

            return [201, { slug: "poc" }];
          }

          return [200, projects];
        }

        if (route.endsWith("/services/")) {
          return [200, samples.services];
        }

        if (route.endsWith("/regions/")) {
          return [
            200,
            [
              { name: "eu-west-1", root_domain: "example.test" },
              { name: "us-east-1", root_domain: "example.test" },
            ],
          ];
        }

        if (
          route === "/api/organizations/acme/environments/obtain/" &&
          method === "POST"
        ) {
          environments.push({
            ...environment(`env${environments.length + 1}`),
            domain,
            name: body.name,
          });

          return [201, { ...environments.at(-1), task_id: "setup" }];
        }

        if (route === "/api/organizations/acme/environments/") {
          return [200, environments];
        }

        if (
          route === "/api/organizations/acme/environments/env1/" &&
          method === "DELETE"
        ) {
          environments = environments.filter((env) => env.key !== "env1");

          return [202, undefined];
        }

        if (route.endsWith("/task-status/setup/")) {
          taskReads += 1;

          return [200, task(taskReads === 1 ? "PENDING" : "SUCCEEDED")];
        }

        if (route.endsWith("/tasks/")) {
          return [200, { count: 0, next: null, previous: null, results: [] }];
        }

        return fallback(method, url, body);
      };

      // `init` makes the project in ./poc, next to the files already here.
      let dir = cwd;

      const run = async (...args: string[]) => {
        const out = await cli(
          [...args, "--agent"],
          { NODE_EXTRA_CA_CERTS: cert },
          dir
        );

        expect(out.code, out.stdout + out.stderr).toBe(0);
        expect(out.data.ok).toBe(true);
        expect(out.stdout + out.stderr).not.toContain("test.secret");
        expect(out.stdout + out.stderr).not.toContain("\u001B[");

        return out.data.data;
      };

      const init = async (...args: string[]) =>
        await run("init", "--project", "poc", "--env", "dev", ...args);

      expect(await init("--region", "eu-west-1", "--dry-run")).toMatchObject({
        action: "create",
        dryRun: true,
      });
      expect(projects).toHaveLength(0);
      expect(
        await init("--region", "eu-west-1", "--timeout", "5")
      ).toMatchObject({ created: true, projectCreated: true, ready: true });
      expect(projects[0]?.region).toBe("eu-west-1");
      expect(taskReads).toBeGreaterThanOrEqual(2);
      expect(await init("--timeout", "5")).toMatchObject({
        created: false,
        projectCreated: false,
        ready: true,
      });

      // Inside the project, the store has the name saleor.yml gives it.
      dir = path.join(cwd, "poc");
      expect(readFileSync(path.join(dir, "saleor.yml"), "utf-8")).toContain(
        "dev: cloud:acme/env1"
      );

      // A second environment, named in saleor.yml as the Cloud environment is.
      expect(
        await run("env", "add", "staging", "--project", "poc", "--timeout", "5")
      ).toMatchObject({ created: true, ref: "cloud:acme/env2" });
      expect(readFileSync(path.join(dir, "saleor.yml"), "utf-8")).toContain(
        "staging: cloud:acme/env2"
      );
      // Adding it again finds it, without asking Cloud for another.
      expect(await run("env", "add", "staging")).toMatchObject({
        created: false,
        ref: "cloud:acme/env2",
      });

      const listed = await run("env", "list");
      expect(listed).toMatchObject([
        {
          dashboardUrl: `https://${domain}/dashboard/`,
          environment: "dev",
          graphqlUrl: `https://${domain}/graphql/`,
          ref: "cloud:acme/env1",
        },
        { environment: "staging", ref: "cloud:acme/env2" },
      ]);

      expect(await run("env", "remove", "dev", "--dry-run")).toMatchObject({
        action: "delete",
        dryRun: true,
      });
      expect(environments).toHaveLength(2);
      expect(await run("env", "remove", "dev", "--force")).toMatchObject({
        action: "delete",
        environment: "dev",
        existed: true,
        forgotten: true,
      });
      // The store is gone, and so is its name.
      expect(readFileSync(path.join(dir, "saleor.yml"), "utf-8")).not.toContain(
        "dev:"
      );
      expect(
        await run("env", "remove", "cloud:acme/dev", "--force")
      ).toMatchObject({ action: "none", existed: false });
      expect(await run("env", "list")).toMatchObject([
        { environment: "staging" },
      ]);
      expect(
        requests
          .filter((req) =>
            ["POST", "DELETE", "PATCH", "PUT"].includes(req.method)
          )
          .map((req) => `${req.method} ${req.path}`)
      ).toStrictEqual([
        "POST /api/organizations/acme/projects/",
        "POST /api/organizations/acme/environments/obtain/",
        "POST /api/organizations/acme/environments/obtain/",
        "DELETE /api/organizations/acme/environments/env1/",
      ]);
      expect(probes.length).toBeGreaterThanOrEqual(2);

      for (const probe of probes) {
        expect(probe.path).toBe("/graphql/");
        expect(probe.auth).toBeUndefined();
        expect(JSON.parse(probe.body)).toStrictEqual({
          query: "query { shop { name } }",
        });
      }
    } finally {
      store.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        store.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  }, 30_000);

  it("plans project local provisioning without creating state and validates bootstrap configuration", async () => {
    writeFileSync(
      path.join(cwd, "saleor.yml"),
      "name: shared\nenvironments:\n  local:\n    kind: local\n    saleor: 3.23.41\n"
    );
    writeFileSync(path.join(cwd, "config.yml"), "invalid: [");
    const invalid = await cli(["env", "start", "--dry-run", "--agent"]);
    expect(invalid.code).not.toBe(0);
    writeFileSync(path.join(cwd, "config.yml"), "{}\n");
    // The project's only environment is the default; naming it is the same.
    const first = await cli(["env", "start", "--dry-run", "--agent"]);
    const second = await cli(["env", "start", "local", "--dry-run", "--agent"]);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(first.data.data.action).toBe("create");
    expect(first.data.data.details).toMatchObject({
      configure: true,
      saleorVersion: "3.23.41",
    });
    expect(second.data.data.target).toStrictEqual(first.data.data.target);

    // Configured on create unless the definition opts out.
    writeFileSync(
      path.join(cwd, "saleor.yml"),
      "name: shared\nenvironments:\n  local:\n    kind: local\n    saleor: 3.23.41\n    configure: never\n"
    );
    const optedOut = await cli(["env", "start", "--dry-run", "--agent"]);
    expect(optedOut.data.data.details.configure).toBe(false);
    expect(
      existsSync(path.join(cwd, "config/local", first.data.data.target.name))
    ).toBe(false);
    expect(existsSync(path.join(cwd, "config/workspaces"))).toBe(false);

    // Another local environment gets an instance named after the project too, since
    // local names are shared by every project on this computer.
    const added = await cli(
      ["env", "add", "review", "--local", "--dry-run", "--agent"],
      { SALEOR_ORG: "" }
    );

    expect(added.code, added.stdout + added.stderr).toBe(0);
    expect(added.data.data).toMatchObject({
      action: "create",
      details: { environment: "review" },
      target: { name: "shared-review", type: "local-instance" },
    });
    expect(readFileSync(path.join(cwd, "saleor.yml"), "utf-8")).not.toContain(
      "review"
    );

    const outcomes = await Promise.all(
      [
        ["env", "add", "Review", "--local"],
        ["env", "add", "--local"],
      ].map(async (args) => await cli(args))
    );

    expect(outcomes.map((out) => out.data.error.code)).toStrictEqual([
      "USAGE_ERROR",
      "CONTEXT_MISSING",
    ]);
  });

  it("adds environments only to a project", async () => {
    const out = await cli(["env", "add", "staging", "--local"]);
    expect(out.data.error).toMatchObject({
      code: "NOT_FOUND",
      suggestion: "Start one with: saleor init",
    });
  });

  // The same store by its name in saleor.yml, and by its ref.
  it.each(["local", "local:demo"])(
    "manages a local store without Cloud credentials (%s)",
    async (word) => {
      credentials = {};
      const fakeBin = path.join(cwd, "fake-bin");
      mkdirSync(fakeBin);
      const fakeDocker = path.join(fakeBin, "docker");
      writeFileSync(
        fakeDocker,
        `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync("docker-calls.jsonl", JSON.stringify(process.argv.slice(2)) + "\\n");
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

      writeFileSync(path.join(cwd, "saleor.yml"), "name: shared-project\n");

      // An exported SALEOR_ORG is not a Cloud flag and must not block a local setup.
      const out = await cli(["init", "--local", "--name", "demo"], {
        PATH: fakeBin,
        SALEOR_ORG: "acme",
        SALEOR_PROJECT: "poc",
      });

      expect(out.code).toBe(0);
      expect(out.data.data.ref).toBe("local:demo");
      expect(out.data.data.ready).toBe(true);
      const manifestFile = path.join(cwd, "saleor.yml");
      const manifest = readFileSync(manifestFile, "utf-8");
      expect(manifest).toContain("kind: local");
      expect(manifest).not.toContain("local:demo");
      expect(existsSync(path.join(cwd, "AGENTS.md"))).toBe(true);
      expect(existsSync(path.join(cwd, "CLAUDE.md"))).toBe(true);

      const inferred = await cli(["env", "start", "--dry-run", "--agent"], {
        PATH: fakeBin,
      });

      expect(inferred.code, inferred.stdout + inferred.stderr).toBe(0);
      expect(inferred.data.data.target.name).toBe("demo");
      expect(inferred.data.data.details.configure).toBe(false);

      // A removal is never inferred, not even from the only environment.
      const unnamed = await cli(["env", "remove", "--dry-run", "--agent"], {
        PATH: fakeBin,
      });

      expect(unnamed.data.error.code).toBe("CONTEXT_MISSING");
      expect(unnamed.data.error.details.choices).toStrictEqual(["local"]);

      const removal = await cli(
        ["env", "remove", word, "--dry-run", "--agent"],
        { PATH: fakeBin }
      );

      expect(removal.data.data.target.name).toBe("demo");
      expect(existsSync(instance)).toBe(true);
      writeFileSync(manifestFile, manifest.replace("3.23.41", "3.23.42"));

      const mismatch = await cli(["env", "start", "--dry-run", "--agent"], {
        PATH: fakeBin,
      });

      expect(mismatch.code).not.toBe(0);
      expect(mismatch.stdout).toContain("3.23.42");
      writeFileSync(manifestFile, manifest);

      const env = async (...args: string[]) => {
        const answer = await cli(["env", ...args, "--agent"], {
          PATH: fakeBin,
        });

        expect(answer.code, answer.stdout + answer.stderr).toBe(0);

        return answer.data.data;
      };

      expect(await env("start", word)).toMatchObject({
        created: false,
        ready: true,
        ref: "local:demo",
      });

      const missing = await cli(["env", "start", "local:missing", "--agent"], {
        PATH: fakeBin,
      });

      expect(missing.data.error.code).toBe("NOT_FOUND");
      expect(existsSync(path.join(cwd, "config/local/missing"))).toBe(false);

      // Cloud stores are left out without a login, with a note saying so.
      expect(await env("list")).toMatchObject([
        { environment: "local", name: "demo", state: "ready" },
      ]);
      expect(await env("stop", word, "--dry-run")).toMatchObject({
        action: "stop",
        destructive: false,
        dryRun: true,
      });
      expect(await env("stop", word)).toMatchObject({
        action: "stop",
        existed: true,
        next: "saleor env start local",
      });
      expect(
        readFileSync(path.join(instance, "instance.json"), "utf-8")
      ).toContain("demo");
      expect(await env("remove", word, "--dry-run")).toMatchObject({
        action: "delete",
        destructive: true,
        dryRun: true,
      });
      expect(existsSync(instance)).toBe(true);

      const unconfirmed = await cli(["env", "remove", word, "--agent"], {
        PATH: fakeBin,
      });

      expect(unconfirmed.code).toBe(1);
      expect(unconfirmed.data.error.code).toBe("CONFIRMATION_REQUIRED");
      expect(existsSync(instance)).toBe(true);
      // The definition stays in saleor.yml, so `env start` can create it again.
      expect(await env("remove", word, "--force")).toMatchObject({
        action: "delete",
        environment: "local",
        existed: true,
        forgotten: false,
      });
      expect(existsSync(instance)).toBe(false);
      expect(readFileSync(manifestFile, "utf-8")).toContain("kind: local");
      expect(await env("remove", word)).toMatchObject({
        action: "none",
        existed: false,
      });
      expect(await env("list")).toStrictEqual([]);

      const dockerCalls: string[][] = readFileSync(
        path.join(cwd, "docker-calls.jsonl"),
        "utf-8"
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      const stops = dockerCalls.filter((args) => args.includes("down"));
      expect(stops).toHaveLength(2);
      expect(stops[0]).not.toContain("--volumes");
      expect(stops[1]).toContain("--volumes");
      expect(
        requests.every(
          (request) => request.path === "/graphql/" && !request.auth
        )
      ).toBe(true);
    },
    // Runs over ten real CLI processes, which shared CI runners make slow.
    60_000
  );

  it("rejects provider-specific init flags before provisioning", async () => {
    const outcomes = await Promise.all(
      [
        ["init", "--local", "--project", "shop"],
        ["init", "--sample-data", "--project", "shop", "--env", "dev"],
        ["init"],
      ].map(async (args) => await cli(args))
    );

    expect(outcomes.map((outcome) => outcome.data.error.code)).toStrictEqual([
      "USAGE_ERROR",
      "USAGE_ERROR",
      "CONTEXT_MISSING",
    ]);
    expect(outcomes.map((outcome) => outcome.code)).toStrictEqual([2, 2, 2]);
    expect(outcomes[2]?.data.error.message).toBe("No project selected.");
    // A missing input lists what could be passed, and the other provider.
    expect(outcomes[2]?.data.error.suggestion).toContain("--project");
    expect(outcomes[2]?.data.error.suggestion).toContain("saleor init --local");
    expect(requests.every((req) => req.method === "GET")).toBe(true);
  });

  it("follows standard help and version conventions", async () => {
    const help = await cli(["help", "env"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("saleor env <command>");
    expect(help.stdout).not.toContain("GLOBAL FLAGS");

    const version = await cli(["--version", "--json"]);
    expect(version.data).toStrictEqual({
      data: { version: expect.any(String) },
      ok: true,
    });

    // The last output flag wins.
    const text = await cli(["commands", "--json", "--output", "text"]);
    expect(text.data).toBeUndefined();
    expect(text.stdout).toContain("saleor env remove");
  });

  it("shows Cloud environments with the shared instance fields", async () => {
    resourceRoutes([environment()]);
    const [listed] = (await cli(["env", "list"])).data.data;

    expect(listed).toMatchObject({
      kind: "cloud",
      name: "dev",
      ready: false,
      ref: "cloud:acme/env1",
      state: "running",
    });
    expect(Object.keys(listed)).toStrictEqual(
      expect.arrayContaining([
        "dashboardUrl",
        "graphqlUrl",
        "saleorVersion",
        "key",
        "project",
      ])
    );
  });

  it("makes a Cloud store's token with the Cloud login, then reuses it", async () => {
    const { cert, key } = testCertificate();
    const received: {
      auth: string | undefined;
      bearer: string | undefined;
      body: any;
    }[] = [];
    const apps: { id: string; name: string }[] = [];

    const store = createSecureServer(
      { cert: readFileSync(cert), key: readFileSync(key) },
      asyncHandler(async (req, res) => {
        const chunks: Buffer[] = [];

        for await (const chunk of req) {
          chunks.push(chunk);
        }

        const body = JSON.parse(Buffer.concat(chunks).toString());
        const bearer = req.headers["authorization-bearer"];
        received.push({
          auth: req.headers.authorization,
          bearer: Array.isArray(bearer) ? bearer.join() : bearer,
          body,
        });

        let data: object = { shop: { name: "Mock Saleor" } };

        if (body.query.includes("userPermissions")) {
          data = {
            apps: { edges: apps.map((node) => ({ node })) },
            me: {
              userPermissions: [
                { code: "MANAGE_APPS" },
                { code: "MANAGE_PRODUCTS" },
              ],
            },
          };
        } else if (body.query.includes("appCreate")) {
          apps.push({ id: "QXBwOjE=", name: body.variables.name });
          data = { issued: { authToken: "app.token.1", errors: [] } };
        } else if (body.query.includes("appTokenCreate")) {
          data = { issued: { authToken: "app.token.2", errors: [] } };
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data }));
      })
    );

    await new Promise<void>((resolve) => {
      store.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = store.address();

      if (address === null || Predicate.isString(address)) {
        throw new Error("Expected TCP address");
      }

      resourceRoutes([
        { ...environment(), domain: `127.0.0.1:${address.port}` },
      ]);

      const call = async () => {
        const out = await cli(
          [
            "api",
            "call",
            "cloud:acme/env1",
            "--query",
            "{ shop { name } }",
            "--agent",
          ],
          { NODE_EXTRA_CA_CERTS: cert }
        );
        expect(out.code, out.stdout + out.stderr).toBe(0);
        expect(out.data.data).toStrictEqual({ shop: { name: "Mock Saleor" } });

        return received
          .splice(0)
          .filter((each) => each.body.query !== "query { shop { name } }");
      };
      const credentialsFile = path.join(cwd, "config/credentials.json");
      const saved = () =>
        JSON.parse(readFileSync(credentialsFile, "utf-8"))[
          "store:cloud:acme/env1"
        ];

      // First run: the login creates the app, with what its owner may grant.
      const first = await call();
      expect(first.map((each) => each.bearer)).toStrictEqual([
        "test.secret",
        "test.secret",
        undefined,
      ]);
      expect(first[1]?.body.variables).toStrictEqual({
        name: "Saleor CLI",
        permissions: ["MANAGE_APPS", "MANAGE_PRODUCTS"],
      });
      // The login never goes in Authorization; the store request uses the app token.
      expect(first.map((each) => each.auth)).toStrictEqual([
        undefined,
        undefined,
        "Bearer app.token.1",
      ]);
      expect(saved()).toBe("app.token.1");

      // Second run: the saved token, without asking the store for another.
      const second = await call();
      expect(second.map((each) => each.auth)).toStrictEqual([
        "Bearer app.token.1",
      ]);
      expect(second.every((each) => each.bearer === undefined)).toBe(true);

      // Without a saved token, the app the CLI made gets a new token.
      writeFileSync(credentialsFile, "{}\n");
      const third = await call();
      expect(third[1]?.body.query).toContain("appTokenCreate");
      expect(third[1]?.body.variables.app).toBe("QXBwOjE=");
      expect(third.at(-1)?.auth).toBe("Bearer app.token.2");
      expect(apps).toHaveLength(1);
      expect(saved()).toBe("app.token.2");
    } finally {
      store.closeAllConnections();
      await new Promise<void>((resolve) => {
        store.close(() => {
          resolve();
        });
      });
    }
  }, 30_000);

  it("requires an explicit target in unattended commands", async () => {
    const outputs = await Promise.all(
      [
        ["env", "stop"],
        ["env", "remove", "--dry-run", "--force"],
        ["init", "--local"],
      ].map(async (args) => await cli(args, { SALEOR_ENV: "local:demo" }))
    );

    // A removal never reads SALEOR_ENV; init's provider flags name a new store.
    expect(outputs.map((out) => out.data.error.code)).toStrictEqual([
      "CONTEXT_MISSING",
      "CONTEXT_MISSING",
      "CONTEXT_MISSING",
    ]);
    expect(outputs[0]?.data.error.suggestion).toContain("Pass <env>");
    expect(outputs[2]?.data.error.suggestion).toContain("--name");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("refuses what a store's source cannot do", async () => {
    const out = await cli(["env", "stop", "cloud:acme/env1"]);
    expect(out.code).toBe(2);
    expect(out.data.error).toMatchObject({
      code: "USAGE_ERROR",
      message: "Saleor Cloud stores cannot be stopped with the CLI.",
    });
    expect(requests).toStrictEqual([]);
  });

  it("does not infer even the only Cloud organization", async () => {
    Reflect.deleteProperty(credentials, "SALEOR_ORG");
    const out = await cli(["init", "--project", "poc", "--env", "dev"]);
    expect(out.data.error.code).toBe("CONTEXT_MISSING");
    expect(out.data.error.suggestion).toContain("--org");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("stops a local instance that does not exist without failing", async () => {
    const out = await cli(["env", "stop", "local:missing"]);
    expect(out.code).toBe(0);
    expect(out.data.data).toMatchObject({ action: "none", existed: false });
  });

  it.each([true, false])(
    "lists a stopped instance, and stopping it again does nothing (engine=%s)",
    async (engine) => {
      // A Docker that runs no containers, with its engine up or down.
      const fakeBin = path.join(cwd, "fake-bin");
      mkdirSync(fakeBin);
      writeFileSync(
        path.join(fakeBin, "docker"),
        `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync("docker-calls.jsonl", JSON.stringify(process.argv.slice(2)) + "\\n");
if (${!engine} && process.argv[2] === "version") process.exit(1);
`
      );
      chmodSync(path.join(fakeBin, "docker"), 0o700);
      const instance = path.join(cwd, "config/local/demo");
      mkdirSync(instance, { recursive: true });
      writeFileSync(
        path.join(instance, "instance.json"),
        JSON.stringify({
          apiPort: 1,
          dashboardPort: 2,
          initialized: true,
          name: "demo",
          saleorVersion: "3.23.41",
          sampleData: false,
        })
      );

      const listed = await cli(["env", "list"], { PATH: fakeBin });
      expect(listed.code, listed.stderr).toBe(0);
      expect(listed.data.data).toMatchObject([
        { environment: null, name: "demo", state: "stopped" },
      ]);

      if (!engine) {
        expect(listed.stderr).toContain("Every instance is stopped.");

        return;
      }

      const stopped = await cli(["env", "stop", "local:demo"], {
        PATH: fakeBin,
      });

      expect(stopped.data.data).toMatchObject({
        action: "none",
        existed: true,
        target: { type: "local-instance" },
      });

      const text = await cli(
        ["env", "stop", "local:demo", "--output", "text"],
        { PATH: fakeBin }
      );

      expect(text.stdout).toBe(
        '✓ Local instance "demo" is already stopped; nothing to do.\n'
      );
      expect(
        readFileSync(path.join(cwd, "docker-calls.jsonl"), "utf-8")
      ).not.toContain('"down"');
    }
  );

  it("reuses an environment named by its key, as the picker gives it", async () => {
    resourceRoutes([environment("env1", "dev")]);

    const out = await cli([
      "init",
      "--org",
      "acme",
      "--project",
      "poc",
      "--env",
      "env1",
      "--dry-run",
    ]);

    expect(out.data.data).toMatchObject({
      action: "update",
      target: { id: "env1", name: "dev" },
    });
  });

  it("reads SALEOR_PROJECT in init", async () => {
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

    // SALEOR_ENV names the environment a command acts on, not one for init to make.
    const out = await cli(
      ["init", "--org", "acme", "--env", "dev", "--timeout", "0"],
      { SALEOR_ENV: "cloud:acme/other", SALEOR_PROJECT: "poc" }
    );

    expect(out.code).toBe(75);
    expect(requests.some((req) => req.method === "POST")).toBe(false);
  });

  it("names an organization the account does not belong to", async () => {
    const out = await cli(["env", "remove", "cloud:nope/dev", "--dry-run"]);

    expect(out.data.error.code).toBe("NOT_FOUND");
    expect(out.data.error.message).toContain('Organization "nope"');
    expect(out.data.error.details.organizations).toStrictEqual([
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
      "init",
      "--org",
      "acme",
      "--project",
      "poc",
      "--env",
      "dev",
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
      "init",
      "--org",
      "acme",
      "--project",
      "shop",
      "--env",
      "dev",
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
    expect(commands.map((item: any) => item.command)).toStrictEqual([
      "saleor init",
      "saleor env list",
      "saleor env add",
      "saleor env start",
      "saleor env stop",
      "saleor env remove",
      "saleor config status",
      "saleor config diff",
      "saleor config deploy",
      "saleor config edit",
      "saleor config pull",
      "saleor config validate",
      "saleor config guide",
      "saleor storefront create",
      "saleor storefront use",
      "saleor api call",
      "saleor webhook listen",
      "saleor login",
      "saleor logout",
      "saleor onboard",
    ]);
    // Targets are optional to the parser: the action resolves them (flag, variable,
    // question) and reports CONTEXT_MISSING itself.
    expect(
      commands.find((item: any) => item.command === "saleor init").flags
    ).toContainEqual(
      expect.objectContaining({ env: "SALEOR_PROJECT", name: "--project" })
    );
    expect(
      commands.find((item: any) => item.command === "saleor env remove")
        .arguments[0]
    ).toMatchObject({ env: null, name: "env", required: false });
    expect(
      commands.find((item: any) => item.command === "saleor env start")
        .arguments[0]
    ).toMatchObject({ env: "SALEOR_ENV", name: "env", required: false });
    expect(globalFlags.map((flag: any) => flag.name)).toStrictEqual([
      "--help",
      "--version",
      "--completions",
      "--output",
      "--no-input",
      "--agent",
    ]);
    expect(exitCodes.map((exit: any) => exit.code)).toStrictEqual([
      0, 1, 2, 75, 130,
    ]);
    expect(errorCodes).toContainEqual({
      code: "NOT_READY",
      exitCode: 75,
      meaning: expect.any(String),
      retry: true,
    });
    expect(requests).toStrictEqual([]);
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
  it.each([[], ["env"], ["env", "remove"]])(
    "advertises agent mode in help: %j",
    async (...args) => {
      const out = await cli([...args, "--help"]);
      expect(out.code).toBe(0);
      expect(out.stdout).toContain(
        "use --agent (shorthand for --json --no-input)"
      );
      expect(out.stdout).toContain("saleor commands --agent");
      expect(requests).toStrictEqual([]);
    }
  );

  it("supports explicit agent mode without agent environment detection", async () => {
    const out = await cli(["commands", "--agent"]);
    expect(out.code).toBe(0);
    expect(out.data.ok).toBe(true);
    expect(
      out.data.data.globalFlags.some((flag: any) => flag.name === "--agent")
    ).toBe(true);
    expect(requests).toStrictEqual([]);
  });

  it("renders usage failures as one JSON result", async () => {
    const out = await cli(["init", "--env", "--unknown"]);
    expect(out.code).toBe(2);
    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(requests).toStrictEqual([]);
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
      "init",
      "--env",
      "dev",
      "--org",
      "acme",
      "--project",
      "poc",
      "--timeout=-1",
    ]);

    expect(out.code).toBe(2);
    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(requests).toStrictEqual([]);
  });
  it("requires auth and never prints credentials", async () => {
    credentials = {};
    const out = await cli(["env", "remove", "cloud:acme/dev", "--dry-run"]);
    expect(out.data.error.code).toBe("AUTH_REQUIRED");
    expect(requests).toStrictEqual([]);
  });
  it("lists the stores it can reach without a Cloud login, and says so", async () => {
    credentials = {};
    const out = await cli(["env", "list"]);
    expect(out.code).toBe(0);
    expect(out.data.data).toStrictEqual([]);
    expect(out.stderr).toContain(
      "Saleor Cloud stores are not listed: you are not logged in. Log in with: saleor login"
    );
    expect(requests).toStrictEqual([]);
  });
  it("uses the environment token without persisting it", async () => {
    const out = await cli(["login"]);
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
    const out = await cli(["env", "remove", "cloud:acme/dev", "--dry-run"]);
    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe(
      status === 401 ? "AUTH_INVALID" : "FORBIDDEN"
    );
  });
  it("refuses a mismatched project without writing anything", async () => {
    resourceRoutes();

    const out = await cli([
      "init",
      "--org",
      "acme",
      "--project",
      "poc",
      "--env",
      "dev",
      "--region",
      "different",
    ]);

    expect(out.data.error.code).toBe("NAME_CONFLICT");
    expect(requests.every((req) => req.method === "GET")).toBe(true);
  });
  it("refuses ambiguous environment names instead of selecting the first", async () => {
    resourceRoutes([environment(), environment("env2")]);
    const out = await cli(["env", "remove", "cloud:acme/dev", "--force"]);
    expect(out.data.error.code).toBe("AMBIGUOUS_TARGET");
    expect(out.code).toBe(2);
    expect(requests.some((req) => req.method === "DELETE")).toBe(false);
  });
  it.each([
    ["env", "remove", "cloud:acme/dev"],
    ["init", "--env", "new", "--project", "poc", "--org", "acme"],
  ])(
    "previews %s %s without confirmation or writes, in either output format",
    async (...args) => {
      resourceRoutes(args[0] === "env" ? [environment()] : []);

      const preview = [...args, "--dry-run"];
      const out = await cli([...preview, "--json"]);

      expect(out.code).toBe(0);
      expect(out.data.data).toMatchObject({ dryRun: true });
      expect(Object.values(out.data.data.target.scope)).toContain("acme");
      expect(JSON.stringify(out.data.data.target)).toContain("poc");

      const text = await cli([...preview, "--output", "text"]);
      expect(text.code).toBe(0);
      expect(text.stdout).toMatch(DRY_RUN_TEXT);
      expect(requests.every((req) => req.method === "GET")).toBe(true);
    }
  );
  it("previews a missing delete target", async () => {
    resourceRoutes();

    const out = await cli(["env", "remove", "cloud:acme/missing", "--dry-run"]);

    expect(out.code).toBe(0);
    expect(out.data.data).toMatchObject({
      action: "none",
      dryRun: true,
      state: "absent",
    });
    expect(requests.every((req) => req.method === "GET")).toBe(true);
  });
  it.each(["production", "conflict"] as const)(
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
            "init",
            "--env",
            "dev",
            "--project",
            "poc",
            "--domain-label",
            "different",
          ],
          code: "NAME_CONFLICT",
        },
        production: {
          args: ["env", "remove", "cloud:acme/dev", "--force"],
          code: "PRODUCTION_DELETE_REFUSED",
        },
      };

      const { args, code } = cases[kind];
      const out = await cli([...args, "--dry-run"], { SALEOR_ORG: "acme" });
      expect(out.data.error.code).toBe(code);
      expect(requests.every((req) => req.method === "GET")).toBe(true);
    }
  );
  it.each([undefined, "new"])(
    "rejects a full project before setup work (environment=%s)",
    async (envName) => {
      resourceRoutes();
      const fallback = handler;
      handler = (method, url, body) =>
        url.pathname.endsWith("/projects/")
          ? [
              200,
              [
                {
                  ...project(),
                  plan: {
                    ...samples.plans[1],
                    allowance: { sandboxes: { cap: 5, included: 5 } },
                  },
                  sandboxes: { count: 5 },
                },
              ],
            ]
          : fallback(method, url, body);

      const out = await cli([
        "init",
        "--org",
        "acme",
        "--project",
        "poc",
        "--describe",
        "Merch store",
        "--storefront",
        "--agent",
        ...(envName === undefined ? [] : ["--env", envName]),
      ]);

      expect(out.data.error.code).toBe("ENVIRONMENT_LIMIT_REACHED");
      expect(out.data.error.message).toContain("5 of 5");
      expect(out.data.error.suggestion).toContain("saleor env list");
      expect(requests.some((request) => request.method === "POST")).toBe(false);
      expect(existsSync(path.join(cwd, "storefront"))).toBe(false);
      expect(existsSync(path.join(cwd, "saleor.yml"))).toBe(false);
    }
  );

  it.each([
    { cap: 5, count: 4 },
    { cap: null, count: 5 },
    { cap: undefined, count: 5 },
    { cap: 5, count: undefined },
  ])(
    "does not infer a sandbox limit without a known exhausted cap (%j)",
    async ({ cap, count }) => {
      resourceRoutes();
      const fallback = handler;
      handler = (method, url, body) =>
        url.pathname.endsWith("/projects/")
          ? [
              200,
              [
                {
                  ...project(),
                  plan: {
                    ...samples.plans[1],
                    allowance: { sandboxes: { cap, included: 5 } },
                  },
                  sandboxes: { count },
                },
              ],
            ]
          : fallback(method, url, body);

      const out = await cli([
        "init",
        "--org",
        "acme",
        "--project",
        "poc",
        "--env",
        "new",
        "--dry-run",
        "--agent",
      ]);

      expect(out.code, out.stdout + out.stderr).toBe(0);
      expect(requests.some((request) => request.method === "POST")).toBe(false);
    }
  );

  it("allows reusing an existing sandbox in a full project", async () => {
    resourceRoutes([environment()]);
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/projects/")
        ? [
            200,
            [
              {
                ...project(),
                plan: {
                  ...samples.plans[1],
                  allowance: { sandboxes: { cap: 5 } },
                },
                sandboxes: { count: 5 },
              },
            ],
          ]
        : fallback(method, url, body);

    const out = await cli([
      "init",
      "--org",
      "acme",
      "--project",
      "poc",
      "--env",
      "env1",
      "--dry-run",
      "--agent",
    ]);

    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it.each([
    { message: "Setting up environment", taskId: "atp-store-warm" },
    {
      message: "Setting up environment",
      taskId: "crt-store-cold",
    },
  ])(
    "shows environment setup progress ($taskId)",
    async ({ taskId, message }) => {
      resourceRoutes();
      const fallback = handler;
      handler = (method, url, body) => {
        if (method === "POST" && url.pathname.endsWith("/obtain/")) {
          return [201, { ...environment("env9", "new"), task_id: taskId }];
        }

        if (url.pathname.includes("/task-status/")) {
          return [200, task("PENDING")];
        }

        return fallback(method, url, body);
      };

      const out = await cli([
        "init",
        "--org",
        "acme",
        "--project",
        "poc",
        "--env",
        "new",
        "--timeout",
        "0",
      ]);

      expect(out.code).toBe(75);
      expect(out.stderr).toContain(message);
      expect(
        requests.filter((request) => request.method === "POST")
      ).toHaveLength(1);
    }
  );

  it("creates in a paid project without asking, after saying it might be charged", async () => {
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) => {
      if (url.pathname.endsWith("/projects/")) {
        return [200, [{ ...project(), plan: samples.plans[1] }]];
      }

      if (method === "POST" && url.pathname.endsWith("/obtain/")) {
        return [201, { ...environment("env9", "new"), task_id: "setup" }];
      }

      return url.pathname.includes("/task-status/")
        ? [200, task("PENDING")]
        : fallback(method, url, body);
    };

    const out = await cli([
      "init",
      "--env",
      "new",
      "--org",
      "acme",
      "--project",
      "poc",
      "--timeout",
      "0",
    ]);

    expect(out.code, out.stdout).toBe(75);
    expect(out.stderr).toContain(
      "Depending on your plan (pro), you might be charged for this environment."
    );
    expect(requests.filter((req) => req.method === "POST")).toHaveLength(1);
  });
  it("previews environment creation in a paid project with scope and a notice", async () => {
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/projects/")
        ? [200, [{ ...project(), plan: samples.plans[1] }]]
        : fallback(method, url, body);

    const out = await cli(["init", "--env", "new", "--dry-run"], {
      SALEOR_ORG: "acme",
      SALEOR_PROJECT: "poc",
    });

    expect(out.code).toBe(0);
    expect(out.data.data).toMatchObject({
      details: { plan: "pro" },
      dryRun: true,
      notice: expect.stringContaining("you might be charged"),
      target: { scope: { organization: "acme", project: "poc" } },
      warning: null,
    });
    expect(out.data.data.details).not.toHaveProperty("pricing");
    expect(requests.every((req) => req.method === "GET")).toBe(true);
  });
  it("publishes safety metadata and preview flags for every risky action", async () => {
    const out = await cli(["commands", "--json"]);

    for (const command of ["env remove", "config pull"]) {
      const entry = out.data.data.commands.find(
        (item: any) => item.command === `saleor ${command}`
      );

      expect(entry.warning).toBeTruthy();
      expect(entry.destructive).toBe(true);
      expect(entry.flags.some((flag: any) => flag.name === "--dry-run")).toBe(
        true
      );
    }

    // Stopping keeps data: it previews, but needs no confirmation.
    expect(
      out.data.data.commands.find(
        (item: any) => item.command === "saleor env stop"
      )
    ).toMatchObject({ destructive: false, warning: null });
  });
  it.each([[], ["--agent"]])(
    "requires --force for noninteractive deletion: %j",
    async (...mode) => {
      resourceRoutes([environment()]);

      const out = await cli(["env", "remove", "cloud:acme/env1", ...mode]);

      expect(out.data.error.code).toBe("CONFIRMATION_REQUIRED");
      expect(requests.some((req) => req.method === "DELETE")).toBe(false);
    }
  );
  it("refuses production deletion even with --force", async () => {
    const env = environment();
    env.service.service_type = "PRODUCTION";
    resourceRoutes([env]);

    const out = await cli(["env", "remove", "cloud:acme/env1", "--force"]);

    expect(out.data.error.code).toBe("PRODUCTION_DELETE_REFUSED");
    expect(requests.some((req) => req.method === "DELETE")).toBe(false);
  });
  it("deleting an absent environment succeeds", async () => {
    resourceRoutes();
    expect(
      await cli(["env", "remove", "cloud:acme/missing", "--force"])
    ).toMatchObject({
      code: 0,
      data: { data: { action: "none", existed: false } },
    });
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
        "init",
        "--env",
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
      "init",
      "--env",
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
      "run the same command again: saleor init --env dev --org acme --project poc"
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
        "init",
        "--env",
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
          "init",
          "--env",
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
      "init",
      "--env",
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
      "remove",
      "cloud:acme/env1",
      "--force",
      "--timeout",
      "0",
    ]);

    expect(out.code).toBe(75);
    expect(out.data.error.code).toBe("NOT_READY");
    // The resume hint drops `--timeout 0`, which would return at once again.
    expect(out.data.error.suggestion).toContain(
      "run the same command again: saleor env remove cloud:acme/env1 --force"
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

    const out = await cli(["env", "remove", "cloud:acme/env1", "--force"]);

    expect(out.code).toBe(0);
    expect(out.data.data.action).toBe("delete");
    expect(deletes).toBe(2);
  });
  it("does not retry a delete Cloud rejects for another reason", async () => {
    resourceRoutes([environment()]);
    const fallback = handler;
    handler = (method, url, body) =>
      method === "DELETE"
        ? [400, { detail: "Environment is protected" }]
        : fallback(method, url, body);

    const out = await cli(["env", "remove", "cloud:acme/env1", "--force"]);

    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe("API_VALIDATION_ERROR");
  });
  it("refuses deleting any environment that is not a sandbox", async () => {
    const env = environment();
    env.service.service_type = "STAGING";
    resourceRoutes([env]);

    const out = await cli(["env", "remove", "cloud:acme/env1", "--force"]);

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
      "init",
      "--env",
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

    const out = await cli(["env", "remove", "cloud:acme/env9", "--force"]);

    expect(out.data.data).toMatchObject({
      action: "delete",
      target: { id: "env9", scope: { project: "other-project" } },
    });
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

    const out = await cli(["login", "--output", "text"], {
      SALEOR_CLOUD_TOKEN: "test.secret",
    });

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

    resourceRoutes();
    const out = await cli(["env", "list"]);

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
    ).toStrictEqual([
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ]);
    const file = path.join(cwd, "config/credentials.json");
    // oxlint-disable-next-line no-bitwise -- Inspect POSIX permission bits.
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf-8")).not.toContain("pending-device-grant");
    expect(login.stdout + login.stderr).not.toContain("refresh-secret");
    expect((await cli(["logout"])).data.data.removed).toBe(true);
    expect(
      (await cli(["env", "remove", "cloud:acme/dev", "--dry-run"])).data.error
        .code
    ).toBe("AUTH_REQUIRED");
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
  it("ignores an exported SALEOR_PROJECT when deleting, instead of reporting a false 'nothing to delete'", async () => {
    const elsewhere = environment("env9", "preview");
    elsewhere.project = { ...elsewhere.project, slug: "other-project" };
    let envs = [elsewhere];
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) => {
      if (method === "DELETE") {
        envs = [];

        return [202, { task_id: "delete" }];
      }

      return url.pathname.endsWith("/environments/")
        ? [200, envs]
        : fallback(method, url, body);
    };

    const out = await cli(["env", "remove", "cloud:acme/preview", "--force"], {
      SALEOR_ENV: "dev",
      SALEOR_PROJECT: "poc",
    });

    expect(out.data.data).toMatchObject({ action: "delete", existed: true });
    expect(requests.filter((req) => req.method === "DELETE")).toHaveLength(1);
  });
  it("asks nothing about money: init has no --force and no warning", async () => {
    const { commands } = (await cli(["commands", "--json"])).data.data;
    const init = commands.find((item: any) => item.command === "saleor init");

    expect(init).toMatchObject({
      destructive: false,
      kind: "ensure",
      warning: null,
    });
    expect(init).not.toHaveProperty("costsMoney");
    expect(init.flags.map((flag: any) => flag.name)).not.toContain("--force");
  });
  it("writes suggested commands so they can be pasted as they are", async () => {
    resourceRoutes([environment("env1", "My Store")]);

    const out = await cli(["env", "remove", "cloud:acme/My Store"]);

    expect(out.data.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(out.data.error.suggestion).toContain(
      "saleor env remove 'cloud:acme/My Store' --force"
    );
  });
  it("reports a Cloud with no sandbox service as unavailable, not as a usage error", async () => {
    resourceRoutes();
    const fallback = handler;
    handler = (method, url, body) =>
      url.pathname.endsWith("/services/")
        ? [
            200,
            samples.services.map((service) => ({
              ...service,
              maintenance_mode: true,
            })),
          ]
        : fallback(method, url, body);

    const out = await cli([
      "init",
      "--env",
      "dev",
      "--org",
      "acme",
      "--project",
      "poc",
    ]);

    expect(out.code).toBe(1);
    expect(out.data.error).toMatchObject({ code: "UNAVAILABLE", retry: true });
    expect(requests.some((req) => req.method === "POST")).toBe(false);
  });

  describe("storefronts", () => {
    let templateUrl: string;
    let closeTemplate: () => Promise<void>;
    let fakeBin: string;

    // A local store "demo" (and "other") whose API is the mock server, a Docker that
    // reports it running, git, and a template server with a minimal storefront.
    beforeEach(async () => {
      credentials = {};
      fakeBin = path.join(cwd, "fake-bin");
      mkdirSync(fakeBin);
      writeFileSync(
        path.join(fakeBin, "docker"),
        `#!${process.execPath}
if (process.argv.includes("ps")) console.log(JSON.stringify({Service:"api", State:"running"}));
`
      );
      chmodSync(path.join(fakeBin, "docker"), 0o700);
      writeFileSync(
        path.join(fakeBin, "pnpm"),
        `#!${process.execPath}
const fs = require("node:fs");
fs.mkdirSync("node_modules", {recursive:true});
fs.appendFileSync("node_modules/install-calls", "install\\n");
`
      );
      chmodSync(path.join(fakeBin, "pnpm"), 0o700);

      symlinkSync(
        execFileSync("which", ["git"]).toString().trim(),
        path.join(fakeBin, "git")
      );

      for (const name of ["demo", "other"]) {
        const dir = path.join(cwd, "config/local", name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          path.join(dir, "instance.json"),
          JSON.stringify({
            apiPort: Number(new URL(base).port),
            dashboardPort: 9000,
            initialized: true,
            name,
            saleorVersion: "3.23.41",
            sampleData: false,
          })
        );
      }

      handler = (_method, _url, body) =>
        Predicate.isString(body?.query) && body.query.includes("channel(")
          ? [
              200,
              {
                data: {
                  channel:
                    body.variables.slug === "default-channel"
                      ? { slug: "default-channel" }
                      : null,
                },
              },
            ]
          : [200, { data: { shop: { name: "Local" } } }];

      const archive = await createTarGzip([
        {
          data: '{"name":"saleor-storefront"}',
          name: "storefront-main/package.json",
        },
        {
          data: "NEXT_PUBLIC_SALEOR_API_URL=https://your-instance.saleor.cloud/graphql/\nNEXT_PUBLIC_DEFAULT_CHANNEL=default-channel\nCONTENT_PROVIDER=saleor\n",
          name: "storefront-main/.env.example",
        },
        { data: ".env\nnode_modules\n", name: "storefront-main/.gitignore" },
        {
          data: "contentAttributes:\n  - name: Returns window days\n    inputType: NUMERIC\n",
          name: "storefront-main/config/saleor/storefront-content.config.yml",
        },
      ]);

      const server = createServer((_req, res) => {
        res.writeHead(200);
        res.end(Buffer.from(archive));
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();

      if (address === null || Predicate.isString(address)) {
        throw new Error("Expected TCP address");
      }

      templateUrl = `http://127.0.0.1:${address.port}/storefront.tar.gz`;
      closeTemplate = async () => {
        await new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        });
      };
    });

    afterEach(async () => {
      await closeTemplate();
    });

    const env = () => ({
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_AUTHOR_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      PATH: fakeBin,
      SALEOR_STOREFRONT_TEMPLATE_URL: templateUrl,
    });

    const storefront = async (...args: string[]) =>
      await cli(["storefront", ...args, "--agent"], env());

    it("creates a storefront connected to a store and safely reuses it", async () => {
      const created = await storefront("create", "local:demo");
      expect(created.code, created.stdout + created.stderr).toBe(0);
      expect(created.data.data).toMatchObject({
        channel: "default-channel",
        created: true,
        env: {
          NEXT_PUBLIC_DEFAULT_CHANNEL: "default-channel",
          NEXT_PUBLIC_SALEOR_API_URL: `${base}/graphql/`.replace(
            "127.0.0.1",
            "localhost"
          ),
        },
        installed: true,
        next: ["cd storefront", "pnpm dev"],
        repository: "created",
        store: { kind: "local", ref: "local:demo", state: "ready" },
        warnings: [],
      });

      const dir = path.join(cwd, "storefront");
      const dotenv = readFileSync(path.join(dir, ".env"), "utf-8");
      expect(dotenv.split("\n")[0]).toMatch(DEMO_HEADER);
      // The template's own defaults stay.
      expect(dotenv).toContain("CONTENT_PROVIDER=saleor");

      // One commit with the template, without the store's .env.
      const committed = execFileSync("git", ["ls-files"], {
        cwd: dir,
      }).toString();

      expect(committed.split("\n").filter(Boolean).sort()).toStrictEqual([
        ".env.example",
        ".gitignore",
        "config/saleor/storefront-content.config.yml",
        "package.json",
      ]);

      const again = await storefront("create", "local:demo");
      expect(again.data.data).toMatchObject({ created: false });
      expect(again.data.data.installed).toBe(true);
      expect(
        readFileSync(path.join(dir, "node_modules/install-calls"), "utf-8")
      ).toBe("install\ninstall\n");

      const elsewhere = await storefront("create", "local:other");
      expect(elsewhere.code).toBe(1);
      expect(elsewhere.data.error.code).toBe("NAME_CONFLICT");
      expect(elsewhere.data.error.suggestion).toContain("--dir");
      expect(readFileSync(path.join(dir, ".env"), "utf-8")).toBe(dotenv);

      const unavailableChannel = await storefront(
        "create",
        "local:other",
        "--dir",
        "other-shop",
        "--channel",
        "eu"
      );

      expect(unavailableChannel.code).toBe(0);
      expect(unavailableChannel.data.data.warnings).toStrictEqual([
        expect.stringContaining('has no channel "eu"'),
      ]);

      const previewSwitch = await storefront(
        "use",
        "local:other",
        "--dir",
        "storefront",
        "--dry-run"
      );

      expect(previewSwitch.data.data).toMatchObject({
        action: "update",
        details: { previous: "local:demo", store: "local:other" },
      });
      expect(readFileSync(path.join(dir, ".env"), "utf-8")).toBe(dotenv);

      const switched = await storefront(
        "use",
        "local:other",
        "--dir",
        "storefront"
      );

      expect(switched.code, switched.stderr).toBe(0);
      expect(switched.data.data).toMatchObject({
        created: false,
        previous: "local:demo",
        store: { ref: "local:other" },
      });
      const switchedEnv = readFileSync(path.join(dir, ".env"), "utf-8");
      expect(switchedEnv).toContain("instance=local:other");
      expect(switchedEnv).toContain("CONTENT_PROVIDER=saleor");

      const same = await storefront(
        "use",
        "local:other",
        "--dir",
        "storefront"
      );

      expect(same.code).toBe(0);
      expect(readFileSync(path.join(dir, ".env"), "utf-8")).toBe(switchedEnv);
    });

    it("previews without writing and refuses directories that are not storefronts", async () => {
      const preview = await storefront(
        "create",
        "local:demo",
        "--dir",
        "shop",
        "--dry-run"
      );

      expect(preview.data.data).toMatchObject({
        action: "create",
        dryRun: true,
        target: { name: "shop", type: "storefront" },
      });
      expect(existsSync(path.join(cwd, "shop"))).toBe(false);

      mkdirSync(path.join(cwd, "notes"));
      writeFileSync(path.join(cwd, "notes/todo.txt"), "keep");

      const refused = await storefront(
        "create",
        "local:demo",
        "--dir",
        "notes"
      );

      expect(refused.data.error.code).toBe("NAME_CONFLICT");

      const removed = await storefront("env", "local:demo");
      expect(removed.code).toBe(2);
      expect(removed.data.error.code).toBe("USAGE_ERROR");
      const missing = await storefront("use", "local:demo");
      expect(missing.data.error).toMatchObject({
        code: "NOT_FOUND",
        suggestion: expect.stringContaining("--dir"),
      });

      // Without a store, the error lists the ones there are; Cloud needs a login.
      const unnamed = await storefront("create");
      expect(unnamed.code).toBe(2);
      expect(unnamed.data.error).toMatchObject({
        code: "CONTEXT_MISSING",
        details: {
          choices: ["local:demo", "local:other"],
          input: "<env>",
        },
      });
    });

    it("keeps the storefront and gives recovery steps when dependency installation fails", async () => {
      writeFileSync(
        path.join(fakeBin, "pnpm"),
        `#!${process.execPath}
console.error("installation failed for test");
process.exit(1);
`
      );
      const failed = await storefront("create", "local:demo");
      expect(failed.code).toBe(0);
      expect(failed.data.data).toMatchObject({
        installed: false,
        next: ["cd storefront", "pnpm install", "pnpm dev"],
      });
      expect(failed.data.data.warnings).toStrictEqual([
        expect.stringContaining("pnpm install failed"),
      ]);
      expect(existsSync(path.join(cwd, "storefront/.env"))).toBe(true);
    });

    it("sets up a project folder with the storefront through init", async () => {
      const out = await cli(
        ["init", "--local", "--name", "demo", "--storefront", "--agent"],
        env()
      );

      expect(out.code, out.stdout + out.stderr).toBe(0);
      expect(out.data.data).toMatchObject({
        ref: "local:demo",
        storefront: {
          created: true,
          path: path.join(realpathSync(cwd), "demo/storefront"),
          repository: "created",
          store: { ref: "local:demo" },
        },
      });
      expect(existsSync(path.join(cwd, "demo/.git"))).toBe(true);
      expect(existsSync(path.join(cwd, "demo/storefront/.git"))).toBe(false);
      expect(out.data.data.storefront.component).toBe("storefront");
      expect(out.data.data.storefront.template).toStrictEqual({
        commit: null,
        ref: "main",
        repository: "saleor/storefront",
      });

      // saleor.yml lists the storefront with its template and content configuration,
      // and the first commit has it so.
      const manifest = readFileSync(path.join(cwd, "demo/saleor.yml"), "utf-8");

      // Only what commands read: no version, no path that is the component's name,
      // no `configure` that is the default.
      expect(parse(manifest)).toStrictEqual({
        components: {
          storefront: {
            config: "config/saleor/storefront-content.config.yml",
            kind: "storefront",
          },
        },
        environments: { local: { kind: "local", saleor: expect.any(String) } },
        name: "demo",
      });
      expect(
        execFileSync("git", ["show", "HEAD:saleor.yml"], {
          cwd: path.join(cwd, "demo"),
        }).toString()
      ).toBe(manifest);

      // Validating the project covers its own configuration and the storefront's.
      const validated = await cli(
        ["config", "validate", "--agent"],
        env(),
        path.join(cwd, "demo/storefront")
      );

      expect(validated.code, validated.stdout + validated.stderr).toBe(0);
      expect(validated.data.data.configs).toStrictEqual([
        { component: null, config: "../config.yml", sections: {} },
        {
          component: "storefront",
          config: "config/saleor/storefront-content.config.yml",
          sections: { contentAttributes: 1 },
        },
      ]);

      const again = await cli(
        ["init", "--local", "--name", "demo", "--storefront", "--agent"],
        env()
      );

      expect(again.data.data.storefront).toMatchObject({ created: false });

      const preview = await cli(
        ["init", "--local", "--name", "demo", "--dry-run", "--agent"],
        env()
      );

      expect(preview.data.data.details.storefront).toBeUndefined();
    });
  });
});
