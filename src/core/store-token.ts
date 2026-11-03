import { Effect, Option } from "effect";
import { fail } from "./errors.ts";
import type { ResolvedStore } from "./stores.ts";
import { askConfirm, askText, isInteractive, required } from "./interaction.ts";
import { SecretStore } from "./secret-store.ts";

// Credentials for a store's own GraphQL API, which are not the Cloud login. People
// supply a store token as they do for Configurator today, usually an app token made in
// the store's Dashboard.
//
// This is the one place commands get a store token. A source that can get one by
// itself plugs in through `StoreSource.token`: local stores log in as the
// admin the CLI created, and Cloud stores get an app token made with the Cloud login
// (modules/cloud/store-access.ts). When a source cannot, people supply one.

export const storeTokenKey = (ref: string) => `store:${ref}`;

export interface StoreToken {
  // Where the token came from, for output; never the token itself.
  readonly from: "SALEOR_TOKEN" | "saved" | "store" | "entered";
  readonly token: string;
}

const dashboardHint = (dashboardUrl: string, needs: string) =>
  `Create an app token in the store's Dashboard (${dashboardUrl}): Apps → Create app, with ${needs}.`;

export interface StoreTokenOptions {
  // The permissions the command needs, as the token prompt and hint say them:
  // "the MANAGE_APPS permission". Defaults to what a configuration needs.
  readonly needs?: string;
  // SALEOR_TOKEN is one token for one store, so commands that reach several stores
  // turn it off rather than send it to all of them.
  readonly envToken?: boolean;
  // A staff user's token, for installing or creating apps, which Saleor refuses an
  // app token. The source's staff login comes before the saved token, which is
  // usually the app token the CLI made.
  readonly staff?: boolean;
}

const staffHint = (store: ResolvedStore["store"]) =>
  store.kind === "cloud"
    ? "Log in with saleor login, or use a staff user's token: an app token cannot install or create apps."
    : "Use a staff user's token, such as one from the store's tokenCreate mutation: an app token cannot install or create apps.";

// In order: SALEOR_TOKEN, the token saved for this store, the store's own login
// (local stores), then a prompt that offers to save what is entered. A staff token
// tries the source's staff login right after SALEOR_TOKEN.
export const storeToken = (
  { store, source }: ResolvedStore,
  {
    envToken = true,
    needs = "the permissions the configuration needs",
    staff = false,
  }: StoreTokenOptions = {}
) =>
  Effect.gen(function* () {
    const fromEnv = envToken ? process.env.SALEOR_TOKEN?.trim() : undefined;

    if (fromEnv) {
      return { from: "SALEOR_TOKEN", token: fromEnv } satisfies StoreToken;
    }

    // A source's own way to a token, if it has one.
    const fromSource = (get: typeof source.token) =>
      get === undefined ? Effect.succeedNone : get(store);

    if (staff) {
      const person = yield* fromSource(source.staffToken);

      if (Option.isSome(person)) {
        return { from: "store", token: person.value } satisfies StoreToken;
      }
    }

    const secrets = yield* SecretStore;
    const key = storeTokenKey(store.ref);
    const saved = yield* secrets.get(key);

    if (saved !== undefined) {
      return { from: "saved", token: saved } satisfies StoreToken;
    }

    const own = yield* fromSource(source.token);

    if (Option.isSome(own)) {
      return { from: "store", token: own.value } satisfies StoreToken;
    }

    const hint = staff
      ? staffHint(store)
      : dashboardHint(store.dashboardUrl, needs);

    if (!(yield* isInteractive)) {
      return yield* fail(
        "STORE_AUTH_REQUIRED",
        `No token for the store ${store.ref}.`,
        {
          suggestion: envToken
            ? `${hint} Then set it as SALEOR_TOKEN, or run this in a terminal to enter and save it.`
            : `${hint} Then run this in a terminal to enter and save it.`,
        }
      );
    }

    const token = yield* askText({
      message: `Token for ${store.name}. ${hint}`,
      secret: true,
      validate: required("A token"),
    });

    if (yield* askConfirm("Save it for this store on this computer?", true)) {
      yield* secrets.set(key, token);
    }

    return { from: "entered", token } satisfies StoreToken;
  });
