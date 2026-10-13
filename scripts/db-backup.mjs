// Backup lógico dos DADOS DO APP (public + app_private) da branch ligada, com a conexão do DONO.
//
// - Grava numa pasta FORA do repositório (obrigatório): um .json por tabela + manifest.json.
// - O manifesto traz versões/checksums das migrações, contagens, md5 do conteúdo e a impressão
//   digital da estrutura — nunca strings de conexão.
// - NÃO inclui neon_auth (usuários, senhas, sessões): é gerenciado pelo Neon Auth. Ver docs/backup.md.
// - Leitura numa única transação REPEATABLE READ (instantâneo consistente).
//
// Uso: npm run db:backup -- --out <pasta fora do repositório>
//      (outra branch: DB_ALLOW_BRANCH=<nome> com NEON_BRANCH/DATABASE_URL_UNPOOLED dessa branch)

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { assertBranch, describeDbUrl } from "./lib/branch-guard.mjs";
import { requireEnv } from "./lib/env-file.mjs";
import { appTables, dataDigests, exportTable, fileHash, normalizeSession, structureFingerprint } from "./lib/db-snapshot.mjs";

/** Exporta para `outDir` e devolve o manifesto. `client` já conectado com o dono. */
export async function runBackup(client, outDir, { branch, log = console.log } = {}) {
  const repo = resolve(process.cwd());
  const target = resolve(outDir);
  const rel = relative(repo, target);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("A pasta do backup precisa ficar FORA do repositório.");
  mkdirSync(target, { recursive: true });
  if (readdirSync(target).length) throw new Error("A pasta do backup precisa estar vazia.");

  await client.query("begin isolation level repeatable read read only");
  try {
    await normalizeSession(client);
    const tables = await appTables(client);
    const digests = await dataDigests(client, tables);
    const structure = await structureFingerprint(client);
    const migrations = (await client.query("select version, checksum from app_private.schema_migrations order by version")).rows;
    const server = (await client.query("select current_setting('server_version') as v")).rows[0].v;
    const files = [];
    for (const t of tables) {
      const name = `${t.schema}.${t.table}`;
      const json = await exportTable(client, t);
      writeFileSync(join(target, `${name}.json`), json, "utf8");
      files.push({ ...t, file: `${name}.json`, sha256: fileHash(json), ...digests[name] });
      log(`exportada  ${name} (${digests[name].rows} linha(s))`);
    }
    await client.query("commit");
    const manifest = {
      format: 1,
      createdAt: new Date().toISOString(),
      source: { branch: branch ?? null, server },
      scope: "dados do app: schemas public e app_private (sem neon_auth)",
      migrations,
      tables: files,
      structure: Object.fromEntries(Object.entries(structure).map(([k, v]) => [k, { hash: v.hash, count: v.count, lines: v.lines }])),
    };
    writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireEnv(["DATABASE_URL_UNPOOLED"]);
  const branch = assertBranch("db:backup");
  const i = process.argv.indexOf("--out");
  const out = i > 0 ? process.argv[i + 1] : null;
  if (!out) {
    console.error("Informe --out <pasta vazia fora do repositório>.");
    process.exit(2);
  }
  const client = new Client(process.env.DATABASE_URL_UNPOOLED);
  await client.connect();
  console.log(`Branch: ${branch} | ${describeDbUrl(process.env.DATABASE_URL_UNPOOLED)}`);
  try {
    const m = await runBackup(client, out, { branch });
    const total = m.tables.reduce((s, t) => s + t.rows, 0);
    console.log(`Backup concluído: ${m.tables.length} tabela(s), ${total} linha(s), migrações até ${m.migrations.at(-1)?.version ?? "-"}.`);
    console.log("Guarde a pasta em local protegido: ela contém dados pessoais. Não a coloque no repositório.");
  } catch (error) {
    console.error(`Backup falhou: ${error.code ?? ""} ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
