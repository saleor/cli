import { Effect, Option, Predicate, Queue, Schema } from "effect";
import { randomBytes } from "node:crypto";
import { text } from "node:stream/consumers";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { fail } from "../../core/errors.ts";

// The HTTP server Saleor delivers to. Its path is a random secret, so only the store
// that was told it can deliver; anything else is refused. When forwarding, the store
// gets the forwarded app's status, so retries behave as they would for that app.

export interface Forwarded {
  readonly error: string | null;
  readonly status: number | null;
  readonly url: string;
}

export interface Delivery {
  readonly event: string | null;
  readonly forwarded: Forwarded | null;
  // Saleor's own headers (saleor-event, saleor-signature, …), as received.
  readonly headers: Readonly<Record<string, string>>;
  readonly payload: Schema.Json;
  readonly receivedAt: string;
}

export interface Listening {
  readonly deliveries: Queue.Dequeue<Delivery>;
  readonly path: string;
  readonly port: number;
}

const saleorHeaders = (headers: IncomingHttpHeaders) =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) =>
      name.startsWith("saleor-") && Predicate.isString(value)
        ? [[name, value] as const]
        : []
    )
  );

const decodeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json)
);

const forward = async (
  url: string,
  body: string,
  headers: Readonly<Record<string, string>>
): Promise<Forwarded> => {
  try {
    const response = await fetch(url, {
      body,
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    });

    return { error: null, status: response.status, url };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      status: null,
      url,
    };
  }
};

interface Handling {
  readonly deliveries: Queue.Queue<Delivery>;
  readonly forwardTo: string | undefined;
  readonly path: string;
}

const receive = async (
  { deliveries, forwardTo, path }: Handling,
  req: IncomingMessage,
  res: ServerResponse
) => {
  if (req.url !== path || req.method !== "POST") {
    res.writeHead(404).end();

    return;
  }

  const body = await text(req);
  const headers = saleorHeaders(req.headers);

  const forwarded =
    forwardTo === undefined ? null : await forward(forwardTo, body, headers);

  res.writeHead(forwarded === null ? 200 : (forwarded.status ?? 502)).end();

  Queue.offerUnsafe(deliveries, {
    event: headers["saleor-event"] ?? null,
    forwarded,
    headers,
    payload: Option.getOrElse(decodeJson(body), () => body),
    receivedAt: new Date().toISOString(),
  });
};

const listenOn = (server: Server, host: string, port: number) =>
  Effect.callback<number, ReturnType<typeof fail>>((resume) => {
    server.once("error", (error) => {
      resume(
        Effect.fail(
          fail(
            "PORT_IN_USE",
            `Could not listen on ${host}:${port}: ${error.message}`,
            { suggestion: "Pick another port with --port <number>." }
          )
        )
      );
    });
    server.listen(port, host, () => {
      const address = server.address();

      resume(
        Effect.succeed(
          address === null || Predicate.isString(address) ? port : address.port
        )
      );
    });
  });

const closeServer = (server: Server) =>
  Effect.callback<void>((resume) => {
    server.closeAllConnections();
    server.close(() => {
      resume(Effect.void);
    });
  });

// Listens until the scope closes.
export const listen = (spec: {
  readonly forwardTo: string | undefined;
  readonly host: string;
  readonly port: number;
}) =>
  Effect.gen(function* () {
    const deliveries = yield* Queue.unbounded<Delivery>();
    const path = `/${randomBytes(16).toString("hex")}`;
    const handling = { deliveries, forwardTo: spec.forwardTo, path };

    const server = createServer((req, res) => {
      Effect.runFork(
        Effect.promise(async () => {
          await receive(handling, req, res);
        }).pipe(
          Effect.catchCause(() =>
            Effect.sync(() => {
              res.destroy();
            })
          )
        )
      );
    });

    const port = yield* Effect.acquireRelease(
      listenOn(server, spec.host, spec.port),
      () => closeServer(server)
    );

    return { deliveries, path, port } satisfies Listening;
  });
