import { Effect, Option } from "effect";
import { fail } from "./errors.ts";
import type { ResolvedInstance } from "./instances.ts";
import { askConfirm, askText, isInteractive, required } from "./interaction.ts";
import { SecretStore } from "./secret-store.ts";

// Credentials for a store's own GraphQL API, which are not the Cloud login. People
// supply a store token as they do for Configurator today, usually an app token made in
// the store's Dashboard.
//
// This is the one place commands get a store token. A source that can get one by
// itself plugs in through `InstanceSource.access`: local instances sign in as the
// admin the CLI created, and Cloud stores get an app token made with the Cloud login
// (modules/cloud/store-access.ts). When a source cannot, people supply one.

export const storeTokenKey = (ref: string) => `store:${ref}`;

export interface StoreAccess {
  // Where the token came from, for output; never the token itself.
  readonly from: "SALEOR_TOKEN" | "saved" | "instance" | "entered";
  readonly token: string;
}

const dashboardHint = (dashboardUrl: string, needs: string) =>
  `Create an app token in the store's Dashboard (${dashboardUrl}): Apps → Create app, with ${needs}.`;

export interface StoreAccessOptions {
  // The permissions the command needs, as the token prompt and hint say them:
  // "the MANAGE_APPS permission". Defaults to what a configuration needs.
  readonly needs?: string;
  // SALEOR_TOKEN is one token for one store, so commands that reach several stores
  // turn it off rather than send it to all of them.
  readonly envToken?: boolean;
  // A staff user's token, for installing or creating apps, which Saleor refuses an
  // app token. The source's staff sign-in comes before the saved token, which is
  // usually the app token the CLI made.
  readonly staff?: boolean;
}

const staffHint = (instance: ResolvedInstance["instance"]) =>
  instance.kind === "cloud"
    ? "Log in with saleor login, or use a staff user's token: an app token cannot install or create apps."
    : "Use a staff user's token, such as one from the store's tokenCreate mutation: an app token cannot install or create apps.";

// In order: SALEOR_TOKEN, the token saved for this store, the instance's own sign-in
// (local instances), then a prompt that offers to save what is entered. A staff token
// tries the source's staff sign-in right after SALEOR_TOKEN.
export const storeAccess = (
  { instance, source }: ResolvedInstance,
  {
    envToken = true,
    needs = "the permissions the configuration needs",
    staff = false,
  }: StoreAccessOptions = {}
) =>
  Effect.gen(function* () {
    const fromEnv = envToken ? process.env.SALEOR_TOKEN?.trim() : undefined;

    if (fromEnv) {
      return { from: "SALEOR_TOKEN", token: fromEnv } satisfies StoreAccess;
    }

    // A source's own way to a token, if it has one.
    const signIn = (get: typeof source.access) =>
      get === undefined ? Effect.succeedNone : get(instance);

    if (staff) {
      const person = yield* signIn(source.staffAccess);

      if (Option.isSome(person)) {
        return { from: "instance", token: person.value } satisfies StoreAccess;
      }
    }

    const secrets = yield* SecretStore;
    const key = storeTokenKey(instance.ref);
    const saved = yield* secrets.get(key);

    if (saved !== undefined) {
      return { from: "saved", token: saved } satisfies StoreAccess;
    }

    const own = yield* signIn(source.access);

    if (Option.isSome(own)) {
      return { from: "instance", token: own.value } satisfies StoreAccess;
    }

    const hint = staff
      ? staffHint(instance)
      : dashboardHint(instance.dashboardUrl, needs);

    if (!(yield* isInteractive)) {
      return yield* fail(
        "STORE_AUTH_REQUIRED",
        `No token for the store ${instance.ref}.`,
        {
          suggestion: envToken
            ? `${hint} Then set it as SALEOR_TOKEN, or run this in a terminal to enter and save it.`
            : `${hint} Then run this in a terminal to enter and save it.`,
        }
      );
    }

    const token = yield* askText({
      message: `Token for ${instance.name}. ${hint}`,
      secret: true,
      validate: required("A token"),
    });

    if (yield* askConfirm("Save it for this store on this computer?", true)) {
      yield* secrets.set(key, token);
    }

    return { from: "entered", token } satisfies StoreAccess;
  });
