import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Testes de integração: executam o código REAL do servidor (camada de dados) contra o Neon
// de desenvolvimento com o papel app_runtime. Exigem .env.local (APP_DATABASE_URL, RLS_TEST_*).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" impede importação fora do servidor do Next; aqui o teste É o servidor.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts", "test/**/*.integration.test.ts"],
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
