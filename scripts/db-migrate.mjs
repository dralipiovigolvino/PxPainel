// Aplica as migrações de db/migrations em ordem, uma transação por arquivo.
// Usa a conexão do DONO do banco (DATABASE_URL_UNPOOLED, gravada pelo `neon link`),
// nunca a do app. Só roda na branch permitida (padrão: development).
//
// Uso: npm run db:migrate            (aplica pendentes)
//      npm run db:migrate -- --status (só lista)

import { Client } from "@neondatabase/serverless";
import { assertBranch, describeDbUrl } from "./lib/branch-guard.mjs";
import { requireEnv } from "./lib/env-file.mjs";
import { applyMigrations } from "./lib/migrations.mjs";

requireEnv(["DATABASE_URL_UNPOOLED"]);
const branch = assertBranch("db:migrate");
const statusOnly = process.argv.includes("--status");

const client = new Client(process.env.DATABASE_URL_UNPOOLED);
await client.connect();
console.log(`Branch: ${branch} | ${describeDbUrl(process.env.DATABASE_URL_UNPOOLED)}`);

const result = await applyMigrations(client, { statusOnly });
if (result.failed) {
  console.error(`ERRO/FALHOU: ${result.failed}`);
  process.exitCode = 1;
} else if (!result.pending) console.log("Nenhuma migração pendente.");
await client.end();
