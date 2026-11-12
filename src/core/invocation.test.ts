import { Effect } from "effect";
import { expect, it } from "vitest";
import {
  ActionContext,
  type Answer,
  command,
  Invocation,
  rerunCommand,
} from "./invocation.ts";

const rerun = async (
  argv: readonly string[],
  answers: Answer[],
  options: Parameters<typeof rerunCommand>[0] = {}
) =>
  await Effect.runPromise(
    rerunCommand(options).pipe(
      Effect.provideService(Invocation, argv),
      Effect.provideService(ActionContext, {
        answers,
        dryRun: false,
        force: false,
        kind: "ensure",
      })
    )
  );

it("quotes every word so a pasted hint is the same command", () => {
  expect(command("init", "--org", "acme", "--project", "My Store")).toBe(
    "saleor init --org acme --project 'My Store'"
  );
  expect(command("env", "remove", "<env>")).toBe("saleor env remove <env>");
});

it("adds answers given at prompts, options before the marker", async () => {
  expect(
    await rerun(
      ["env", "add", "--"],
      [
        { flag: "--local" },
        { option: ["--saleor-version", "3.23.41"] },
        { positional: "dev" },
      ],
      { add: ["--dry-run"] }
    )
  ).toBe("saleor env add --local --saleor-version 3.23.41 --dry-run -- dev");
});

it("protects a flag-shaped positional answer with a marker", async () => {
  expect(await rerun(["env", "remove"], [{ positional: "-dev" }])).toBe(
    "saleor env remove -- -dev"
  );
});

it("drops a zero wait budget when resuming, but not a flag-shaped name", async () => {
  expect(
    await rerun(["env", "remove", "--timeout", "0", "--", "--timeout=0"], [], {
      resume: true,
    })
  ).toBe("saleor env remove -- --timeout=0");
});

it("does not repeat a flag that is already there", async () => {
  expect(
    await rerun(["env", "remove", "x", "--force"], [], { add: ["--force"] })
  ).toBe("saleor env remove x --force");
});
