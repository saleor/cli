import { Predicate } from "effect";
import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import os from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `api call` and `webhook listen` as separate CLI processes, against a local store
// "demo" whose GraphQL API is a mock server, with a Docker that reports it running.

const executable = path.resolve(process.env.SALEOR_CLI_BIN ?? "bin/saleor.mjs");

interface Received {
  readonly auth: string | undefined;
  readonly body: any;
  readonly headers: IncomingMessage["headers"];
}

let cwd: string;
let store: Received[];

// The store's JSON answer to one request.
let answer: (body: any) => object;
const servers: Server[] = [];

const serve = async (
  handle: (req: IncomingMessage, res: ServerResponse, body: string) => void
) => {
  const server = createServer((req, res) => {
    text(req)
      .then((body) => {
        handle(req, res, body);
      })
      .catch(() => {
        res.destroy();
      });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("Expected TCP address");
  }

  return address.port;
};

beforeEach(async () => {
  cwd = mkdtempSync(path.join(os.tmpdir(), "saleor-store-commands-"));
  store = [];
  answer = () => ({ data: { shop: { name: "Demo" } } });

  const apiPort = await serve((req, res, body) => {
    const parsed = body ? JSON.parse(body) : undefined;

    // Finding the store checks that it answers; that is not the command's request.
    if (parsed?.query === "query { shop { name } }") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { shop: { name: "Demo" } } }));

      return;
    }

    store.push({
      auth: req.headers.authorization,
      body: parsed,
      headers: req.headers,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer(parsed)));
  });

  const fakeBin = path.join(cwd, "fake-bin");
  mkdirSync(fakeBin);
  writeFileSync(
    path.join(fakeBin, "docker"),
    `#!${process.execPath}
if (process.argv.includes("ps")) console.log(JSON.stringify({Service:"api", State:"running"}));
`
  );
  chmodSync(path.join(fakeBin, "docker"), 0o700);

  const dir = path.join(cwd, "config/local/demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "instance.json"),
    JSON.stringify({
      apiPort,
      dashboardPort: 9000,
      initialized: true,
      name: "demo",
      saleorVersion: "3.23.41",
      sampleData: false,
    })
  );
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    })
  );
  rmSync(cwd, { force: true, recursive: true });
});

const start = (args: readonly string[], env: Record<string, string> = {}) =>
  spawn(process.execPath, [executable, ...args], {
    cwd,
    env: {
      PATH: path.join(cwd, "fake-bin"),
      SALEOR_CONFIG_DIR: path.join(cwd, "config"),
      SALEOR_CREDENTIAL_STORE: "file",
      SALEOR_TOKEN: "store.secret",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

const finish = async (child: ChildProcess) =>
  await new Promise<{
    code: number | null;
    data: any;
    stderr: string;
    stdout: string;
  }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out\n${stdout}\n${stderr}`));
    }, 10_000);

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

const cli = async (args: readonly string[], env: Record<string, string> = {}) =>
  await finish(start([...args, "--agent"], env));

describe("api call", () => {
  it("sends the document with the store's token and returns its data", async () => {
    const out = await cli([
      "api",
      "call",
      "local:demo",
      "--query",
      "query($n: Int) { shop { name } }",
      "--variables",
      '{"n": 1}',
    ]);

    expect(out.code).toBe(0);
    expect(out.data).toStrictEqual({
      data: { shop: { name: "Demo" } },
      ok: true,
    });
    expect(store).toHaveLength(1);
    expect(store[0]?.auth).toBe("Bearer store.secret");
    expect(store[0]?.body).toStrictEqual({
      query: "query($n: Int) { shop { name } }",
      variables: { n: 1 },
    });
    expect(out.stdout + out.stderr).not.toContain("store.secret");
  });

  it("sends no token with --anonymous", async () => {
    const out = await cli(
      [
        "api",
        "call",
        "local:demo",
        "--anonymous",
        "--query",
        "{ shop { name } }",
      ],
      {
        SALEOR_TOKEN: "",
      }
    );

    expect(out.code).toBe(0);
    expect(store[0]?.auth).toBeUndefined();
  });

  it("reads the document from a file", async () => {
    writeFileSync(path.join(cwd, "shop.graphql"), "{ shop { name } }");

    const out = await cli([
      "api",
      "call",
      "local:demo",
      "--file",
      "shop.graphql",
    ]);

    expect(out.code).toBe(0);
    expect(store[0]?.body.query).toBe("{ shop { name } }");
  });

  it("fails on GraphQL errors, keeping partial data", async () => {
    answer = () => ({
      data: { shop: null },
      errors: [{ message: "Something broke" }],
    });

    const out = await cli([
      "api",
      "call",
      "local:demo",
      "--query",
      "{ shop { name } }",
    ]);

    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe("STORE_ERROR");
    expect(out.data.error.details.data).toStrictEqual({ shop: null });
  });

  it("names a missing permission as the token's problem", async () => {
    answer = () => ({
      data: null,
      errors: [
        {
          extensions: { exception: { code: "PermissionDenied" } },
          message:
            "To access this path, you need one of the following permissions: MANAGE_APPS",
        },
      ],
    });

    const out = await cli([
      "api",
      "call",
      "local:demo",
      "--query",
      "{ apps { totalCount } }",
    ]);

    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe("STORE_AUTH_INVALID");
    expect(out.data.error.message).toContain("MANAGE_APPS");
  });

  it.each([
    [[], "No GraphQL document"],
    [["--query", "{ shop { name } }", "--variables", "[1]"], "JSON object"],
    [["--query", "{ a }", "--file", "x.graphql"], "not both"],
  ])(
    "refuses an invalid request before contacting the store (%j)",
    async (args, message) => {
      const out = await cli(["api", "call", "local:demo", ...args]);

      expect(out.code).toBe(2);
      expect(out.data.error.code).toBe("USAGE_ERROR");
      expect(out.data.error.message).toContain(message);
      expect(store).toStrictEqual([]);
    }
  );
});

describe("webhook listen", () => {
  let forwarded: Received[];
  let forwardUrl: string;

  // The store answers the listener's setup; once the webhook exists, it delivers to
  // its target (Docker's name for this computer is 127.0.0.1 here).
  const storeAnswers =
    (deliver: (targetUrl: string) => void) => (body: any) => {
      const query: string = body.query;

      if (query.includes("me {")) {
        return {
          data: {
            me: {
              userPermissions: [
                { code: "MANAGE_APPS" },
                { code: "MANAGE_ORDERS" },
              ],
            },
          },
        };
      }

      if (query.includes("appCreate")) {
        return {
          data: {
            appCreate: {
              app: { id: "app-1", name: body.variables.input.name },
              errors: [],
            },
          },
        };
      }

      if (query.includes("webhookCreate")) {
        const { targetUrl } = body.variables.input;
        setTimeout(() => {
          deliver(targetUrl.replace("host.docker.internal", "127.0.0.1"));
        }, 50);

        return {
          data: {
            webhookCreate: {
              errors: [],
              webhook: {
                asyncEvents: [{ code: "ORDER_CREATED" }],
                id: "wh-1",
                targetUrl,
              },
            },
          },
        };
      }

      if (query.includes("appDelete")) {
        return { data: { appDelete: { errors: [] } } };
      }

      return { data: null, errors: [{ message: "unexpected" }] };
    };

  const deliverOrder = (targetUrl: string) => {
    // Something other than the store, at another path: refused.
    fetch(new URL("/elsewhere", targetUrl), { body: "{}", method: "POST" })
      .then(
        async () =>
          await fetch(targetUrl, {
            body: JSON.stringify([{ id: "order-1", type: "ORDER_CREATED" }]),
            headers: {
              "content-type": "application/json",
              "saleor-event": "order_created",
              "saleor-signature": "sig",
            },
            method: "POST",
          })
      )
      .catch(() => undefined);
  };

  beforeEach(async () => {
    forwarded = [];

    const port = await serve((req, res, body) => {
      forwarded.push({
        auth: undefined,
        body: JSON.parse(body),
        headers: req.headers,
      });
      res.writeHead(202).end();
    });

    forwardUrl = `http://127.0.0.1:${port}/api/webhooks`;
  });

  it("subscribes a temporary app, forwards a delivery, and deletes the app", async () => {
    answer = storeAnswers(deliverOrder);

    const out = await cli([
      "webhook",
      "listen",
      "local:demo",
      "--events",
      "order.created",
      "--count",
      "1",
      "--forward-to",
      forwardUrl,
    ]);

    expect(out.code).toBe(0);
    const [delivery] = out.data.data.deliveries;
    expect(delivery).toMatchObject({
      event: "order_created",
      forwarded: { status: 202, url: forwardUrl },
      headers: { "saleor-event": "order_created", "saleor-signature": "sig" },
      payload: [{ id: "order-1", type: "ORDER_CREATED" }],
    });
    expect(out.data.data.webhook.events).toStrictEqual(["ORDER_CREATED"]);

    const create = store.find((each) => each.body.query.includes("appCreate"));
    expect(create?.body.variables.input.permissions).toStrictEqual([
      "MANAGE_APPS",
      "MANAGE_ORDERS",
    ]);

    const hook = store.find((each) =>
      each.body.query.includes("webhookCreate")
    );

    expect(hook?.body.variables.input).toMatchObject({
      app: "app-1",
      asyncEvents: ["ORDER_CREATED"],
    });
    expect(hook?.body.variables.input.targetUrl).toMatch(
      /^http:\/\/host\.docker\.internal:\d+\/[0-9a-f]{32}$/
    );

    expect(store.at(-1)?.body).toMatchObject({ variables: { id: "app-1" } });
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.headers["saleor-signature"]).toBe("sig");
    expect(out.stderr).toContain("Deleted the temporary app");
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "deletes the app when stopped with %s",
    async (signal) => {
      answer = storeAnswers(() => undefined);

      const child = start([
        "webhook",
        "listen",
        "local:demo",
        "--events",
        "order_created",
        "--agent",
      ]);

      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk;

        if (stderr.includes("Listening for") && !child.killed) {
          child.kill(signal);
        }
      });

      const out = await finish(child);

      expect(out.code).toBe(130);
      expect(store.at(-1)?.body.query).toContain("appDelete");
    }
  );

  it("needs events or a subscription", async () => {
    const out = await cli(["webhook", "listen", "local:demo"]);

    expect(out.code).toBe(2);
    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(store).toStrictEqual([]);
  });

  it("needs the tunnel's port with --public-url", async () => {
    const out = await cli([
      "webhook",
      "listen",
      "local:demo",
      "--events",
      "order_created",
      "--public-url",
      "https://tunnel.example",
    ]);

    expect(out.code).toBe(2);
    expect(out.data.error.message).toContain("--port");
    expect(store).toStrictEqual([]);
  });
});

describe("app", () => {
  const MANIFEST = "https://apps.example.test/api/manifest";

  // A store with the apps in `apps` and the installations in `installing`; installing
  // makes the app at once, as Saleor does when its job finishes.
  let apps: {
    id: string;
    identifier: string;
    manifestUrl: string;
    name: string;
  }[];

  let installing: {
    appName: string;
    id: string;
    manifestUrl: string;
    message: string | null;
    status: string;
  }[];

  const appStore = (body: any) => {
    const query: string = body.query;

    if (query.includes("appsInstallations")) {
      return {
        data: {
          apps: {
            edges: apps.map((node) => ({
              node: { ...node, isActive: true, type: "THIRDPARTY" },
            })),
          },
          appsInstallations: installing,
        },
      };
    }

    if (query.includes("appFetchManifest")) {
      return {
        data: {
          appFetchManifest: {
            errors: [],
            manifest: {
              identifier: "example.app",
              name: "Example",
              permissions: [{ code: "MANAGE_ORDERS" }],
            },
          },
        },
      };
    }

    if (query.includes("appInstall") || query.includes("appRetryInstall")) {
      installing = [];
      apps.push({
        id: "QXBwOjk=",
        identifier: "example.app",
        manifestUrl: MANIFEST,
        name: "Example",
      });

      return {
        data: { started: { appInstallation: { id: "inst-1" }, errors: [] } },
      };
    }

    if (query.includes("appDelete")) {
      apps = apps.filter((each) => each.id !== body.variables.id);

      return { data: { appDelete: { errors: [] } } };
    }

    return { data: null, errors: [{ message: `unexpected: ${query}` }] };
  };

  const mutations = () =>
    store
      .map((each): string => each.body.query)
      .filter((query) => query.trimStart().startsWith("mutation"))
      .map((query) => /(app[A-Za-z]+)\(/.exec(query)?.[1]);

  beforeEach(() => {
    apps = [];
    installing = [];
    answer = appStore;
  });

  it("installs from a manifest URL with the permissions it asks for, then reuses it", async () => {
    const env = { SALEOR_POLL_INTERVAL_SECONDS: "0.001" };
    const add = ["app", "add", "local:demo", "--manifest", MANIFEST];

    const preview = await cli([...add, "--dry-run"], env);
    expect(preview.code, preview.stdout + preview.stderr).toBe(0);
    expect(preview.data.data).toMatchObject({
      action: "create",
      details: { permissions: ["MANAGE_ORDERS"] },
      dryRun: true,
    });
    expect(mutations()).toStrictEqual(["appFetchManifest"]);
    expect(apps).toHaveLength(0);

    store = [];
    const first = await cli(add, env);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(first.data.data).toMatchObject({
      app: { id: "QXBwOjk=", name: "Example" },
      created: true,
      store: "local:demo",
    });
    expect(mutations()).toStrictEqual(["appFetchManifest", "appInstall"]);
    expect(
      store.find((each) => each.body.query.includes("appInstall"))?.body
        .variables.input
    ).toStrictEqual({
      activateAfterInstallation: true,
      appName: "Example",
      manifestUrl: MANIFEST,
      permissions: ["MANAGE_ORDERS"],
    });
    expect(store.every((each) => each.auth === "Bearer store.secret")).toBe(
      true
    );

    store = [];
    const again = await cli(add, env);
    expect(again.data.data).toMatchObject({ created: false });
    expect(mutations()).toStrictEqual([]);
  });

  it("retries a failed installation instead of starting another", async () => {
    installing = [
      {
        appName: "Example",
        id: "inst-0",
        manifestUrl: MANIFEST,
        message: "Timeout",
        status: "FAILED",
      },
    ];

    const out = await cli(
      ["app", "add", "local:demo", "--manifest", MANIFEST],
      { SALEOR_POLL_INTERVAL_SECONDS: "0.001" }
    );

    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(mutations()).toStrictEqual(["appFetchManifest", "appRetryInstall"]);
  });

  it("reports an installation the store could not finish", async () => {
    answer = (body) => {
      if (body.query.includes("appInstall")) {
        installing = [
          {
            appName: "Example",
            id: "inst-1",
            manifestUrl: MANIFEST,
            message: "Manifest unreachable",
            status: "FAILED",
          },
        ];

        return {
          data: { started: { appInstallation: { id: "inst-1" }, errors: [] } },
        };
      }

      return appStore(body);
    };

    const out = await cli(
      ["app", "add", "local:demo", "--manifest", MANIFEST],
      { SALEOR_POLL_INTERVAL_SECONDS: "0.001" }
    );

    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe("STORE_ERROR");
    expect(out.data.error.message).toContain("Manifest unreachable");
  });

  it("refuses App Store apps on a local store before contacting it", async () => {
    const out = await cli([
      "app",
      "add",
      "local:demo",
      "--store-app",
      "avatax",
    ]);

    expect(out.code).toBe(2);
    expect(out.data.error.message).toContain(
      "cannot reach a store on this computer"
    );
    expect(store).toStrictEqual([]);
  });

  it("lists apps and installations", async () => {
    apps = [
      {
        id: "a1",
        identifier: "one",
        manifestUrl: "https://one/m",
        name: "One",
      },
    ];
    installing = [
      {
        appName: "Two",
        id: "i2",
        manifestUrl: "https://two/m",
        message: null,
        status: "PENDING",
      },
    ];

    const out = await cli(["app", "list", "local:demo"]);

    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(
      out.data.data.map((each: any) => [each.name, each.state])
    ).toStrictEqual([
      ["One", "installed"],
      ["Two", "installing"],
    ]);
  });

  it("reinstalls from the app's manifest only with confirmation", async () => {
    apps = [
      {
        id: "a1",
        identifier: "example.app",
        manifestUrl: MANIFEST,
        name: "Example",
      },
    ];
    const reinstall = ["app", "reinstall", "local:demo", "--app", "Example"];
    const env = { SALEOR_POLL_INTERVAL_SECONDS: "0.001" };

    const refused = await cli(reinstall, env);
    expect(refused.data.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(mutations()).toStrictEqual(["appFetchManifest"]);
    expect(apps.map((each) => each.id)).toStrictEqual(["a1"]);

    store = [];
    const out = await cli([...reinstall, "--force"], env);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.data.data).toMatchObject({
      app: { id: "QXBwOjk=", name: "Example" },
      store: "local:demo",
    });
    expect(mutations()).toStrictEqual([
      "appFetchManifest",
      "appDelete",
      "appInstall",
    ]);
    expect(
      store.find((each) => each.body.query.includes("appDelete"))?.body
        .variables
    ).toStrictEqual({ id: "a1" });
    expect(apps.map((each) => each.id)).toStrictEqual(["QXBwOjk="]);
  });

  it("keeps the app when the store cannot read its manifest", async () => {
    apps = [
      {
        id: "a1",
        identifier: "example.app",
        manifestUrl: MANIFEST,
        name: "Example",
      },
    ];
    answer = (body) =>
      body.query.includes("appFetchManifest")
        ? {
            data: {
              appFetchManifest: {
                errors: [{ field: "manifestUrl", message: "Unreachable" }],
                manifest: null,
              },
            },
          }
        : appStore(body);

    const out = await cli([
      "app",
      "reinstall",
      "local:demo",
      "--app",
      "a1",
      "--force",
    ]);

    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe("STORE_ERROR");
    expect(out.data.error.message).toContain("Unreachable");
    expect(mutations()).toStrictEqual(["appFetchManifest"]);
    expect(apps).toHaveLength(1);
  });

  it("uninstalls only with confirmation, and succeeds when the app is gone", async () => {
    apps = [
      {
        id: "a1",
        identifier: "one",
        manifestUrl: "https://one/m",
        name: "One",
      },
    ];
    const remove = ["app", "remove", "local:demo", "--app", "One"];

    const refused = await cli(remove);
    expect(refused.data.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(apps).toHaveLength(1);

    const removed = await cli([...remove, "--force"]);
    expect(removed.code, removed.stdout + removed.stderr).toBe(0);
    expect(removed.data.data).toMatchObject({
      action: "delete",
      existed: true,
    });
    expect(apps).toStrictEqual([]);

    const again = await cli([...remove, "--force"]);
    expect(again.data.data).toMatchObject({ action: "none", existed: false });
  });
});
