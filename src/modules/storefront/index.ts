import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { storefrontCommand } from "./commands.ts";
import { storefrontSetup } from "./setup.ts";

export const storefrontModule = defineModule({
  commands: [storefrontCommand],
  description:
    "Storefronts from the Saleor template, connected to a Cloud or local store.",
  layer: FetchHttpClient.layer,
  name: "storefront",
  setupExtension: storefrontSetup,
});
