import { Effect, Option } from "effect";
import {
  absent,
  DEFAULT_WAIT_SECONDS,
  type Planned,
} from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import type { Store, StoreSource } from "../../core/store.ts";
import { notice } from "../../core/output.ts";
import { deadlineIn } from "../../core/readiness.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import { populateEnvironmentDatabase } from "./api/contract.ts";
import { currentUser } from "./auth/current-user.ts";
import { deviceLogin } from "./auth/device-login.ts";
import {
  describeEnvironment,
  environmentTarget,
  findCloudEnvironment,
  isSandbox,
  listCloudEnvironments,
  listOrganizations,
  serviceTypeLabel,
} from "./lookup.ts";
import { deleteEnvironment } from "./provision.ts";
import { waitForTask } from "./readiness.ts";
import { cloudAppToken, cloudLoginToken } from "./store-token.ts";

// Cloud environments as stores other modules can connect to, in every organization
// the account belongs to. Refs are `cloud:<org>/<environment key>`.
const list = Effect.gen(function* () {
  const organizations = yield* listOrganizations;

  const environments = yield* Effect.forEach(organizations, (org) =>
    Effect.map(listCloudEnvironments(org.slug), (envs) =>
      envs.map((env): Store => describeEnvironment(org.slug, env))
    )
  );

  return environments.flat();
});

// A ref's id is `<org>/<environment key>`; a name is accepted for the key when it is
// unambiguous in the organization.
const parse = (id: string) => {
  const separator = id.indexOf("/");

  return separator === -1
    ? Option.none()
    : Option.some({
        environment: id.slice(separator + 1),
        organization: id.slice(0, separator),
      });
};

const find = (id: string) =>
  Effect.gen(function* () {
    const parsed = parse(id);

    if (Option.isNone(parsed)) {
      return Option.none<Store>();
    }

    const { environment, organization } = parsed.value;

    return Option.map(
      yield* findCloudEnvironment(organization, environment),
      (env): Store => describeEnvironment(organization, env)
    );
  });

// Deleting a sandbox. Production environments are only deleted in the dashboard.
const remove = (id: string, { timeout }: { readonly timeout: number }) =>
  Effect.gen(function* () {
    const parsed = parse(id);

    if (Option.isNone(parsed)) {
      return yield* fail(
        "USAGE_ERROR",
        `"cloud:${id}" is not a Cloud ref: they look like cloud:<org>/<env key>.`
      );
    }

    const { environment, organization } = parsed.value;
    const found = yield* findCloudEnvironment(organization, environment);

    if (Option.isNone(found)) {
      return absent({
        id: null,
        name: environment,
        scope: { organization },
        type: "environment",
      });
    }

    const env = found.value;

    if (!isSandbox(env)) {
      return yield* fail(
        "PRODUCTION_DELETE_REFUSED",
        `"${env.name}" is a ${serviceTypeLabel(env)} environment. The CLI only deletes sandboxes.`,
        {
          suggestion: `To delete it, use the Saleor Cloud dashboard: https://cloud.saleor.io/org/${organization}/environments/${env.key}`,
        }
      );
    }

    const details = describeEnvironment(organization, env);

    return {
      action: "delete",
      apply: Effect.as(
        deleteEnvironment(organization, env, deadlineIn(timeout)),
        {}
      ),
      details,
      risk: "All its data is deleted. This cannot be undone.",
      state: details.state,
      target: environmentTarget(organization, env),
    } satisfies Planned<object, unknown>;
  });

// Restores the environment from Saleor Cloud's populated template, then waits for it.
const populate = (environment: Store) =>
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
      yield* waitForTask({
        taskId: started.task_id,
        deadline: deadlineIn(DEFAULT_WAIT_SECONDS),
        label: "Loading sample data",
      });
    }
  });

export const cloudStores = {
  find,
  kind: "cloud",
  label: "Saleor Cloud",
  list,
  login: Effect.gen(function* () {
    yield* deviceLogin(true);
    yield* notice(`✓ Logged in as ${(yield* currentUser).email}.`);
  }),
  populate,
  remove,
  staffToken: cloudLoginToken,
  token: cloudAppToken,
} satisfies StoreSource<unknown>;
