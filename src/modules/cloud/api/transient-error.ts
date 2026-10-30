import { Data } from "effect";

export class TransientError extends Data.TaggedError("TransientError")<{
  readonly status: number;
}> {}
