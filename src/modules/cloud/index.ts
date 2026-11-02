import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { type CoreServices, defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { CloudApiLive } from "./api/client.ts";
import { sessionLayer } from "./auth/signed-in.ts";
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
import { cloudInstances } from "./instances.ts";
import { cloudSetup } from "./setup.ts";

// The Cloud account commands would act as, as a line to show; see signed-in.ts.
export { account as cloudAccount } from "./auth/signed-in.ts";

export const cloudLayer = CloudApiLive.pipe(
  Layer.provideMerge(sessionLayer),
  Layer.provideMerge(Layer.mergeAll(FetchHttpClient.layer, SecretStoreLive))
);

// Named, because no command needs the SecretStore that store access does.
export const cloudModule = defineModule<
  Layer.Success<typeof cloudLayer> | CoreServices
>({
  commands: [login, logout],
  description: "Saleor Cloud: login, and its environments as stores.",
  instances: cloudInstances,
  layer: cloudLayer,
  name: "cloud",
  setup: cloudSetup,
});
