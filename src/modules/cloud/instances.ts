import { Effect, Option } from "effect";
import { DEFAULT_WAIT_SECONDS } from "../../core/action.ts";
import type { Instance, InstanceSource } from "../../core/instance.ts";
import { command } from "../../core/invocation.ts";
import { notice } from "../../core/output.ts";
import { deadlineIn } from "../../core/readiness.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import { populateEnvironmentDatabase } from "./api/contract.ts";
import { currentUser } from "./auth/current-user.ts";
import { deviceLogin } from "./auth/device-login.ts";
import {
  describeEnvironment,
  findEnvironment,
  listEnvironments,
  listOrganizations,
} from "./lookup.ts";
import { waitForTask } from "./readiness.ts";

// Cloud environments as stores other modules can connect to, in every organization
// the account belongs to. Refs are `cloud:<org>/<environment key>`.
const list = Effect.gen(function* () {
  const organizations = yield* listOrganizations;

  const environments = yield* Effect.forEach(organizations, (org) =>
    Effect.map(listEnvironments(org.slug), (envs) =>
      envs.map((env): Instance => describeEnvironment(org.slug, env))
    )
  );

  return environments.flat();
});

const find = (id: string) =>
  Effect.gen(function* () {
    const separator = id.indexOf("/");

    if (separator < 0) {
      return Option.none<Instance>();
    }

    const organization = id.slice(0, separator);

    return Option.map(
      yield* findEnvironment(organization, id.slice(separator + 1)),
      (env): Instance => describeEnvironment(organization, env)
    );
  });

// Restores the environment from Saleor Cloud's populated template, then waits for it.
const populate = (environment: Instance) =>
  Effect.gen(function* () {
    const [organization = "", key = ""] = environment.ref
      .slice("cloud:".length)
      .split("/");

    const api = yield* CloudApi;

    const started = yield* orDescribe(
      api.call(populateEnvironmentDatabase, {
        path: { id: key, organization_slug: organization },
      })
    );

    if (started.task_id !== null) {
      yield* waitForTask(
        started.task_id,
        deadlineIn(DEFAULT_WAIT_SECONDS),
        "Loading sample data"
      );
    }
  });

export const cloudInstances = {
  find,
  kind: "cloud",
  label: "Saleor Cloud",
  list,
  listCommand: command("env", "list", "--org", "<org>"),
  populate,
  signIn: Effect.gen(function* () {
    yield* deviceLogin(true);
    yield* notice(`✓ Logged in as ${(yield* currentUser).email}.`);
  }),
} satisfies InstanceSource<unknown>;
