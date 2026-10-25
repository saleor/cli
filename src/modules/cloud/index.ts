import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { CloudApiLive } from "./api/client.ts";
import { SessionLive } from "./auth/session.ts";
import { envCommand } from "./commands/env.ts";
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
import { cloudSetup } from "./setup.ts";

const http = FetchHttpClient.layer;

const session = SessionLive.pipe(
  Layer.provide(SecretStoreLive),
  Layer.provide(http)
);

export const cloudLayer = CloudApiLive.pipe(
  Layer.provideMerge(session),
  Layer.provideMerge(http)
);

export const cloudModule = defineModule({
  commands: [login, logout, envCommand],
  description: "Saleor Cloud: login and environments.",
  layer: cloudLayer,
  name: "cloud",
  setup: cloudSetup,
});
