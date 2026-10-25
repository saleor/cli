import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { localCommand } from "./commands.ts";
import { DockerLive } from "./docker.ts";
import { localSetup } from "./setup.ts";

export const localLayer = Layer.mergeAll(
  DockerLive,
  SecretStoreLive,
  FetchHttpClient.layer
);

export const localModule = defineModule({
  commands: [localCommand],
  description: "Local Saleor instances running in Docker.",
  layer: localLayer,
  name: "local",
  setup: localSetup,
});
