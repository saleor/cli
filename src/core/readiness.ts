import { Duration, Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { type CliFailure, fail } from "./errors.ts";
import { rerunCommand } from "./invocation.ts";

// A wait budget for one command run. Running out is not a failure: the command returns
// NOT_READY (exit 75) and running it again continues from Cloud's current state.
export interface Deadline {
  readonly at: number;
}

export const deadlineIn = (seconds: number): Deadline => ({
  at: Date.now() + seconds * 1000,
});

export const isPast = (deadline: Deadline) => Date.now() >= deadline.at;

// `message` says what is still happening; the work itself carries on in Saleor Cloud.
export const notReady = (
  message: string,
  details: CliFailure["details"],
  location = "Saleor Cloud"
) =>
  Effect.flatMap(rerunCommand(), (command) =>
    Effect.fail(
      fail("NOT_READY", `Stopped waiting: ${message}`, {
        details,
        retry: true,
        suggestion: `It continues in ${location}. To keep waiting, run the same command again: ${command}`,
      })
    )
  );

export const POLL = Duration.seconds(
  Number(process.env.SALEOR_POLL_INTERVAL_SECONDS ?? 5)
);

// A finished task does not mean the store answers yet; cold starts can take minutes.
export const probeGraphql = (graphqlUrl: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const request = HttpClientRequest.post(graphqlUrl).pipe(
      HttpClientRequest.bodyJsonUnsafe({ query: "query { shop { name } }" })
    );

    const response = yield* http
      .execute(request)
      .pipe(Effect.timeout(Duration.seconds(15)), Effect.option);

    if (Option.isNone(response) || response.value.status !== 200) {
      return false;
    }

    const body = yield* response.value.json.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            data: Schema.optionalKey(
              Schema.Struct({
                shop: Schema.optionalKey(
                  Schema.NullOr(Schema.Struct({ name: Schema.String }))
                ),
              })
            ),
          })
        )
      ),
      Effect.orElseSucceed(() => ({ data: undefined }))
    );

    return body.data?.shop !== undefined && body.data.shop !== null;
  });
