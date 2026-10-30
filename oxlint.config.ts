import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import antiSlop from "ultracite/oxlint/anti-slop";

// General policy plus the existing Effect and anti-slop checks.
export default defineConfig({
  env: { browser: false, node: true },
  extends: [core, antiSlop],
  ignorePatterns: [
    ...core.ignorePatterns,
    ".context/**",
    "node_modules/**",
    "dist/**",
    "coverage/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    ...antiSlop.jsPlugins,
    { name: "sonarjs", specifier: "eslint-plugin-sonarjs" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  overrides: [
    ...core.overrides,
    {
      // Fixtures intentionally model invalid inputs; spies are inspected, not called unbound.
      files: ["**/*.test.ts"],
      rules: {
        "typescript/no-explicit-any": "off",
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-argument": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/unbound-method": "off",
        "vitest/valid-expect": ["error", { maxArgs: 2 }],
        "vitest/no-conditional-expect": "off",
        "vitest/no-standalone-expect": "off",
        "vitest/require-mock-type-parameters": "off",
        "max-lines": "off",
        "max-lines-per-function": "off",
        "max-depth": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "vitest/no-focused-tests": "error",
        "vitest/no-disabled-tests": "error",
        "vitest/prefer-strict-equal": "error",
      },
      plugins: ["vitest"],
    },
    { files: ["*.config.ts"], rules: { "import/no-default-export": "off" } },
  ],
  rules: {
    // Keep existing declaration, regex and expression styles during the engine migration.
    "eslint/func-names": "off",
    "eslint/no-shadow": "off",
    "eslint/no-use-before-define": "off",
    "eslint/prefer-named-capture-group": "off",
    "eslint/require-unicode-regexp": "off",
    "eslint/require-await": "off",
    "eslint/sort-keys": "off",
    // Effect.map/flatMap are dual APIs, not Array methods with a thisArg.
    "unicorn/no-array-method-this-argument": "off",
    "unicorn/consistent-function-scoping": "off",
    "unicorn/no-await-expression-member": "off",
    "unicorn/prefer-ternary": "off",
    "unicorn/no-array-sort": "off",
    // Node callback APIs need Promise adapters; async safety is enforced below.
    "promise/avoid-new": "off",
    "promise/prefer-await-to-callbacks": "off",
    "node/callback-return": "off",
    "typescript/strict-boolean-expressions": "off",
    // Effect generators return through yield* failures, and JSON values include readonly arrays.
    "typescript/consistent-return": "off",
    "typescript/no-misused-spread": "off",
    "typescript/no-invalid-void-type": "off",
    "typescript/strict-void-return": "off",

    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    // Effect overloads require explicit undefined; schema constants intentionally share type names.
    "unicorn/no-useless-undefined": "off",
    "no-redeclare": "off",
    "import/consistent-type-specifier-style": "off",
    // Type-aware exhaustiveness replaces redundant default branches.
    "default-case": "off",
    "typescript/consistent-type-imports": [
      "error",
      {
        prefer: "type-imports",
        fixStyle: "inline-type-imports",
        disallowTypeAnnotations: false,
      },
    ],
    complexity: ["error", 20],
    "import/no-default-export": "error",
    "max-depth": ["error", 3],
    "max-lines": [
      "error",
      { max: 500, skipBlankLines: true, skipComments: true },
    ],
    "max-lines-per-function": [
      "error",
      { max: 100, skipBlankLines: true, skipComments: true },
    ],
    "max-params": ["error", 3],
    "oxc/no-accumulating-spread": "error",
    "sonarjs/cognitive-complexity": ["error", 15],
    "typescript/await-thenable": "error",
    "typescript/no-floating-promises": ["error", { ignoreVoid: false }],
    "typescript/no-misused-promises": "error",
    "typescript/no-unnecessary-type-parameters": "error",
    "typescript/no-unsafe-type-assertion": "error",
  },
});
