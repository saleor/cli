import { defineConfig } from "tsdown";

// Mirrors cf's `vp pack` setup (tsdown underneath): one ESM bundle for Node, minified,
// without source maps. Everything is bundled except packages that load their own files
// at runtime; those stay in `dependencies` and are installed alongside.
export default defineConfig({
  clean: true,
  deps: {
    // Loads a prebuilt native binary for the current platform.
    neverBundle: ["@napi-rs/keyring"],
    onlyBundle: false,
  },
  entry: { saleor: "src/cli.ts" },
  format: ["esm"],
  minify: true,
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  target: "node22.18",
});
