import { Data, Duration, Effect, Option } from "effect";
import type { CliFailure } from "./errors.ts";
import { notice } from "./output.ts";
import { type Deadline, heartbeat, isPast, POLL } from "./readiness.ts";

// Waiting for something outside the CLI (Saleor Cloud, Docker, a store, the login
// server) to reach a state. The CLI does not own those transitions; it can only look.
// Each round observes the outside world as a state, and `decide`, a pure function of
// that state, says what comes next. The loop, its pace, its progress lines and its
// deadline live here once, so every wait behaves the same way.

export type Step<A, R> = Data.TaggedEnum<{
  // Finished, with the result.
  Done: { readonly value: A };
  // Cannot finish: stop with this failure.
  Fail: { readonly failure: CliFailure };
  // Not there yet: look again after the interval, unless the deadline has passed.
  Wait: {
    // What the wait is doing, for heartbeat lines: "waiting for the GraphQL API".
    readonly doing: string;
    // Printed the first time this wait is in this state.
    readonly say: string | undefined;
    // Wait this much longer between rounds from now on (OAuth's slow_down).
    readonly slowDownBy: Duration.Duration | undefined;
  };
  // Do this, then look again right away.
  Act: { readonly run: Effect.Effect<void, CliFailure, R> };
}>;

interface StepDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: Step<this["A"], this["B"]>;
}

const Step = Data.taggedEnum<StepDefinition>();

export const done = <A>(value: A) => Step.Done({ value });

export const failWith = (failure: CliFailure) => Step.Fail({ failure });

export const wait = (
  doing: string,
  options: {
    readonly say?: string | undefined;
    readonly slowDownBy?: Duration.Duration | undefined;
  } = {}
) =>
  Step.Wait({
    doing,
    say: options.say,
    slowDownBy: options.slowDownBy,
  });

export const act = <R>(run: Effect.Effect<void, CliFailure, R>) =>
  Step.Act({ run });

export interface Convergence<S, A, E, R> {
  readonly observe: Effect.Effect<S, E, R>;
  readonly decide: (state: S) => Step<A, R>;
  readonly deadline: Deadline;
  // The failure when the deadline passes while waiting, from the last state seen.
  readonly timeout: (state: S) => Effect.Effect<never, CliFailure, R>;
  // Shared by a caller that waits for several things in turn, so heartbeat lines keep
  // counting across all of them. None by default for waits a person is acting on.
  readonly beat?: ((doing: string) => Effect.Effect<void>) | undefined;
  readonly interval?: Duration.Duration | undefined;
  // Wait one interval before the first look (OAuth device polling).
  readonly waitFirst?: boolean | undefined;
}

export const converge = <S, A, E, R>(spec: Convergence<S, A, E, R>) =>
  Effect.gen(function* () {
    const beat = spec.beat ?? heartbeat();
    const said = new Set<string>();
    let interval = spec.interval ?? POLL;

    const pause = (
      state: S,
      step: Extract<Step<A, R>, { readonly _tag: "Wait" }>
    ) =>
      Effect.gen(function* () {
        if (step.slowDownBy !== undefined) {
          interval = Duration.sum(interval, step.slowDownBy);
        }

        if (isPast(spec.deadline)) {
          return yield* spec.timeout(state);
        }

        if (step.say !== undefined && !said.has(step.say)) {
          said.add(step.say);
          yield* notice(step.say);
        }

        yield* beat(step.doing);
        yield* Effect.sleep(interval);
      });

    if (spec.waitFirst === true) {
      yield* Effect.sleep(interval);
    }

    for (;;) {
      const state = yield* spec.observe;

      const finished: Option.Option<A> = yield* Step.$match(
        spec.decide(state),
        {
          Act: ({ run }) => Effect.as(run, Option.none<A>()),
          Done: ({ value }) => Effect.succeed(Option.some(value)),
          Fail: ({ failure }) => Effect.fail(failure),
          Wait: (step) => Effect.as(pause(state, step), Option.none<A>()),
        }
      );

      if (Option.isSome(finished)) {
        return finished.value;
      }
    }
  });
