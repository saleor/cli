import { Effect, Option } from "effect";
import {
  absent,
  DEFAULT_WAIT_SECONDS,
  type Planned,
} from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import type { Instance, InstanceSource } from "../../core/instance.ts";
import { notice } from "../../core/output.ts";
import { deadlineIn } from "../../core/readiness.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import { populateEnvironmentDatabase } from "./api/contract.ts";
import { currentUser } from "./auth/current-user.ts";
import { deviceLogin } from "./auth/device-login.ts";
import {
  describeEnvironment,
  environmentTarget,
  findEnvironment,
  isSandbox,
  listEnvironments,
  listOrganizations,
  serviceTypeLabel,
} from "./lookup.ts";
import { deleteEnvironment } from "./provision.ts";
import { waitForTask } from "./readiness.ts";
import { cloudAccess, cloudLogin } from "./store-access.ts";

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
      return Option.none<Instance>();
    }

    const { environment, organization } = parsed.value;

    return Option.map(
      yield* findEnvironment(organization, environment),
      (env): Instance => describeEnvironment(organization, env)
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
    const found = yield* findEnvironment(organization, environment);

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
      yield* waitForTask({
        taskId: started.task_id,
        deadline: deadlineIn(DEFAULT_WAIT_SECONDS),
        label: "Loading sample data",
      });
    }
  });

export const cloudInstances = {
  access: cloudAccess,
  staffAccess: cloudLogin,
  find,
  kind: "cloud",
  label: "Saleor Cloud",
  list,
  populate,
  remove,
  signIn: Effect.gen(function* () {
    yield* deviceLogin(true);
    yield* notice(`✓ Logged in as ${(yield* currentUser).email}.`);
  }),
} satisfies InstanceSource<unknown>;
