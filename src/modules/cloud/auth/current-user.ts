import { Effect } from "effect";
import { CloudApi, orDescribe } from "../api/client.ts";
import { retrieveUserWithOnboardingInfo } from "../api/generated.ts";

export const currentUser = Effect.gen(function* () {
  const api = yield* CloudApi;
  const user = yield* orDescribe(api.call(retrieveUserWithOnboardingInfo));

  const name =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || null;

  return {
    email: user.email,
    label: name === null ? user.email : `${name} <${user.email}>`,
    name,
  };
});
