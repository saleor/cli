import { Effect, Option, Queue } from "effect";
import { currentOutputFormat, useColors } from "../../core/output.ts";
import type { Delivery } from "./listener.ts";

// Deliveries as they arrive. People read each one on stdout: a line saying what it
// is, then its payload. In json mode stdout keeps its one result document, so each
// delivery is a JSON line on stderr, like progress.

const time = (iso: string) => iso.slice(11, 19);

const forwardedText = (delivery: Delivery) => {
  const { forwarded } = delivery;

  if (forwarded === null) {
    return "";
  }

  return forwarded.status === null
    ? `  → ${forwarded.url} failed: ${forwarded.error ?? "no answer"}`
    : `  → ${forwarded.url} ${forwarded.status}`;
};

export const showDelivery = (delivery: Delivery) =>
  Effect.gen(function* () {
    if ((yield* currentOutputFormat) === "json") {
      process.stderr.write(
        `${JSON.stringify({ delivery, event: "webhook" })}\n`
      );

      return;
    }

    const name = delivery.event ?? "(no saleor-event header)";

    const bold = useColors()
      ? (words: string) => `\u001B[1m${words}\u001B[0m`
      : (words: string) => words;

    process.stdout.write(
      [
        `${time(delivery.receivedAt)}  ${bold(name)}${forwardedText(delivery)}`,
        JSON.stringify(delivery.payload, null, 2),
        "",
      ].join("\n")
    );
  });

// Ctrl+C (or SIGTERM, how scripts and agents stop a process): stop as an interrupted
// command (exit 130), once `effect` has been interrupted and its finalizers (deleting
// the app) have run. Without this, Node would exit at once and leave the app on the
// store.
const interrupted = Effect.callback<void>((resume) => {
  const stop = () => {
    resume(Effect.void);
  };

  // `on`, not `once`: a second Ctrl+C during cleanup must not kill the process
  // before the app is deleted.
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  return Effect.sync(() => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  });
});

export const receiveUntil = <R>(
  deliveries: Queue.Dequeue<Delivery>,
  count: number,
  show: (delivery: Delivery) => Effect.Effect<void, never, R>
) => {
  const received: Delivery[] = [];
  const limit = count === 0 ? Number.POSITIVE_INFINITY : count;

  const collect = Effect.gen(function* () {
    while (received.length < limit) {
      const delivery = yield* Queue.take(deliveries);
      yield* show(delivery);
      received.push(delivery);
    }

    return received;
  });

  return collect;
};

export const untilCtrlC = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    // A side that interrupts itself does not end a race, so the race only says
    // which side finished; interrupting comes after, once the loser has cleaned up.
    const outcome = yield* Effect.raceFirst(
      Effect.map(effect, Option.some),
      Effect.as(interrupted, Option.none<A>())
    );

    if (Option.isNone(outcome)) {
      return yield* Effect.interrupt;
    }

    return outcome.value;
  });
