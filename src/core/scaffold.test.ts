import { Effect, Predicate } from "effect";
import { FetchHttpClient } from "effect/http";
import { createTar, createTarGzip } from "nanotar";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { create } from "tar";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  directoryState,
  downloadTemplate,
  template,
  templateSource,
} from "./scaffold.ts";

let dir: string;
let server: Server;
let archive: Uint8Array | undefined;
let url: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "saleor-scaffold-test-"));
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  server = createServer((_req, res) => {
    res.writeHead(archive === undefined ? 404 : 200);
    res.end(archive === undefined ? undefined : Buffer.from(archive));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();

  if (address === null || Predicate.isString(address)) {
    throw new Error("Expected TCP address");
  }

  url = `http://127.0.0.1:${address.port}/template.tar.gz`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  rmSync(dir, { force: true, recursive: true });
});

const download = (into: string) =>
  downloadTemplate(template("saleor/storefront", "main", url), into).pipe(
    Effect.provide(FetchHttpClient.layer)
  );

it("unpacks the template without its top folder, keeping executable files", async () => {
  archive = await createTarGzip([
    { name: "storefront-main/" },
    { data: "{}", name: "storefront-main/package.json" },
    {
      attrs: { mode: "755" },
      data: "#!/bin/sh",
      name: "storefront-main/scripts/run.sh",
    },
  ]);

  const into = path.join(dir, "shop");
  await Effect.runPromise(download(into));

  expect(readFileSync(path.join(into, "package.json"), "utf-8")).toBe("{}");
  expect(statSync(path.join(into, "scripts/run.sh")).mode % 0o1000).toBe(0o755);
  // Nothing is left next to it.
  expect(readdirSync(dir)).toStrictEqual(["shop"]);
});

it("keeps paths longer than a tar header's name field, as GitHub archives them", async () => {
  // GitHub stores paths over 100 characters in the ustar prefix field.
  const source = path.join(dir, "source");
  const deep = `storefront-main/${"nested-directory/".repeat(8)}file.md`;
  mkdirSync(path.dirname(path.join(source, deep)), { recursive: true });
  writeFileSync(path.join(source, deep), "deep");
  // oxlint-disable-next-line unicorn/prefer-spread -- tar returns a stream whose concat method collects its bytes.
  archive = await create({ cwd: source, gzip: true, portable: true }, [
    "storefront-main",
  ]).concat();

  const into = path.join(dir, "shop");
  await Effect.runPromise(download(into));

  expect(
    readFileSync(
      path.join(into, deep.slice("storefront-main/".length)),
      "utf-8"
    )
  ).toBe("deep");
});

it("never writes outside the template, whatever an entry's path says", async () => {
  archive = await createTarGzip([
    { data: "{}", name: "storefront-main/package.json" },
    { data: "x", name: "storefront-main/../../escaped" },
    { data: "x", name: "/escaped-absolute" },
  ]);

  const into = path.join(dir, "shop");
  const failure = await Effect.runPromise(Effect.flip(download(into)));

  expect(failure.code).toBe("TEMPLATE_FAILED");
  expect(readdirSync(dir)).toStrictEqual([]);
  expect(existsSync(path.join(path.dirname(dir), "escaped"))).toBe(false);
});

it("reports a download the server refuses", async () => {
  archive = undefined;

  const failure = await Effect.runPromise(
    Effect.flip(download(path.join(dir, "shop")))
  );

  expect(failure.code).toBe("TEMPLATE_FAILED");
  expect(failure.message).toContain("404");
  expect(directoryState(path.join(dir, "shop"))).toBe("absent");
});

// A pax global header as `git archive` (and so GitHub) writes one: the commit, as a
// "comment" record, before the files.
const globalHeader = (commit: string) => {
  const record = `52 comment=${commit}\n`;
  const header = Buffer.alloc(512);
  header.write("pax_global_header", 0);
  header.write("0000666\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${record.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header.write("g", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);

  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);

  const body = Buffer.alloc(512);
  body.write(record, 0);

  return Buffer.concat([header, body]);
};

it("says which commit the template was downloaded at, when the archive does", async () => {
  const commit = "a6e357a575c6e694e1aa5e5def4a1783dd223117";

  const files = createTar([
    { data: "{}", name: "storefront-main/package.json" },
  ]);

  archive = gzipSync(Buffer.concat([globalHeader(commit), files]));

  const into = path.join(dir, "shop");
  const downloaded = await Effect.runPromise(download(into));

  expect(downloaded).toStrictEqual({ commit });
  expect(readFileSync(path.join(into, "package.json"), "utf-8")).toBe("{}");
  expect(
    templateSource(template("saleor/storefront", "main", url), downloaded)
  ).toBe(`saleor/storefront@${commit}`);

  // An archive that does not say is recorded by its branch.
  archive = await createTarGzip([
    { data: "{}", name: "storefront-main/package.json" },
  ]);

  const unknown = await Effect.runPromise(download(path.join(dir, "other")));

  expect(unknown).toStrictEqual({ commit: undefined });
  expect(
    templateSource(template("saleor/storefront", "main", url), unknown)
  ).toBe("saleor/storefront (main)");
});
