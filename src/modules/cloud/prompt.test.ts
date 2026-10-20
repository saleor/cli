import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type PromptOperations, Prompts } from "../../core/interaction.ts";
import { CloudApi, type CloudApiService } from "./api/client.ts";
import samples from "./api/fixtures/cloud-samples.json" with { type: "json" };
import { ListProjectResponse } from "./api/generated.ts";
import { promptInitChoices } from "./prompt.ts";

const RANDOM_NAME = /^sandbox-[0-9a-f]{6}$/;

const project = Schema.decodeUnknownSync(ListProjectResponse)({
  ...samples.project,
  plan: samples.plans[0],
});

const environment = { ...samples.environment, project };

const api = (respond: (path: string) => Schema.Json): CloudApiService => {
  const call = (operation: Parameters<CloudApiService["call"]>[0]) =>
    operation.response === undefined
      ? Effect.void
      : Schema.decodeEffect(operation.response)(respond(operation.path)).pipe(
          Effect.orDie
        );

  // SAFETY: the adapter decodes each fixture through the operation's own response schema.
  return { call: call as CloudApiService["call"] };
};

// Answers are consumed in order; the prompt message is recorded for assertions.
const script = (answers: (string | boolean)[]) => {
  const asked: string[] = [];

  const next = async (message: string) => {
    asked.push(message);

    return await Promise.resolve(answers.shift() ?? "");
  };

  const prompts: PromptOperations = {
    confirm: async (options) => (await next(options.message)) === true,
    select: async (options) => String(await next(options.message)),
    text: async (options) => String(await next(options.message)),
  };

  return { asked, prompts };
};

const run = (
  answers: (string | boolean)[],
  input: Parameters<typeof promptInitChoices>[0]
) => {
  const { asked, prompts } = script(answers);

  const cloud = api((path) => {
    if (path.endsWith("/environments/")) {
      return [environment];
    }

    if (path.endsWith("/projects/")) {
      return [project];
    }

    if (path.endsWith("/regions/")) {
      return [
        { name: "us-east-1", root_domain: "a", services: "", url: "" },
        { name: "eu-west-1", root_domain: "b", services: "", url: "" },
      ];
    }

    throw new Error(`Unexpected request: ${path}`);
  });

  return {
    asked,
    outcome: Effect.runPromise(
      promptInitChoices(input).pipe(
        Effect.provideService(CloudApi, cloud),
        Effect.provideService(Prompts, prompts)
      )
    ),
  };
};

describe("interactive init choices", () => {
  it("reuses an existing project and sandbox without a confirmation, and records the answers as rerun flags", async () => {
    const { asked, outcome } = run([project.slug, environment.key], {
      env: Option.none(),
      organization: "acme",
      project: Option.none(),
      region: Option.none(),
    });

    expect(await outcome).toMatchObject({
      env: environment.name,
      project: project.slug,
      rerunFlags: ["--project", project.slug, "--env", environment.name],
    });

    expect(asked).toEqual(["Project", "Environment"]);
  });

  it("creates a project in a chosen region, asking only for what flags did not supply", async () => {
    const { asked, outcome } = run(["\0new", "my-store", "eu-west-1", true], {
      env: Option.some("dev"),
      organization: "acme",
      project: Option.none(),
      region: Option.none(),
    });

    expect(await outcome).toMatchObject({
      env: "dev",
      project: "my-store",
      region: Option.some("eu-west-1"),
      rerunFlags: ["--project", "my-store", "--region", "eu-west-1"],
    });

    expect(asked).toEqual(["Project", "Project name", "Region", "Continue?"]);
  });

  it("creates nothing when the summary is declined", async () => {
    const { outcome } = run(["\0new", "my-store", "us-east-1", "dev", false], {
      env: Option.none(),
      organization: "acme",
      project: Option.none(),
      region: Option.none(),
    });

    await expect(outcome).rejects.toMatchObject({
      message: expect.stringContaining("Cancelled"),
    });
  });

  it("generates an environment name when the answer is left blank", async () => {
    const { outcome } = run(["\0new", "my-store", "us-east-1", "", true], {
      env: Option.none(),
      organization: "acme",
      project: Option.none(),
      region: Option.none(),
    });

    const chosen = await outcome;
    expect(chosen.env).toMatch(RANDOM_NAME);
    expect(chosen.rerunFlags).toContain(chosen.env);
  });
});
