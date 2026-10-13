// Verificação de isolamento (RLS) de user_preferences no Neon REAL, usando o PAPEL DE
// EXECUÇÃO do app (APP_DATABASE_URL), com o mesmo mecanismo de contexto do servidor:
//   begin; select set_config('app.user_id', <id>, true); ...; commit
//
// Identidades: RLS_TEST_A_ID / RLS_TEST_B_ID (ids reais do Neon Auth), se definidos;
// senão, dois UUIDs aleatórios. O dono do banco (DATABASE_URL_UNPOOLED) só é usado no
// final para remover as linhas de teste com ids aleatórios.
//
// Uso: npm run test:rls
//
// Datas relativas usam o dia civil de São Paulo, como as regras do banco: current_date (UTC na sessão)
// já é "amanhã" entre 21h e 24h e faria consultas e recebimentos de hoje parecerem futuros.

import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { assertBranch, describeDbUrl } from "./lib/branch-guard.mjs";
import { requireEnv } from "./lib/env-file.mjs";

requireEnv(["APP_DATABASE_URL"]);
const branch = assertBranch("test:rls");
const realIds = Boolean(process.env.RLS_TEST_A_ID && process.env.RLS_TEST_B_ID);
const A = (process.env.RLS_TEST_A_ID ?? randomUUID()).toLowerCase();
const B = (process.env.RLS_TEST_B_ID ?? randomUUID()).toLowerCase();

console.log(`Branch: ${branch} | ${describeDbUrl(process.env.APP_DATABASE_URL)}`);
console.log(`Identidades: ${realIds ? "ids reais do Neon Auth (RLS_TEST_A_ID/B_ID)" : "UUIDs aleatórios"}\n`);

const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
let failures = 0;
function check(description, passed, detail = "") {
  if (!passed) failures++;
  console.log(`${passed ? "PASSOU" : "FALHOU"}  ${description}${!passed && detail ? ` (${detail})` : ""}`);
}

/** Mesma sequência do servidor (src/lib/db/user-context.ts). */
async function asUser(id, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (id) await client.query("select set_config('app.user_id', $1, true)", [id]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    return { error: error.code ?? error.message };
  } finally {
    client.release();
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, params) => async (c) => {
  const r = await c.query(sql, params);
  return { rows: r.rows, count: r.rowCount };
};

// Papel de execução
{
  const r = await asUser(null, q("select current_user as u, rolsuper, rolbypassrls from pg_roles where rolname = current_user"));
  check("conexão do app usa app_runtime sem superusuário/BYPASSRLS", r.rows?.[0]?.u === "app_runtime" && !r.rows[0].rolsuper && !r.rows[0].rolbypassrls, JSON.stringify(r));
}

// Visitante / sem contexto
{
  const read = await asUser(null, q("select user_id from public.user_preferences"));
  check("sem contexto (visitante) não lê registros", read.rows?.length === 0, JSON.stringify(read));
  const insert = await asUser(null, q("insert into public.user_preferences (user_id) values ($1)", [A]));
  check("sem contexto não insere", insert.error === "42501", JSON.stringify(insert));
  const update = await asUser(null, q("update public.user_preferences set display_name = 'x'"));
  check("sem contexto não altera nada", update.count === 0 || Boolean(update.error), JSON.stringify(update));
}

// A: cria, altera e lê o próprio registro
const nameA = `Teste A ${Date.now()}`;
{
  const ensure = await asUser(A, q("insert into public.user_preferences (user_id) values ($1) on conflict (user_id) do nothing", [A]));
  check("A cria o próprio registro (idempotente)", !ensure.error, JSON.stringify(ensure));
  const again = await asUser(A, q("insert into public.user_preferences (user_id) values ($1) on conflict (user_id) do nothing", [A]));
  check("repetir a criação não gera erro", !again.error, JSON.stringify(again));
  const update = await asUser(A, q("update public.user_preferences set display_name = $2 where user_id = $1 returning display_name", [A, nameA]));
  check("A altera o próprio nome", update.rows?.[0]?.display_name === nameA, JSON.stringify(update));
  const read = await asUser(A, q("select user_id, display_name from public.user_preferences"));
  check("A lê somente o próprio registro", read.rows?.length === 1 && read.rows[0].user_id === A, JSON.stringify(read));
  const remove = await asUser(A, q("update public.user_preferences set display_name = null where user_id = $1 returning display_name", [A]));
  check("A remove o nome (NULL)", remove.rows?.length === 1 && remove.rows[0].display_name === null, JSON.stringify(remove));
  await asUser(A, q("update public.user_preferences set display_name = $2 where user_id = $1", [A, nameA]));
}

// B tenta acessar A
await asUser(B, q("insert into public.user_preferences (user_id) values ($1) on conflict (user_id) do nothing", [B]));
{
  const readA = await asUser(B, q("select * from public.user_preferences where user_id = $1", [A]));
  check("B não lê o registro de A", readA.rows?.length === 0, JSON.stringify(readA));
  const readAll = await asUser(B, q("select user_id from public.user_preferences"));
  check("B só enxerga o próprio registro", readAll.rows?.every((r) => r.user_id === B) && readAll.rows.length === 1, JSON.stringify(readAll));
  const updateA = await asUser(B, q("update public.user_preferences set display_name = 'invasão' where user_id = $1", [A]));
  check("B não altera o registro de A (0 linhas)", updateA.count === 0, JSON.stringify(updateA));
  const insertAsA = await asUser(B, q("insert into public.user_preferences (user_id, display_name) values ($1, 'x')", [A]));
  check("B não insere em nome de A (RLS 42501)", insertAsA.error === "42501", JSON.stringify(insertAsA));
  const insertOther = await asUser(B, q("insert into public.user_preferences (user_id) values ($1)", [randomUUID()]));
  check("B não insere para outro id", insertOther.error === "42501", JSON.stringify(insertOther));
  const transfer = await asUser(B, q("update public.user_preferences set user_id = $1 where user_id = $2", [A, B]));
  check("B não transfere o próprio registro (sem UPDATE em user_id)", transfer.error === "42501", JSON.stringify(transfer));
  const del = await asUser(B, q("delete from public.user_preferences where user_id = $1", [A]));
  check("B não exclui registros (sem DELETE)", del.error === "42501", JSON.stringify(del));
  const forge = await asUser(B, q("update public.user_preferences set created_at = now() where user_id = $1", [B]));
  check("B não altera created_at", forge.error === "42501", JSON.stringify(forge));
  const stillA = await asUser(A, q("select display_name from public.user_preferences where user_id = $1", [A]));
  check("registro de A permanece intacto", stillA.rows?.[0]?.display_name === nameA, JSON.stringify(stillA));
}

// Menu do usuário (migração 0019): ordem dos módulos e módulos ocultos, por usuário
console.log("\n— Menu do usuário —");
{
  const empty = JSON.stringify({ menu_order: [], menu_hidden: [] });
  // Parte do menu padrão (uma execução anterior interrompida não pode deixar a conta de teste personalizada).
  await asUser(A, q("update public.user_preferences set menu_order = '{}', menu_hidden = '{}' where user_id = $1", [A]));
  const save = await asUser(
    A,
    q("update public.user_preferences set menu_order = $2::text[], menu_hidden = $3::text[] where user_id = $1 returning menu_order, menu_hidden", [A, ["plantoes", "financas", "followup", "pericias"], ["pericias"]]),
  );
  check("A grava a própria ordem do menu e os módulos ocultos", save.rows?.[0]?.menu_order?.join() === "plantoes,financas,followup,pericias" && save.rows[0].menu_hidden.join() === "pericias", JSON.stringify(save));
  const byB = await asUser(B, q("update public.user_preferences set menu_hidden = $2::text[] where user_id = $1", [A, ["financas"]]));
  check("B não altera o menu de A (0 linhas)", byB.count === 0, JSON.stringify(byB));
  const readB = await asUser(B, q("select menu_order, menu_hidden from public.user_preferences"));
  check("B só lê o próprio menu, que continua no padrão", readB.rows?.length === 1 && JSON.stringify(readB.rows[0]) === empty, JSON.stringify(readB));
  const anon = await asUser(null, q("update public.user_preferences set menu_hidden = $1::text[]", [["financas"]]));
  check("visitante sem contexto não altera menus", anon.count === 0 || Boolean(anon.error), JSON.stringify(anon));
  const unknown = await asUser(A, q("update public.user_preferences set menu_order = $2::text[] where user_id = $1", [A, ["financas", "relatorios"]]));
  check("módulo desconhecido na ordem é recusado (23514)", unknown.error === "23514", JSON.stringify(unknown));
  const dashboard = await asUser(A, q("update public.user_preferences set menu_hidden = $2::text[] where user_id = $1", [A, ["dashboard"]]));
  check("o Dashboard não pode ser ocultado (23514)", dashboard.error === "23514", JSON.stringify(dashboard));
  const withCnpj = await asUser(
    A,
    q("update public.user_preferences set menu_order = $2::text[], menu_hidden = $3::text[] where user_id = $1 returning menu_order", [A, ["cnpj", "plantoes", "financas", "followup", "pericias"], ["pericias"]]),
  );
  check("o módulo CNPJ pode ser ordenado e ocultado como os outros", withCnpj.rows?.[0]?.menu_order?.join() === "cnpj,plantoes,financas,followup,pericias", JSON.stringify(withCnpj));
  const tooMany = await asUser(A, q("update public.user_preferences set menu_order = $2::text[] where user_id = $1", [A, ["cnpj", "cnpj", "cnpj", "cnpj", "cnpj", "cnpj"]]));
  check("lista maior que o número de módulos é recusada (23514)", tooMany.error === "23514", JSON.stringify(tooMany));
  const kept = await asUser(A, q("select menu_order, menu_hidden from public.user_preferences where user_id = $1", [A]));
  check("tentativas recusadas não mudam o menu de A", kept.rows?.[0]?.menu_hidden?.join() === "pericias", JSON.stringify(kept));
  const reset = await asUser(A, q("update public.user_preferences set menu_order = '{}', menu_hidden = '{}' where user_id = $1 returning menu_order, menu_hidden", [A]));
  check("A volta ao menu padrão (listas vazias)", JSON.stringify(reset.rows?.[0]) === empty, JSON.stringify(reset));
}

// Dados do provedor e controle interno ficam inacessíveis
{
  const authUsers = await asUser(A, q('select count(*) from neon_auth."user"'));
  check("app_runtime não lê neon_auth (usuários, sessões, senhas)", authUsers.error === "42501", JSON.stringify(authUsers));
  const migrations = await asUser(A, q("select * from app_private.schema_migrations"));
  check("app_runtime não lê o controle de migrações", migrations.error === "42501", JSON.stringify(migrations));
  const setRole = await asUser(A, q("set role neondb_owner"));
  check("app_runtime não assume o papel do dono", Boolean(setRole.error), JSON.stringify(setRole));
}

// Reuso de conexões: pool com 1 conexão, o contexto não pode vazar entre transações
{
  const afterA = await asUser(null, q("select coalesce(current_setting('app.user_id', true), '') as ctx, (select count(*)::int from public.user_preferences) as visiveis"));
  check("após a transação de A, a conexão reaproveitada volta sem contexto", afterA.rows?.[0]?.ctx === "" && afterA.rows[0].visiveis === 0, JSON.stringify(afterA));

  const sequence = [];
  for (let i = 0; i < 10; i++) {
    const id = i % 2 === 0 ? A : B;
    const r = await asUser(id, q("select array_agg(user_id)::text[] as ids from public.user_preferences"));
    sequence.push(JSON.stringify(r.rows?.[0]?.ids) === JSON.stringify([id]));
  }
  check("10 transações alternadas A/B na mesma conexão: cada uma vê só o próprio registro", sequence.every(Boolean), JSON.stringify(sequence));
}
{
  const concurrent = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3 });
  const run = async (id) => {
    const client = await concurrent.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [id]);
      await client.query("select pg_sleep(0.05)");
      const { rows } = await client.query("select user_id from public.user_preferences");
      await client.query("commit");
      return rows.length === 1 && rows[0].user_id === id;
    } finally {
      client.release();
    }
  };
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => run(i % 2 ? A : B)));
  check("12 transações simultâneas A/B no pool: nenhum contexto misturado", results.every(Boolean), JSON.stringify(results));
  await concurrent.end();
}

// ---------------------------------------------------------------------------
// Finanças: áreas e lançamentos (migração 0002)
// ---------------------------------------------------------------------------
console.log("\n— Finanças —");
const created = { areas: new Map(), entries: new Map() }; // id -> dono (para limpeza)
const tag = `[teste-rls ${Date.now()}]`;
const one = async (id, sql, params) => asUser(id, q(sql, params));

const newArea = async (owner, name, color = "#2563eb") => {
  const r = await one(owner, "insert into public.fin_areas (user_id, name, color) values ($1, $2, $3) returning id", [owner, `${tag} ${name}`, color]);
  if (r.rows?.[0]) created.areas.set(r.rows[0].id, owner);
  return r;
};
const newEntry = async (owner, areaId, description, cents = 1000, due = "2026-09-15") => {
  const r = await one(
    owner,
    "insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date) values ($1, $2, $3, $4, $5::date) returning id",
    [owner, areaId, `${tag} ${description}`, cents, due],
  );
  if (r.rows?.[0]) created.entries.set(r.rows[0].id, owner);
  return r;
};

const areaA = (await newArea(A, "Área A")).rows?.[0]?.id;
const areaB = (await newArea(B, "Área B")).rows?.[0]?.id;
check("A e B criam as próprias áreas", Boolean(areaA && areaB));
const entryA = (await newEntry(A, areaA, "Conta A", 12345)).rows?.[0]?.id;
const entryB = (await newEntry(B, areaB, "Conta B", 500)).rows?.[0]?.id;
check("A e B criam contas nas próprias áreas", Boolean(entryA && entryB));

{
  const dup = await newArea(A, "área a"); // mesmo nome, outra caixa
  check("nome de área duplicado (sem diferenciar maiúsculas) é recusado", dup.error === "23505", JSON.stringify(dup));
  const badColor = await one(A, "insert into public.fin_areas (user_id, name, color) values ($1, $2, 'red')", [A, `${tag} cor`]);
  check("cor fora do formato #rrggbb é recusada pelo banco", badColor.error === "23514", JSON.stringify(badColor));
  const zero = await newEntry(A, areaA, "Zero", 0);
  check("valor zero é recusado pelo banco", zero.error === "23514", JSON.stringify(zero));
  const tooBig = await newEntry(A, areaA, "Grande", 10_000_000_000);
  check("valor acima do limite é recusado pelo banco", tooBig.error === "23514", JSON.stringify(tooBig));
  const paidNoDate = await one(A, "update public.fin_entries set status = 'pago' where id = $1", [entryA]);
  check("pago sem data de pagamento é recusado", paidNoDate.error === "23514", JSON.stringify(paidNoDate));
  const pendingWithDate = await one(A, "update public.fin_entries set paid_on = '2026-09-10' where id = $1", [entryA]);
  check("pendente com data de pagamento é recusado", pendingWithDate.error === "23514", JSON.stringify(pendingWithDate));
  const pay = await one(A, "update public.fin_entries set status = 'pago', paid_on = '2026-09-10' where id = $1 returning id", [entryA]);
  const move = await one(A, "update public.fin_entries set due_date = '2026-09-20' where id = $1 returning to_char(paid_on, 'YYYY-MM-DD') as paid_on", [entryA]);
  check("alterar vencimento de conta paga mantém a data de pagamento", pay.rows?.length === 1 && move.rows?.[0]?.paid_on === "2026-09-10", JSON.stringify(move));
  const unpay = await one(A, "update public.fin_entries set status = 'pendente', paid_on = null where id = $1 returning id", [entryA]);
  check("voltar para pendente limpa a data", unpay.rows?.length === 1, JSON.stringify(unpay));
}

{
  const readAreas = await one(B, "select id from public.fin_areas where id = $1", [areaA]);
  check("B não lê a área de A", readAreas.rows?.length === 0, JSON.stringify(readAreas));
  const readEntries = await one(B, "select id from public.fin_entries where id = $1", [entryA]);
  check("B não lê a conta de A", readEntries.rows?.length === 0, JSON.stringify(readEntries));
  const allB = await one(B, "select user_id from public.fin_entries union all select user_id from public.fin_areas");
  check("B só enxerga áreas e contas próprias", allB.rows?.every((r) => r.user_id === B), JSON.stringify(allB.rows?.length));
  const updArea = await one(B, "update public.fin_areas set name = 'invasão' where id = $1", [areaA]);
  check("B não altera a área de A (0 linhas)", updArea.count === 0, JSON.stringify(updArea));
  const updEntry = await one(B, "update public.fin_entries set amount_cents = 1 where id = $1", [entryA]);
  check("B não altera a conta de A (0 linhas)", updEntry.count === 0, JSON.stringify(updEntry));
  const delEntry = await one(B, "delete from public.fin_entries where id = $1", [entryA]);
  check("B não exclui a conta de A (0 linhas)", delEntry.count === 0, JSON.stringify(delEntry));
  const delArea = await one(B, "delete from public.fin_areas where id = $1", [areaA]);
  check("B não exclui a área de A (0 linhas)", delArea.count === 0, JSON.stringify(delArea));
  const intoA = await newEntry(B, areaA, "Na área de A");
  check("B não cria conta vinculada à área de A (FK composta 23503)", intoA.error === "23503", JSON.stringify(intoA));
  const asA = await one(B, "insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date) values ($1, $2, 'x', 1, '2026-09-01')", [A, areaA]);
  check("B não cria conta em nome de A (RLS 42501)", asA.error === "42501", JSON.stringify(asA));
  const moveToA = await one(B, "update public.fin_entries set area_id = $1 where id = $2", [areaA, entryB]);
  check("B não move a própria conta para a área de A (23503)", moveToA.error === "23503", JSON.stringify(moveToA));
  const ownerEntry = await one(B, "update public.fin_entries set user_id = $1 where id = $2", [A, entryB]);
  check("B não muda user_id da conta (sem permissão, 42501)", ownerEntry.error === "42501", JSON.stringify(ownerEntry));
  const ownerArea = await one(B, "update public.fin_areas set user_id = $1 where id = $2", [A, areaB]);
  check("B não muda user_id da área (42501)", ownerArea.error === "42501", JSON.stringify(ownerArea));
  const sumAsB = await one(B, "select count(*)::int as n, coalesce(sum(amount_cents), 0)::text as total from public.fin_entries where user_id = $1 or area_id = $2", [A, areaA]);
  check("resumo calculado por B não inclui nada de A (0 contas, soma 0)", sumAsB.rows?.[0]?.n === 0 && sumAsB.rows[0].total === "0", JSON.stringify(sumAsB));
  const sumB = await one(B, "select coalesce(sum(amount_cents), 0)::text as total from public.fin_entries where id = $1", [entryB]);
  check("B soma a própria conta", sumB.rows?.[0]?.total === "500", JSON.stringify(sumB));
  const anonAreas = await one(null, "select count(*)::int as n from public.fin_areas");
  const anonEntries = await one(null, "select count(*)::int as n, coalesce(sum(amount_cents), 0)::text as total from public.fin_entries");
  check("visitante sem contexto não vê áreas nem contas (inclusive soma)", anonAreas.rows?.[0]?.n === 0 && anonEntries.rows?.[0]?.n === 0 && anonEntries.rows[0].total === "0", JSON.stringify({ anonAreas, anonEntries }));
  const anonInsert = await one(null, "insert into public.fin_areas (user_id, name, color) values ($1, 'x', '#000000')", [A]);
  check("visitante sem contexto não cria área", anonInsert.error === "42501", JSON.stringify(anonInsert));
}

{
  const delWithEntries = await asUser(A, async (c) => {
    try { await c.query("delete from public.fin_areas where id = $1", [areaA]); return {}; }
    catch (e) { return { error: e.code, constraint: e.constraint }; }
  });
  check("erro de exclusão identifica a FK dos lançamentos", delWithEntries.constraint === "fin_entries_area_fkey", JSON.stringify(delWithEntries));
  check("área com lançamentos não pode ser excluída (RESTRICT 23001)", delWithEntries.error === "23001", JSON.stringify(delWithEntries));
  const stillThere = await one(A, "select count(*)::int as n from public.fin_entries where id = $1", [entryA]);
  check("contas não são apagadas em cascata", stillThere.rows?.[0]?.n === 1, JSON.stringify(stillThere));

  const archive = await one(A, "update public.fin_areas set archived_at = now() where id = $1 returning id", [areaA]);
  check("A arquiva a própria área", archive.rows?.length === 1, JSON.stringify(archive));
  const intoArchived = await newEntry(A, areaA, "Em área arquivada");
  check("área arquivada não recebe conta nova", intoArchived.error === "P0001", JSON.stringify(intoArchived));
  const areaA2 = (await newArea(A, "Área A2")).rows?.[0]?.id;
  const entryA2 = (await newEntry(A, areaA2, "Conta A2")).rows?.[0]?.id;
  const moveIntoArchived = await one(A, "update public.fin_entries set area_id = $1 where id = $2", [areaA, entryA2]);
  check("não é possível mover conta para área arquivada", moveIntoArchived.error === "P0001", JSON.stringify(moveIntoArchived));
  const editKeepArchived = await one(A, "update public.fin_entries set description = $2 where id = $1 returning id", [entryA, `${tag} Conta A editada`]);
  check("editar conta mantendo a área arquivada é permitido", editKeepArchived.rows?.length === 1, JSON.stringify(editKeepArchived));
  const payArchived = await one(A, "update public.fin_entries set status = 'pago', paid_on = '2026-09-12' where id = $1 returning id", [entryA]);
  check("conta em área arquivada pode ser paga", payArchived.rows?.length === 1, JSON.stringify(payArchived));
  const moveOut = await one(A, "update public.fin_entries set area_id = $1 where id = $2 returning id", [areaA2, entryA]);
  check("conta sai da área arquivada para uma ativa própria", moveOut.rows?.length === 1, JSON.stringify(moveOut));
  const restore = await one(A, "update public.fin_areas set archived_at = null where id = $1 returning id", [areaA]);
  check("A restaura a área", restore.rows?.length === 1, JSON.stringify(restore));
  const emptyDelete = await one(A, "delete from public.fin_areas where id = $1 returning id", [areaA]);
  check("área sem lançamentos pode ser excluída", emptyDelete.rows?.length === 1, JSON.stringify(emptyDelete));
  if (emptyDelete.rows?.length === 1) created.areas.delete(areaA);
}

// Recorrências (migração 0003): séries e exceções
{
  console.log("\n— Recorrências —");
  const areaS = (await newArea(A, "Área séries")).rows?.[0]?.id;
  const sA = await one(
    A,
    `insert into public.fin_series (user_id, area_id, description, amount_kind, amount_cents, frequency, start_date)
     values ($1, $2, $3, 'fixo', 1000, 'mensal', '2026-09-10') returning id`,
    [A, areaS, `${tag} Série A`],
  );
  const seriesA = sA.rows?.[0]?.id;
  check("A cria série na própria área", Boolean(seriesA), JSON.stringify(sA));
  const occA = await one(
    A,
    `insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, series_id, occurrence_date)
     values ($1, $2, $3, 1000, '2026-09-10', $4, '2026-09-10') returning id`,
    [A, areaS, `${tag} Ocorrência`, seriesA],
  );
  if (occA.rows?.[0]) created.entries.set(occA.rows[0].id, A);
  const dupOcc = await one(
    A,
    `insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, series_id, occurrence_date)
     values ($1, $2, $3, 1000, '2026-09-11', $4, '2026-09-10')`,
    [A, areaS, `${tag} Duplicada`, seriesA],
  );
  check("mesma série + data original não duplica (23505)", dupOcc.error === "23505", JSON.stringify(dupOcc));
  const nullFixed = await one(A, "insert into public.fin_entries (user_id, area_id, description, due_date) values ($1, $2, $3, '2026-09-01')", [A, areaS, `${tag} Sem valor`]);
  check("conta única sem valor é recusada (NULL só para variável pendente)", nullFixed.error === "23514", JSON.stringify(nullFixed));
  const changeOcc = await one(A, "update public.fin_entries set occurrence_date = '2026-10-10' where id = $1", [occA.rows?.[0]?.id]);
  check("data original da ocorrência não pode ser alterada (42501)", changeOcc.error === "42501", JSON.stringify(changeOcc));
  const changeRule = await one(A, "update public.fin_series set frequency = 'semanal' where id = $1", [seriesA]);
  check("regra da série (frequência) não é alterável in-place (42501)", changeRule.error === "42501", JSON.stringify(changeRule));

  const readS = await one(B, "select id from public.fin_series where id = $1", [seriesA]);
  check("B não lê a série de A", readS.rows?.length === 0, JSON.stringify(readS));
  const updS = await one(B, "update public.fin_series set end_date = '2026-01-01' where id = $1", [seriesA]);
  check("B não altera a série de A (0 linhas)", updS.count === 0, JSON.stringify(updS));
  const areaSB = (await newArea(B, "Área séries B")).rows?.[0]?.id;
  const linkB = await one(
    B,
    `insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, series_id, occurrence_date)
     values ($1, $2, 'x', 1, '2026-09-10', $3, '2026-12-10')`,
    [B, areaSB, seriesA],
  );
  check("B não vincula conta à série de A (FK composta 23503)", linkB.error === "23503", JSON.stringify(linkB));
  const exB = await one(B, "insert into public.fin_series_exceptions (series_id, user_id, occurrence_date) values ($1, $2, '2026-10-10')", [seriesA, B]);
  check("B não cria exceção na série de A (23503)", exB.error === "23503", JSON.stringify(exB));
  const exAsA = await one(B, "insert into public.fin_series_exceptions (series_id, user_id, occurrence_date) values ($1, $2, '2026-10-10')", [seriesA, A]);
  check("B não cria exceção em nome de A (42501)", exAsA.error === "42501", JSON.stringify(exAsA));
  const anonS = await one(null, "select (select count(*) from public.fin_series)::int as s, (select count(*) from public.fin_series_exceptions)::int as x");
  check("visitante sem contexto não vê séries nem exceções", anonS.rows?.[0]?.s === 0 && anonS.rows[0].x === 0, JSON.stringify(anonS));
  const archiveWithSeries = await one(A, "update public.fin_areas set archived_at = now() where id = $1 returning id", [areaS]);
  const seriesIntoArchived = await one(
    A,
    `insert into public.fin_series (user_id, area_id, description, amount_kind, frequency, start_date) values ($1, $2, 'x', 'variavel', 'mensal', '2026-09-10')`,
    [A, areaS],
  );
  check("série nova em área arquivada é recusada (P0001)", archiveWithSeries.rows?.length === 1 && seriesIntoArchived.error === "P0001", JSON.stringify(seriesIntoArchived));
  // Séries não têm DELETE para o app: a limpeza usa a conexão do dono (abaixo).
  created.series = [seriesA].filter(Boolean);
}

// Parcelamentos e eventos (migração 0004)
{
  console.log("\n— Parcelamentos —");
  const areaP = (await newArea(A, "Área parcelas")).rows?.[0]?.id;
  const planA = await asUser(A, async (c) => {
    const p = await c.query(
      `insert into public.fin_installment_plans (user_id, area_id, description, total_cents, installments_count, first_due_date, request_id)
       values ($1, $2, $3, 1000, 2, '2026-10-10', gen_random_uuid()) returning id`,
      [A, areaP, `${tag} Plano`],
    );
    await c.query(
      `insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, installment_plan_id, installment_number)
       values ($1, $2, 'p1', 500, '2026-10-10', $3, 1), ($1, $2, 'p2', 500, '2026-11-10', $3, 2)`,
      [A, areaP, p.rows[0].id],
    );
    return p.rows[0].id;
  });
  check("A cria plano com parcelas consistentes", typeof planA === "string", JSON.stringify(planA));
  const bad = await asUser(A, async (c) => {
    const p = await c.query(
      `insert into public.fin_installment_plans (user_id, area_id, description, total_cents, installments_count, first_due_date, request_id)
       values ($1, $2, 'x', 1000, 2, '2026-10-10', gen_random_uuid()) returning id`,
      [A, areaP],
    );
    await c.query(
      `insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, installment_plan_id, installment_number)
       values ($1, $2, 'p1', 400, '2026-10-10', $3, 1), ($1, $2, 'p2', 500, '2026-11-10', $3, 2)`,
      [A, areaP, p.rows[0].id],
    );
    return "gravou";
  });
  check("plano com soma diferente do total é recusado no commit (gatilho adiado)", bad?.error === "P0001", JSON.stringify(bad));
  const zeroParcel = await one(
    A,
    `insert into public.fin_installment_plans (user_id, area_id, description, total_cents, installments_count, first_due_date, request_id)
     values ($1, $2, 'x', 2, 3, '2026-10-10', gen_random_uuid())`,
    [A, areaP],
  );
  check("plano que geraria parcela zero é recusado (23514)", zeroParcel.error === "23514", JSON.stringify(zeroParcel));
  const changeTotal = await one(A, "update public.fin_installment_plans set total_cents = 1 where id = $1", [planA]);
  check("total do plano não é alterável (42501)", changeTotal.error === "42501", JSON.stringify(changeTotal));
  const parcel = (await one(A, "select id from public.fin_entries where installment_plan_id = $1 order by installment_number limit 1", [planA])).rows?.[0]?.id;
  const changeAmount = await one(A, "update public.fin_entries set amount_cents = 1 where id = $1", [parcel]);
  check("valor de parcela não é alterável (P0001)", changeAmount.error === "P0001", JSON.stringify(changeAmount));
  const delParcel = await one(A, "delete from public.fin_entries where id = $1", [parcel]);
  check("parcela não é excluída pelo app (P0001)", delParcel.error === "P0001", JSON.stringify(delParcel));
  const cancelSingle = await one(A, "update public.fin_entries set status = 'cancelado' where installment_plan_id is null and user_id = $1", [A]);
  check("só parcelas podem ser canceladas (23514 ou 0 linhas)", cancelSingle.error === "23514" || cancelSingle.count === 0, JSON.stringify(cancelSingle));

  const readPlan = await one(B, "select id from public.fin_installment_plans where id = $1", [planA]);
  check("B não lê o plano de A", readPlan.rows?.length === 0, JSON.stringify(readPlan));
  const cancelB = await one(B, "update public.fin_installment_plans set canceled_at = now(), canceled_count = 1 where id = $1", [planA]);
  check("B não cancela o plano de A (0 linhas)", cancelB.count === 0, JSON.stringify(cancelB));
  const areaPB = (await newArea(B, "Área parcelas B")).rows?.[0]?.id;
  const parcelIntoA = await one(
    B,
    `insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, installment_plan_id, installment_number)
     values ($1, $2, 'x', 1, '2026-10-10', $3, 9)`,
    [B, areaPB, planA],
  );
  check("B não vincula parcela ao plano de A (FK composta 23503)", parcelIntoA.error === "23503", JSON.stringify(parcelIntoA));
  const evA = await one(A, "insert into public.fin_events (user_id, entity_type, entity_id, action) values ($1, 'plano', $2, 'teste') returning id", [A, planA]);
  check("A registra evento próprio", evA.rows?.length === 1, JSON.stringify(evA));
  const evRead = await one(B, "select id from public.fin_events where entity_id = $1", [planA]);
  check("B não lê eventos de A", evRead.rows?.length === 0, JSON.stringify(evRead));
  const evForge = await one(B, "insert into public.fin_events (user_id, entity_type, entity_id, action) values ($1, 'plano', $2, 'x')", [A, planA]);
  check("B não registra evento em nome de A (42501)", evForge.error === "42501", JSON.stringify(evForge));
  const evEdit = await one(A, "update public.fin_events set action = 'x' where entity_id = $1", [planA]);
  check("eventos não podem ser alterados (42501)", evEdit.error === "42501", JSON.stringify(evEdit));
  const anonP = await one(null, "select (select count(*) from public.fin_installment_plans)::int as p, (select count(*) from public.fin_events)::int as e");
  check("visitante sem contexto não vê planos nem eventos", anonP.rows?.[0]?.p === 0 && anonP.rows[0].e === 0, JSON.stringify(anonP));
  created.eventUsers = [A];
}

// Concorrência: excluir área enquanto outra transação insere nela
{
  const areaC = (await newArea(A, "Área concorrência")).rows?.[0]?.id;
  const race = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2 });
  const t1 = await race.connect();
  const t2 = await race.connect();
  let deleteResult;
  try {
    await t1.query("begin");
    await t1.query("select set_config('app.user_id', $1, true)", [A]);
    const ins = await t1.query(
      "insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date) values ($1, $2, $3, 100, '2026-09-01') returning id",
      [A, areaC, `${tag} corrida`],
    );
    created.entries.set(ins.rows[0].id, A);
    await t2.query("begin");
    await t2.query("select set_config('app.user_id', $1, true)", [A]);
    const pendingDelete = t2.query("delete from public.fin_areas where id = $1", [areaC]).then(
      () => "apagou",
      (e) => e.code,
    );
    await sleep(600);
    await t1.query("commit");
    deleteResult = await pendingDelete;
    await t2.query("rollback").catch(() => {});
  } finally {
    t1.release();
    t2.release();
    await race.end();
  }
  check("corrida inserir × excluir área: exclusão falha após o insert confirmar (23001)", deleteResult === "23001", deleteResult);

  // Arquivar enquanto outra transação tenta lançar: o lançamento posterior é recusado.
  const race2 = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2 });
  const u1 = await race2.connect();
  const u2 = await race2.connect();
  let insertResult;
  try {
    await u1.query("begin");
    await u1.query("select set_config('app.user_id', $1, true)", [A]);
    await u1.query("update public.fin_areas set archived_at = now() where id = $1", [areaC]);
    await u2.query("begin");
    await u2.query("select set_config('app.user_id', $1, true)", [A]);
    const pendingInsert = u2
      .query(
        "insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date) values ($1, $2, $3, 100, '2026-09-01') returning id",
        [A, areaC, `${tag} corrida 2`],
      )
      .then(
        (r) => {
          created.entries.set(r.rows[0].id, A);
          return "inseriu";
        },
        (e) => e.code,
      );
    await sleep(600);
    await u1.query("commit");
    insertResult = await pendingInsert;
    await u2.query(insertResult === "inseriu" ? "commit" : "rollback").catch(() => {});
  } finally {
    u1.release();
    u2.release();
    await race2.end();
  }
  check("corrida arquivar × lançar: o lançamento que esperava é recusado (P0001)", insertResult === "P0001", insertResult);
}

// ---------------------------------------------------------------------------
// Cartões, faturas, compras e cobranças (migração 0005)
// ---------------------------------------------------------------------------
console.log("\n— Cartões e faturas —");
created.cards = new Set();
{
  const newCard = async (owner, name) => {
    const r = await one(owner, "insert into public.fin_cards (user_id, name, closing_day, due_day) values ($1, $2, 10, 20) returning id", [owner, `${tag} ${name}`]);
    if (r.rows?.[0]) created.cards.add(r.rows[0].id);
    return r.rows?.[0]?.id;
  };
  const newInvoice = async (owner, cardId, ref) =>
    (
      await one(
        owner,
        "insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date) values ($1, $2, $3::date, $3::date + 9, $3::date + 19) returning id",
        [owner, cardId, ref],
      )
    ).rows?.[0]?.id;
  const newPurchase = (owner, cardId, areaId, total = 3000, count = 1) =>
    one(
      owner,
      `insert into public.fin_card_purchases (user_id, card_id, area_id, description, purchase_date, total_cents, installments_count, request_id)
       values ($1, $2, $3, $4, '2026-09-05', $5, $6, gen_random_uuid()) returning id`,
      [owner, cardId, areaId, `${tag} compra`, total, count],
    );
  const newCharge = (owner, cardId, purchaseId, invoiceId, amount = 3000, n = 1) =>
    one(
      owner,
      "insert into public.fin_card_charges (user_id, card_id, purchase_id, invoice_id, installment_number, amount_cents) values ($1, $2, $3, $4, $5, $6) returning id",
      [owner, cardId, purchaseId, invoiceId, n, amount],
    );

  // Áreas próprias do bloco (as anteriores podem ter sido excluídas/arquivadas nos testes acima).
  const areaA = (await newArea(A, "Área cartões A")).rows?.[0]?.id;
  const areaB = (await newArea(B, "Área cartões B")).rows?.[0]?.id;
  const cardA = await newCard(A, "Cartão A");
  const cardB = await newCard(B, "Cartão B");
  check("A e B criam os próprios cartões", Boolean(cardA && cardB));
  const invA = await newInvoice(A, cardA, "2026-09-01");
  const purchaseA = (await newPurchase(A, cardA, areaA)).rows?.[0]?.id;
  const chargeA = (await newCharge(A, cardA, purchaseA, invA)).rows?.[0]?.id;
  check("A cria fatura, compra e cobrança no próprio cartão", Boolean(invA && purchaseA && chargeA));

  const seen = await one(
    B,
    `select (select count(*) from public.fin_cards where id = $1)::int + (select count(*) from public.fin_invoices where id = $2)::int
          + (select count(*) from public.fin_card_purchases where id = $3)::int + (select count(*) from public.fin_card_charges where id = $4)::int as n`,
    [cardA, invA, purchaseA, chargeA],
  );
  check("B não lê cartão, fatura, compra nem cobrança de A", seen.rows?.[0]?.n === 0, JSON.stringify(seen));
  const sumB = await one(B, "select coalesce(sum(amount_cents), 0)::text as total from public.fin_card_charges");
  check("soma de cobranças calculada por B não inclui A", sumB.rows?.[0]?.total === "0", JSON.stringify(sumB));
  const anon = await one(null, "select (select count(*) from public.fin_cards)::int + (select count(*) from public.fin_invoices)::int + (select count(*) from public.fin_card_charges)::int as n");
  check("visitante sem contexto não vê cartões, faturas nem cobranças", anon.rows?.[0]?.n === 0, JSON.stringify(anon));

  const buyOnA = await newPurchase(B, cardA, areaB);
  check("B não lança compra no cartão de A (FK composta 23503)", buyOnA.error === "23503", JSON.stringify(buyOnA));
  const purchaseB = (await newPurchase(B, cardB, areaB)).rows?.[0]?.id;
  const chargeIntoA = await newCharge(B, cardB, purchaseB, invA);
  check("B não coloca cobrança na fatura de A (23503)", chargeIntoA.error === "23503", JSON.stringify(chargeIntoA));
  const asA = await one(B, "insert into public.fin_cards (user_id, name, closing_day, due_day) values ($1, $2, 5, 15)", [A, `${tag} forjado`]);
  check("B não cria cartão em nome de A (RLS 42501)", asA.error === "42501", JSON.stringify(asA));
  const invAsB = await one(
    B,
    "insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date) values ($1, $2, '2026-10-01', '2026-10-10', '2026-10-20')",
    [B, cardA],
  );
  check("B não cria fatura no cartão de A (23503)", invAsB.error === "23503", JSON.stringify(invAsB));
  const payA = await one(B, "update public.fin_invoices set status = 'pago', paid_on = '2026-09-20' where id = $1", [invA]);
  check("B não paga a fatura de A (0 linhas)", payA.count === 0, JSON.stringify(payA));
  const delA = await one(B, "delete from public.fin_card_charges where id = $1", [chargeA]);
  const delCardA = await one(B, "delete from public.fin_cards where id = $1", [cardA]);
  check("B não exclui cobrança nem cartão de A (0 linhas)", delA.count === 0 && delCardA.count === 0, JSON.stringify({ delA, delCardA }));
  const moveCard = await one(B, "update public.fin_cards set user_id = $1 where id = $2", [A, cardB]);
  check("B não transfere o próprio cartão (sem UPDATE em user_id, 42501)", moveCard.error === "42501", JSON.stringify(moveCard));
  const editCharge = await one(A, "update public.fin_card_charges set amount_cents = 1 where id = $1", [chargeA]);
  check("cobrança não é editável pelo app (sem UPDATE, 42501)", editCharge.error === "42501", JSON.stringify(editCharge));
  const forgeTotal = await one(A, "update public.fin_invoices set paid_total_cents = 1 where id = $1", [invA]);
  check("total pago não é gravável pelo app (42501)", forgeTotal.error === "42501", JSON.stringify(forgeTotal));

  const emptyInv = await newInvoice(A, cardA, "2026-11-01");
  const payEmpty = await one(A, "update public.fin_invoices set status = 'pago', paid_on = '2026-09-20' where id = $1", [emptyInv]);
  check("fatura vazia não pode ser paga (P0001)", payEmpty.error === "P0001", JSON.stringify(payEmpty));
  const pay = await one(A, "update public.fin_invoices set status = 'pago', paid_on = '2026-09-20' where id = $1 returning paid_total_cents::text as t", [invA]);
  check("pagamento integral grava o total calculado pelo banco", pay.rows?.[0]?.t === "3000", JSON.stringify(pay));
  const purchaseA2 = (await newPurchase(A, cardA, areaA, 500)).rows?.[0]?.id;
  const addPaid = await newCharge(A, cardA, purchaseA2, invA, 500);
  check("fatura paga não recebe cobrança (P0001)", addPaid.error === "P0001", JSON.stringify(addPaid));
  const delPaid = await one(A, "delete from public.fin_card_purchases where id = $1", [purchaseA]);
  check("compra em fatura paga não pode ser excluída (P0001)", delPaid.error === "P0001", JSON.stringify(delPaid));
  const moveDue = await one(A, "update public.fin_invoices set due_date = due_date + 1 where id = $1", [invA]);
  check("datas de fatura paga não mudam (P0001)", moveDue.error === "P0001", JSON.stringify(moveDue));
  const reopen = await one(A, "update public.fin_invoices set status = 'pendente', paid_on = null where id = $1 returning paid_on, paid_total_cents", [invA]);
  check("reabrir limpa data e total pagos", Boolean(reopen.rows?.[0]) && reopen.rows[0].paid_on === null && reopen.rows[0].paid_total_cents === null, JSON.stringify(reopen));
  const delCard = await one(A, "delete from public.fin_cards where id = $1", [cardA]);
  check("cartão com vínculos não pode ser excluído (RESTRICT)", delCard.error === "23001" || delCard.error === "23503", JSON.stringify(delCard));
  await one(A, "update public.fin_cards set archived_at = now() where id = $1", [cardA]);
  const buyArchived = await newPurchase(A, cardA, areaA);
  check("cartão arquivado não recebe compra (P0001)", buyArchived.error === "P0001", JSON.stringify(buyArchived));
  await one(A, "update public.fin_cards set archived_at = null where id = $1", [cardA]);
  const eventsB = await one(B, "select count(*)::int as n from public.fin_events where user_id = $1", [A]);
  check("B não lê o histórico (fin_events) de A", eventsB.rows?.[0]?.n === 0, JSON.stringify(eventsB));

  // Total da fatura informado pelo usuário (migração 0018): vale no lugar da soma das compras cadastradas.
  console.log("\n— Total da fatura informado —");
  const invS = await newInvoice(A, cardA, "2026-12-01");
  const purchaseS = (await newPurchase(A, cardA, areaA, 100000)).rows?.[0]?.id;
  await newCharge(A, cardA, purchaseS, invS, 100000);
  const statedByB = await one(B, "update public.fin_invoices set stated_total_cents = 999 where id = $1", [invS]);
  check("B não informa o total da fatura de A (0 linhas)", statedByB.count === 0, JSON.stringify(statedByB));
  const statedAnon = await one(null, "update public.fin_invoices set stated_total_cents = 999 where id = $1", [invS]);
  check("visitante sem contexto não informa total (0 linhas)", statedAnon.count === 0, JSON.stringify(statedAnon));
  const stated = await one(A, "update public.fin_invoices set stated_total_cents = 250000 where id = $1 returning stated_total_cents::text as s", [invS]);
  check("A informa o total real da própria fatura", stated.rows?.[0]?.s === "250000", JSON.stringify(stated));
  const statedZero = await one(A, "update public.fin_invoices set stated_total_cents = 0 where id = $1", [invS]);
  check("total informado zero é recusado (23514)", statedZero.error === "23514", JSON.stringify(statedZero));
  const payStated = await one(A, "update public.fin_invoices set status = 'pago', paid_on = '2026-12-20' where id = $1 returning paid_total_cents::text as t", [invS]);
  check("pagamento grava o total informado (250000), não a soma das compras (100000)", payStated.rows?.[0]?.t === "250000", JSON.stringify(payStated));
  const forgePaid = await one(A, "update public.fin_invoices set paid_total_cents = 1 where id = $1", [invS]);
  check("com total informado, o total pago continua não gravável pelo app (42501)", forgePaid.error === "42501", JSON.stringify(forgePaid));
  const purchaseS2 = (await newPurchase(A, cardA, areaA, 30000)).rows?.[0]?.id;
  const lateCharge = await newCharge(A, cardA, purchaseS2, invS, 30000);
  check("fatura paga COM total informado aceita compra como detalhe", Boolean(lateCharge.rows?.[0]), JSON.stringify(lateCharge));
  const stillPaid = await one(A, "select paid_total_cents::text as t from public.fin_invoices where id = $1", [invS]);
  check("valor pago não muda com a compra lançada depois", stillPaid.rows?.[0]?.t === "250000", JSON.stringify(stillPaid));
  const changeStated = await one(A, "update public.fin_invoices set stated_total_cents = 300000 where id = $1", [invS]);
  check("total informado não muda com a fatura paga (P0001)", changeStated.error === "P0001", JSON.stringify(changeStated));
  const reopenStated = await one(A, "update public.fin_invoices set status = 'pendente', paid_on = null where id = $1 returning stated_total_cents::text as s, paid_total_cents as p", [invS]);
  check("reabrir mantém o total informado e limpa o pagamento", reopenStated.rows?.[0]?.s === "250000" && reopenStated.rows?.[0]?.p === null, JSON.stringify(reopenStated));
  const lowerStated = await one(A, "update public.fin_invoices set stated_total_cents = 70000, status = 'pago', paid_on = '2026-12-20' where id = $1 returning paid_total_cents::text as t", [invS]);
  check("total informado menor que as compras é aceito e é o valor pago (70000)", lowerStated.rows?.[0]?.t === "70000", JSON.stringify(lowerStated));
  const statedOnly = await newInvoice(A, cardA, "2027-01-01");
  const payStatedOnly = await one(A, "update public.fin_invoices set stated_total_cents = 12345, status = 'pago', paid_on = '2027-01-20' where id = $1 returning paid_total_cents::text as t", [statedOnly]);
  check("fatura sem compras é paga pelo total informado", payStatedOnly.rows?.[0]?.t === "12345", JSON.stringify(payStatedOnly));
  const insertStated = await one(B, "insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date, stated_total_cents) values ($1, $2, '2027-02-01', '2027-02-10', '2027-02-20', 5000)", [B, cardA]);
  check("B não cria fatura com total no cartão de A (23503)", insertStated.error === "23503", JSON.stringify(insertStated));
}

// ---------------------------------------------------------------------------
// Forma de pagamento e edição de compra no cartão (migração 0017)
// ---------------------------------------------------------------------------
console.log("\n— Forma de pagamento —");
{
  const areaA = (await newArea(A, "Área formas A")).rows?.[0]?.id;
  const areaA2 = (await newArea(A, "Área formas A2")).rows?.[0]?.id;
  const areaB = (await newArea(B, "Área formas B")).rows?.[0]?.id;
  const entryA = (await newEntry(A, areaA, "Conta formas A")).rows?.[0]?.id;
  check("conta nova sem forma fica não informada (NULL)", (await one(A, "select payment_method from public.fin_entries where id = $1", [entryA])).rows?.[0]?.payment_method === null);
  const setPix = await one(A, "update public.fin_entries set payment_method = 'pix' where id = $1 returning payment_method", [entryA]);
  check("A grava Pix na própria conta", setPix.rows?.[0]?.payment_method === "pix", JSON.stringify(setPix));
  const bad = await one(A, "update public.fin_entries set payment_method = 'dinheiro' where id = $1", [entryA]);
  check("forma fora de Pix/boleto é recusada pelo banco (23514)", bad.error === "23514", JSON.stringify(bad));
  const byB = await one(B, "update public.fin_entries set payment_method = 'boleto' where id = $1", [entryA]);
  check("B não altera a forma da conta de A (0 linhas)", byB.count === 0, JSON.stringify(byB));
  const series = await one(
    A,
    `insert into public.fin_series (user_id, area_id, description, amount_kind, amount_cents, frequency, interval_months, start_date, payment_method)
     values ($1, $2, $3, 'fixo', 1000, 'mensal', 1, '2026-10-10', 'boleto') returning id`,
    [A, areaA, `${tag} Série formas`],
  );
  check("A cria recorrência com forma de pagamento", Boolean(series.rows?.[0]?.id), JSON.stringify(series));
  const editSeries = await one(A, "update public.fin_series set payment_method = 'pix' where id = $1", [series.rows?.[0]?.id]);
  check("forma da recorrência não muda por UPDATE (só por nova regra, 42501)", editSeries.error === "42501", JSON.stringify(editSeries));
  const plan = await asUser(A, async (c) => {
    const p = await c.query(
      `insert into public.fin_installment_plans (user_id, area_id, description, total_cents, installments_count, first_due_date, request_id, payment_method)
       values ($1, $2, $3, 1000, 2, '2026-10-10', gen_random_uuid(), 'boleto') returning id`,
      [A, areaA, `${tag} Plano formas`],
    );
    await c.query(
      `insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, installment_plan_id, installment_number, payment_method)
       values ($1, $2, 'p1', 500, '2026-10-10', $3, 1, 'boleto'), ($1, $2, 'p2', 500, '2026-11-10', $3, 2, 'boleto')`,
      [A, areaA, p.rows[0].id],
    );
    return p.rows[0].id;
  });
  check("A cria parcelamento com forma de pagamento", typeof plan === "string", JSON.stringify(plan));
  const planPix = await one(A, "update public.fin_installment_plans set payment_method = 'pix' where id = $1 returning payment_method", [plan]);
  const parcelPix = await one(A, "update public.fin_entries set payment_method = 'pix' where installment_plan_id = $1 and status = 'pendente'", [plan]);
  check("A muda a forma do próprio parcelamento e das parcelas pendentes", planPix.rows?.[0]?.payment_method === "pix" && parcelPix.count === 2, JSON.stringify({ planPix, parcelPix }));
  const planByB = await one(B, "update public.fin_installment_plans set payment_method = 'boleto' where id = $1", [plan]);
  check("B não altera a forma do parcelamento de A (0 linhas)", planByB.count === 0, JSON.stringify(planByB));

  const card = await one(A, "insert into public.fin_cards (user_id, name, closing_day, due_day) values ($1, $2, 10, 20) returning id", [A, `${tag} Cartão formas`]);
  const cardId = card.rows?.[0]?.id;
  if (cardId) created.cards.add(cardId);
  const purchase = await one(
    A,
    `insert into public.fin_card_purchases (user_id, card_id, area_id, description, purchase_date, total_cents, installments_count, request_id)
     values ($1, $2, $3, $4, '2026-10-05', 3000, 1, gen_random_uuid()) returning id`,
    [A, cardId, areaA, `${tag} Compra formas`],
  );
  const purchaseId = purchase.rows?.[0]?.id;
  const moveArea = await one(A, "update public.fin_card_purchases set area_id = $2 where id = $1 returning area_id", [purchaseId, areaA2]);
  check("A muda a área da própria compra para outra área sua", moveArea.rows?.[0]?.area_id === areaA2, JSON.stringify(moveArea));
  const toB = await one(A, "update public.fin_card_purchases set area_id = $2 where id = $1", [purchaseId, areaB]);
  check("compra de A não vai para área de B (FK composta 23503)", toB.error === "23503", JSON.stringify(toB));
  const byB2 = await one(B, "update public.fin_card_purchases set area_id = $2 where id = $1", [purchaseId, areaB]);
  check("B não altera a compra de A (0 linhas)", byB2.count === 0, JSON.stringify(byB2));
  await one(A, "update public.fin_areas set archived_at = now() where id = $1", [areaA]);
  const toArchived = await one(A, "update public.fin_card_purchases set area_id = $2 where id = $1", [purchaseId, areaA]);
  check("compra não vai para área arquivada (P0001)", toArchived.error === "P0001", JSON.stringify(toArchived));
  await one(A, "update public.fin_areas set archived_at = null where id = $1", [areaA]);
}

// ---------------------------------------------------------------------------
// Follow-up: pacientes, consultas e modelos (migração 0006)
// ---------------------------------------------------------------------------
console.log("\n— Follow-up: cadastros —");
created.fuPatients = new Set();
created.fuTemplates = new Set();
{
  const newPatient = async (owner, name) => {
    const r = await one(owner, "insert into public.fu_patients (user_id, name) values ($1, $2) returning id", [owner, `${tag} ${name}`]);
    if (r.rows?.[0]) created.fuPatients.add(r.rows[0].id);
    return r.rows?.[0]?.id;
  };
  const patA = await newPatient(A, "Paciente A");
  const patA2 = await newPatient(A, "Paciente A");
  const patB = await newPatient(B, "Paciente B");
  check("A cadastra dois pacientes com o mesmo nome; B cadastra o seu", Boolean(patA && patA2 && patB && patA !== patA2));
  const consA = (await one(A, "insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date - 3) returning id", [A, patA])).rows?.[0]?.id;
  check("A registra consulta do próprio paciente", Boolean(consA));
  const tplA = (await one(A, "insert into public.fu_templates (user_id, name) values ($1, $2) returning id", [A, `${tag} Modelo A`])).rows?.[0]?.id;
  if (tplA) created.fuTemplates.add(tplA);
  const stepA = await one(A, "insert into public.fu_template_steps (user_id, template_id, day_offset, message, position) values ($1, $2, 7, 'Olá {nome}', 0) returning id", [A, tplA]);
  check("A cria modelo com etapa", Boolean(tplA && stepA.rows?.[0]));

  const seen = await one(
    B,
    `select (select count(*) from public.fu_patients where id = any($1::uuid[]))::int + (select count(*) from public.fu_consultations where id = $2)::int
          + (select count(*) from public.fu_templates where id = $3)::int + (select count(*) from public.fu_template_steps where template_id = $3)::int as n`,
    [[patA, patA2], consA, tplA],
  );
  check("B não lê pacientes, consultas, modelos nem etapas de A", seen.rows?.[0]?.n === 0, JSON.stringify(seen));
  const anon = await one(null, "select (select count(*) from public.fu_patients)::int + (select count(*) from public.fu_consultations)::int + (select count(*) from public.fu_templates)::int as n");
  check("visitante sem contexto não vê nada do Follow-up", anon.rows?.[0]?.n === 0, JSON.stringify(anon));
  const updA = await one(B, "update public.fu_patients set name = 'invasor' where id = $1", [patA]);
  const delA = await one(B, "delete from public.fu_patients where id = $1", [patA2]);
  check("B não altera nem exclui paciente de A (0 linhas)", updA.count === 0 && delA.count === 0, JSON.stringify({ updA, delA }));
  const asA = await one(B, "insert into public.fu_patients (user_id, name) values ($1, 'forjado')", [A]);
  check("B não cadastra paciente em nome de A (RLS 42501)", asA.error === "42501", JSON.stringify(asA));
  const linkA = await one(B, "insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date)", [B, patA]);
  check("B não vincula consulta ao paciente de A (FK composta 23503)", linkA.error === "23503", JSON.stringify(linkA));
  const stepIntoA = await one(B, "insert into public.fu_template_steps (user_id, template_id, day_offset, message, position) values ($1, $2, 1, 'x', 0)", [B, tplA]);
  check("B não adiciona etapa ao modelo de A (23503)", stepIntoA.error === "23503", JSON.stringify(stepIntoA));
  const transfer = await one(B, "update public.fu_patients set user_id = $1 where id = $2", [A, patB]);
  check("B não transfere o próprio paciente (sem UPDATE em user_id, 42501)", transfer.error === "42501", JSON.stringify(transfer));
  const movePatient = await one(A, "update public.fu_consultations set patient_id = $1 where id = $2", [patA2, consA]);
  check("paciente da consulta é fixo (sem UPDATE em patient_id, 42501)", movePatient.error === "42501", JSON.stringify(movePatient));
  const delTpl = await one(A, "delete from public.fu_templates where id = $1", [tplA]);
  check("modelos não são excluídos pelo app (arquivar; 42501)", delTpl.error === "42501", JSON.stringify(delTpl));
  const future = await one(A, "insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date + 2)", [A, patA]);
  check("consulta futura é recusada pelo banco (P0001)", future.error === "P0001", JSON.stringify(future));
  const badPhone = await one(A, "update public.fu_patients set phone = '11987654321' where id = $1", [patA]);
  check("telefone fora do E.164 é recusado pelo banco (23514)", badPhone.error === "23514", JSON.stringify(badPhone));
  await one(A, "update public.fu_patients set archived_at = now() where id = $1", [patA2]);
  const intoArchived = await one(A, "insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date)", [A, patA2]);
  check("paciente arquivado não recebe consulta nova (P0001)", intoArchived.error === "P0001", JSON.stringify(intoArchived));
  const delWithConsult = await one(A, "delete from public.fu_patients where id = $1", [patA]);
  check("paciente com consultas não é excluído (RESTRICT)", delWithConsult.error === "23001" || delWithConsult.error === "23503", JSON.stringify(delWithConsult));
}

// ---------------------------------------------------------------------------
// Follow-up: planos, etapas e histórico (migração 0007)
// ---------------------------------------------------------------------------
console.log("\n— Follow-up: planos e etapas —");
{
  const pat = (await one(A, "insert into public.fu_patients (user_id, name) values ($1, $2) returning id", [A, `${tag} Plano A`])).rows?.[0]?.id;
  if (pat) created.fuPatients.add(pat);
  const patB = (await one(B, "insert into public.fu_patients (user_id, name) values ($1, $2) returning id", [B, `${tag} Plano B`])).rows?.[0]?.id;
  if (patB) created.fuPatients.add(patB);
  const cons = (await one(A, "insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date - 5) returning id", [A, pat])).rows?.[0]?.id;
  const consB = (await one(B, "insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date) returning id", [B, patB])).rows?.[0]?.id;
  // Consulta de A ainda sem plano: o teste de vínculo cruzado não esbarra na unicidade.
  const consFree = (await one(A, "insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date - 1) returning id", [A, pat])).rows?.[0]?.id;
  const plan = (
    await one(
      A,
      "insert into public.fu_plans (user_id, patient_id, consultation_id, template_name, template_version, request_id) values ($1, $2, $3, 'Modelo', 1, gen_random_uuid()) returning id",
      [A, pat, cons],
    )
  ).rows?.[0]?.id;
  const step = async (offset) =>
    (
      await one(
        A,
        "insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, $3, 'Olá {nome}', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date) returning id",
        [A, plan, offset],
      )
    ).rows?.[0]?.id;
  const s0 = await step(0);
  const s7 = await step(7);
  const s30 = await step(30);
  const ev = await one(A, "insert into public.fu_events (user_id, patient_id, consultation_id, plan_id, step_id, action) values ($1, $2, $3, $4, $5, 'plano_criado') returning id", [A, pat, cons, plan, s0]);
  check("A cria plano, etapas e histórico da própria consulta", Boolean(plan && s0 && s7 && s30 && ev.rows?.[0]));

  const seen = await one(
    B,
    `select (select count(*) from public.fu_plans where id = $1)::int + (select count(*) from public.fu_steps where plan_id = $1)::int
          + (select count(*) from public.fu_events where patient_id = $2)::int as n`,
    [plan, pat],
  );
  check("B não lê planos, etapas nem histórico de A", seen.rows?.[0]?.n === 0, JSON.stringify(seen));
  const anon = await one(null, "select (select count(*) from public.fu_plans)::int + (select count(*) from public.fu_steps)::int + (select count(*) from public.fu_events)::int as n");
  check("visitante sem contexto não vê planos, etapas nem histórico", anon.rows?.[0]?.n === 0, JSON.stringify(anon));
  const planOnA = await one(
    B,
    "insert into public.fu_plans (user_id, patient_id, consultation_id, template_name, template_version, request_id) values ($1, $2, $3, 'x', 1, gen_random_uuid())",
    [B, pat, consFree],
  );
  check("B não cria plano na consulta de A (FK composta 23503)", planOnA.error === "23503", JSON.stringify(planOnA));
  const mixed = await one(
    B,
    "insert into public.fu_plans (user_id, patient_id, consultation_id, template_name, template_version, request_id) values ($1, $2, $3, 'x', 1, gen_random_uuid())",
    [B, patB, consFree],
  );
  check("B não mistura o próprio paciente com a consulta de A (23503)", mixed.error === "23503", JSON.stringify(mixed));
  const stepOnA = await one(B, "insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, 1, 'x', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)", [B, plan]);
  check("B não insere etapa no plano de A (23503)", stepOnA.error === "23503", JSON.stringify(stepOnA));
  const evOnA = await one(B, "insert into public.fu_events (user_id, patient_id, action) values ($1, $2, 'etapa_realizada')", [B, pat]);
  const evMixed = await one(B, "insert into public.fu_events (user_id, patient_id, step_id, action) values ($1, $2, $3, 'etapa_realizada')", [B, patB, s0]);
  check("B não grava histórico em paciente ou etapa de A (23503)", evOnA.error === "23503" && evMixed.error === "23503", JSON.stringify({ evOnA, evMixed }));
  const doneByB = await one(B, "update public.fu_steps set status = 'realizado', done_text = 'x' where id = $1", [s0]);
  check("B não marca etapa de A (0 linhas)", doneByB.count === 0, JSON.stringify(doneByB));
  const delPlan = await one(A, "delete from public.fu_plans where id = $1", [plan]);
  const delStep = await one(A, "delete from public.fu_steps where id = $1", [s0]);
  const delEv = await one(A, "delete from public.fu_events where patient_id = $1", [pat]);
  const updEv = await one(A, "update public.fu_events set action = 'plano_cancelado' where patient_id = $1", [pat]);
  check("planos, etapas e histórico não são excluídos; histórico não é alterado (42501)", [delPlan, delStep, delEv, updEv].every((r) => r.error === "42501"), JSON.stringify({ delPlan, delStep, delEv, updEv }));
  const forgeDone = await one(A, "update public.fu_steps set done_at = now() - interval '9 days' where id = $1", [s0]);
  check("instante de realização não é gravável pelo app (42501)", forgeDone.error === "42501", JSON.stringify(forgeDone));
  const dupOffset = await one(A, "insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, 7, 'x', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)", [A, plan]);
  check("intervalo repetido vivo no plano é recusado (23505)", dupOffset.error === "23505", JSON.stringify(dupOffset));
  const done = await one(A, "update public.fu_steps set status = 'realizado', done_text = 'Olá Fulano' where id = $1 returning done_at is not null as stamped", [s0]);
  check("realizar grava o instante pelo servidor", done.rows?.[0]?.stamped === true, JSON.stringify(done));
  const moveDone = await one(A, "update public.fu_steps set due_date = due_date + 3 where id = $1", [s0]);
  check("etapa realizada não muda de data (P0001)", moveDone.error === "P0001", JSON.stringify(moveDone));
  const cancel = await one(A, "update public.fu_steps set status = 'cancelado', cancel_kind = 'cancelado' where id = $1", [s7]);
  const revive = await one(A, "update public.fu_steps set status = 'pendente', cancel_kind = null, canceled_at = null where id = $1", [s7]);
  const revive2 = await one(A, "update public.fu_steps set status = 'pendente', cancel_kind = null where id = $1", [s7]);
  check("etapa cancelada é final (P0001 / sem grant no instante)", cancel.count === 1 && revive.error === "42501" && revive2.error === "P0001", JSON.stringify({ cancel, revive, revive2 }));
  const cancelPlan = await one(A, "update public.fu_plans set status = 'cancelado' where id = $1 returning canceled_at is not null as stamped", [plan]);
  check("cancelar plano grava o instante pelo servidor", cancelPlan.rows?.[0]?.stamped === true, JSON.stringify(cancelPlan));
  const reactivate = await one(A, "update public.fu_plans set status = 'ativo' where id = $1", [plan]);
  check("plano cancelado não é reativado (P0001)", reactivate.error === "P0001", JSON.stringify(reactivate));
  const intoCanceled = await one(A, "insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, 90, 'x', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date)", [A, plan]);
  check("plano cancelado não recebe etapas (P0001)", intoCanceled.error === "P0001", JSON.stringify(intoCanceled));
  const secondPlan = await one(
    A,
    "insert into public.fu_plans (user_id, patient_id, consultation_id, template_name, template_version, request_id) values ($1, $2, $3, 'Outro', 1, gen_random_uuid())",
    [A, pat, cons],
  );
  check("uma consulta tem um único plano (23505)", secondPlan.error === "23505", JSON.stringify(secondPlan));
  void consB;
}

// ---------------------------------------------------------------------------
// Plantões: tipos, ocorrências e histórico (migração 0008)
// ---------------------------------------------------------------------------
console.log("\n— Plantões: tipos e ocorrências —");
created.plTypes = new Set();
{
  const newType = async (owner, name) => {
    const r = await one(owner, "insert into public.pl_types (user_id, name, default_amount_cents, color) values ($1, $2, 100000, '#2563eb') returning id", [owner, `${tag} ${name}`]);
    if (r.rows?.[0]) created.plTypes.add(r.rows[0].id);
    return r.rows?.[0]?.id;
  };
  const tA = await newType(A, "Tipo A");
  const tB = await newType(B, "Tipo B");
  const sA = (await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents) values ($1, $2, '2026-10-20', 100000) returning id", [A, tA])).rows?.[0]?.id;
  const ev = await one(A, "insert into public.pl_events (user_id, shift_id, type_id, action) values ($1, $2, $3, 'criado') returning id", [A, sA, tA]);
  check("A cria tipo, plantão e histórico", Boolean(tA && tB && sA && ev.rows?.[0]));
  const seen = await one(
    B,
    "select (select count(*) from public.pl_types where id = $1)::int + (select count(*) from public.pl_shifts where id = $2)::int + (select count(*) from public.pl_events where type_id = $1)::int as n",
    [tA, sA],
  );
  check("B não lê tipo, plantão nem histórico de A", seen.rows?.[0]?.n === 0, JSON.stringify(seen));
  const anon = await one(null, "select (select count(*) from public.pl_types)::int + (select count(*) from public.pl_shifts)::int + (select count(*) from public.pl_events)::int as n");
  check("visitante sem contexto não vê Plantões", anon.rows?.[0]?.n === 0, JSON.stringify(anon));
  const onTypeA = await one(B, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents) values ($1, $2, '2026-10-20', 100)", [B, tA]);
  check("B não cria plantão com o tipo de A (FK composta 23503)", onTypeA.error === "23503", JSON.stringify(onTypeA));
  const asA = await one(B, "insert into public.pl_types (user_id, name, default_amount_cents, color) values ($1, 'forjado', 1, '#000000')", [A]);
  check("B não cria tipo em nome de A (42501)", asA.error === "42501", JSON.stringify(asA));
  const evOnA = await one(B, "insert into public.pl_events (user_id, shift_id, action) values ($1, $2, 'criado')", [B, sA]);
  check("B não grava histórico no plantão de A (23503)", evOnA.error === "23503", JSON.stringify(evOnA));
  const upd = await one(B, "update public.pl_shifts set amount_cents = 1 where id = $1", [sA]);
  const del = await one(B, "delete from public.pl_shifts where id = $1", [sA]);
  check("B não altera nem exclui plantão de A (0 linhas)", upd.count === 0 && del.count === 0, JSON.stringify({ upd, del }));
  const moveType = await one(A, "update public.pl_shifts set type_id = $1 where id = $2", [tA, sA]);
  const transfer = await one(B, "update public.pl_types set user_id = $1 where id = $2", [A, tB]);
  check("tipo do plantão e dono do tipo são imutáveis (42501)", moveType.error === "42501" && transfer.error === "42501", JSON.stringify({ moveType, transfer }));
  const evEdit = await one(A, "update public.pl_events set action = 'editado' where type_id = $1", [tA]);
  const evDel = await one(A, "delete from public.pl_events where type_id = $1", [tA]);
  check("histórico não é alterado nem excluído pelo app (42501)", evEdit.error === "42501" && evDel.error === "42501", JSON.stringify({ evEdit, evDel }));
  const zero = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents) values ($1, $2, '2026-10-21', '07:00', '07:00', false, 100)", [A, tA]);
  const over24 = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents) values ($1, $2, '2026-10-21', '07:00', '08:00', true, 100)", [A, tA]);
  const half = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, start_time, amount_cents) values ($1, $2, '2026-10-21', '07:00', 100)", [A, tA]);
  const nonPositive = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents) values ($1, $2, '2026-10-21', 0)", [A, tA]);
  check("banco recusa duração zero, mais de 24 h, horário pela metade e valor não positivo (23514)", [zero, over24, half, nonPositive].every((r) => r.error === "23514"), JSON.stringify({ zero, over24, half, nonPositive }));
  const ok24 = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents) values ($1, $2, '2026-10-22', '07:00', '07:00', true, 100) returning id", [A, tA]);
  check("plantão de 24 h (07:00 → 07:00 do dia seguinte) é aceito", Boolean(ok24.rows?.[0]), JSON.stringify(ok24));
  const forgeCancel = await one(A, "update public.pl_shifts set canceled_at = now() where id = $1", [sA]);
  check("instante de cancelamento não é gravável pelo app (42501)", forgeCancel.error === "42501", JSON.stringify(forgeCancel));
  await one(A, "update public.pl_types set archived_at = now() where id = $1", [tA]);
  const intoArchived = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents) values ($1, $2, '2026-10-23', 100)", [A, tA]);
  check("tipo arquivado não recebe plantão (P0001)", intoArchived.error === "P0001", JSON.stringify(intoArchived));
  const delType = await one(A, "delete from public.pl_types where id = $1", [tA]);
  check("tipo com plantões não é excluído (RESTRICT)", delType.error === "23001" || delType.error === "23503", JSON.stringify(delType));
}

// ---------------------------------------------------------------------------
// Plantões: séries, exceções e movimentações (migração 0009)
// ---------------------------------------------------------------------------
console.log("\n— Plantões: recorrências —");
{
  const tA = (await one(A, "insert into public.pl_types (user_id, name, default_amount_cents, color) values ($1, $2, 100000, '#16a34a') returning id", [A, `${tag} Série A`])).rows?.[0]?.id;
  const tB = (await one(B, "insert into public.pl_types (user_id, name, default_amount_cents, color) values ($1, $2, 100000, '#16a34a') returning id", [B, `${tag} Série B`])).rows?.[0]?.id;
  for (const id of [tA, tB]) if (id) created.plTypes.add(id);
  const sA = (await one(A, "insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, amount_cents) values ($1, $2, 16, 1, '2026-10-01', 100000) returning id", [A, tA])).rows?.[0]?.id;
  const occ = (
    await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, series_id, original_date) values ($1, $2, '2026-10-01', 100000, $3, '2026-10-01') returning id", [A, tA, sA])
  ).rows?.[0]?.id;
  check("A cria série e ocorrência com identidade (série, data original)", Boolean(sA && occ));
  const dup = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, series_id, original_date) values ($1, $2, '2026-10-02', 100000, $3, '2026-10-01')", [A, tA, sA]);
  check("mesma data original na série é recusada (23505)", dup.error === "23505", JSON.stringify(dup));
  const half = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, series_id) values ($1, $2, '2026-10-08', 100000, $3)", [A, tA, sA]);
  check("ocorrência de série sem data original é recusada (23514)", half.error === "23514", JSON.stringify(half));
  const move = await one(A, "update public.pl_shifts set shift_date = '2026-10-03' where id = $1 returning moved_at is not null as stamped", [occ]);
  check("mover grava o instante pelo servidor", move.rows?.[0]?.stamped === true, JSON.stringify(move));
  const changeOrig = await one(A, "update public.pl_shifts set original_date = '2026-10-03' where id = $1", [occ]);
  const forgeMoved = await one(A, "update public.pl_shifts set moved_at = null where id = $1", [occ]);
  check("data original e instante da movimentação não são graváveis pelo app (42501)", changeOrig.error === "42501" && forgeMoved.error === "42501", JSON.stringify({ changeOrig, forgeMoved }));
  const exc = await one(A, "insert into public.pl_series_exceptions (series_id, user_id, original_date) values ($1, $2, '2026-10-08') returning series_id", [sA, A]);
  check("A registra exceção na própria série", Boolean(exc.rows?.[0]), JSON.stringify(exc));
  const seen = await one(B, "select (select count(*) from public.pl_series where id = $1)::int + (select count(*) from public.pl_series_exceptions where series_id = $1)::int as n", [sA]);
  check("B não lê séries nem exceções de A", seen.rows?.[0]?.n === 0, JSON.stringify(seen));
  const anon = await one(null, "select (select count(*) from public.pl_series)::int + (select count(*) from public.pl_series_exceptions)::int as n");
  check("visitante sem contexto não vê séries nem exceções", anon.rows?.[0]?.n === 0, JSON.stringify(anon));
  const seriesOnA = await one(B, "insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, amount_cents) values ($1, $2, 16, 1, '2026-10-01', 1)", [B, tA]);
  check("B não cria série com o tipo de A (23503)", seriesOnA.error === "23503", JSON.stringify(seriesOnA));
  const excOnA = await one(B, "insert into public.pl_series_exceptions (series_id, user_id, original_date) values ($1, $2, '2026-10-15')", [sA, B]);
  check("B não registra exceção na série de A (23503)", excOnA.error === "23503", JSON.stringify(excOnA));
  const shiftOnA = await one(B, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, series_id, original_date) values ($1, $2, '2026-10-15', 1, $3, '2026-10-15')", [B, tB, sA]);
  check("B não vincula ocorrência à série de A (23503)", shiftOnA.error === "23503", JSON.stringify(shiftOnA));
  const upd = await one(B, "update public.pl_series set end_date = '2026-10-01' where id = $1", [sA]);
  check("B não encerra série de A (0 linhas)", upd.count === 0, JSON.stringify(upd));
  const delSeries = await one(A, "delete from public.pl_series where id = $1", [sA]);
  const changeRule = await one(A, "update public.pl_series set weekday_mask = 2 where id = $1", [sA]);
  check("série não é excluída nem tem a regra alterada no lugar (dividir) (42501)", delSeries.error === "42501" && changeRule.error === "42501", JSON.stringify({ delSeries, changeRule }));
  await one(A, "update public.pl_types set archived_at = now() where id = $1", [tA]);
  const intoArchived = await one(A, "insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, amount_cents) values ($1, $2, 16, 1, '2026-10-01', 1)", [A, tA]);
  check("tipo arquivado não recebe série nova (P0001)", intoArchived.error === "P0001", JSON.stringify(intoArchived));
  const badMask = await one(B, "insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, amount_cents) values ($1, $2, 0, 13, '2026-10-01', 1)", [B, tB]);
  check("regra inválida (nenhum dia / intervalo > 12) é recusada (23514)", badMask.error === "23514", JSON.stringify(badMask));
}

// ---------------------------------------------------------------------------
// Plantões: realização e recebimento (migração 0010)
// ---------------------------------------------------------------------------
console.log("\n— Plantões: realização e recebimento —");
{
  const tA = (await one(A, "insert into public.pl_types (user_id, name, default_amount_cents, color) values ($1, $2, 100000, '#dc2626') returning id", [A, `${tag} Receb A`])).rows?.[0]?.id;
  if (tA) created.plTypes.add(tA);
  const newShift = async () => (await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date - 3, 100000) returning id", [A, tA])).rows?.[0]?.id;
  const s1 = await newShift();
  const s2 = await newShift();
  const done = await one(A, "update public.pl_shifts set status = 'realizado' where id = $1 returning done_at is not null as stamped", [s1]);
  check("realizar grava o instante pelo servidor", done.rows?.[0]?.stamped === true, JSON.stringify(done));
  const forgeDone = await one(A, "update public.pl_shifts set done_at = now() - interval '5 days' where id = $1", [s1]);
  const forgeCents = await one(A, "update public.pl_shifts set received_cents = 1 where id = $1", [s1]);
  check("instante da realização e valor recebido não são graváveis pelo app (42501)", forgeDone.error === "42501" && forgeCents.error === "42501", JSON.stringify({ forgeDone, forgeCents }));
  const future = await one(A, "update public.pl_shifts set received_on = (now() at time zone 'America/Sao_Paulo')::date + 2 where id = $1", [s1]);
  check("recebimento com data futura é recusado pelo banco (P0001)", future.error === "P0001", JSON.stringify(future));
  const recv = await one(A, "update public.pl_shifts set received_on = (now() at time zone 'America/Sao_Paulo')::date where id = $1 returning received_cents::text as cents", [s1]);
  check("recebimento integral: valor recebido = valor do plantão (banco)", recv.rows?.[0]?.cents === "100000", JSON.stringify(recv));
  const changeAmount = await one(A, "update public.pl_shifts set amount_cents = 1 where id = $1", [s1]);
  const cancelReceived = await one(A, "update public.pl_shifts set status = 'cancelado' where id = $1", [s1]);
  const delReceived = await one(A, "delete from public.pl_shifts where id = $1", [s1]);
  check("recebido: valor fixo, sem cancelar e sem excluir (P0001)", [changeAmount, cancelReceived, delReceived].every((r) => r.error === "P0001"), JSON.stringify({ changeAmount, cancelReceived, delReceived }));
  await one(A, "update public.pl_shifts set status = 'realizado' where id = $1", [s2]);
  const cancelDone = await one(A, "update public.pl_shifts set status = 'cancelado' where id = $1", [s2]);
  const delDone = await one(A, "delete from public.pl_shifts where id = $1", [s2]);
  check("realizado não é cancelado direto nem excluído (P0001)", cancelDone.error === "P0001" && delDone.error === "P0001", JSON.stringify({ cancelDone, delDone }));
  const bRecv = await one(B, "update public.pl_shifts set received_on = (now() at time zone 'America/Sao_Paulo')::date where id = $1", [s2]);
  const bUndo = await one(B, "update public.pl_shifts set received_on = null where id = $1", [s1]);
  check("B não registra nem desfaz recebimento de A (0 linhas)", bRecv.count === 0 && bUndo.count === 0, JSON.stringify({ bRecv, bUndo }));
  const bRead = await one(B, "select coalesce(sum(received_cents), 0)::text as total from public.pl_shifts where received_on is not null");
  check("soma de recebidos calculada por B não inclui A", bRead.rows?.[0]?.total === "0", JSON.stringify(bRead));
  const undo = await one(A, "update public.pl_shifts set received_on = null where id = $1 returning received_cents", [s1]);
  check("desfazer recebimento limpa o valor recebido", undo.rows?.[0]?.received_cents === null, JSON.stringify(undo));
}

// ---------------------------------------------------------------------------
// Ajustes: impostos, Perícias, próxima consulta e colunas novas (migrações 0011 a 0016)
// ---------------------------------------------------------------------------
console.log("\n— Impostos, Perícias e próxima consulta —");
{
  const tables = await asUser(null, q("select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1"));
  const loose = (tables.rows ?? []).filter((t) => !t.rls || !t.forced).map((t) => t.relname);
  check(`todas as ${tables.rows?.length ?? 0} tabelas do app têm RLS habilitada e forçada`, (tables.rows?.length ?? 0) >= 28 && loose.length === 0, loose.join(", "));

  // Percentual de impostos: cada um só altera o próprio; fora de 0–100% é recusado.
  await one(A, "insert into public.user_preferences (user_id) values ($1) on conflict (user_id) do nothing", [A]);
  const rateOther = await one(B, "update public.user_preferences set tax_rate_bp = 1234 where user_id = $1 returning user_id", [A]);
  check("B não altera o percentual de impostos de A", rateOther.count === 0, JSON.stringify(rateOther));
  const rateBad = await one(A, "update public.user_preferences set tax_rate_bp = 10001 where user_id = $1", [A]);
  check("percentual acima de 100% é recusado pelo banco", rateBad.error === "23514", JSON.stringify(rateBad));

  // Perícias (por CNPJ: a alíquota do registro; sem CNPJ: zero)
  const cnpjTax = (await one(A, "insert into public.cnpjs (user_id, name, abbreviation, tax_rate_bp) values ($1, $2, 'Perícias', 900) returning id", [A, `${tag} CNPJ das perícias`])).rows?.[0]?.id;
  const company = (await one(A, "insert into public.per_companies (user_id, name, default_amount_cents, cnpj_id) values ($1, $2, 100000, $3) returning id", [A, `${tag} Empresa`, cnpjTax])).rows?.[0]?.id;
  const exam = (await one(A, "insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, cnpj_id) values ($1, $2, '2026-10-10', '09:00', 100000, 900, $3) returning id", [A, company, cnpjTax])).rows?.[0]?.id;
  check("A cria empresa e perícia", Boolean(cnpjTax && company && exam));
  const examNoCnpj = await one(A, "insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp) values ($1, $2, '2026-10-10', '10:00', 100000, 900)", [A, company]);
  check("perícia sem CNPJ com alíquota é recusada (sem CNPJ não há imposto estimado)", examNoCnpj.error === "23514", JSON.stringify(examNoCnpj));
  const seenB = await one(B, "select (select count(*) from public.per_companies where id = $1)::int + (select count(*) from public.per_exams where id = $2)::int + (select count(*) from public.per_events)::int * 0 as n", [company, exam]);
  check("B não vê empresa nem perícia de A", seenB.rows?.[0]?.n === 0, JSON.stringify(seenB));
  const seenNone = await asUser(null, q("select (select count(*) from public.per_companies)::int + (select count(*) from public.per_exams)::int + (select count(*) from public.per_events)::int as n"));
  check("sem contexto: nenhuma empresa, perícia ou histórico visível", seenNone.rows?.[0]?.n === 0, JSON.stringify(seenNone));
  const crossCompany = await one(B, "insert into public.per_companies (user_id, name, default_amount_cents) values ($1, 'x', 100)", [A]);
  check("B não cria empresa em nome de A", crossCompany.error === "42501", JSON.stringify(crossCompany));
  const crossExam = await one(B, "insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp) values ($1, $2, '2026-10-10', '09:00', 100, 0)", [B, company]);
  check("B não cria perícia na empresa de A (chave estrangeira composta)", crossExam.error === "23503", JSON.stringify(crossExam));
  const updOther = await one(B, "update public.per_exams set status = 'realizada' where id = $1 returning id", [exam]);
  check("B não altera perícia de A", updOther.count === 0, JSON.stringify(updOther));
  const owner = await one(A, "update public.per_exams set user_id = $1 where id = $2", [B, exam]);
  check("dono da perícia não é alterável (sem permissão na coluna)", owner.error === "42501", JSON.stringify(owner));
  const stamp = await one(A, "update public.per_exams set done_at = now() where id = $1", [exam]);
  check("instante de realização não é gravável pelo app", stamp.error === "42501", JSON.stringify(stamp));
  const badRate = await one(A, "update public.per_exams set tax_rate_bp = -1 where id = $1", [exam]);
  check("alíquota inválida é recusada pelo banco", badRate.error === "23514", JSON.stringify(badRate));
  const futureReceipt = await one(A, "update public.per_exams set received_on = (now() at time zone 'America/Sao_Paulo')::date + 30 where id = $1", [exam]);
  check("recebimento com data futura é recusado", futureReceipt.error === "P0001", JSON.stringify(futureReceipt));
  const history = await one(A, "delete from public.per_events where company_id = $1", [company]);
  check("histórico de perícias não é apagável pelo app", history.error === "42501", JSON.stringify(history));
  const delExam = await one(A, "delete from public.per_exams where id = $1 returning id", [exam]);
  const delCompany = await one(A, "delete from public.per_companies where id = $1 returning id", [company]);
  check("A remove a própria perícia agendada e a empresa sem vínculos", delExam.count === 1 && delCompany.count === 1, JSON.stringify({ delExam, delCompany }));

  // Plantões: CNPJ, classificação e alíquota coerentes; função da previsão acessível só pelo gatilho/consulta do app
  const plType = (await one(A, "insert into public.pl_types (user_id, name, default_amount_cents, color, default_amount_kind, pay_day, cnpj_id) values ($1, $2, 100000, '#2563eb', 'bruto', 31, $3) returning id", [A, `${tag} Tipo por CNPJ`, cnpjTax])).rows?.[0]?.id;
  const shift = await one(
    A,
    "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, amount_kind, tax_rate_bp, pay_day, cnpj_id) values ($1, $2, '2027-01-10', 100000, 'bruto', 900, 31, $3) returning id, to_char(expected_pay_date, 'YYYY-MM-DD') as expected",
    [A, plType, cnpjTax],
  );
  check("previsão calculada pelo banco: dia 31 em fevereiro vira o último dia", shift.rows?.[0]?.expected === "2027-02-28", JSON.stringify(shift));
  const noRate = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, amount_kind, cnpj_id) values ($1, $2, '2027-01-11', 100000, 'bruto', $3)", [A, plType, cnpjTax]);
  check("plantão por CNPJ sem alíquota gravada é recusado", noRate.error === "23514", JSON.stringify(noRate));
  const netRate = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, amount_kind, tax_rate_bp) values ($1, $2, '2027-01-11', 100000, 'liquido', 900)", [A, plType]);
  check("plantão sem CNPJ com alíquota é recusado (sem CNPJ não há imposto estimado)", netRate.error === "23514", JSON.stringify(netRate));
  const seenShiftB = await one(B, "select count(*)::int as n from public.pl_shifts where id = $1", [shift.rows?.[0]?.id]);
  check("B não vê o plantão de A com as colunas novas", seenShiftB.rows?.[0]?.n === 0);
  await one(A, "delete from public.pl_shifts where id = $1", [shift.rows?.[0]?.id]);
  await one(A, "delete from public.pl_types where id = $1", [plType]);
  const delCnpjTax = await one(A, "delete from public.cnpjs where id = $1 returning id", [cnpjTax]);
  check("A remove o CNPJ quando nada mais o usa", delCnpjTax.count === 1, JSON.stringify(delCnpjTax));

  // Cartão: área padrão de outra conta é recusada
  const areaOfB = (await newArea(B, "Área padrão de B")).rows?.[0]?.id;
  const cardCross = await one(A, "insert into public.fin_cards (user_id, name, closing_day, due_day, default_area_id) values ($1, $2, 10, 20, $3)", [A, `${tag} Cartão cruzado`, areaOfB]);
  check("cartão de A não aceita área padrão de B (chave estrangeira composta)", cardCross.error === "23503", JSON.stringify(cardCross));

  // Próxima consulta (o app não apaga agendamentos nem pacientes com histórico: limpeza pelo dono)
  const patient = (await one(A, "insert into public.fu_patients (user_id, name) values ($1, $2) returning id", [A, `${tag} Paciente agenda`])).rows?.[0]?.id;
  const appt = (await one(A, "insert into public.fu_appointments (user_id, patient_id, scheduled_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date + 5) returning id", [A, patient])).rows?.[0]?.id;
  check("A agenda a próxima consulta do próprio paciente", Boolean(patient && appt));
  const second = await one(A, "insert into public.fu_appointments (user_id, patient_id, scheduled_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date + 9)", [A, patient]);
  check("só uma próxima consulta em aberto por paciente", second.error === "23505", JSON.stringify(second));
  const apptB = await one(B, "select count(*)::int as n from public.fu_appointments where id = $1", [appt]);
  check("B não vê o agendamento de A", apptB.rows?.[0]?.n === 0);
  const apptCross = await one(B, "insert into public.fu_appointments (user_id, patient_id, scheduled_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date + 5)", [B, patient]);
  check("B não agenda para paciente de A (recusa pela chave estrangeira, sem revelar o agendamento)", apptCross.error === "23503", JSON.stringify(apptCross));
  const apptAsA = await one(B, "insert into public.fu_appointments (user_id, patient_id, scheduled_date) values ($1, $2, (now() at time zone 'America/Sao_Paulo')::date + 5)", [A, patient]);
  check("B não grava agendamento em nome de A", apptAsA.error === "42501", JSON.stringify(apptAsA));
  const apptDel = await one(A, "delete from public.fu_appointments where id = $1", [appt]);
  check("agendamento não é apagável pelo app (cancelar mantém o registro)", apptDel.error === "42501", JSON.stringify(apptDel));
  const cancel = await one(A, "update public.fu_appointments set status = 'cancelada' where id = $1 returning canceled_at is not null as stamped", [appt]);
  const reopen = await one(A, "update public.fu_appointments set status = 'agendada' where id = $1", [appt]);
  check("cancelamento carimbado pelo servidor e definitivo", cancel.rows?.[0]?.stamped === true && reopen.error === "P0001", JSON.stringify({ cancel, reopen }));
  if (process.env.DATABASE_URL_UNPOOLED) {
    const own = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
    await own.query("delete from public.fu_appointments where patient_id = $1", [patient]);
    await own.query("delete from public.fu_patients where id = $1", [patient]);
    await own.end();
  }
  const leftAppt = await one(A, "select count(*)::int as n from public.fu_patients where id = $1", [patient]);
  check("limpeza dos registros desta seção", leftAppt.rows?.[0]?.n === 0, JSON.stringify(leftAppt));
}

// ---------------------------------------------------------------------------
// CNPJ (migração 0020): cadastro por conta e marcação "recebo por CNPJ" em plantões e perícias
// ---------------------------------------------------------------------------
console.log("\n— CNPJ —");
{
  const todaySp = (await one(A, "select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d")).rows?.[0]?.d;
  const cnpj = (await one(A, "insert into public.cnpjs (user_id, name, abbreviation, cnpj_number, tax_rate_bp, tax_due_day) values ($1, $2, 'CNPJ A', '11222333000181', 900, 20) returning id", [A, `${tag} CNPJ de A`])).rows?.[0]?.id;
  check("A cadastra o próprio CNPJ", Boolean(cnpj));
  const seenB = await one(B, "select count(*)::int as n from public.cnpjs where id = $1", [cnpj]);
  check("B não vê o CNPJ de A", seenB.rows?.[0]?.n === 0, JSON.stringify(seenB));
  const seenNone = await asUser(null, q("select count(*)::int as n from public.cnpjs"));
  check("sem contexto: nenhum CNPJ visível", seenNone.rows?.[0]?.n === 0, JSON.stringify(seenNone));
  const insAsA = await one(B, "insert into public.cnpjs (user_id, name, abbreviation, tax_rate_bp) values ($1, 'x', 'x', 900)", [A]);
  check("B não cadastra CNPJ em nome de A", insAsA.error === "42501", JSON.stringify(insAsA));
  const updB = await one(B, "update public.cnpjs set tax_rate_bp = 1 where id = $1 returning id", [cnpj]);
  check("B não altera o CNPJ de A (0 linhas)", updB.count === 0, JSON.stringify(updB));
  const delB = await one(B, "delete from public.cnpjs where id = $1 returning id", [cnpj]);
  check("B não apaga o CNPJ de A (0 linhas)", delB.count === 0, JSON.stringify(delB));
  const owner = await one(A, "update public.cnpjs set user_id = $1 where id = $2", [B, cnpj]);
  check("dono do CNPJ não é alterável (sem permissão na coluna)", owner.error === "42501", JSON.stringify(owner));
  const badRate = await one(A, "update public.cnpjs set tax_rate_bp = 10001 where id = $1", [cnpj]);
  check("percentual acima de 100% é recusado", badRate.error === "23514", JSON.stringify(badRate));
  const badDay = await one(A, "update public.cnpjs set tax_due_day = 0 where id = $1", [cnpj]);
  check("dia de pagamento fora de 1 a 31 é recusado", badDay.error === "23514", JSON.stringify(badDay));
  const badNumber = await one(A, "update public.cnpjs set cnpj_number = '11.222.333/0001-81' where id = $1", [cnpj]);
  check("número do CNPJ com pontuação é recusado (guardado só com os 14 caracteres)", badNumber.error === "23514", JSON.stringify(badNumber));
  const dup = await one(A, "insert into public.cnpjs (user_id, name, abbreviation, tax_rate_bp) values ($1, $2, 'Duplicado', 900)", [A, `${tag} cnpj de a`]);
  check("nome repetido na mesma conta é recusado", dup.error === "23505", JSON.stringify(dup));
  const sameNameB = (await one(B, "insert into public.cnpjs (user_id, name, abbreviation, tax_rate_bp) values ($1, $2, 'CNPJ B', 600) returning id", [B, `${tag} CNPJ de A`])).rows?.[0]?.id;
  check("o mesmo nome em outra conta é aceito", Boolean(sameNameB));

  // Marcação nos registros: sempre um CNPJ da própria conta.
  const typeA = (await one(A, "insert into public.pl_types (user_id, name, default_amount_cents, color, default_amount_kind, cnpj_id) values ($1, $2, 100000, '#2563eb', 'bruto', $3) returning id", [A, `${tag} Tipo CNPJ`, cnpj])).rows?.[0]?.id;
  const typeB = (await one(B, "insert into public.pl_types (user_id, name, default_amount_cents, color, default_amount_kind) values ($1, $2, 100000, '#2563eb', 'liquido') returning id", [B, `${tag} Tipo de B`])).rows?.[0]?.id;
  check("A cria tipo de plantão por CNPJ e B, um tipo sem CNPJ", Boolean(typeA && typeB));
  const typeCross = await one(B, "update public.pl_types set default_amount_kind = 'bruto', cnpj_id = $2 where id = $1", [typeB, cnpj]);
  check("tipo de B não aceita o CNPJ de A (chave estrangeira composta)", typeCross.error === "23503", JSON.stringify(typeCross));
  const shiftCross = await one(B, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, amount_kind, tax_rate_bp, cnpj_id) values ($1, $2, '2027-03-10', 100000, 'bruto', 900, $3)", [B, typeB, cnpj]);
  check("plantão de B não aceita o CNPJ de A", shiftCross.error === "23503", JSON.stringify(shiftCross));
  const noCnpj = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, amount_kind, tax_rate_bp) values ($1, $2, '2027-03-10', 100000, 'bruto', 900)", [A, typeA]);
  check("plantão com imposto estimado sem CNPJ é recusado", noCnpj.error === "23514", JSON.stringify(noCnpj));
  const kindMismatch = await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, amount_kind, cnpj_id) values ($1, $2, '2027-03-10', 100000, 'liquido', $3)", [A, typeA, cnpj]);
  check("plantão marcado com CNPJ sem ser por CNPJ no valor é recusado", kindMismatch.error === "23514", JSON.stringify(kindMismatch));
  const shiftA = (await one(A, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, amount_kind, tax_rate_bp, cnpj_id) values ($1, $2, $4::date - 3, 100000, 'bruto', 900, $3) returning id", [A, typeA, cnpj, todaySp])).rows?.[0]?.id;
  check("A cria plantão por CNPJ", Boolean(shiftA));
  const seriesA = (await one(A, "insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, end_date, amount_cents, amount_kind, tax_rate_bp, cnpj_id) values ($1, $2, 2, 1, '2031-01-06', '2031-01-06', 100000, 'bruto', 900, $3) returning id", [A, typeA, cnpj])).rows?.[0]?.id;
  if (typeA) (created.plTypes ??= new Set()).add(typeA);
  const seriesCnpj = await one(A, "update public.pl_series set cnpj_id = null, amount_kind = 'liquido', tax_rate_bp = null where id = $1", [seriesA]);
  check("recorrência não troca de CNPJ por UPDATE (só por nova recorrência)", Boolean(seriesA) && seriesCnpj.error === "42501", JSON.stringify(seriesCnpj));
  const companyB = (await one(B, "insert into public.per_companies (user_id, name, default_amount_cents) values ($1, $2, 100000) returning id", [B, `${tag} Empresa de B`])).rows?.[0]?.id;
  const companyCross = await one(B, "update public.per_companies set cnpj_id = $2 where id = $1", [companyB, cnpj]);
  check("empresa de B não aceita o CNPJ de A", companyCross.error === "23503", JSON.stringify(companyCross));
  const examCross = await one(B, "insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, cnpj_id) values ($1, $2, '2027-03-10', '09:00', 100000, 900, $3)", [B, companyB, cnpj]);
  check("perícia de B não aceita o CNPJ de A", examCross.error === "23503", JSON.stringify(examCross));

  // Recebimento registrado: o valor continua travado; alíquota e marcação de CNPJ podem ser corrigidas.
  const receive = await one(A, "update public.pl_shifts set received_on = $2::date where id = $1 returning received_cents::int as cents", [shiftA, todaySp]);
  const lockedAmount = await one(A, "update public.pl_shifts set amount_cents = 1 where id = $1", [shiftA]);
  check("plantão recebido não aceita mudança de valor", receive.rows?.[0]?.cents === 100000 && lockedAmount.error === "P0001", JSON.stringify({ receive, lockedAmount }));
  const newRate = await one(A, "update public.pl_shifts set tax_rate_bp = 1100 where id = $1 returning tax_rate_bp", [shiftA]);
  check("plantão recebido aceita a nova alíquota do CNPJ", newRate.rows?.[0]?.tax_rate_bp === 1100, JSON.stringify(newRate));
  const unmark = await one(A, "update public.pl_shifts set amount_kind = 'liquido', tax_rate_bp = null, cnpj_id = null where id = $1 returning received_cents::int as cents", [shiftA]);
  check("plantão recebido aceita desmarcar o CNPJ sem mexer no valor recebido", unmark.rows?.[0]?.cents === 100000, JSON.stringify(unmark));
  await one(A, "update public.pl_shifts set amount_kind = 'bruto', tax_rate_bp = 900, cnpj_id = $2 where id = $1", [shiftA, cnpj]);

  const inUse = await one(A, "delete from public.cnpjs where id = $1", [cnpj]);
  check("CNPJ em uso não é apagado", inUse.error === "23001" || inUse.error === "23503", JSON.stringify(inUse));

  // Limpeza desta seção: o app desfaz o recebimento e apaga o que criou; a recorrência sai na limpeza final (pelo tipo).
  await one(A, "update public.pl_shifts set received_on = null where id = $1", [shiftA]);
  const delShift = await one(A, "delete from public.pl_shifts where id = $1 returning id", [shiftA]);
  await one(B, "delete from public.per_companies where id = $1", [companyB]);
  await one(B, "delete from public.pl_types where id = $1", [typeB]);
  const delCnpjB = await one(B, "delete from public.cnpjs where id = $1 returning id", [sameNameB]);
  check("B apaga o próprio CNPJ, sem uso; A apaga o próprio plantão", delCnpjB.count === 1 && delShift.count === 1, JSON.stringify({ delCnpjB, delShift }));
  if (process.env.DATABASE_URL_UNPOOLED) {
    // A recorrência (sem DELETE para o app) e o tipo saem com a conexão do dono; depois, o CNPJ.
    const own = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
    await own.query("delete from public.pl_events where type_id = $1", [typeA]);
    await own.query("delete from public.pl_shifts where type_id = $1", [typeA]);
    await own.query("delete from public.pl_series where type_id = $1", [typeA]);
    await own.query("delete from public.pl_types where id = $1", [typeA]);
    await own.query("delete from public.cnpjs where id = $1", [cnpj]);
    await own.end();
    created.plTypes?.delete(typeA);
  }
  const left = await one(A, "select (select count(*) from public.cnpjs where name like $1)::int + (select count(*) from public.pl_types where id = $2)::int + (select count(*) from public.pl_shifts where id = $3)::int as n", [`${tag}%`, typeA, shiftA]);
  const leftB = await one(B, "select (select count(*) from public.cnpjs where name like $1)::int + (select count(*) from public.pl_types where id = $2)::int + (select count(*) from public.per_companies where id = $3)::int as n", [`${tag}%`, typeB, companyB]);
  check("limpeza dos registros desta seção", left.rows?.[0]?.n === 0 && leftB.rows?.[0]?.n === 0, JSON.stringify({ left, leftB }));
}

// Limpeza: somente os registros criados nesta rodada (pelas áreas criadas e tudo que depende delas).
// Usa a conexão do dono porque o app não tem DELETE em séries/exceções/cartões (por desenho).
{
  let removed = 0;
  const areaIds = [...created.areas.keys()];
  const owner = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  const c = await owner.connect();
  try {
    await c.query("begin");
    // Follow-up: histórico, etapas e planos (quando existirem), consultas, pacientes e modelos da rodada.
    const fuPatients = [...(created.fuPatients ?? [])];
    const fuTemplates = [...(created.fuTemplates ?? [])];
    const fuTable = async (t) => (await c.query("select to_regclass($1) is not null as ok", [`public.${t}`])).rows[0].ok;
    if (await fuTable("fu_events")) removed += (await c.query("delete from public.fu_events where patient_id = any($1::uuid[])", [fuPatients])).rowCount ?? 0;
    if (await fuTable("fu_steps")) {
      removed += (await c.query("delete from public.fu_steps where plan_id in (select id from public.fu_plans where patient_id = any($1::uuid[]))", [fuPatients])).rowCount ?? 0;
      removed += (await c.query("delete from public.fu_plans where patient_id = any($1::uuid[])", [fuPatients])).rowCount ?? 0;
    }
    if (await fuTable("fu_patients")) {
      removed += (await c.query("delete from public.fu_consultations where patient_id = any($1::uuid[])", [fuPatients])).rowCount ?? 0;
      removed += (await c.query("delete from public.fu_patients where id = any($1::uuid[])", [fuPatients])).rowCount ?? 0;
      removed += (await c.query("delete from public.fu_template_steps where template_id = any($1::uuid[])", [fuTemplates])).rowCount ?? 0;
      removed += (await c.query("delete from public.fu_templates where id = any($1::uuid[])", [fuTemplates])).rowCount ?? 0;
    }
    // Plantões: histórico, ocorrências, séries/exceções (quando existirem) e tipos da rodada.
    const plTypes = [...(created.plTypes ?? [])];
    if (plTypes.length && (await fuTable("pl_types"))) {
      removed += (await c.query("delete from public.pl_events where type_id = any($1::uuid[]) or shift_id in (select id from public.pl_shifts where type_id = any($1::uuid[]))", [plTypes])).rowCount ?? 0;
      removed += (await c.query("delete from public.pl_shifts where type_id = any($1::uuid[])", [plTypes])).rowCount ?? 0;
      if (await fuTable("pl_series")) {
        removed += (await c.query("delete from public.pl_series_exceptions where series_id in (select id from public.pl_series where type_id = any($1::uuid[]))", [plTypes])).rowCount ?? 0;
        removed += (await c.query("delete from public.pl_series where type_id = any($1::uuid[])", [plTypes])).rowCount ?? 0;
      }
      removed += (await c.query("delete from public.pl_types where id = any($1::uuid[])", [plTypes])).rowCount ?? 0;
    }
    const cardIds = [...(created.cards ?? [])];
    // O guarda de fatura paga vale para todos os papéis: reabre antes de remover cobranças.
    if (cardIds.length) {
      await c.query("update public.fin_invoices set status = 'pendente', paid_on = null where card_id = any($1::uuid[])", [cardIds]);
      removed += (await c.query("delete from public.fin_card_charges where card_id = any($1::uuid[])", [cardIds])).rowCount ?? 0;
      removed += (await c.query("delete from public.fin_card_purchases where card_id = any($1::uuid[])", [cardIds])).rowCount ?? 0;
    }
    const steps = [
      ["fin_card_charges", "purchase_id in (select id from public.fin_card_purchases where area_id = any($1::uuid[]))"],
      ["fin_card_purchases", "area_id = any($1::uuid[])"],
      ["fin_entries", "area_id = any($1::uuid[])"],
      ["fin_events", "entity_id in (select id from public.fin_installment_plans where area_id = any($1::uuid[]))"],
      ["fin_installment_plans", "area_id = any($1::uuid[])"],
      ["fin_series_exceptions", "series_id in (select id from public.fin_series where area_id = any($1::uuid[]))"],
      ["fin_series", "area_id = any($1::uuid[])"],
      ["fin_areas", "id = any($1::uuid[])"],
    ];
    for (const [table, where] of steps) {
      if (!(await c.query("select to_regclass($1) is not null as ok", [`public.${table}`])).rows[0].ok) continue;
      removed += (await c.query(`delete from public.${table} where ${where}`, [areaIds])).rowCount ?? 0;
    }
    for (const cardId of created.cards ?? []) {
      removed += (await c.query("delete from public.fin_invoices where card_id = $1", [cardId])).rowCount ?? 0;
      removed += (await c.query("delete from public.fin_cards where id = $1", [cardId])).rowCount ?? 0;
    }
    await c.query("commit");
  } catch (error) {
    await c.query("rollback").catch(() => {});
    console.error("limpeza falhou:", error.code);
  } finally {
    c.release();
    await owner.end();
  }
  const left = await one(A, "select count(*)::int as n from public.fin_areas where name like $1", [`${tag}%`]);
  const leftB = await one(B, "select count(*)::int as n from public.fin_areas where name like $1", [`${tag}%`]);
  check(`limpeza: ${removed} registros de teste removidos, nenhum resíduo`, left.rows?.[0]?.n === 0 && leftB.rows?.[0]?.n === 0, JSON.stringify({ left, leftB }));
}

await pool.end();

// Limpeza das linhas de ids aleatórios (somente com a conexão do dono; o app não tem DELETE).
if (!realIds && process.env.DATABASE_URL_UNPOOLED) {
  const cleanup = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  await cleanup.query("delete from public.user_preferences where user_id = any($1::uuid[])", [[A, B]]);
  await cleanup.end();
  console.log("\n(linhas de teste com ids aleatórios removidas com a conexão do dono)");
}

console.log(`\n${failures === 0 ? "Todas as verificações passaram." : `${failures} verificação(ões) falharam.`}`);
process.exit(failures === 0 ? 0 : 1);
