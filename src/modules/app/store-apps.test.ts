import { Effect, Option, Predicate } from "effect";
import { FetchHttpClient } from "effect/http";
import { createServer, type Server } from "node:http";
import { text } from "node:stream/consumers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { instance } from "../../core/instance.ts";
import { Prompts } from "../../core/interaction.ts";
import { ActionContext, type Answer } from "../../core/invocation.ts";
import { OutputFlag } from "../../core/output.ts";
import { deadlineIn } from "../../core/readiness.ts";
import { planStoreApps } from "./store-apps.ts";

// The App Store list at a terminal: ticked apps are installed, unticked installed ones
// are uninstalled, and only after the plan says so.

const AVATAX = "https://avatax.example.test/api/manifest";
const KLAVIYO = "https://klaviyo.example.test/api/manifest";
const ELSEWHERE = "https://mine.example.test/api/manifest";

const catalog = {
  extensionCategories: [
    {
      extensions: [
        {
          id: "saleor.app.avatax",
          manifestUrl: AVATAX,
          name: { en: "AvaTax" },
          type: "APP",
        },
      ],
      id: "taxes",
      name: { en: "Taxes" },
    },
    {
      extensions: [
        {
          id: "saleor.app.klaviyo",
          manifestUrl: KLAVIYO,
          name: { en: "Klaviyo" },
          type: "APP",
        },
      ],
      id: "notifications",
      name: { en: "Notifications" },
    },
  ],
};

let server: Server;
let port: number;
let apps: { id: string; manifestUrl: string; name: string }[];
let mutations: string[];

const tty = [process.stdin, process.stdout].map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY")
);

const answerTo = (query: string, variables: any) => {
  if (query.includes("appsInstallations")) {
    return {
      apps: {
        edges: apps.map((node) => ({
          node: { ...node, identifier: null, isActive: true, type: null },
        })),
      },
      appsInstallations: [],
    };
  }

  const [, mutation] = /(app[A-Za-z]+)\(/.exec(query) ?? [];
  mutations.push(mutation ?? query);

  if (mutation === "appFetchManifest") {
    return {
      appFetchManifest: {
        errors: [],
        manifest: { identifier: null, name: "Klaviyo", permissions: [] },
      },
    };
  }

  if (mutation === "appInstall") {
    apps.push({
      id: "new",
      manifestUrl: variables.input.manifestUrl,
      name: "Klaviyo",
    });

    return { started: { appInstallation: { id: "inst" }, errors: [] } };
  }

  apps = apps.filter((each) => each.id !== variables.id);

  return { appDelete: { errors: [] } };
};

beforeEach(async () => {
  // Agents' markers turn questions off; this is a person at a terminal.
  for (const key of [
    "AI_AGENT",
    "AMP_CURRENT_THREAD_ID",
    "CI",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CODEX_SANDBOX",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CURSOR_AGENT",
    "GEMINI_CLI",
    "OPENCODE",
    "SALEOR_NO_INPUT",
  ]) {
    vi.stubEnv(key, "");
  }

  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  }

  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);

  apps = [
    { id: "avatax", manifestUrl: AVATAX, name: "AvaTax" },
    { id: "mine", manifestUrl: ELSEWHERE, name: "Mine" },
  ];
  mutations = [];

  server = createServer((req, res) => {
    text(req)
      .then((raw) => {
        res.writeHead(200, { "content-type": "application/json" });

        if (req.url === "/extensions") {
          res.end(JSON.stringify(catalog));

          return;
        }

        const body = JSON.parse(raw);
        res.end(JSON.stringify({ data: answerTo(body.query, body.variables) }));
      })
      .catch(() => {
        res.destroy();
      });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("Expected TCP address");
  }

  port = address.port;
  vi.stubEnv("SALEOR_EXTENSIONS_URL", `http://127.0.0.1:${port}/extensions`);
  vi.stubEnv("SALEOR_POLL_INTERVAL_SECONDS", "0.001");
});

afterEach(async () => {
  for (const [index, stream] of [process.stdin, process.stdout].entries()) {
    const descriptor = tty[index];

    if (descriptor === undefined) {
      Reflect.deleteProperty(stream, "isTTY");
    } else {
      Object.defineProperty(stream, "isTTY", descriptor);
    }
  }

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

// Plans with the answer `ticked` at the list; applies the plan too when `apply`.
const scenario = async (ticked: readonly string[], apply = false) => {
  const multiselect = vi.fn(async () => ticked);
  const answers: Answer[] = [];

  const store = {
    instance: instance({
      dashboardUrl: "https://example.test/dashboard/",
      graphqlUrl: `http://127.0.0.1:${port}/graphql/`,
      kind: "cloud",
      name: "dev",
      ref: "cloud:acme/env1",
      saleorVersion: "3.23.0",
      state: "running",
    }),
    token: "store.secret",
  };

  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const planned = yield* planStoreApps(store, Option.none(), deadlineIn(5));
      const done = apply ? yield* planned.apply : undefined;

      return { done, planned };
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(OutputFlag, Option.some("text")),
      Effect.provideService(ActionContext, {
        answers,
        dryRun: false,
        force: false,
        kind: "ensure",
      }),
      Effect.provideService(Prompts, {
        confirm: async () => true,
        multiselect,
        select: async () => "",
        text: async () => "",
      })
    )
  );

  return { ...outcome, answers, multiselect };
};

it("starts with the installed App Store apps ticked, and changes nothing until applied", async () => {
  const { multiselect, planned } = await scenario([AVATAX, KLAVIYO]);

  expect(multiselect).toHaveBeenCalledWith(
    expect.objectContaining({
      groups: {
        Notifications: [{ label: "Klaviyo", value: KLAVIYO }],
        Taxes: [{ hint: "installed", label: "AvaTax", value: AVATAX }],
      },
      initialValues: [AVATAX],
    })
  );
  expect(planned).toMatchObject({ action: "create", risk: null });
  // Reading the new app's manifest is the only request before applying.
  expect(mutations).toStrictEqual(["appFetchManifest"]);
});

it("uninstalls an App Store app that is unticked, never one from elsewhere", async () => {
  const { answers, done, planned } = await scenario([KLAVIYO], true);

  expect(planned.action).toBe("update");
  expect(planned.risk).toContain("AvaTax");
  // A rerun with --store-app would not uninstall, so it is not offered as one.
  expect(answers).toStrictEqual([]);

  expect(done).toMatchObject({
    data: { installed: ["Klaviyo"], removed: ["AvaTax"] },
  });
  expect(mutations).toStrictEqual([
    "appFetchManifest",
    "appDelete",
    "appInstall",
  ]);
  expect(apps.map((each) => each.id)).toStrictEqual(["mine", "new"]);
});
