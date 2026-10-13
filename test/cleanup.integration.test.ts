import { expect, it } from "vitest";
import { cleanupTestResidue } from "./cleanup-test-data";

// Executado só quando pedido: CLEANUP_TEST_RESIDUE=1 npm run test:int -- test/cleanup.integration.test.ts
it.runIf(process.env.CLEANUP_TEST_RESIDUE === "1")("remove resíduos de testes das contas fictícias", async () => {
  const n = await cleanupTestResidue();
  expect(n).toBeGreaterThanOrEqual(0);
});
