// Cenário FICTÍCIO pequeno cobrindo os módulos (com um CNPJ e registros marcados), para a revisão visual (contas de teste A e B).
// Inserido pelo dono da branch development (as regras do banco valem) e removido SÓ pelos IDs guardados.
// Mesmo conteúdo do cenário do ensaio de restauração (scripts/db-restore-drill.mjs), com outro prefixo.

import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const A = process.env.RLS_TEST_A_ID;
const B = process.env.RLS_TEST_B_ID;
export const P = "[teste-visual]";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const today = fmt.format(new Date());
const addDays = (civil, n) => new Date(Date.parse(`${civil}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function withClient(url, fn) {
  const c = new Client(url);
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export const ids = { A: {}, B: {} };
export async function seed() {
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
      a.fatura = await one("insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date, stated_total_cents) values ($1, $2, $3::date, $4::date, $5::date, 80000) returning id", [A, a.cartao, `${today.slice(0, 7)}-01`, addDays(today, -1), addDays(today, 5)]);
      // Mês em que a fatura vence (total informado de R$ 800,00 com R$ 300,00 em compras cadastradas).
      a.faturaMes = addDays(today, 5).slice(0, 7);
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

      // CNPJ fictício (número de exemplo, com dígitos verificadores válidos), a 9%, imposto no dia 20.
      a.cnpj = await one("insert into public.cnpjs (user_id, name, abbreviation, cnpj_number, tax_rate_bp, tax_due_day) values ($1, $2, 'Clínica', '11222333000181', 900, 20) returning id", [A, `${P} Clínica Fictícia`]);
      a.tipo = await one("insert into public.pl_types (user_id, name, default_amount_cents, color, default_amount_kind, pay_day, cnpj_id) values ($1, $2, 100000, '#16a34a', 'bruto', 20, $3) returning id", [A, `${P} Hospital`, a.cnpj]);
      a.serie = await one("insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, amount_cents, start_time, end_time, end_next_day, amount_kind, tax_rate_bp, pay_day, cnpj_id) values ($1, $2, 2, 1, $3::date, 80000, '07:00', '19:00', false, 'bruto', 900, 20, $4) returning id", [A, a.tipo, today, a.cnpj]);
      await c.query("insert into public.pl_series_exceptions (series_id, user_id, original_date) values ($1, $2, $3::date)", [a.serie, A, addDays(today, 1)]);
      a.plantaoSerie = await one("insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents, series_id, original_date, amount_kind, tax_rate_bp, pay_day, cnpj_id) values ($1, $2, $3::date, '07:00', '19:00', false, 80000, $4, $3::date, 'bruto', 900, 20, $5) returning id", [A, a.tipo, today, a.serie, a.cnpj]);
      a.plantao = await one("insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents, amount_kind, tax_rate_bp, pay_day, cnpj_id) values ($1, $2, $3::date, '19:00', '07:00', true, 100000, 'bruto', 900, 20, $4) returning id", [A, a.tipo, addDays(today, -3), a.cnpj]);
      // Plantão do mês passado, ainda a receber neste mês (previsão no dia 20) e com imposto estimado neste mês.
      a.plantaoPassado = await one("insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents, amount_kind, tax_rate_bp, pay_day, cnpj_id) values ($1, $2, $3::date, '07:00', '19:00', false, 250000, 'bruto', 900, 20, $4) returning id", [A, a.tipo, addDays(`${today.slice(0, 7)}-01`, -10), a.cnpj]);
      // Perícias: empresa por CNPJ; uma perícia do mês passado e uma daqui a três dias; outra sem CNPJ.
      a.empresa = await one("insert into public.per_companies (user_id, name, default_amount_cents, cnpj_id) values ($1, $2, 60000, $3) returning id", [A, `${P} Empresa Pericial`, a.cnpj]);
      a.periciaPassada = await one("insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, cnpj_id) values ($1, $2, $3::date, '09:00', 60000, 900, $4) returning id", [A, a.empresa, addDays(`${today.slice(0, 7)}-01`, -5), a.cnpj]);
      a.pericia = await one("insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, cnpj_id) values ($1, $2, $3::date, '14:00', 60000, 900, $4) returning id", [A, a.empresa, addDays(today, 3), a.cnpj]);
      a.periciaSemCnpj = await one("insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp) values ($1, $2, $3::date, '16:00', 45000, 0) returning id", [A, a.empresa, addDays(today, 4)]);
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

/**
 * Remove o cenário das contas fictícias A e B pelo PREFIXO "[teste-visual]" e tudo o que depende dele
 * (inclusive ocorrências geradas pelas recorrências ao abrir as telas). Não toca em outros registros.
 */
export async function cleanupSeed() {
  return withClient(process.env.DATABASE_URL_UNPOOLED, async (c) => {
    let n = 0;
    const users = [A, B];
    const q = async (sql, params) => (n += (await c.query(sql, params)).rowCount ?? 0);
    const list = async (table, column) => (await c.query(`select id from public.${table} where user_id = any($1::uuid[]) and ${column} like $2`, [users, `${P}%`])).rows.map((r) => r.id);
    await c.query("begin");
    try {
      const areas = await list("fin_areas", "name");
      const cards = await list("fin_cards", "name");
      const patients = await list("fu_patients", "name");
      const templates = await list("fu_templates", "name");
      const types = await list("pl_types", "name");
      // Plantões
      await q("delete from public.pl_events where type_id = any($1::uuid[]) or shift_id in (select id from public.pl_shifts where type_id = any($1::uuid[]))", [types]);
      await q("update public.pl_shifts set received_on = null where type_id = any($1::uuid[]) and received_on is not null", [types]);
      await q("delete from public.pl_shifts where type_id = any($1::uuid[])", [types]);
      await q("delete from public.pl_series_exceptions where series_id in (select id from public.pl_series where type_id = any($1::uuid[]))", [types]);
      await q("delete from public.pl_series where type_id = any($1::uuid[])", [types]);
      await q("delete from public.pl_types where id = any($1::uuid[])", [types]);
      // Perícias
      const companies = await list("per_companies", "name");
      await q("delete from public.per_events where company_id = any($1::uuid[]) or exam_id in (select id from public.per_exams where company_id = any($1::uuid[]))", [companies]);
      await q("update public.per_exams set received_on = null where company_id = any($1::uuid[]) and received_on is not null", [companies]);
      await q("delete from public.per_exams where company_id = any($1::uuid[])", [companies]);
      await q("delete from public.per_companies where id = any($1::uuid[])", [companies]);
      // CNPJs, depois dos plantões e das perícias que os usam
      await q("delete from public.cnpjs where user_id = any($1::uuid[]) and name like $2", [users, `${P}%`]);
      // Follow-up
      await q("delete from public.fu_events where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_steps where plan_id in (select id from public.fu_plans where patient_id = any($1::uuid[]))", [patients]);
      await q("delete from public.fu_plans where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_consultations where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_patients where id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_template_steps where template_id = any($1::uuid[])", [templates]);
      await q("delete from public.fu_templates where id = any($1::uuid[])", [templates]);
      // Finanças
      await q("delete from public.fin_events where entity_id = any($1::uuid[]) or entity_id in (select id from public.fin_invoices where card_id = any($1::uuid[])) or entity_id in (select id from public.fin_card_purchases where card_id = any($1::uuid[])) or entity_id in (select id from public.fin_installment_plans where area_id = any($2::uuid[]))", [cards, areas]);
      await q("update public.fin_invoices set status = 'pendente', paid_on = null where card_id = any($1::uuid[]) and status <> 'pendente'", [cards]);
      await q("delete from public.fin_card_charges where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_card_purchases where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_invoices where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_cards where id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_entries where area_id = any($1::uuid[])", [areas]);
      await q("delete from public.fin_installment_plans where area_id = any($1::uuid[])", [areas]);
      await q("delete from public.fin_series_exceptions where series_id in (select id from public.fin_series where area_id = any($1::uuid[]))", [areas]);
      await q("delete from public.fin_series where area_id = any($1::uuid[])", [areas]);
      await q("delete from public.fin_areas where id = any($1::uuid[])", [areas]);
      await c.query("commit");
    } catch (error) {
      await c.query("rollback").catch(() => {});
      throw error;
    }
    return n;
  });
}
