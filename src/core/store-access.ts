import { Effect, Option } from "effect";
import { fail } from "./errors.ts";
import type { ResolvedInstance } from "./instances.ts";
import { askConfirm, askText, isInteractive, required } from "./interaction.ts";
import { SecretStore } from "./secret-store.ts";

// Credentials for a store's own GraphQL API, which are not the Cloud login: that one
// is for the Cloud API and never sent to a store. People supply a store token as they
// do for Configurator today, usually an app token made in the store's Dashboard.

export const storeTokenKey = (ref: string) => `store:${ref}`;

export interface StoreAccess {
  // Where the token came from, for output; never the token itself.
  readonly from: "SALEOR_TOKEN" | "saved" | "instance" | "entered";
  readonly token: string;
}

const dashboardHint = (dashboardUrl: string) =>
  `Create an app token in the store's Dashboard (${dashboardUrl}): Apps → Create app, with the permissions the configuration needs.`;

// In order: SALEOR_TOKEN, the token saved for this store, the instance's own sign-in
// (local instances), then a prompt that offers to save what is entered.
export const storeAccess = ({ instance, source }: ResolvedInstance) =>
  Effect.gen(function* () {
    const fromEnv = process.env.SALEOR_TOKEN?.trim();

    if (fromEnv) {
      return { from: "SALEOR_TOKEN", token: fromEnv } satisfies StoreAccess;
    }

    const secrets = yield* SecretStore;
    const key = storeTokenKey(instance.ref);
    const saved = yield* secrets.get(key);

    if (saved !== undefined) {
      return { from: "saved", token: saved } satisfies StoreAccess;
    }

    const own =
      source.access === undefined
        ? Option.none()
        : yield* source.access(instance);

    if (Option.isSome(own)) {
      return { from: "instance", token: own.value } satisfies StoreAccess;
    }

    if (!(yield* isInteractive)) {
      return yield* fail(
        "STORE_AUTH_REQUIRED",
        `No token for the store ${instance.ref}.`,
        {
          suggestion: `${dashboardHint(instance.dashboardUrl)} Then set it as SALEOR_TOKEN, or run this in a terminal to enter and save it.`,
        }
      );
    }

    const token = yield* askText({
      message: `Token for ${instance.name}. ${dashboardHint(instance.dashboardUrl)}`,
      secret: true,
      validate: required("A token"),
    });

    if (yield* askConfirm("Save it for this store on this computer?", true)) {
      yield* secrets.set(key, token);
    }

    return { from: "entered", token } satisfies StoreAccess;
  });
