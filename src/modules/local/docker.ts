import { spawn } from "node:child_process";
import { Context, Effect, Layer } from "effect";
import { type CliFailure, fail } from "../../core/errors.ts";

export interface DockerService {
  readonly run: (args: readonly string[]) => Effect.Effect<string, CliFailure>;
}

export class Docker extends Context.Service<Docker, DockerService>()(
  "saleor/Docker"
) {}

const PORT_CONFLICT =
  /port is already allocated|address already in use|ports are not available/i;

const dockerFailure = (
  args: readonly string[],
  stderr: string,
  code: number | null
) => {
  if (PORT_CONFLICT.test(stderr)) {
    return fail(
      "PORT_IN_USE",
      "A port assigned to this local instance is already in use.",
      {
        suggestion:
          "Stop the process using the port, then run the same command again.",
      }
    );
  }

  const pulling = args.includes("pull");

  return fail(
    pulling ? "IMAGE_PULL_FAILED" : "TASK_FAILED",
    `Docker ${pulling ? "could not download the images" : "command failed"}: ${stderr.trim() || `exit ${code}`}`,
    {
      details: { args, stderr },
      suggestion:
        "Check Docker and retry the same command. List instances with: saleor local list. Inspect containers with: saleor local status --name <name>",
    }
  );
};

const run = (args: readonly string[]) =>
  Effect.callback<string, CliFailure>((resume) => {
    const child = spawn("docker", [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-12_000);
    });
    child.on("error", (error) =>
      resume(
        Effect.fail(
          fail("DOCKER_MISSING", `Cannot start Docker: ${error.message}`, {
            suggestion:
              "Install Docker with Compose, then run this command again.",
          })
        )
      )
    );
    child.on("close", (code) => {
      if (code === 0) {
        resume(Effect.succeed(stdout));

        return;
      }

      resume(Effect.fail(dockerFailure(args, stderr, code)));
    });

    return Effect.sync(() => {
      child.kill("SIGTERM");
    });
  });

export const DockerLive = Layer.succeed(Docker, { run });

export const checkDocker = Effect.gen(function* () {
  const docker = yield* Docker;
  yield* docker.run(["version", "--format", "{{.Server.Version}}"]).pipe(
    Effect.catchTag("CliFailure", (error) =>
      error.code === "DOCKER_MISSING"
        ? Effect.fail(error)
        : Effect.fail(
            fail(
              "DOCKER_NOT_RUNNING",
              "Docker is installed but its engine is not responding.",
              {
                suggestion:
                  "Start Docker Desktop or your Docker engine, then try again.",
              }
            )
          )
    )
  );
  yield* docker.run(["compose", "version"]);
});
