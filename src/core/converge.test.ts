import { Duration, Effect } from "effect";
import { expect, it } from "vitest";
import { act, converge, done, failWith, wait } from "./converge.ts";
import { fail } from "./errors.ts";

const future = { at: Date.now() + 60_000 };
const past = { at: 0 };

// Observes the next value of `states` each round.
const sequence = <S>(states: readonly S[]) => {
  let round = 0;
  const seen: S[] = [];

  return {
    observe: Effect.sync(() => {
      const state = states[Math.min(round, states.length - 1)];
      round += 1;

      if (state === undefined) {
        throw new Error("No states.");
      }

      seen.push(state);

      return state;
    }),
    seen,
  };
};

const quiet = () => Effect.void;

it("observes until the decision is done", async () => {
  const { observe, seen } = sequence(["pending", "pending", "ready"]);

  const result = await Effect.runPromise(
    converge({
      beat: quiet,
      deadline: future,
      decide: (state) => (state === "ready" ? done(42) : wait("waiting")),
      interval: Duration.zero,
      observe,
      timeout: () => Effect.fail(fail("NOT_READY", "Too slow.")),
    })
  );

  expect(result).toBe(42);
  expect(seen).toStrictEqual(["pending", "pending", "ready"]);
});

it("fails with the decided failure", async () => {
  const failure = await Effect.runPromise(
    Effect.flip(
      converge({
        beat: quiet,
        deadline: future,
        decide: () => failWith(fail("TASK_FAILED", "Broke.")),
        interval: Duration.zero,
        observe: Effect.succeed("failed"),
        timeout: () => Effect.fail(fail("NOT_READY", "Too slow.")),
      })
    )
  );

  expect(failure.code).toBe("TASK_FAILED");
});

it("times out from the last state seen once the deadline has passed", async () => {
  const failure = await Effect.runPromise(
    Effect.flip(
      converge({
        beat: quiet,
        deadline: past,
        decide: () => wait("waiting"),
        interval: Duration.zero,
        observe: Effect.succeed("installing"),
        timeout: (state) => Effect.fail(fail("NOT_READY", `Still ${state}.`)),
      })
    )
  );

  expect(failure.message).toBe("Still installing.");
});

it("finishes on a done state even after the deadline", async () => {
  const result = await Effect.runPromise(
    converge({
      beat: quiet,
      deadline: past,
      decide: () => done("ok"),
      interval: Duration.zero,
      observe: Effect.succeed("ready"),
      timeout: () => Effect.fail(fail("NOT_READY", "Too slow.")),
    })
  );

  expect(result).toBe("ok");
});

it("runs an action, then observes again without waiting", async () => {
  const actions: string[] = [];
  const { observe } = sequence(["busy", "ready"]);

  await Effect.runPromise(
    converge({
      beat: quiet,
      deadline: past,
      decide: (state) =>
        state === "busy"
          ? act(Effect.sync(() => actions.push(state)))
          : done(undefined),
      interval: Duration.zero,
      observe,
      timeout: () => Effect.fail(fail("NOT_READY", "Too slow.")),
    })
  );

  expect(actions).toStrictEqual(["busy"]);
});

it("reports each wait's beat", async () => {
  const beats: string[] = [];
  const { observe } = sequence(["a", "b", "done"]);

  await Effect.runPromise(
    converge({
      beat: (doing) => Effect.sync(() => beats.push(doing)),
      deadline: future,
      decide: (state) =>
        state === "done" ? done(undefined) : wait(`waiting for ${state}`),
      interval: Duration.zero,
      observe,
      timeout: () => Effect.fail(fail("NOT_READY", "Too slow.")),
    })
  );

  expect(beats).toStrictEqual(["waiting for a", "waiting for b"]);
});
