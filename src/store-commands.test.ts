import { Predicate } from "effect";
import { createTarGzip } from "nanotar";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

  it("signs in as the local admin for each command, saving nothing", async () => {
    const credentialsFile = path.join(cwd, "config/credentials.json");

    writeFileSync(
      credentialsFile,
      JSON.stringify({
        "local:demo": JSON.stringify({
          database: "d",
          django: "s",
          password: "admin-pass",
        }),
      })
    );

    answer = (body) =>
      body.query.includes("tokenCreate(email")
        ? { data: { tokenCreate: { errors: [], token: "staff.jwt" } } }
        : { data: { shop: { name: "Demo" } } };

    // The file goes once nothing is saved in it.
    const saved = () =>
      existsSync(credentialsFile)
        ? JSON.parse(readFileSync(credentialsFile, "utf-8"))["store:local:demo"]
        : undefined;

    const signsIn = async () => {
      store.splice(0);

      const out = await cli(
        ["api", "call", "local:demo", "--query", "{ shop { name } }"],
        { SALEOR_TOKEN: "" }
      );

      expect(out.code, out.stdout + out.stderr).toBe(0);
      expect(store.map((each) => each.auth)).toStrictEqual([
        undefined,
        "Bearer staff.jwt",
      ]);
      expect(store[0]?.body.variables).toStrictEqual({
        email: "admin@example.com",
        password: "admin-pass",
      });
      expect(saved()).toBeUndefined();
    };

    await signsIn();
    // Again, not from a saved token.
    await signsIn();

    // A token saved for the store goes with it, so a store made again under the
    // name is not sent the old one.
    const credentials = JSON.parse(readFileSync(credentialsFile, "utf-8"));
    credentials["store:local:demo"] = "entered.token";
    writeFileSync(credentialsFile, JSON.stringify(credentials));

    const removed = await cli(["env", "remove", "local:demo", "--force"]);

    expect(removed.code, removed.stdout + removed.stderr).toBe(0);
    expect(saved()).toBeUndefined();
  });
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

  it("logs in again to delete the app when the local login has expired", async () => {
    writeFileSync(
      path.join(cwd, "config/credentials.json"),
      JSON.stringify({
        "local:demo": JSON.stringify({
          database: "d",
          django: "s",
          password: "admin-pass",
        }),
      })
    );

    const listening = storeAnswers(deliverOrder);
    let logins = 0;
    let deletes = 0;

    answer = (body) => {
      if (body.query.includes("tokenCreate(email")) {
        logins += 1;

        return {
          data: { tokenCreate: { errors: [], token: `staff.jwt.${logins}` } },
        };
      }

      if (body.query.includes("appDelete")) {
        deletes += 1;

        if (deletes === 1) {
          return {
            data: null,
            errors: [
              {
                extensions: { exception: { code: "ExpiredSignatureError" } },
                message: "Signature has expired",
              },
            ],
          };
        }
      }

      return listening(body);
    };

    const out = await cli(
      [
        "webhook",
        "listen",
        "local:demo",
        "--events",
        "order_created",
        "--count",
        "1",
      ],
      { SALEOR_TOKEN: "" }
    );

    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(logins).toBe(2);
    expect(
      store
        .filter((each) => each.body.query.includes("appDelete"))
        .map((each) => each.auth)
    ).toStrictEqual(["Bearer staff.jwt.1", "Bearer staff.jwt.2"]);
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
    expect(out.data.error.code).toBe("CONTEXT_MISSING");
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
    manifestUrl: string | null;
    name: string;
  }[];

  let installing: {
    appName: string;
    id: string;
    manifestUrl: string;
    message: string | null;
    status: string;
  }[];

  type Entries = { key: string; value: string }[];

  const metadataByAppId = new Map<
    string,
    { metadata: Entries; privateMetadata: Entries }
  >();

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

    // As Saleor does, it will not read the manifest of an app it has installed.
    if (
      query.includes("appFetchManifest") &&
      apps.some((each) => each.identifier === "example.app")
    ) {
      return {
        data: {
          appFetchManifest: {
            errors: [
              {
                code: "UNIQUE",
                field: "identifier",
                message:
                  "App with the same identifier is already installed: Example",
              },
            ],
            manifest: null,
          },
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
        manifestUrl: body.variables.input?.manifestUrl ?? MANIFEST,
        name: "Example",
      });

      return {
        data: { started: { appInstallation: { id: "inst-1" }, errors: [] } },
      };
    }

    if (query.includes("privateMetadata {")) {
      return {
        data: {
          app: metadataByAppId.get(body.variables.id) ?? {
            metadata: [],
            privateMetadata: [],
          },
        },
      };
    }

    const updated = /(updateMetadata|updatePrivateMetadata)\(/.exec(query)?.[1];

    if (updated !== undefined) {
      const kind =
        updated === "updateMetadata" ? "metadata" : "privateMetadata";

      const entries = metadataByAppId.get(body.variables.id) ?? {
        metadata: [],
        privateMetadata: [],
      };

      entries[kind] = [...entries[kind], ...body.variables.input];
      metadataByAppId.set(body.variables.id, entries);

      return { data: { updated: { errors: [] } } };
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
      .map(
        (query) => /(app[A-Za-z]+|update[A-Za-z]*Metadata)\(/.exec(query)?.[1]
      );

  beforeEach(() => {
    apps = [];
    installing = [];
    metadataByAppId.clear();
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

  describe("on this computer, for a local store in Docker", () => {
    // An app the template made, which serves its manifest with the URLs its .env
    // gives, read on every request as `next dev` reloads it.
    const runApp = async (id: string) => {
      const dir = path.join(cwd, "apps/loyalty");
      mkdirSync(path.join(dir, "src/pages/api"), { recursive: true });
      writeFileSync(
        path.join(dir, "package.json"),
        '{"dependencies":{"@saleor/app-sdk":"1.12.0"}}'
      );
      writeFileSync(
        path.join(dir, "src/pages/api/manifest.ts"),
        'export default { id: "shop.loyalty" };\n'
      );
      writeFileSync(
        path.join(dir, ".env"),
        "# APP_IFRAME_BASE_URL=\n# APP_API_BASE_URL=\n"
      );

      let port = 0;
      port = await serve((_req, res) => {
        const env = readFileSync(path.join(dir, ".env"), "utf-8");

        const base =
          /^APP_API_BASE_URL=(.+)$/m.exec(env)?.[1] ??
          `http://localhost:${port}`;

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id, tokenTargetUrl: `${base}/api/register` }));
      });

      return { dir, port };
    };

    const installedFrom = () =>
      store.find((each) => each.body.query.includes("appInstall"))?.body
        .variables.input.manifestUrl;

    it("gives the store Docker's name for this computer, and the project's app its URLs", async () => {
      writeFileSync(
        path.join(cwd, "saleor.yml"),
        "name: Shop\ncomponents:\n  loyalty:\n    kind: app\n    path: apps/loyalty\n"
      );

      const { dir, port } = await runApp("shop.loyalty");

      const add = [
        "app",
        "add",
        "local:demo",
        "--manifest",
        `http://localhost:${port}/api/manifest`,
      ];

      const env = { SALEOR_POLL_INTERVAL_SECONDS: "0.001" };

      const preview = await cli([...add, "--dry-run"], env);
      expect(preview.code, preview.stdout + preview.stderr).toBe(0);
      expect(preview.data.data.details).toMatchObject({
        env: {
          values: {
            APP_API_BASE_URL: `http://host.docker.internal:${port}`,
            APP_IFRAME_BASE_URL: `http://localhost:${port}`,
          },
        },
        manifestUrl: `http://host.docker.internal:${port}/api/manifest`,
      });
      expect(readFileSync(path.join(dir, ".env"), "utf-8")).not.toContain(
        "host.docker.internal"
      );

      const out = await cli(add, env);
      expect(out.code, out.stdout + out.stderr).toBe(0);
      expect(installedFrom()).toBe(
        `http://host.docker.internal:${port}/api/manifest`
      );

      const written = readFileSync(path.join(dir, ".env"), "utf-8");
      expect(written).toContain(
        `APP_API_BASE_URL=http://host.docker.internal:${port}\n`
      );
      expect(written).toContain(
        `APP_IFRAME_BASE_URL=http://localhost:${port}\n`
      );
      expect(written).not.toContain("# APP_API_BASE_URL=");

      // Typed the same way again, it is the same app.
      store = [];
      const again = await cli(add, env);
      expect(again.data.data).toMatchObject({ created: false });
      expect(mutations()).toStrictEqual([]);
    });

    it("refuses an app it cannot point at Docker before installing", async () => {
      const { port } = await runApp("someone.else");

      const out = await cli([
        "app",
        "add",
        "local:demo",
        "--manifest",
        `http://localhost:${port}/api/manifest`,
      ]);

      expect(out.code).toBe(2);
      expect(out.data.error.message).toContain("store's own container");
      expect(out.data.error.suggestion).toContain(
        `APP_API_BASE_URL=http://host.docker.internal:${port}`
      );
      expect(store).toStrictEqual([]);
    });
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
    // The store will not read an installed app's manifest, so the first read only
    // shows it can reach it; the second, after the delete, gives the permissions.
    expect(mutations()).toStrictEqual([
      "appFetchManifest",
      "appDelete",
      "appFetchManifest",
      "appInstall",
    ]);
    expect(
      store.find((each) => each.body.query.includes("appDelete"))?.body
        .variables
    ).toStrictEqual({ id: "a1" });
    expect(apps.map((each) => each.id)).toStrictEqual(["QXBwOjk="]);
  });

  it("copies the old app's metadata to the new one only when asked", async () => {
    const env = { SALEOR_POLL_INTERVAL_SECONDS: "0.001" };

    const reinstall = [
      "app",
      "reinstall",
      "local:demo",
      "--app",
      "a1",
      "--force",
    ];

    const old = {
      metadata: [{ key: "channel", value: "default" }],
      privateMetadata: [{ key: "settings", value: "encrypted" }],
    };

    const installedApp = {
      id: "a1",
      identifier: "example.app",
      manifestUrl: MANIFEST,
      name: "Example",
    };

    apps = [installedApp];
    metadataByAppId.set("a1", old);

    const plain = await cli(reinstall, env);
    expect(plain.code, plain.stdout + plain.stderr).toBe(0);
    expect(plain.data.data.app.id).toBe("QXBwOjk=");
    expect(mutations()).toStrictEqual([
      "appFetchManifest",
      "appDelete",
      "appFetchManifest",
      "appInstall",
    ]);
    expect(metadataByAppId.has("QXBwOjk=")).toBe(false);

    store = [];
    apps = [installedApp];
    metadataByAppId.set("a1", old);

    const copied = await cli([...reinstall, "--copy-metadata"], env);
    expect(copied.code, copied.stdout + copied.stderr).toBe(0);
    expect(mutations()).toStrictEqual([
      "appFetchManifest",
      "appDelete",
      "appFetchManifest",
      "appInstall",
      "updateMetadata",
      "updatePrivateMetadata",
    ]);
    expect(metadataByAppId.get("QXBwOjk=")).toStrictEqual(old);
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

  // --app is a target: a terminal is offered the store's apps; anything else is told
  // which ones it could have named.
  it("lists the store's apps when no app is named", async () => {
    apps = [
      {
        id: "a1",
        identifier: "one",
        manifestUrl: "https://one/m",
        name: "One",
      },
      { id: "a2", identifier: "two", manifestUrl: null, name: "Two" },
    ];

    const removing = await cli(["app", "remove", "local:demo", "--force"]);
    expect(removing.code).toBe(2);
    expect(removing.data.error).toMatchObject({
      code: "CONTEXT_MISSING",
      details: { choices: ["a1", "a2"], input: "--app <app>" },
    });
    expect(apps).toHaveLength(2);

    // Only an app installed from a manifest can be installed again.
    const reinstalling = await cli(["app", "reinstall", "local:demo"]);
    expect(reinstalling.data.error).toMatchObject({
      code: "CONTEXT_MISSING",
      details: { choices: ["a1"] },
    });
  });
});

describe("app create", () => {
  const MANIFEST_TS = `export default createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    return {
      name: "Saleor App Template",
      id: "saleor.app",
    };
  },
});
`;

  let templateUrl = "";

  const env = () => ({
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_AUTHOR_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    SALEOR_APP_TEMPLATE_URL: templateUrl,
  });

  beforeEach(async () => {
    const archive = await createTarGzip([
      {
        data: '{"name":"saleor-app-template","dependencies":{"@saleor/app-sdk":"1.12.0"}}',
        name: "t-main/package.json",
      },
      { data: MANIFEST_TS, name: "t-main/src/pages/api/manifest.ts" },
      {
        data: "APP_IFRAME_BASE_URL=\nAPP_API_BASE_URL=\n",
        name: "t-main/.env.example",
      },
      { data: ".env\nnode_modules", name: "t-main/.gitignore" },
    ]);

    const port = await serve((_req, res) => {
      res.writeHead(200);
      res.end(Buffer.from(archive));
    });

    const fakeBin = path.join(cwd, "fake-bin");
    writeFileSync(
      path.join(fakeBin, "pnpm"),
      `#!${process.execPath}
require("node:fs").mkdirSync("node_modules", {recursive:true});
`
    );
    chmodSync(path.join(fakeBin, "pnpm"), 0o700);
    symlinkSync(
      execFileSync("which", ["git"]).toString().trim(),
      path.join(fakeBin, "git")
    );

    writeFileSync(path.join(cwd, "saleor.yml"), "name: Outdoor Shop\n");

    templateUrl = `http://127.0.0.1:${port}/app.tar.gz`;
  });

  it("makes each app its own folder, manifest id and component", async () => {
    const first = await cli(["app", "create", "--app", "Loyalty"], env());
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(first.data.data).toMatchObject({
      component: "loyalty",
      created: true,
      identifier: "outdoor-shop.loyalty",
      installed: true,
      next: [
        "cd apps/loyalty",
        "pnpm dev",
        "saleor app add <env> --manifest <url>/api/manifest",
      ],
      repository: "created",
      warnings: [],
    });

    const dir = path.join(cwd, "apps/loyalty");

    const manifest = readFileSync(
      path.join(dir, "src/pages/api/manifest.ts"),
      "utf-8"
    );

    expect(manifest).toContain('id: "outdoor-shop.loyalty"');
    expect(manifest).toContain('name: "Loyalty"');
    expect(readFileSync(path.join(dir, ".gitignore"), "utf-8")).toContain(
      "\n.saleor-app-auth.json\n"
    );
    // Empty, the template's manifest takes them as its URLs; unset, it falls back to
    // the address the app is reached at.
    expect(readFileSync(path.join(dir, ".env"), "utf-8")).toBe(
      "# APP_IFRAME_BASE_URL=\n# APP_API_BASE_URL=\n"
    );
    // The app tokens and .env never reach git.
    expect(
      execFileSync("git", ["ls-files"], { cwd: dir })
        .toString()
        .split("\n")
        .filter(Boolean)
        .sort()
    ).toStrictEqual([
      ".env.example",
      ".gitignore",
      "package.json",
      "src/pages/api/manifest.ts",
    ]);

    const second = await cli(["app", "create", "--app", "Rewards"], env());
    expect(second.data.data).toMatchObject({
      component: "rewards",
      identifier: "outdoor-shop.rewards",
    });
    expect(readFileSync(path.join(cwd, "saleor.yml"), "utf-8")).toContain(
      "components:\n  loyalty:\n    kind: app\n    path: apps/loyalty\n  rewards:\n    kind: app\n    path: apps/rewards\n"
    );

    // Again: the files and id are kept.
    const again = await cli(["app", "create", "--app", "Loyalty"], env());
    expect(again.data.data).toMatchObject({
      created: false,
      identifier: "outdoor-shop.loyalty",
    });
    expect(
      readFileSync(path.join(dir, "src/pages/api/manifest.ts"), "utf-8")
    ).toBe(manifest);
  });

  it("refuses a folder that holds something else", async () => {
    mkdirSync(path.join(cwd, "apps/loyalty"), { recursive: true });
    writeFileSync(path.join(cwd, "apps/loyalty/notes.txt"), "mine");

    const out = await cli(["app", "create", "--app", "loyalty"], env());

    expect(out.code).toBe(1);
    expect(out.data.error.code).toBe("NAME_CONFLICT");
  });
});

describe("local backups", () => {
  const calls = () =>
    existsSync(path.join(cwd, "docker.log"))
      ? readFileSync(path.join(cwd, "docker.log"), "utf-8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).join(" "))
      : [];

  const backupDir = (store: string, name: string) =>
    path.join(cwd, "config/backups/local", store, name);

  // A Docker that records its calls, reports the store running (or stopped), and
  // copies out of a container by writing the file.
  const fakeDocker = (state = "running") => {
    writeFileSync(
      path.join(cwd, "fake-bin", "docker"),
      `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(cwd, "docker.log"))}, JSON.stringify(args) + "\\n");
if (args.includes("ps")) for (const s of ["api", "db", "worker"]) console.log(JSON.stringify({Service: s, State: ${JSON.stringify(state)}}));
const cp = args.indexOf("cp");
if (cp !== -1 && args[cp + 2].startsWith("/")) fs.writeFileSync(args[cp + 2], "data");
`
    );
  };

  const saved = (store: string, name: string, saleorVersion = "3.23.41") => {
    mkdirSync(backupDir(store, name), { recursive: true });
    writeFileSync(path.join(backupDir(store, name), "db.dump"), "data");
    writeFileSync(path.join(backupDir(store, name), "media.tgz"), "data");
    writeFileSync(
      path.join(backupDir(store, name), "backup.json"),
      JSON.stringify({
        createdAt: "2026-11-01T10:00:00.000Z",
        name,
        saleorVersion,
        store,
      })
    );
  };

  beforeEach(() => {
    fakeDocker();
  });

  it("dumps the database and media to this computer, then reuses the backup by name", async () => {
    const made = await cli([
      "backup",
      "add",
      "local:demo",
      "--backup",
      "before-import",
    ]);

    expect(made.code).toBe(0);
    expect(made.data.data).toMatchObject({
      created: true,
      id: "demo/before-import",
    });
    expect(calls().some((call) => call.includes("exec -T db pg_dump"))).toBe(
      true
    );

    for (const file of ["backup.json", "db.dump", "media.tgz"]) {
      expect(
        existsSync(path.join(backupDir("demo", "before-import"), file))
      ).toBe(true);
    }

    const before = calls().length;

    const again = await cli([
      "backup",
      "add",
      "local:demo",
      "--backup",
      "before-import",
    ]);

    expect(again.data.data).toMatchObject({ created: false });
    expect(
      calls()
        .slice(before)
        .some((call) => call.includes("pg_dump"))
    ).toBe(false);

    const listed = await cli(["backup", "list", "local:demo"]);

    expect(listed.data.data.map((each: any) => each.id)).toStrictEqual([
      "demo/before-import",
    ]);
  });

  it("refuses to back up a stopped store", async () => {
    fakeDocker("exited");
    const out = await cli(["backup", "add", "local:demo", "--backup", "x"]);

    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(out.data.error.suggestion).toContain("env start");
  });

  it("restores another store's backup only with confirmation, keeping this store's admin", async () => {
    saved("other", "snapshot");

    const refused = await cli([
      "backup",
      "restore",
      "local:demo",
      "--backup",
      "other/snapshot",
    ]);

    expect(refused.data.error.code).toBe("CONFIRMATION_REQUIRED");
    expect(calls().some((call) => call.includes("pg_restore"))).toBe(false);

    const restored = await cli([
      "backup",
      "restore",
      "local:demo",
      "--backup",
      "snapshot",
      "--force",
    ]);

    expect(restored.code).toBe(0);
    expect(restored.data.data).toMatchObject({
      backup: { id: "other/snapshot" },
      ref: "local:demo",
    });

    const steps = calls().map((call) =>
      ["pg_restore", "migrate", "DJANGO_SUPERUSER_PASSWORD", "tar -xzf"].find(
        (step) => call.includes(step)
      )
    );

    expect(steps.filter(Boolean)).toStrictEqual([
      "pg_restore",
      "migrate",
      "DJANGO_SUPERUSER_PASSWORD",
      "tar -xzf",
    ]);
  });

  it("refuses a backup made with a newer Saleor", async () => {
    saved("demo", "future", "3.99.0");

    const out = await cli([
      "backup",
      "restore",
      "local:demo",
      "--backup",
      "future",
      "--force",
    ]);

    expect(out.data.error.code).toBe("USAGE_ERROR");
    expect(out.data.error.message).toContain("Saleor 3.99.0");
  });

  it("deletes a backup with --force, and succeeds when it is gone", async () => {
    saved("demo", "old");

    const removed = await cli([
      "backup",
      "remove",
      "local:demo",
      "--backup",
      "old",
      "--force",
    ]);

    expect(removed.data.data).toMatchObject({ action: "delete" });
    expect(existsSync(backupDir("demo", "old"))).toBe(false);

    const again = await cli([
      "backup",
      "remove",
      "local:demo",
      "--backup",
      "old",
      "--force",
    ]);

    expect(again.data.data).toMatchObject({ action: "none", existed: false });
  });
});
