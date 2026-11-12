import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { webhookCommand } from "./commands.ts";

export const webhookModule = defineModule({
  commands: [webhookCommand],
  description:
    "A store's webhooks, received on this computer through a temporary app.",
  layer: Layer.mergeAll(FetchHttpClient.layer, SecretStoreLive),
  name: "webhook",
});
