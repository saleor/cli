import { Effect } from "effect";
import type { ErrorCode } from "../../../core/errors.ts";
import { openBrowser } from "../../../core/interaction.ts";
import { notice } from "../../../core/output.ts";
import { pollForTokens, requestDeviceCode } from "./device-grant.ts";
import { Session } from "./session.ts";

const FINISHED_GRANT = new Set<ErrorCode>([
  "API_ERROR",
  "AUTH_DEVICE_ACCESS_DENIED",
  "AUTH_DEVICE_CODE_EXPIRED",
]);

// Reuses a still-valid pending code, so an agent that was interrupted while the person
// was approving does not invalidate the link it already showed them.
export const deviceLogin = (openInBrowser: boolean) =>
  Effect.gen(function* () {
    const session = yield* Session;
    const pending = yield* session.pendingGrant;

    const grant =
      pending !== undefined && pending.expiresAt - 30_000 > Date.now()
        ? pending
        : yield* requestDeviceCode;

    if (grant !== pending) {
      yield* session.savePendingGrant(grant);
    }

    const url = grant.verificationUriComplete ?? grant.verificationUri;
    const opened = openInBrowser ? yield* openBrowser(url) : false;
    yield* notice(
      [
        opened
          ? "To log in, approve the request in the browser window that just opened:"
          : "To log in, open this link in your browser and approve the request:",
        `  ${url}`,
        `  Check that the page shows the code ${grant.userCode}.`,
        "Waiting for approval… (Ctrl+C to cancel)",
      ].join("\n"),
      {
        event: "login",
        expiresAt: new Date(grant.expiresAt).toISOString(),
        userCode: grant.userCode,
        verificationUrl: url,
      }
    );

    const tokens = yield* pollForTokens(grant).pipe(
      // A denied, expired or refused grant can never be approved; the next login must
      // ask for a new one. A network failure or Ctrl+C keeps it for the next run.
      Effect.tapError((failure) =>
        FINISHED_GRANT.has(failure.code)
          ? session.clearPendingGrant
          : Effect.void
      )
    );

    yield* session.saveLogin(tokens);
    yield* session.clearPendingGrant;
  });
