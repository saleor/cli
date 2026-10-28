import { Context, Deferred, Effect, Option } from "effect";

// Escape at any prompt leaves the current step for the place that led to it: a
// command opened from a menu returns to that menu, a group menu to its parent, a later
// onboarding question to the first one. Flows mark those places with `withBack`;
// prompts only ask whether one exists and never know where it leads.

// What a prompt answers when the person pressed Escape and there is a way back.
export const BACK: unique symbol = Symbol("saleor/back");

// Leaves for the nearest `withBack`. None outside one: Escape has nowhere to go.
export const Back = Context.Reference<Option.Option<Effect.Effect<never>>>(
  "saleor/Back",
  {
    defaultValue: Option.none,
  }
);

export const canGoBack = Effect.gen(function* () {
  return Option.isSome(yield* Back);
});

export const goBack = Effect.gen(function* () {
  return yield* Option.getOrElse(yield* Back, () => Effect.interrupt);
});

// Runs `effect` as a place Escape inside it returns to: None when the person went back.
// The abandoned work is interrupted from outside, so its finalizers run but it renders
// no result and sets no exit code.
export const withBack = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const left = yield* Deferred.make<void>();

    return yield* Effect.raceFirst(
      effect.pipe(
        Effect.map(Option.some),
        Effect.provideService(
          Back,
          Option.some(
            Effect.andThen(Deferred.succeed(left, undefined), Effect.never)
          )
        )
      ),
      Effect.as(Deferred.await(left), Option.none<A>())
    );
  });

// Asks `question`, then runs `next` with the answer. Escape anywhere in `next` asks
// the question again; Escape at the question itself leaves for the enclosing place.
export const askThen = <A, E, R, B, E2, R2>(
  question: Effect.Effect<A, E, R>,
  next: (answer: A) => Effect.Effect<B, E2, R2>
): Effect.Effect<B, E | E2, R | R2> =>
  Effect.gen(function* () {
    const done = yield* withBack(next(yield* question));

    return Option.isSome(done) ? done.value : yield* askThen(question, next);
  });
