import "server-only";

import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import { getServerConfig } from "@/lib/server-config";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Banco de dados não configurado");
    this.name = "DatabaseNotConfiguredError";
  }
}

export class UnsafeDatabaseRoleError extends Error {
  constructor() {
    super("A conexão do app usa um papel com privilégios elevados (BYPASSRLS/superusuário)");
    this.name = "UnsafeDatabaseRoleError";
  }
}

// Um pool por processo (reaproveitado entre recargas do next dev).
const globalForDb = globalThis as unknown as { appDbPool?: Pool; appDbRoleChecked?: Promise<void> };

function getPool(): Pool {
  if (globalForDb.appDbPool) return globalForDb.appDbPool;
  const config = getServerConfig();
  if (!config) throw new DatabaseNotConfiguredError();
  globalForDb.appDbPool = new Pool({ connectionString: config.databaseUrl, max: 5 });
  return globalForDb.appDbPool;
}

/** Recusa operar se a conexão do app puder ignorar o RLS. Verificado uma vez por processo. */
async function assertRuntimeRole(client: PoolClient): Promise<void> {
  globalForDb.appDbRoleChecked ??= client
    .query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    )
    .then(({ rows }) => {
      if (!rows[0] || rows[0].rolsuper || rows[0].rolbypassrls) throw new UnsafeDatabaseRoleError();
    })
    .catch((error) => {
      globalForDb.appDbRoleChecked = undefined;
      throw error;
    });
  return globalForDb.appDbRoleChecked;
}

/**
 * Executa `fn` numa transação cujo contexto de RLS é o usuário autenticado.
 *
 * - O id vem de requireUser()/requireFreshUser(), nunca do cliente.
 * - set_config(..., true) vale só para esta transação: ao terminar (commit ou
 *   rollback) o valor some, e a conexão volta ao pool sem contexto.
 * - Contexto e consultas usam a mesma conexão e a mesma transação.
 */
export async function withUserContext<T>(user: AuthUser, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await assertRuntimeRole(client);
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [user.id]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
