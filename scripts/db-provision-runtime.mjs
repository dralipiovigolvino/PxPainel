// Habilita o login do papel de execução `app_runtime` (criado pela migração 0001)
// com uma senha aleatória nova e grava APP_DATABASE_URL em .env.local.
//
// - A senha é gerada aqui e NUNCA é impressa.
// - Vai ao Neon pela conexão TLS: o Neon repassa ALTER ROLE ao plano de controle e só
//   aceita senha em texto (recusa verificadores SCRAM pré-calculados).
// - Rodar de novo troca a senha (rotação).
//
// Uso: npm run db:provision-runtime

import { randomBytes } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { assertBranch, describeDbUrl } from "./lib/branch-guard.mjs";
import { requireEnv, setEnvVar } from "./lib/env-file.mjs";

requireEnv(["DATABASE_URL", "DATABASE_URL_UNPOOLED"]);
const branch = assertBranch("db:provision-runtime");
const ROLE = "app_runtime";

const password = randomBytes(32).toString("base64url");

const admin = new Client(process.env.DATABASE_URL_UNPOOLED);
await admin.connect();
console.log(`Branch: ${branch} | ${describeDbUrl(process.env.DATABASE_URL_UNPOOLED)}`);

const { rows } = await admin.query(
  "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolinherit from pg_roles where rolname = $1",
  [ROLE],
);
if (!rows[0]) {
  console.error(`O papel ${ROLE} não existe. Rode "npm run db:migrate" antes.`);
  process.exit(1);
}
if (Object.values(rows[0]).some(Boolean)) {
  console.error(`O papel ${ROLE} tem atributos elevados; corrija antes de habilitar o login.`);
  process.exit(1);
}
const memberships = await admin.query(
  "select g.rolname from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles r on r.oid = m.member where r.rolname = $1",
  [ROLE],
);
if (memberships.rows.length) {
  console.error(`O papel ${ROLE} é membro de outros papéis (${memberships.rows.map((r) => r.rolname).join(", ")}); revise antes.`);
  process.exit(1);
}

// base64url contém só [A-Za-z0-9_-]: seguro como literal (ALTER ROLE não aceita parâmetros).
await admin.query(`alter role ${ROLE} with login password '${password}'`);
await admin.end();

// A conexão do app usa o endpoint com pooler e os mesmos parâmetros (sslmode etc.).
const pooled = new URL(process.env.DATABASE_URL);
pooled.username = ROLE;
pooled.password = password;
setEnvVar("APP_DATABASE_URL", pooled.toString());

// Confirma que o login funciona e que o papel não ignora o RLS.
const check = new Client(pooled.toString());
await check.connect();
const me = (
  await check.query(
    "select current_user as role, rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = current_user",
  )
).rows[0];
await check.end();
console.log(`APP_DATABASE_URL gravada em .env.local (papel=${me.role}, superusuário=${me.super}, BYPASSRLS=${me.bypass}).`);
