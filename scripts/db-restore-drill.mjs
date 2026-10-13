// ENSAIO DE BACKUP E RESTAURAÇÃO (dados fictícios conhecidos, ambiente descartável).
//
// 1. Insere um cenário FICTÍCIO "[teste-backup]" nas contas de teste A e B da branch development.
// 2. Faz o backup lógico (db-backup) para uma pasta temporária FORA do repositório.
// 3. Cria uma branch DESCARTÁVEL do Neon a partir de "production" (sem tabelas do app; a production
//    não é alterada) e obtém a conexão sem imprimi-la.
// 4. Restaura (db-restore): migrações do repositório → dados → contagens, md5, estrutura, FKs.
// 5. Confere RLS e permissões com o papel do app (senha aleatória só na branch descartável, só em memória):
//    sem contexto nada aparece; A vê só o que é de A; B só o de B; escrita cruzada e colunas sem grant negadas;
//    valores do cenário (calculados à mão) batem.
// 6. Sempre ao final: apaga a branch descartável, o cenário (por IDs conhecidos) e a pasta do backup.
//
// Uso: npm run db:restore-drill            (--keep-backup mantém a pasta temporária)

import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@neondatabase/serverless";
import { runBackup } from "./db-backup.mjs";
import { runRestore } from "./db-restore.mjs";
import { assertBranch } from "./lib/branch-guard.mjs";
import { compareStructure, normalizeSession, structureFingerprint } from "./lib/db-snapshot.mjs";
import { requireEnv } from "./lib/env-file.mjs";

requireEnv(["DATABASE_URL_UNPOOLED", "RLS_TEST_A_ID", "RLS_TEST_B_ID"]);
assertBranch("db:restore-drill");
const A = process.env.RLS_TEST_A_ID;
const B = process.env.RLS_TEST_B_ID;
const P = "[teste-backup]";
const PARENT = process.env.DRILL_PARENT_BRANCH ?? "production";
const project = JSON.parse(readFileSync(".neon", "utf8")).projectId;
const ownerUrl = new URL(process.env.DATABASE_URL_UNPOOLED);
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const today = fmt.format(new Date());
const addDays = (civil, n) => new Date(Date.parse(`${civil}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** neon CLI com saída capturada (nunca impressa: pode conter credenciais). */
function neon(args) {
  // Argumentos fixos deste script (sem entrada externa); shell necessário para o neon.cmd no Windows.
  const r = spawnSync(["neon", ...args, "--project-id", project].join(" "), { shell: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`neon ${args[0]} ${args[1] ?? ""} falhou (código ${r.status}).`);
  return r.stdout.trim();
}

async function withClient(url, fn) {
  const c = new Client(url);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// ---------- 1) Cenário fictício (dono da branch development; regras do banco valem) ----------
const ids = { A: {}, B: {} };
async function seed() {
  await withClient(process.env.DATABASE_URL_UNPOOLED, async (c) => {
    const one = async (sql, params) => (await c.query(sql, params)).rows[0].id;
    await c.query("begin");
    try {
      const a = ids.A;
      a.area = await one("insert into public.fin_areas (user_id, name, color) values ($1, $2, '#2563eb') returning id", [A, `${P} Casa`]);
      a.luz = await one("insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date) values ($1, $2, $3, 12345, $4::date) returning id", [A, a.area, `${P} Luz`, today]);
      a.fixa = await one("insert into public.fin_series (user_id, area_id, description, amount_kind, amount_cents, frequency, interval_months, start_date, generated_until) values ($1, $2, $3, 'fixo', 2500, 'mensal', 1, $4::date, $4::date) returning id", [A, a.area, `${P} Internet`, today]);
      a.fixaEntry = await one("insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, series_id, occurrence_date) values ($1, $2, $3, 2500, $4::date, $5, $4::date) returning id", [A, a.area, `${P} Internet`, today, a.fixa]);
      await c.query("insert into public.fin_series_exceptions (series_id, user_id, occurrence_date) values ($1, $2, $3::date)", [a.fixa, A, addDays(today, 31)]);
      a.variavel = await one("insert into public.fin_series (user_id, area_id, description, amount_kind, frequency, interval_months, start_date, generated_until) values ($1, $2, $3, 'variavel', 'mensal', 1, $4::date, $4::date) returning id", [A, a.area, `${P} Água`, today]);
      a.variavelEntry = await one("insert into public.fin_entries (user_id, area_id, description, due_date, series_id, occurrence_date, is_variable) values ($1, $2, $3, $4::date, $5, $4::date, true) returning id", [A, a.area, `${P} Água`, today, a.variavel]);
      a.plano = await one("insert into public.fin_installment_plans (user_id, area_id, description, total_cents, installments_count, first_due_date, request_id) values ($1, $2, $3, 10000, 2, $4::date, $5) returning id", [A, a.area, `${P} Geladeira`, today, randomUUID()]);
      a.parcelas = [];
      for (const n of [1, 2]) a.parcelas.push(await one("insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date, installment_plan_id, installment_number) values ($1, $2, $3, 5000, $4::date, $5, $6) returning id", [A, a.area, `${P} Geladeira`, addDays(today, (n - 1) * 30), a.plano, n]));
      a.cartao = await one("insert into public.fin_cards (user_id, name, closing_day, due_day) values ($1, $2, 1, 10) returning id", [A, `${P} Cartão`]);
      a.fatura = await one("insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date) values ($1, $2, $3::date, $4::date, $5::date) returning id", [A, a.cartao, `${today.slice(0, 7)}-01`, addDays(today, -1), addDays(today, 5)]);
      a.compra = await one("insert into public.fin_card_purchases (user_id, card_id, area_id, description, purchase_date, total_cents, installments_count, request_id) values ($1, $2, $3, $4, $5::date, 30000, 1, $6) returning id", [A, a.cartao, a.area, `${P} Mercado`, addDays(today, -2), randomUUID()]);
      await c.query("insert into public.fin_card_charges (user_id, card_id, purchase_id, invoice_id, installment_number, amount_cents) values ($1, $2, $3, $4, 1, 30000)", [A, a.cartao, a.compra, a.fatura]);
      a.finEvento = await one("insert into public.fin_events (user_id, entity_type, entity_id, action, details) values ($1, 'cartao', $2, 'criado', '{\"origem\": \"ensaio\"}') returning id", [A, a.cartao]);

      a.modelo = await one("insert into public.fu_templates (user_id, name) values ($1, $2) returning id", [A, `${P} Modelo`]);
      for (const [d, pos] of [[0, 0], [7, 1]]) await c.query("insert into public.fu_template_steps (user_id, template_id, day_offset, message, position) values ($1, $2, $3, 'Mensagem fictícia', $4)", [A, a.modelo, d, pos]);
      a.paciente = await one("insert into public.fu_patients (user_id, name, phone, notes) values ($1, $2, '+5511900000000', 'Observação fictícia') returning id", [A, `${P} Paciente Fictício`]);
      a.consulta = await one("insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, $3::date) returning id", [A, a.paciente, addDays(today, -1)]);
      a.planoFu = await one("insert into public.fu_plans (user_id, patient_id, consultation_id, template_id, template_name, template_version, request_id) values ($1, $2, $3, $4, 'Modelo', 1, $5) returning id", [A, a.paciente, a.consulta, a.modelo, randomUUID()]);
      a.etapas = [];
      for (const d of [0, 7]) a.etapas.push(await one("insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, $3, 'Mensagem fictícia', $4::date, $4::date) returning id", [A, a.planoFu, d, addDays(today, d - 1)]));
      a.fuEvento = await one("insert into public.fu_events (user_id, patient_id, consultation_id, plan_id, action) values ($1, $2, $3, $4, 'plano_criado') returning id", [A, a.paciente, a.consulta, a.planoFu]);

      a.tipo = await one("insert into public.pl_types (user_id, name, default_amount_cents, color) values ($1, $2, 100000, '#16a34a') returning id", [A, `${P} Hospital`]);
      a.serie = await one("insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, amount_cents, start_time, end_time, end_next_day) values ($1, $2, 127, 1, $3::date, 80000, '07:00', '19:00', false) returning id", [A, a.tipo, today]);
      await c.query("insert into public.pl_series_exceptions (series_id, user_id, original_date) values ($1, $2, $3::date)", [a.serie, A, addDays(today, 1)]);
      a.plantaoSerie = await one("insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents, series_id, original_date) values ($1, $2, $3::date, '07:00', '19:00', false, 80000, $4, $3::date) returning id", [A, a.tipo, today, a.serie]);
      a.plantao = await one("insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents) values ($1, $2, $3::date, '19:00', '07:00', true, 100000) returning id", [A, a.tipo, addDays(today, -3)]);
      await c.query("update public.pl_shifts set status = 'realizado', done_at = now(), received_on = $2::date, received_cents = 100000 where id = $1", [a.plantao, addDays(today, -1)]);
      a.plEvento = await one("insert into public.pl_events (user_id, shift_id, type_id, action) values ($1, $2, $3, 'recebido') returning id", [A, a.plantao, a.tipo]);

      const b = ids.B;
      b.area = await one("insert into public.fin_areas (user_id, name, color) values ($1, $2, '#dc2626') returning id", [B, `${P} B Área`]);
      b.conta = await one("insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date) values ($1, $2, $3, 777, $4::date) returning id", [B, b.area, `${P} B Conta`, today]);
      b.paciente = await one("insert into public.fu_patients (user_id, name) values ($1, $2) returning id", [B, `${P} B Paciente`]);
      await c.query("commit");
    } catch (error) {
      await c.query("rollback").catch(() => {});
      throw error;
    }
  });
}

/** Remove SÓ o cenário, pelos IDs guardados (dono; ordem filhos → pais). */
async function cleanupSeed() {
  const a = ids.A;
  const b = ids.B;
  return withClient(process.env.DATABASE_URL_UNPOOLED, async (c) => {
    let n = 0;
    const q = async (sql, params) => {
      if (params.some((p) => p === undefined || (Array.isArray(p) && !p.length))) return;
      n += (await c.query(sql, params)).rowCount ?? 0;
    };
    await c.query("begin");
    try {
      await q("delete from public.pl_events where id = $1", [a.plEvento]);
      await q("delete from public.pl_shifts where id = any($1::uuid[])", [[a.plantaoSerie, a.plantao].filter(Boolean)]);
      await q("delete from public.pl_series_exceptions where series_id = $1", [a.serie]);
      await q("delete from public.pl_series where id = $1", [a.serie]);
      await q("delete from public.pl_types where id = $1", [a.tipo]);
      await q("delete from public.fu_events where id = $1", [a.fuEvento]);
      await q("delete from public.fu_steps where plan_id = $1", [a.planoFu]);
      await q("delete from public.fu_plans where id = $1", [a.planoFu]);
      await q("delete from public.fu_consultations where id = $1", [a.consulta]);
      await q("delete from public.fu_patients where id = any($1::uuid[])", [[a.paciente, b.paciente].filter(Boolean)]);
      await q("delete from public.fu_template_steps where template_id = $1", [a.modelo]);
      await q("delete from public.fu_templates where id = $1", [a.modelo]);
      await q("delete from public.fin_events where id = $1", [a.finEvento]);
      await q("delete from public.fin_card_charges where purchase_id = $1", [a.compra]);
      await q("delete from public.fin_card_purchases where id = $1", [a.compra]);
      await q("delete from public.fin_invoices where id = $1", [a.fatura]);
      await q("delete from public.fin_cards where id = $1", [a.cartao]);
      await q("delete from public.fin_entries where id = any($1::uuid[])", [[a.luz, a.fixaEntry, a.variavelEntry, ...(a.parcelas ?? []), b.conta].filter(Boolean)]);
      await q("delete from public.fin_installment_plans where id = $1", [a.plano]);
      await q("delete from public.fin_series_exceptions where series_id = $1", [a.fixa]);
      await q("delete from public.fin_series where id = any($1::uuid[])", [[a.fixa, a.variavel].filter(Boolean)]);
      await q("delete from public.fin_areas where id = any($1::uuid[])", [[a.area, b.area].filter(Boolean)]);
      await c.query("commit");
    } catch (error) {
      await c.query("rollback").catch(() => {});
      throw error;
    }
    return n;
  });
}

// ---------- 5) RLS e permissões no destino, com o papel do app ----------
async function verifyRls(targetUrl, manifest) {
  const password = randomBytes(32).toString("base64url");
  await withClient(targetUrl, (c) => c.query(`alter role app_runtime with login password '${password}'`));
  const appUrl = new URL(targetUrl);
  appUrl.username = "app_runtime";
  appUrl.password = password;
  const tables = manifest.tables.filter((t) => t.schema === "public").map((t) => `public.${t.table}`);

  // Esperado por usuário, contado pelo dono no destino (o dono ignora o RLS).
  const expected = await withClient(targetUrl, async (c) => {
    const out = {};
    for (const t of tables) {
      const { rows } = await c.query(`select count(*) filter (where user_id = $1)::int as a, count(*) filter (where user_id = $2)::int as b from ${t}`, [A, B]);
      out[t] = rows[0];
    }
    return out;
  });

  await withClient(appUrl.toString(), async (c) => {
    const role = (await c.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user")).rows[0];
    check("papel do app restaurado sem superusuário nem BYPASSRLS", !role.rolsuper && !role.rolbypassrls);
    const as = async (user, fn) => {
      await c.query("begin");
      try {
        if (user) await c.query("select set_config('app.user_id', $1, true)", [user]);
        return await fn();
      } finally {
        await c.query("rollback");
      }
    };
    const counts = async (user) => as(user, async () => {
      const out = {};
      for (const t of tables) out[t] = (await c.query(`select count(*)::int as n from ${t}`)).rows[0].n;
      return out;
    });
    const none = await counts(null);
    check("sem contexto de usuário: nenhuma linha visível", Object.values(none).every((n) => n === 0), `${tables.length} tabela(s)`);
    const seenA = await counts(A);
    const seenB = await counts(B);
    const badA = tables.filter((t) => seenA[t] !== expected[t].a);
    const badB = tables.filter((t) => seenB[t] !== expected[t].b);
    check("A vê exatamente as linhas de A em todas as tabelas", !badA.length, badA.join(", "));
    check("B vê exatamente as linhas de B em todas as tabelas", !badB.length, badB.join(", "));

    // Valores do cenário (calculados à mão): 5 contas de A = 12.345 + 2.500 + 5.000 + 5.000 conhecidos + 1 variável;
    // fatura com 1 cobrança de 30.000; 2 etapas pendentes; plantões 80.000 + 100.000, recebido 100.000.
    const v = await as(A, async () => (await c.query(
      `select (select count(*) from public.fin_entries where description like $1)::int as contas,
              (select sum(amount_cents) from public.fin_entries where description like $1)::text as conhecido,
              (select count(*) from public.fin_entries where description like $1 and amount_cents is null)::int as a_informar,
              (select sum(amount_cents) from public.fin_card_charges where invoice_id = $2)::text as fatura,
              (select count(*) from public.fu_steps where plan_id = $3 and status = 'pendente')::int as etapas,
              (select sum(amount_cents) from public.pl_shifts where type_id = $4)::text as plantoes,
              (select sum(received_cents) from public.pl_shifts where type_id = $4)::text as recebido,
              (select count(*) from public.fin_series_exceptions where series_id = $5)::int as excecoes,
              (select count(*) from public.fin_entries where id = $6)::int as conta_de_b`,
      [`${P}%`, ids.A.fatura, ids.A.planoFu, ids.A.tipo, ids.A.fixa, ids.B.conta],
    )).rows[0]);
    check(
      "valores do cenário de A idênticos aos calculados à mão",
      v.contas === 5 && v.conhecido === "24845" && v.a_informar === 1 && v.fatura === "30000" && v.etapas === 2 && v.plantoes === "180000" && v.recebido === "100000" && v.excecoes === 1 && v.conta_de_b === 0,
      `contas ${v.contas}, conhecido ${v.conhecido}, a informar ${v.a_informar}, fatura ${v.fatura}, etapas ${v.etapas}, plantões ${v.plantoes}, recebido ${v.recebido}, conta de B visível a A: ${v.conta_de_b}`,
    );
    const relB = await as(B, async () => (await c.query("select (select sum(amount_cents) from public.fin_entries where id = $1)::text as conta, (select count(*) from public.fu_patients where id = $2)::int as paciente, (select count(*) from public.fin_entries where id = $3)::int as luz_de_a", [ids.B.conta, ids.B.paciente, ids.A.luz])).rows[0]);
    check("valores de B e isolamento A/B no destino", relB.conta === "777" && relB.paciente === 1 && relB.luz_de_a === 0);
    const relations = await as(A, async () => (await c.query(
      `select (select count(*) from public.fin_entries e join public.fin_installment_plans p on p.id = e.installment_plan_id and p.user_id = e.user_id where p.id = $1)::int as parcelas,
              (select count(*) from public.fin_card_charges ch join public.fin_card_purchases pu on pu.id = ch.purchase_id join public.fin_invoices i on i.id = ch.invoice_id where i.id = $2)::int as cobrancas,
              (select count(*) from public.fu_steps s join public.fu_plans pl on pl.id = s.plan_id join public.fu_consultations co on co.id = pl.consultation_id join public.fu_patients pa on pa.id = co.patient_id where pa.id = $3)::int as etapas,
              (select count(*) from public.pl_shifts s join public.pl_series se on se.id = s.series_id where se.id = $4)::int as da_serie`,
      [ids.A.plano, ids.A.fatura, ids.A.paciente, ids.A.serie],
    )).rows[0]);
    check("relações navegáveis (parcelas→plano, cobrança→compra/fatura, etapa→plano→consulta→paciente, plantão→série)", relations.parcelas === 2 && relations.cobrancas === 1 && relations.etapas === 2 && relations.da_serie === 1, JSON.stringify(relations));

    const denied = async (user, sql, params) => as(user, async () => {
      try {
        await c.query(sql, params);
        return false;
      } catch (error) {
        return error.code === "42501";
      }
    });
    check("A não grava linha em nome de B (RLS)", await denied(A, "insert into public.fin_areas (user_id, name, color) values ($1, 'x', '#000000')", [B]));
    check("coluna sem permissão não é alterável (grant por coluna)", await denied(A, "update public.fin_entries set user_id = $1 where id = $2", [B, ids.A.luz]));
    check("tabela interna de migrações inacessível ao app", await denied(A, "select count(*) from app_private.schema_migrations", []));
  });
}

// ---------- Execução ----------
const branchName = `restore-drill-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
let branchId = null;
let backupDir = null;
let failed = false;
try {
  console.log(`Ensaio: hoje ${today} (São Paulo). Branch descartável "${branchName}" a partir de "${PARENT}".`);
  await seed();
  check("cenário fictício inserido em development", true, "contas A e B, prefixo [teste-backup]");

  backupDir = mkdtempSync(join(tmpdir(), "app-pessoal-backup-ensaio-"));
  const manifest = await withClient(process.env.DATABASE_URL_UNPOOLED, (c) => runBackup(c, backupDir, { branch: process.env.NEON_BRANCH, log: () => {} }));
  const total = manifest.tables.reduce((s, t) => s + t.rows, 0);
  check("backup lógico gravado fora do repositório", true, `${manifest.tables.length} tabela(s), ${total} linha(s), migrações até ${manifest.migrations.at(-1).version}`);

  const created = JSON.parse(neon(["branches", "create", "--name", branchName, "--parent", PARENT, "--no-secrets", "--output", "json"]));
  branchId = (created.branch ?? created).id;
  check("branch descartável criada", Boolean(branchId), branchId);
  const targetUrl = neon(["connection-string", branchId, "--role-name", decodeURIComponent(ownerUrl.username), "--database-name", ownerUrl.pathname.slice(1)]);
  if (!/^postgres(ql)?:\/\//.test(targetUrl)) throw new Error("Conexão da branch descartável não obtida.");

  const { checks } = await runRestore(targetUrl, backupDir, { log: () => {} });
  for (const c of checks) check(`restauração: ${c.name}`, c.ok, c.detail);
  await verifyRls(targetUrl, manifest);

  // Provas negativas: as conferências recusam o que deveriam recusar.
  const refused = async (dir) => runRestore(targetUrl, dir, { log: () => {} }).then(() => null, (e) => e.message);
  const again = await refused(backupDir);
  check("recusa restaurar sobre banco que já tem dados", Boolean(again && /já tem/.test(again)), again ?? "não recusou");
  appendFileSync(join(backupDir, manifest.tables.find((t) => t.rows > 0).file), " ");
  const tampered = await refused(backupDir);
  check("recusa backup adulterado (sha256)", Boolean(tampered && /sha256/.test(tampered)), tampered ?? "não recusou");
  // Mudança proposital na branch descartável: a comparação de estrutura precisa acusá-la.
  const drift = await withClient(targetUrl, async (c) => {
    await c.query("alter table public.fin_areas no force row level security; revoke select on public.pl_types from app_runtime");
    await normalizeSession(c);
    return compareStructure(manifest.structure, await structureFingerprint(c)).map((d) => d.name);
  });
  check("comparação de estrutura detecta RLS/permissão alterados", drift.includes("tabelas") && drift.includes("permissoes_tabelas"), drift.join(", "));
} catch (error) {
  failed = true;
  console.error(`ERRO no ensaio: ${error.code ?? ""} ${error.message}`);
} finally {
  if (branchId) {
    try {
      neon(["branches", "delete", branchId]);
      const listed = JSON.parse(neon(["branches", "list", "--output", "json"]));
      const still = (Array.isArray(listed) ? listed : listed.branches ?? []).some((b) => b.id === branchId);
      check("branch descartável apagada", !still);
    } catch (error) {
      check("branch descartável apagada", false, `${error.message} — apague "${branchName}" no console do Neon`);
    }
  }
  try {
    const n = await cleanupSeed();
    check("cenário removido de development (por IDs)", true, `${n} linha(s)`);
  } catch (error) {
    check("cenário removido de development (por IDs)", false, error.message);
  }
  if (backupDir && !process.argv.includes("--keep-backup")) {
    rmSync(backupDir, { recursive: true, force: true });
    check("pasta temporária do backup apagada", true);
  }
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} verificações OK${failed ? " (ensaio interrompido por erro)" : ""}.`);
if (bad || failed) process.exitCode = 1;
