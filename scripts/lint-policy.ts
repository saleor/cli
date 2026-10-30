// Prove the effective Oxlint configuration rejects regressions, not just today's code.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";

const probes = [
  {
    rule: "sonarjs(cognitive-complexity)",
    code: `export const choose = (x: number) => { ${Array.from({ length: 16 }, (_, i) => `if (x === ${i}) return ${i};`).join("\n")} return -1; };`,
  },
  {
    rule: "eslint(complexity)",
    code: `export const choose = (x: number) => { ${Array.from({ length: 21 }, (_, i) => `if (x === ${i}) return ${i};`).join("\n")} return -1; };`,
  },
  {
    rule: "eslint(max-depth)",
    code: "export const nested = (x: number[]) => { for (const a of x) { if (a) { for (const b of x) { if (b) { console.log(a, b); } } } } };",
  },
  {
    rule: "eslint(max-params)",
    code: "export const sum = (a: number, b: number, c: number, d: number) => a + b + c + d;",
  },
  {
    rule: "eslint(max-lines)",
    code: Array.from(
      { length: 501 },
      (_, i) => `export const value${i} = ${i};`
    ).join("\n"),
  },
  {
    rule: "eslint(max-lines-per-function)",
    code: `export const long = () => {\n${"console.log('line');\n".repeat(101)}};`,
  },
  {
    rule: "eslint(max-classes-per-file)",
    code: "export class First {}\nexport class Second {}",
  },
  {
    rule: "typescript(no-floating-promises)",
    code: "void Promise.resolve(1);",
  },
  {
    rule: "typescript(no-misused-promises)",
    code: "[1].forEach(async (item) => { await Promise.resolve(item); });",
  },
  {
    rule: "typescript(await-thenable)",
    code: "export const value = await 42;",
  },
  {
    rule: "typescript(no-unsafe-type-assertion)",
    code: "declare const value: unknown;\nexport const text = value as string;",
  },
  {
    rule: "typescript(no-unsafe-assignment)",
    code: "declare const value: any;\nexport const count: number = value;",
  },
  {
    rule: "vitest(no-focused-tests)",
    test: true,
    code: 'import { it } from "vitest";\nit.only("focused", () => {});',
  },
  {
    rule: "vitest(no-disabled-tests)",
    test: true,
    code: 'import { it } from "vitest";\nit.skip("skipped", () => {});',
  },
  {
    rule: "vitest(prefer-strict-equal)",
    test: true,
    code: 'import { expect, it } from "vitest";\nit("loose", () => { expect({}).toEqual({}); });',
  },
];

const output = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      filename: Schema.String,
      code: Schema.optionalKey(Schema.String),
    })
  ),
});

const directory = mkdtempSync(path.resolve("src/.lint-policy-"));

try {
  const files = probes.map((probe, index) => {
    const file = path.join(
      directory,
      `probe-${index}${probe.test ? ".test" : ""}.ts`
    );

    writeFileSync(file, probe.code);

    return file;
  });

  const result = spawnSync(
    "pnpm",
    ["exec", "oxlint", "--type-aware", "--format", "json", ...files],
    { encoding: "utf-8", timeout: 30_000 }
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = Schema.decodeUnknownSync(output)(JSON.parse(result.stdout));

  for (const [index, probe] of probes.entries()) {
    assert.ok(
      report.diagnostics.some(
        (diagnostic) =>
          path.resolve(diagnostic.filename) === files[index] &&
          diagnostic.code === probe.rule
      ),
      `Policy did not reject ${probe.rule}`
    );
  }

  console.log(`All ${probes.length} lint policy probes passed.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
