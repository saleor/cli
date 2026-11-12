import { Duration, Effect } from "effect";
import { type CliFailure, fail } from "./errors.ts";
import { rerunCommand } from "./invocation.ts";
import { elapsed } from "./durations.ts";
import { notice } from "./output.ts";

// A wait budget for one command run. Running out is not a failure: the command returns
// NOT_READY (exit 75) and running it again continues from where the work got to.
export interface Deadline {
  readonly at: number;
}

export const deadlineIn = (seconds: number): Deadline => ({
  at: Date.now() + seconds * 1000,
});

export const isPast = (deadline: Deadline) => Date.now() >= deadline.at;

// `message` says what is still happening; the work itself carries on in `location`
// ("Saleor Cloud", "Docker", "the store").
export const notReady = (
  message: string,
  details: CliFailure["details"],
  location: string
) =>
  Effect.flatMap(rerunCommand({ resume: true }), (command) =>
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

const HEARTBEAT_MS = Number(process.env.SALEOR_HEARTBEAT_SECONDS ?? 30) * 1000;

// Long waits print a line now and then, so a quiet terminal is not mistaken for a hang.
export const heartbeat = () => {
  const start = Date.now();
  let last = start;

  return (what: string) =>
    Effect.suspend(() => {
      const now = Date.now();

      if (now - last < HEARTBEAT_MS) {
        return Effect.void;
      }

      last = now;

      return notice(`  …still ${what} (${elapsed(now - start)} so far)`);
    });
};
