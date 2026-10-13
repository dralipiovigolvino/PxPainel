// Limpeza manual de resíduos de testes: SOMENTE áreas com prefixo "[teste-" das contas fictícias A e B.
// Uso: npx vite-node test/cleanup-test-data.ts   (ou pelo Vitest de integração)
import { Pool } from "@neondatabase/serverless";
import { cleanupAreas } from "./integration-helpers";

export async function cleanupTestResidue(): Promise<number> {
  const ids = [process.env.RLS_TEST_A_ID, process.env.RLS_TEST_B_ID].filter(Boolean) as string[];
  if (ids.length !== 2) throw new Error("RLS_TEST_A_ID/B_ID ausentes");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  try {
    const { rows } = await pool.query<{ id: string }>("select id from public.fin_areas where user_id = any($1::uuid[]) and name like '[teste-%'", [ids]);
    await cleanupAreas(rows.map((r) => r.id));
    return rows.length;
  } finally {
    await pool.end();
  }
}
