import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integração (Neon real) roda só com npm run test:int.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
