import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { type CoreServices, defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { CloudApiLive } from "./api/client.ts";
import { account, sessionLayer } from "./auth/logged-in.ts";
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
import { cloudStores } from "./stores.ts";
import { cloudSetup } from "./setup.ts";

export const cloudLayer = CloudApiLive.pipe(
  Layer.provideMerge(sessionLayer),
  Layer.provideMerge(Layer.mergeAll(FetchHttpClient.layer, SecretStoreLive))
);

// Named, because no command needs the SecretStore that store tokens do.
export const cloudModule = defineModule<
  Layer.Success<typeof cloudLayer> | CoreServices
>({
  commands: [login, logout],
  description: "Saleor Cloud: login, and its environments as stores.",
  stores: cloudStores,
  layer: cloudLayer,
  name: "cloud",
  setup: cloudSetup,
  // The Cloud account commands would act as.
  status: account,
});
