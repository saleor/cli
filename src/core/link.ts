import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
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
    Effect.flatMap((content) =>
      content.version === undefined ||
      content.version === 1 ||
      content.version === 2
        ? Effect.succeed(content)
        : Effect.fail(
            fail(
              "USAGE_ERROR",
              `Unsupported link file version in ${file}. Upgrade the CLI or recreate the link.`
            )
          )
    ),
    Effect.mapError(() =>
      fail(
        "USAGE_ERROR",
        `${file} is not a supported link file. Expected a JSON object with version 1 or 2.`,
        {
          suggestion:
            "Fix or delete the file, then link the directory again with: saleor link",
        }
      )
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
              fail(
                "USAGE_ERROR",
                `The "${section}" section of ${file} is not valid.`,
                {
                  suggestion:
                    "Fix or delete the file, then link the directory again with: saleor link",
                }
              )
            )
          );

    return { file, value };
  });

interface LinkDocument {
  [key: string]: Schema.Json;
}

export const writeLinkSections = (
  sections: Readonly<Record<string, Schema.Json | undefined>>,
  cwd: string = process.cwd()
) =>
  Effect.gen(function* () {
    const file = findLinkFile(cwd) ?? path.join(path.resolve(cwd), LINK_FILE);
    const content = existsSync(file) ? yield* parseLinkFile(file) : {};
    const updated: LinkDocument = { ...content, version: 2 };

    for (const [key, value] of Object.entries(sections)) {
      if (value === undefined) {
        delete updated[key];
      } else {
        updated[key] = value;
      }
    }

    yield* Effect.try({
      catch: () =>
        fail("TASK_FAILED", `Could not save the directory link in ${file}.`),
      try: () => {
        mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, `${JSON.stringify(updated, null, 2)}\n`);
        renameSync(temp, file);
      },
    });

    return file;
  });

export const writeLinkSection = (
  section: string,
  value: Schema.Json,
  cwd?: string
) => writeLinkSections({ [section]: value }, cwd);
