import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { fail } from "./errors.ts";

// The project-folder link file: which remote resources this directory works against.
// It holds names and keys only, never secrets, and each module owns one section.
export const LINK_FILE = path.join(".saleor", "link.json");

export const findLinkFile = (
  cwd: string = process.cwd()
): string | undefined => {
  let dir = path.resolve(cwd);

  for (;;) {
    const candidate = path.join(dir, LINK_FILE);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      return undefined;
    }

    dir = parent;
  }
};

const parseLinkFile = (file: string) =>
  Effect.sync(() => readFileSync(file, "utf8")).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.JsonObject)),
    Effect.mapError(() =>
      fail("USAGE_ERROR", `Invalid project link file: ${file}.`)
    )
  );

export const readLinkSection = <A>(
  section: string,
  schema: Schema.Codec<A>,
  cwd?: string
) =>
  Effect.gen(function* () {
    const file = findLinkFile(cwd);

    if (file === undefined) {
      return { file: undefined, value: undefined };
    }

    const content = yield* parseLinkFile(file);

    const value =
      content[section] === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(schema)(content[section]).pipe(
            Effect.mapError(() =>
              fail("USAGE_ERROR", `Invalid ${section} context in ${file}.`)
            )
          );

    return { file, value };
  });

export const writeLinkSection = (
  section: string,
  value: Schema.Json,
  cwd: string = process.cwd()
) =>
  Effect.gen(function* () {
    const file = findLinkFile(cwd) ?? path.join(path.resolve(cwd), LINK_FILE);
    const content = existsSync(file) ? yield* parseLinkFile(file) : {};

    yield* Effect.sync(() => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        `${JSON.stringify({ ...content, [section]: value }, null, 2)}\n`
      );
    });

    return file;
  });
