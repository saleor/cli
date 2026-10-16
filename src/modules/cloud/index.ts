import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { defineModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { CloudApiLive } from "./api/client.ts";
import { SessionLive } from "./auth/session.ts";
import { envCommand } from "./commands/env.ts";
import { init } from "./commands/init.ts";
import { link } from "./commands/link.ts";
import { login } from "./commands/login.ts";
import { logout } from "./commands/logout.ts";
import { orgCommand } from "./commands/org.ts";
import { projectCommand } from "./commands/project.ts";
import { whoami } from "./commands/whoami.ts";

const http = FetchHttpClient.layer;

const session = SessionLive.pipe(
  Layer.provide(SecretStoreLive),
  Layer.provide(http)
);

export const cloudModule = defineModule({
  commands: [
    login,
    logout,
    whoami,
    orgCommand,
    projectCommand,
    envCommand,
    link,
    init,
  ],
  description:
    "Saleor Cloud: account, organizations, projects and environments.",
  layer: CloudApiLive.pipe(
    Layer.provideMerge(session),
    Layer.provideMerge(http)
  ),
  name: "cloud",
});
