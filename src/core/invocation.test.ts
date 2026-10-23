import { Effect } from "effect";
import { expect, it } from "vitest";
import { appendOptions, Invocation, resumeCommand } from "./invocation.ts";

it("removes the zero wait budget without removing a flag-shaped resource name", async () => {
  const command = await Effect.runPromise(
    resumeCommand.pipe(
      Effect.provideService(Invocation, [
        "env",
        "create",
        "--timeout",
        "0",
        "--",
        "--timeout=0",
      ])
    )
  );

  expect(command).toBe("saleor env create -- --timeout=0");
});

it("places resolved setup choices before an end-of-options marker", () => {
  expect(
    appendOptions(
      ["init", "--"],
      ["--org", "acme", "--project", "shop", "--env", "dev"]
    )
  ).toEqual([
    "init",
    "--org",
    "acme",
    "--project",
    "shop",
    "--env",
    "dev",
    "--",
  ]);
});
