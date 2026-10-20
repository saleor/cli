// Read-only by default. Writes require a named organization and --allow-create-delete.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";

const exec = promisify(execFile);
const executable = path.resolve(import.meta.dirname, "../bin/saleor.mjs");
const smokeArgs = process.argv.slice(2);
const orgIndex = smokeArgs.indexOf("--org");
const organization = orgIndex === -1 ? undefined : smokeArgs[orgIndex + 1];
const writes = smokeArgs.includes("--allow-create-delete");

if (writes && !organization) {
  throw new Error("Pass --org <slug> for live writes.");
}

const run = async (args: string[], allowedCodes = [0]) => {
  let stdout: string;
  let code = 0;

  try {
    ({ stdout } = await exec(
      process.execPath,
      [executable, ...args, "--json"],
      { env: process.env, timeout: 720_000 }
    ));
  } catch (error) {
    const failure = Schema.decodeUnknownSync(
      Schema.Struct({ code: Schema.Finite, stdout: Schema.String })
    )(error);

    ({ code, stdout } = failure);
  }

  const output = JSON.parse(stdout);

  if (!allowedCodes.includes(code)) {
    throw new Error(`${args.slice(0, 2).join(" ")}: ${JSON.stringify(output)}`);
  }

  return output;
};

await run(["whoami"]);

await run(["org", "list"]);

console.log("PASS: production authentication and organization discovery");

if (organization) {
  await run(["project", "list", "--org", organization]);
  await run(["env", "list", "--org", organization]);
  console.log("PASS: project and environment discovery");
}

if (writes && organization) {
  const name = `cli-poc-${Date.now().toString(36)}`;
  const context = ["--org", organization, "--project", name];

  // Removes whatever this run created, even when it failed half-way, and reports both
  // the test failure and a cleanup failure instead of letting one hide the other.
  const cleanup = async () => {
    const projects = await run(["project", "list", "--org", organization]);

    const created = projects.data.some(
      (project: { name: string }) => project.name === name
    );

    if (created) {
      await run(["env", "delete", name, ...context, "--force"]);
      await run(["project", "delete", name, "--org", organization, "--force"]);
    }

    const remaining = await run(["project", "list", "--org", organization]);

    if (
      remaining.data.some((project: { name: string }) => project.name === name)
    ) {
      throw new Error("Project still present after cleanup.");
    }

    const again = await run([
      "env",
      "delete",
      name,
      "--org",
      organization,
      "--force",
    ]);

    if (again.data.deleted !== false) {
      throw new Error("Deleting an absent environment should be a no-op.");
    }

    console.log(`PASS: removed test environment and project ${name}`);
  };

  let failure: unknown;

  try {
    const initial = await run(
      ["init", ...context, "--env", name, "--timeout", "0"],
      [0, 75]
    );

    console.log(
      `PASS: initial provisioning (${initial.ok ? "ready" : initial.error.code}) for ${name}`
    );
    const ready = await run(["init", ...context, "--env", name]);

    if (
      !ready.data.environment.ready ||
      ready.data.project.created ||
      ready.data.environment.created
    ) {
      throw new Error("Expected reuse of both resources on rerun.");
    }

    console.log(
      "PASS: rerun reuses project/environment and verifies GraphQL readiness"
    );
    await run(["env", "get", ready.data.environment.key, ...context]);
  } catch (error) {
    failure = error;
  }

  try {
    await cleanup();
  } catch (error) {
    throw failure === undefined
      ? error
      : new AggregateError([failure, error], "Smoke test and cleanup failed");
  }

  if (failure !== undefined) {
    throw failure;
  }
}
