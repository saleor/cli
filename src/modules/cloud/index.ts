import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { CloudApiLive } from "./api/client.ts";
import { SessionLive } from "./auth/session.ts";
import { envCommand } from "./commands/env.ts";
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
import { orgCommand } from "./commands/org.ts";
import { projectCommand } from "./commands/project.ts";
import { whoami } from "./commands/whoami.ts";
import { resolveCloudTarget } from "./target.ts";

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
  commands: [login, logout, whoami, orgCommand, projectCommand, envCommand],
  description:
    "Saleor Cloud: account, organizations, projects and environments.",
  layer: cloudLayer,
  name: "cloud",
  target: {
    kind: "cloud",
    resolve: (ref) => resolveCloudTarget(ref).pipe(Effect.provide(cloudLayer)),
  },
});
