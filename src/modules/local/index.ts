import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { type CoreServices, defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { DockerLive } from "./docker.ts";
import { localInstances } from "./instances.ts";
import { localSetup } from "./setup.ts";

export const localLayer = Layer.mergeAll(
  DockerLive,
  SecretStoreLive,
  FetchHttpClient.layer
);

// Local stores have no commands of their own: `env` starts, stops and removes them
// through their instance source, as it does every other store.
export const localModule = defineModule<
  Layer.Success<typeof localLayer> | CoreServices
>({
  commands: [],
  description: "Local Saleor instances running in Docker.",
  instances: localInstances,
  layer: localLayer,
  name: "local",
  setup: localSetup,
});
