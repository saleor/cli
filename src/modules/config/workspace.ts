import { Effect, Layer } from "effect";
import { fail } from "../../core/errors.ts";
import { WorkspaceConfiguration } from "../../core/workspace-configuration.ts";
import { applyDeploy, planDeploy } from "./deploying.ts";
import { existingConfig, validateFile } from "./engine.ts";

export const workspaceConfigurationLive = Layer.succeed(
  WorkspaceConfiguration,
  {
    apply: (instance, token, file) =>
      Effect.gen(function* () {
        const store = { token, url: instance.graphqlUrl };
        const plan = yield* planDeploy(store, file);

        const deployed = yield* applyDeploy({
          instance,
          store,
          file,
          plan,
        });

        if (deployed.missed.length > 0) {
          return yield* fail(
            "DEPLOY_PARTIAL",
            `The configuration is incomplete in ${instance.ref}. Run the same command again to retry.`
          );
        }
      }),
    validate: (file) =>
      Effect.asVoid(Effect.flatMap(existingConfig(file), validateFile)),
  }
);
