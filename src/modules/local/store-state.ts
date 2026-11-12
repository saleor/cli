import type { StoreState } from "../../core/store.ts";

// A local store's state from what Docker and the store say. A first setup that never
// finished outranks everything; then whether the API answers, then whether it runs.
export const localState = (seen: {
  readonly initialized: boolean;
  readonly apiRunning: boolean;
  readonly answers: boolean;
}): StoreState => {
  if (!seen.initialized) {
    return "incomplete";
  }

  if (seen.answers) {
    return "ready";
  }

  return seen.apiRunning ? "starting" : "stopped";
};
