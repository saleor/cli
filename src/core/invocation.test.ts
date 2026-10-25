import { Effect } from "effect";
import { expect, it } from "vitest";
import {
  ActionContext,
  type Answer,
  command,
  Invocation,
  rerunCommand,
} from "./invocation.ts";

const rerun = (
  argv: readonly string[],
  answers: Answer[],
  options: Parameters<typeof rerunCommand>[0] = {}
) =>
  Effect.runPromise(
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
  expect(command("env", "delete", "<env>")).toBe("saleor env delete <env>");
});

it("adds answers given at prompts, options before the marker", async () => {
  expect(
    await rerun(
      ["env", "delete", "--"],
      [{ option: ["--org", "acme"] }, { positional: "dev" }],
      { add: ["--force"] }
    )
  ).toBe("saleor env delete --org acme --force -- dev");
});

it("protects a flag-shaped positional answer with a marker", async () => {
  expect(await rerun(["env", "delete"], [{ positional: "-dev" }])).toBe(
    "saleor env delete -- -dev"
  );
});

it("drops a zero wait budget when resuming, but not a flag-shaped name", async () => {
  expect(
    await rerun(["env", "delete", "--timeout", "0", "--", "--timeout=0"], [], {
      resume: true,
    })
  ).toBe("saleor env delete -- --timeout=0");
});

it("does not repeat a flag that is already there", async () => {
  expect(
    await rerun(["env", "delete", "x", "--force"], [], { add: ["--force"] })
  ).toBe("saleor env delete x --force");
});
