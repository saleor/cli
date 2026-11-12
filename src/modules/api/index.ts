import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { apiCommand } from "./commands.ts";

export const apiModule = defineModule({
  commands: [apiCommand],
  description: "GraphQL requests to a store's API, with its token.",
  layer: Layer.mergeAll(FetchHttpClient.layer, SecretStoreLive),
  name: "api",
});
