import { Effect, Option } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fail } from "./errors.ts";
import { configPath, nameFirstStore, projectAt } from "./project.ts";
import type { Store } from "./store.ts";

// What `init` writes into a project folder besides naming its store: an empty
// configuration to start from, guides for coding agents, and a .gitignore that keeps
// secrets and packages out of git. Nothing that is there already is overwritten.

const AGENTS_GUIDE =
  "# Saleor project\n\nsaleor.yml defines environments and lists the project's components (a storefront, apps) with their paths; config.yml describes store configuration.\nEach component keeps its own packages, scripts and lockfile.\nCommands name an environment as the word after the command: saleor env start local, saleor config deploy staging.\nRun saleor env list to see every environment and its state.\nBefore changing a store, inspect saleor config diff <env>.\nKeep credentials in the CLI secret store or ignored environment files.\nUse saleor --help for workflows and follow component-specific instructions when editing a component.\n";

const GUIDES = {
  "AGENTS.md": AGENTS_GUIDE,
  "CLAUDE.md": "@AGENTS.md\n",
};

const IGNORED = [".env", ".env.local", "node_modules/"];

const writeMissing = (file: string, content: string) => {
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
};

const ignoreSecrets = (root: string) => {
  const ignore = path.join(root, ".gitignore");
  const current = existsSync(ignore) ? readFileSync(ignore, "utf-8") : "";
  const lines = current.split("\n");
  const missing = IGNORED.filter((line) => !lines.includes(line));

  if (missing.length > 0) {
    const separator = current.endsWith("\n") || !current ? "" : "\n";
    writeFileSync(ignore, `${current}${separator}${missing.join("\n")}\n`);
  }
};

export const initializeProject = (
  root: string,
  name: string,
  store: Pick<Store, "kind" | "name" | "ref" | "saleorVersion">
) =>
  Effect.gen(function* () {
    yield* nameFirstStore(root, name, store);
    yield* Effect.try({
      catch: () =>
        fail("LOCAL_STATE_ERROR", `Could not initialize project at ${root}.`),
      try: () => {
        const project = projectAt(root);

        if (Option.isSome(project)) {
          writeMissing(configPath(project.value), "{}\n");
        }

        for (const [file, content] of Object.entries(GUIDES)) {
          writeMissing(path.join(root, file), content);
        }

        ignoreSecrets(root);
      },
    });
  });
