import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests live beside source: src/*.test.ts
    // Integration tests live in: tests/*.test.ts
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
