import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { appCommand } from "./commands.ts";
import { appSetup } from "./setup.ts";

export const appModule = defineModule({
  commands: [appCommand],
  description:
    "Apps installed on a store: list, install and uninstall them, and apps of your own from the Saleor app template.",
  layer: Layer.mergeAll(FetchHttpClient.layer, SecretStoreLive),
  name: "app",
  setupExtension: appSetup,
});
