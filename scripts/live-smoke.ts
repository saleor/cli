// Read-only by default: lists the environments of --org. With --project <slug> and
// --allow-create-delete, it also creates a sandbox in that project and deletes it.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";

const exec = promisify(execFile);
const executable = path.resolve(import.meta.dirname, "../bin/saleor.mjs");
const smokeArgs = process.argv.slice(2);

const flagValue = (flag: string) => {
  const index = smokeArgs.indexOf(flag);

  return index === -1 ? undefined : smokeArgs[index + 1];
};

const organization = flagValue("--org");
const project = flagValue("--project");
const writes = smokeArgs.includes("--allow-create-delete");

if (!organization) {
  throw new Error("Pass --org <slug>.");
}

if (writes && !project) {
  throw new Error("Pass --project <slug> for live writes.");
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

await run(["env", "list", "--org", organization]);

console.log("PASS: production authentication and environment discovery");

if (writes && project) {
  const name = `cli-poc-${Date.now().toString(36)}`;
  const context = ["--org", organization, "--project", project];

  // Removes whatever this run created, even when it failed half-way, and reports both
  // the test failure and a cleanup failure instead of letting one hide the other.
  const cleanup = async () => {
    await run(["env", "delete", name, ...context, "--force"]);

    const again = await run(["env", "delete", name, ...context, "--force"]);

    if (again.data.action !== "none" || again.data.existed !== false) {
      throw new Error("Deleting an absent environment should be a no-op.");
    }

    console.log(`PASS: removed test environment ${name}`);
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

    if (!ready.data.ready || ready.data.projectCreated || ready.data.created) {
      throw new Error("Expected reuse of the environment on rerun.");
    }

    console.log(
      "PASS: rerun reuses the environment and verifies GraphQL readiness"
    );

    const listed = await run(["env", "list", ...context]);

    if (
      !listed.data.some((env: { key: string }) => env.key === ready.data.key)
    ) {
      throw new Error("The new environment is not listed.");
    }
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
