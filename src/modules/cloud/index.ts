import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type { CliModule } from "../../core/module.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { CloudApiLive } from "./api/client.ts";
import { SessionLive } from "./auth/session.ts";
import { login, logout, whoami } from "./commands/auth.ts";
import {
  envCommand,
  orgCommand,
  projectCommand,
} from "./commands/resources.ts";
import { init, link } from "./commands/workspace.ts";

export const cloudModule: CliModule = {
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
  name: "cloud",
};

const http = FetchHttpClient.layer;

const session = SessionLive.pipe(
  Layer.provide(SecretStoreLive),
  Layer.provide(http)
);

export const cloudLayer = CloudApiLive.pipe(
  Layer.provideMerge(session),
  Layer.provideMerge(http)
);
