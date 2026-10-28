import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { CloudApiLive } from "./api/client.ts";
import { account, sessionLayer, signedIn } from "./auth/signed-in.ts";
import { envCommand } from "./commands/env.ts";
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
import { cloudInstances } from "./instances.ts";
import { cloudSetup } from "./setup.ts";

// Whether this person has Cloud credentials; see signed-in.ts.
export const cloudSignedIn = signedIn;

// The Cloud account commands would act as, as a line to show; see signed-in.ts.
export const cloudAccount = account;

export const cloudLayer = CloudApiLive.pipe(
  Layer.provideMerge(sessionLayer),
  Layer.provideMerge(FetchHttpClient.layer)
);

export const cloudModule = defineModule({
  commands: [login, logout, envCommand],
  description: "Saleor Cloud: login and environments.",
  instances: cloudInstances,
  layer: cloudLayer,
  name: "cloud",
  setup: cloudSetup,
});
