import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  // Match Next.js's automatic JSX runtime so component (.tsx) files render in
  // tests without an explicit `import React` (they don't carry one).
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
