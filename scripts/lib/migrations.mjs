// Migrações de db/migrations: leitura (versão + checksum) e aplicação em ordem, uma transação por arquivo.
// Usado por db:migrate (branch ligada) e pela restauração (banco de destino descartável).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readMigrations(dir = join(process.cwd(), "db", "migrations")) {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(join(dir, file), "utf8");
      return { file, version: file.replace(/\.sql$/, ""), sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

export async function ensureMigrationsTable(client) {
  await client.query(`
    create schema if not exists app_private;
    revoke all on schema app_private from public;
    create table if not exists app_private.schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    );
    revoke all on table app_private.schema_migrations from public;
  `);
}

/**
 * Aplica as pendentes. Retorna { applied, pending, failed }. Uma migração alterada depois de aplicada
 * (checksum diferente) interrompe tudo.
 */
export async function applyMigrations(client, { statusOnly = false, log = console.log, until = null } = {}) {
  await ensureMigrationsTable(client);
  const applied = new Map((await client.query("select version, checksum from app_private.schema_migrations")).rows.map((r) => [r.version, r.checksum]));
  const result = { applied: [], pending: 0, failed: null };
  for (const m of readMigrations()) {
    if (until && m.version > until) break;
    if (applied.has(m.version)) {
      if (applied.get(m.version) !== m.checksum) {
        result.failed = `${m.file} foi alterado depois de aplicado. Crie uma nova migração em vez de editar.`;
        return result;
      }
      log(`aplicada   ${m.file}`);
      continue;
    }
    result.pending++;
    if (statusOnly) {
      log(`pendente   ${m.file}`);
      continue;
    }
    try {
      await client.query("begin");
      await client.query(m.sql);
      await client.query("insert into app_private.schema_migrations (version, checksum) values ($1, $2)", [m.version, m.checksum]);
      await client.query("commit");
      result.applied.push(m.version);
      log(`APLICADA   ${m.file}`);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      result.failed = `${m.file}: ${error.code ?? ""} ${error.message}`;
      return result;
    }
  }
  return result;
}
