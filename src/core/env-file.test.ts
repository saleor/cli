import { expect, it } from "vitest";
import { connectedRef, declares, parseEnv, setEnv } from "./env-file.ts";

const EXAMPLE = [
  "# Your store's API",
  "NEXT_PUBLIC_SALEOR_API_URL=https://your-instance.saleor.cloud/graphql/",
  "",
  "# NEXT_PUBLIC_DEFAULT_CHANNEL=default-channel",
  'STRIPE_KEY="keep me" # a comment',
  "",
].join("\n");

it("sets owned keys in place, uncommenting them, and keeps every other line", () => {
  const written = setEnv(
    EXAMPLE,
    {
      NEXT_PUBLIC_DEFAULT_CHANNEL: "eu",
      NEXT_PUBLIC_SALEOR_API_URL: "http://localhost:8000/graphql/",
    },
    "local:demo",
    "set by a test"
  );

  expect(written.split("\n")).toEqual([
    "# saleor: instance=local:demo (set by a test)",
    "# Your store's API",
    "NEXT_PUBLIC_SALEOR_API_URL=http://localhost:8000/graphql/",
    "",
    "NEXT_PUBLIC_DEFAULT_CHANNEL=eu",
    'STRIPE_KEY="keep me" # a comment',
    "",
  ]);
  expect(connectedRef(written)).toBe("local:demo");
  expect(parseEnv(written).get("STRIPE_KEY")).toBe("keep me");
});

it("replaces its own header and appends keys the file does not mention", () => {
  const first = setEnv("A=1\n", { B: "two words" }, "local:a", "note");
  const second = setEnv(first, { B: "2" }, "cloud:acme/env1", "note");

  expect(second).toBe("# saleor: instance=cloud:acme/env1 (note)\nA=1\nB=2\n");
  expect(parseEnv(first).get("B")).toBe("two words");
  expect(connectedRef("A=1\n")).toBeUndefined();
});

it("tells declared keys, assigned or commented out, from absent ones", () => {
  expect(declares(EXAMPLE, "NEXT_PUBLIC_DEFAULT_CHANNEL")).toBe(true);
  expect(declares(EXAMPLE, "NEXT_PUBLIC_SALEOR_API_URL")).toBe(true);
  expect(declares(EXAMPLE, "NEXT_PUBLIC")).toBe(false);
  expect(parseEnv(EXAMPLE).has("NEXT_PUBLIC_DEFAULT_CHANNEL")).toBe(false);
});
