import { Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { projectLocal } from "../../core/project.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { localCommand } from "./commands.ts";
import { DockerLive } from "./docker.ts";
import { localInstances } from "./instances.ts";
import { localSetup } from "./setup.ts";
import { listInstanceNames } from "./state.ts";

// Whether this computer has any local instance to manage.
export const hasLocalInstances = Effect.map(
  listInstanceNames(),
  (names) => names.length > 0 || Option.isSome(projectLocal())
);

export const localLayer = Layer.mergeAll(
  DockerLive,
  SecretStoreLive,
  FetchHttpClient.layer
);

export const localModule = defineModule({
  commands: [localCommand],
  description: "Local Saleor instances running in Docker.",
  instances: localInstances,
  layer: localLayer,
  name: "local",
  setup: localSetup,
});
