import { expect, it } from "vitest";
import { localState } from "./store-state.ts";

it.each([
  ["incomplete", { answers: true, apiRunning: true, initialized: false }],
  ["ready", { answers: true, apiRunning: true, initialized: true }],
  ["starting", { answers: false, apiRunning: true, initialized: true }],
  ["stopped", { answers: false, apiRunning: false, initialized: true }],
] as const)("is %s", (state, seen) => {
  expect(localState(seen)).toBe(state);
});
