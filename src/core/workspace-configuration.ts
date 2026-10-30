import { Context, type Effect } from "effect";
import type { CliFailure } from "./errors.ts";
import type { Instance } from "./instance.ts";

export class WorkspaceConfiguration extends Context.Service<
  WorkspaceConfiguration,
  {
    readonly validate: (file: string) => Effect.Effect<void, CliFailure>;
    readonly apply: (
      instance: Instance,
      token: string,
      file: string
    ) => Effect.Effect<void, CliFailure>;
  }
>()("saleor/WorkspaceConfiguration") {}
