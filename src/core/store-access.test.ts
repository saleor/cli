import { Effect, Option } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { instance } from "./instance.ts";
import { OutputFlag } from "./output.ts";
import type { ResolvedInstance } from "./instances.ts";
import { SecretStore } from "./secret-store.ts";
import { storeAccess, storeTokenKey } from "./store-access.ts";

const resolved: ResolvedInstance = {
  instance: instance({
    dashboardUrl: "https://staging.example.com/dashboard/",
    graphqlUrl: "https://staging.example.com/graphql/",
    kind: "cloud",
    name: "staging",
    ref: "cloud:org/staging",
    saleorVersion: "3.23.41",
    state: "ready",
  }),
  source: {
    find: () => Effect.succeed(Option.none()),
    kind: "cloud",
    label: "Saleor Cloud",
    list: Effect.succeed([]),
    listCommand: "saleor cloud env list",
  },
};

const access = async (envToken = true) =>
  await Effect.runPromise(
    storeAccess(resolved, { envToken }).pipe(
      Effect.provideService(OutputFlag, Option.some("json")),
      Effect.provideService(SecretStore, {
        backend: "file",
        get: (key) =>
          Effect.succeed(
            key === storeTokenKey("cloud:org/staging") ? "saved" : undefined
          ),
        remove: () => Effect.die("Unexpected credential removal"),
        set: () => Effect.die("Unexpected credential write"),
      })
    )
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

it("uses SALEOR_TOKEN for a single store", async () => {
  vi.stubEnv("SALEOR_TOKEN", "from-env");

  expect(await access()).toStrictEqual({
    from: "SALEOR_TOKEN",
    token: "from-env",
  });
});

it("ignores SALEOR_TOKEN when the command reaches several stores", async () => {
  vi.stubEnv("SALEOR_TOKEN", "from-env");

  expect(await access(false)).toStrictEqual({ from: "saved", token: "saved" });
});
