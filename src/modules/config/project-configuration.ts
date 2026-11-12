import { Effect, Layer } from "effect";
import { fail } from "../../core/errors.ts";
import { ProjectConfiguration } from "../../core/project-configuration.ts";
import { applyDeploy, planDeploy } from "./deploying.ts";
import { existingConfig, validateFile } from "./engine.ts";

export const projectConfigurationLive = Layer.succeed(ProjectConfiguration, {
  apply: (client, file) =>
    Effect.gen(function* () {
      const plan = yield* planDeploy(client, file);
      const deployed = yield* applyDeploy({ client, file, plan });

      if (deployed.missed.length > 0) {
        return yield* fail(
          "DEPLOY_PARTIAL",
          `The configuration is incomplete in ${client.store.ref}. Run the same command again to retry.`
        );
      }
    }),
  validate: (file) =>
    Effect.asVoid(Effect.flatMap(existingConfig(file), validateFile)),
});
