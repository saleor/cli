import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";

// Biome owns general lint and formatting; this pass adds anti-slop only.
export default defineConfig({
  categories: { correctness: "off" },
  extends: [antiSlop],
  ignorePatterns: [
    ".context/**",
    "node_modules/**",
    "dist/**",
    "coverage/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    ...antiSlop.jsPlugins,
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  rules: {
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "oxc/no-accumulating-spread": "error",
  },
});
