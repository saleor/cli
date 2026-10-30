import { Data, type Schema } from "effect";

export class ApiStatusError extends Data.TaggedError("ApiStatusError")<{
  readonly status: number;
  readonly body: Schema.Json | undefined;
  readonly operation: string;
}> {}
