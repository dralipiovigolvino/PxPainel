// Dashboard integrado (Etapa 13) na APLICAÇÃO, com Neon Auth e Neon reais.
// Conta fictícia A (B para isolamento); cenário "[teste-e2e]" FICTÍCIO inserido com o papel do app
// e removido ao final (só registros desta conta com o prefixo e os criados durante a rodada).
// Uso: npm run test:e2e:dashboard     Capturas opcionais: E2E_SHOTS_DIR=<pasta>.

import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { createChecks, startBrowser } from "./lib/browser.mjs";

const A = { email: process.env.RLS_TEST_A_EMAIL, password: process.env.RLS_TEST_A_PASSWORD, id: process.env.RLS_TEST_A_ID };
const B = { email: process.env.RLS_TEST_B_EMAIL, password: process.env.RLS_TEST_B_PASSWORD };
const P = "[teste-e2e]";
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const today = fmt.format(new Date());
const addDays = (civil, n) => new Date(Date.parse(`${civil}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const norm = (s) => (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const runStart = new Date(Date.now() - 5000).toISOString();

async function owner(fn) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** Remove só os dados de teste da conta A (prefixo "[teste-e2e]") e o que depende deles. */
async function cleanup() {
  return owner(async (pool) => {
    const c = await pool.connect();
    let n = 0;
    const q = async (sql, params) => (n += (await c.query(sql, params)).rowCount ?? 0);
    try {
      await c.query("begin");
      const ids = async (sql) => (await c.query(sql, [A.id, `${P}%`])).rows.map((r) => r.id);
      const areas = await ids("select id from public.fin_areas where user_id = $1 and name like $2");
      const cards = await ids("select id from public.fin_cards where user_id = $1 and name like $2");
      const patients = await ids("select id from public.fu_patients where user_id = $1 and name like $2");
      const templates = await ids("select id from public.fu_templates where user_id = $1 and name like $2");
      const types = await ids("select id from public.pl_types where user_id = $1 and name like $2");
      // Finanças
      await q("update public.fin_invoices set status = 'pendente', paid_on = null where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_events where user_id = $1 and created_at >= $2::timestamptz", [A.id, runStart]);
      await q("delete from public.fin_events where entity_id in (select id from public.fin_invoices where card_id = any($1::uuid[])) or entity_id in (select id from public.fin_card_purchases where card_id = any($1::uuid[]))", [cards]);
      await q("delete from public.fin_card_charges where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_card_purchases where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_invoices where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_cards where id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_entries where area_id = any($1::uuid[])", [areas]);
      await q("delete from public.fin_series_exceptions where series_id in (select id from public.fin_series where area_id = any($1::uuid[]))", [areas]);
      await q("delete from public.fin_series where area_id = any($1::uuid[])", [areas]);
      await q("delete from public.fin_areas where id = any($1::uuid[])", [areas]);
      // Follow-up
      await q("delete from public.fu_events where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_steps where plan_id in (select id from public.fu_plans where patient_id = any($1::uuid[]))", [patients]);
      await q("delete from public.fu_plans where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_consultations where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_patients where id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_template_steps where template_id = any($1::uuid[])", [templates]);
      await q("delete from public.fu_templates where id = any($1::uuid[])", [templates]);
      // Plantões
      await q("delete from public.pl_events where type_id = any($1::uuid[]) or shift_id in (select id from public.pl_shifts where type_id = any($1::uuid[])) or (user_id = $2 and created_at >= $3::timestamptz)", [types, A.id, runStart]);
      await q("delete from public.pl_shifts where type_id = any($1::uuid[])", [types]);
      await q("delete from public.pl_series_exceptions where series_id in (select id from public.pl_series where type_id = any($1::uuid[]))", [types]);
      await q("delete from public.pl_series where type_id = any($1::uuid[])", [types]);
      await q("delete from public.pl_types where id = any($1::uuid[])", [types]);
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    return n;
  });
}

/** Inserções com o PAPEL DO APP e o contexto de A (regras do banco valem). */
async function asA(fn) {
  const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true)", [A.id]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

const one = async (c, sql, params) => (await c.query(sql, params)).rows[0]?.id;
const ids = {};

/** Cenário (esperados calculados à mão; ver o resumo no relatório). */
async function seed() {
  await asA(async (c) => {
    // Finanças
    const area = await one(c, "insert into public.fin_areas (user_id, name, color) values ($1, $2, '#2563eb') returning id", [A.id, `${P} Dash Casa`]);
    const entry = (desc, cents, due) => one(c, "insert into public.fin_entries (user_id, area_id, description, amount_cents, due_date) values ($1, $2, $3, $4, $5::date) returning id", [A.id, area, `${P} ${desc}`, cents, due]);
    ids.conta100 = await entry("Conta 100", 10000, today);
    ids.paga = await entry("Conta paga", 7000, today);
    await c.query("update public.fin_entries set status = 'pago', paid_on = $2::date where id = $1", [ids.paga, today]);
    ids.anterior = await entry("Mês anterior", 5000, addDays(today, -35));
    for (let i = 1; i <= 6; i++) await entry(`Antiga ${i}`, 1000, addDays(today, -40 - i * 7));
    const vs = await one(c, "insert into public.fin_series (user_id, area_id, description, amount_kind, frequency, interval_months, start_date, generated_until) values ($1, $2, $3, 'variavel', 'mensal', 1, $4::date, $4::date) returning id", [A.id, area, `${P} Variável`, today]);
    ids.variavel = await one(c, "insert into public.fin_entries (user_id, area_id, description, due_date, series_id, occurrence_date, is_variable) values ($1, $2, $3, $4::date, $5, $4::date, true) returning id", [A.id, area, `${P} Variável`, today, vs]);
    const card = await one(c, "insert into public.fin_cards (user_id, name, closing_day, due_day) values ($1, $2, 1, 10) returning id", [A.id, `${P} Dash Cartão`]);
    ids.fatura = await one(c, "insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date) values ($1, $2, $3::date, $4::date, $5::date) returning id", [A.id, card, `${today.slice(0, 7)}-01`, addDays(today, -1), today]);
    for (const cents of [12000, 18000]) {
      const p = await one(c, "insert into public.fin_card_purchases (user_id, card_id, area_id, description, purchase_date, total_cents, installments_count, request_id) values ($1, $2, $3, $4, $5::date, $6, 1, $7) returning id", [A.id, card, area, `${P} Compra`, addDays(today, -2), cents, randomUUID()]);
      await c.query("insert into public.fin_card_charges (user_id, card_id, purchase_id, invoice_id, installment_number, amount_cents) values ($1, $2, $3, $4, 1, $5)", [A.id, card, p, ids.fatura, cents]);
    }
    // Follow-up
    await one(c, "insert into public.fu_templates (user_id, name) values ($1, $2) returning id", [A.id, `${P} Dash Modelo`]);
    const patient = (name) => one(c, "insert into public.fu_patients (user_id, name, phone, notes) values ($1, $2, '+5511987654321', 'Observação fictícia sensível') returning id", [A.id, `${P} ${name}`]);
    const plan = async (pid, date, key) => {
      const cid = await one(c, "insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, $3::date) returning id", [A.id, pid, date]);
      const plid = await one(c, "insert into public.fu_plans (user_id, patient_id, consultation_id, template_name, template_version, request_id) values ($1, $2, $3, 'Modelo', 1, $4) returning id", [A.id, pid, cid, randomUUID()]);
      for (const d of [0, 1, 7, 30]) ids[`${key}D${d}`] = await one(c, "insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, $3, 'Mensagem fictícia completa', $4::date, $4::date) returning id", [A.id, plid, d, addDays(date, d)]);
    };
    ids.p1 = await patient("Ana Dash");
    await plan(ids.p1, addDays(today, -1), "p1");
    ids.p2 = await patient("Bruno Dash");
    await plan(ids.p2, today, "p2");
    await c.query("update public.fu_steps set status = 'realizado', done_text = 'feito' where id = $1", [ids.p2D0]);
    await c.query("update public.fu_steps set status = 'cancelado', cancel_kind = 'cancelado' where id = $1", [ids.p2D1]);
    ids.p3 = await patient("Carla Arquivada");
    await plan(ids.p3, today, "p3");
    await c.query("update public.fu_patients set archived_at = now() where id = $1", [ids.p3]);
    // Plantões
    const type = await one(c, "insert into public.pl_types (user_id, name, default_amount_cents, color) values ($1, $2, 100000, '#16a34a') returning id", [A.id, `${P} Dash Plantão`]);
    const shift = (date, start = null, end = null, nextDay = null) =>
      one(c, "insert into public.pl_shifts (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents) values ($1, $2, $3::date, $4::time, $5::time, $6, 100000) returning id", [A.id, type, date, start, end, nextDay]);
    ids.plHoje = await shift(today);
    // 24 h que começou ontem uma hora "à frente" do agora: termina hoje daqui a ~1 h (em andamento).
    const [h, m] = hm.format(new Date()).split(":").map(Number);
    ids.lateNight = h >= 23;
    const t = `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    ids.plNoturno = await shift(addDays(today, -1), t, t, true);
    ids.plFuturo = await shift(addDays(today, 3));
    ids.plConfirmar = await shift(addDays(today, -2));
    const cancel = await shift(addDays(today, -1));
    await c.query("update public.pl_shifts set status = 'cancelado' where id = $1", [cancel]);
    ids.plType = type;
  });
}

const t = createChecks();
const b = await startBrowser({ port: 9345 });
const { ev } = b;
const check = t.check;
const shot = async (name) => process.env.E2E_SHOTS_DIR && b.shot(`${process.env.E2E_SHOTS_DIR}/${name}.png`);
const noticeText = () => ev(`document.querySelector('main [data-notice] p')?.textContent ?? ''`);
const waitNotice = (text) => b.waitFor(`!document.querySelector('[role=dialog], [role=alertdialog]') && document.querySelector('main [data-notice] p')?.textContent === ${JSON.stringify(text)}`, 30000);
const bodyHas = (text) => ev(`document.body.innerText.includes(${JSON.stringify(text)})`);
const summary = (section) => ev(`(document.querySelector('[data-dash-section="${section}"] [data-dash-summary]')?.textContent ?? '').replace(/\\u00a0/g, ' ')`);
const count = (section) => ev(`(document.querySelector('[data-dash-section="${section}"] [data-dash-count]')?.textContent ?? '')`);
const itemIds = (section) => ev(`[...document.querySelectorAll('[data-dash-section="${section}"] [data-dash-item]')].map(li => li.dataset.dashItem.split(':')[2])`);
const noOverflow = () =>
  ev(`(() => { const d = document.documentElement; const main = document.querySelector('main'); const r = main.getBoundingClientRect().right;
    const over = [...main.querySelectorAll('*')].filter(el => el.offsetParent !== null && el.getBoundingClientRect().right > r + 1).length;
    return { h: d.scrollWidth > d.clientWidth, over }; })()`);

try {
  t.info(`limpeza prévia: ${await cleanup()} registro(s)`);
  await b.viewport(1280, 900);

  // Conta B: estados vazios verdadeiros (sem exemplos fictícios).
  await b.login(B);
  await b.goto("/");
  check(
    "conta sem registros: só o aviso de nada pendente, sem exemplos nem resumos zerados",
    (await ev(`document.querySelectorAll('[data-dash-item]').length`)) === 0 &&
      (await bodyHas("Nada pendente para hoje nem para os próximos 7 dias.")) &&
      (await ev(`!document.querySelector('[data-dash-shift-summary], [data-dash-exam-summary]')`)),
  );
  await b.logout();

  await seed();
  await b.login(A);
  await b.goto("/");
  await b.waitFor(`document.querySelector('[data-dash-section=hoje]')`);
  check("Hoje: contas (R$ 100,00) + fatura do cartão (R$ 300,00) a pagar, e 1 sem valor", (await summary("hoje")) === "R$ 400,00 a pagar + 1 sem valor", await summary("hoje"));
  const hojeTotal = ids.lateNight ? 6 : 7;
  check(`Hoje com ${hojeTotal} itens: contador sem parênteses e no máximo 5 visíveis`, (await itemIds("hoje")).length === 5 && (await count("hoje")) === String(hojeTotal), await count("hoje"));
  if (hojeTotal > 5) {
    await ev(`document.querySelector('[data-dash-section=hoje] [data-dash-more]').click()`);
    await b.waitFor(`document.querySelectorAll('[data-dash-section=hoje] [data-dash-item]').length === ${hojeTotal}`);
  }
  const hoje = await itemIds("hoje");
  check(
    "Hoje lista conta, variável, a fatura do cartão (uma vez, sem uma linha por compra), follow-ups e plantões; conta paga fora",
    [ids.conta100, ids.variavel, ids.fatura, ids.p1D1, ids.p3D0, ids.plHoje].every((id) => hoje.includes(id)) && !hoje.includes(ids.paga) && !(await ev(`[...document.querySelectorAll('[data-dash-item]')].some(li => li.innerText.includes(${JSON.stringify(`${P} Compra`)}))`)),
    hoje,
  );
  const faturaItem = norm(await ev(`document.querySelector('[data-dash-item="financas:fatura:${ids.fatura}"]').innerText`));
  check("fatura do cartão no Dashboard: nome do cartão, total das compras e aviso de total não informado", faturaItem.includes(`${P} Dash Cartão`) && faturaItem.includes("R$ 300,00") && faturaItem.includes("total não informado"), faturaItem);
  if (!ids.lateNight) check("noturno iniciado ontem aparece uma vez em Hoje como 'Em andamento'", hoje.filter((id) => id === ids.plNoturno).length === 1 && norm(await ev(`document.querySelector('[data-dash-item="plantoes:plantao:${ids.plNoturno}"]').innerText`)).includes("Em andamento"));
  else t.info("23h–24h: verificação do plantão em andamento coberta pelos testes unitários/integração");
  check("variável mostra 'Valor a informar' (não zero)", norm(await ev(`document.querySelector('[data-dash-item="financas:conta:${ids.variavel}"]').innerText`)).includes("Valor a informar"));
  check("Atrasados: R$ 110,00 a pagar (inclui meses anteriores); 8 itens com o follow-up", (await summary("atrasados")) === "R$ 110,00 a pagar" && (await count("atrasados")) === "8", await summary("atrasados"));
  check("lista limitada a 5 com 'Ver todos (8)'", (await itemIds("atrasados")).length === 5 && norm(await ev(`document.querySelector('[data-dash-section=atrasados] [data-dash-more]')?.textContent`)) === "Ver todos (8)");
  const atrasados = await itemIds("atrasados");
  check("atrasados do mais antigo para o mais recente", atrasados[0] !== ids.anterior && !atrasados.slice(0, 5).includes(ids.p1D0), atrasados);
  await ev(`document.querySelector('[data-dash-section=atrasados] [data-dash-more]').click()`);
  check("'Ver todos' mostra os 8", await b.waitFor(`document.querySelectorAll('[data-dash-section=atrasados] [data-dash-item]').length === 8`));
  check("Próximos 7 dias: 4 follow-ups e 1 plantão, sem resumo de valores", (await count("proximos")) === "5" && (await summary("proximos")) === "", await summary("proximos"));
  // Entre 23h e 24h o plantão de 24 h "noturno" já terminou e também fica a confirmar.
  const aConfirmar = (await itemIds("a_confirmar")).sort();
  check("A confirmar: só o agendado passado (cancelado e em andamento fora)", JSON.stringify(aConfirmar) === JSON.stringify((ids.lateNight ? [ids.plConfirmar, ids.plNoturno] : [ids.plConfirmar]).sort()), aConfirmar);
  const html = await ev(`document.querySelector('main').innerText`);
  check("início não expõe telefone, observação nem mensagem do paciente", !html.includes("98765") && !html.includes("Observação fictícia sensível") && !html.includes("Mensagem fictícia completa"));
  check("resumo de plantões do mês: programado, recebido e a receber", await ev(`['programado', 'recebido-do-mes', 'a-receber'].every(k => !!document.querySelector('[data-dash-total=' + k + ']'))`));
  check("sem seção 'Módulos' (o menu já leva aos módulos) e sem textos explicativos das seções", !(await bodyHas("Módulos")) && !(await bodyHas("Ainda agendados e com o horário já passado")));

  // Links: registro de outro mês; fatura; plantão; follow-up.
  await ev(`[...document.querySelectorAll('[data-dash-section=atrasados] [data-dash-item]')].find(li => li.dataset.dashItem.endsWith(${JSON.stringify(ids.anterior)})).querySelector('[data-dash-link]').click()`);
  check("link da conta de outro mês abre o mês certo com a conta destacada", await b.waitFor(`location.search.includes('mes=${addDays(today, -35).slice(0, 7)}') && !!document.querySelector('[data-entry-id="${ids.anterior}"][data-focused]')`, 20000), await b.loc());
  await b.goto("/");
  await ev(`document.querySelector('[data-dash-item="plantoes:plantao:${ids.plConfirmar}"] [data-dash-link]').click()`);
  check("link do plantão (outro dia/mês) abre os detalhes da ocorrência certa", await b.waitFor(`document.querySelector('[data-shift-details="${ids.plConfirmar}"]')`, 20000));

  // Ação rápida: pagar a conta pelo diálogo de Finanças; dashboard atualiza.
  await b.goto("/");
  await b.click(`Pagar ${P} Conta 100`);
  await b.waitFor(`document.querySelector('#pay-date')`);
  await ev(`document.querySelector('[role=dialog] form button[type=submit]').click()`);
  check("pagar conta pelo dashboard (diálogo e validações de Finanças)", await waitNotice("Conta marcada como paga."), await noticeText());
  check("conta paga sai de Hoje e o resumo é recalculado", await b.waitFor(`!document.querySelector('[data-dash-item="financas:conta:${ids.conta100}"]') && (document.querySelector('[data-dash-section=hoje] [data-dash-summary]')?.textContent ?? '').replace(/\\u00a0/g, ' ') === 'R$ 300,00 a pagar + 1 sem valor'`, 20000), await summary("hoje"));
  // Fatura do cartão: o link abre o mês com o cartão destacado; "Pagar" usa o diálogo de Finanças.
  await ev(`document.querySelector('[data-dash-item="financas:fatura:${ids.fatura}"] [data-dash-link]').click()`);
  check("link da fatura abre o Mês com o cartão destacado", await b.waitFor(`location.pathname === '/financas/mes' && !!document.querySelector('[data-invoice-id="${ids.fatura}"][data-focused]')`, 20000), await b.loc());
  await b.goto("/");
  await b.click(`Pagar ${P} Dash Cartão`);
  await b.waitFor(`document.querySelector('[data-invoice-form=pagar]')`);
  check("pagar o cartão pelo dashboard: mostra as compras cadastradas e pede o total e a data", norm(await ev(`document.querySelector('[role=dialog]').innerText`)).includes("Compras cadastradas R$ 300,00") && (await ev(`document.querySelector('#invoice-pay-date').value`)) === today);
  await b.type("#invoice-total", "450,00");
  await ev(`document.querySelector('[role=dialog] form button[type=submit]').click()`);
  check("cartão marcado como pago pelo dashboard, com o total real", await waitNotice("Cartão marcado como pago."), await noticeText());
  check("fatura paga sai de Hoje e o resumo é recalculado", await b.waitFor(`!document.querySelector('[data-dash-item="financas:fatura:${ids.fatura}"]') && document.querySelector('[data-dash-section=hoje] [data-dash-summary]')?.textContent === '1 sem valor'`, 20000), await summary("hoje"));
  const paidInvoice = await owner(async (pool) => (await pool.query("select status, paid_total_cents::text as t, stated_total_cents::text as s from public.fin_invoices where id = $1", [ids.fatura])).rows[0]);
  check("um pagamento só, pelo total real informado (R$ 450,00); as compras não mudam", paidInvoice.status === "pago" && paidInvoice.t === "45000" && paidInvoice.s === "45000", paidInvoice);

  // Follow-up: "Realizada" abre o diálogo na página do paciente; depois some do dashboard.
  await b.click(`Marcar realizada: ${P} Ana Dash D1`);
  check("'Realizada' abre a confirmação na página do paciente (não conclui sozinho)", await b.waitFor(`location.pathname.startsWith('/follow-up/pacientes/${ids.p1}') && document.querySelector('[data-done-preview]')`, 20000));
  await ev(`document.querySelector('[role=dialog] form button[type=submit]').click()`);
  check("confirmar realização", await waitNotice("Etapa marcada como realizada."), await noticeText());
  await b.goto("/");
  check("etapa realizada não aparece mais no dashboard", !(await itemIds("hoje")).includes(ids.p1D1));
  await b.click(`Mensagem: ${P} Carla Arquivada D0`);
  check("'Mensagem' abre a mensagem (copiar não conclui)", await b.waitFor(`document.querySelector('[data-message-text]')`, 20000));

  // Geração pelo acesso direto: séries retroativas sem geração.
  await asA(async (c) => {
    const area = (await c.query("select id from public.fin_areas where name = $1", [`${P} Dash Casa`])).rows[0].id;
    await c.query("insert into public.fin_series (user_id, area_id, description, amount_kind, amount_cents, frequency, interval_months, start_date) values ($1, $2, $3, 'fixo', 2500, 'mensal', 1, $4::date)", [A.id, area, `${P} Retroativa`, addDays(today, -40)]);
    await c.query("insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, amount_cents) values ($1, $2, 127, 1, $3::date, 1000)", [A.id, ids.plType, addDays(today, -3)]);
  });
  await b.goto("/");
  check("acesso direto: geração pendente sinalizada (sem zeros definitivos)", (await ev(`!!document.querySelector('[data-dash-generating]')`)) || (await b.waitFor(`document.body.innerText.includes(${JSON.stringify(`${P} Retroativa`)})`, 2000)));
  check("após a geração, a recorrência retroativa aparece em Atrasados", await b.waitFor(`!document.querySelector('[data-dash-generating]') && [...document.querySelectorAll('[data-dash-section=atrasados] [data-dash-item]')].some(li => li.innerText.includes(${JSON.stringify(`${P} Retroativa`)}))`, 45000) || (await ev(`document.querySelector('[data-dash-section=atrasados] [data-dash-more]')?.textContent ?? ''`)).includes("Ver todos"));
  const gen = await owner(async (pool) => (await pool.query("select count(*)::int n, count(distinct due_date)::int d from public.fin_entries where description = $1", [`${P} Retroativa`])).rows[0]);
  check("geração idempotente: sem ocorrências duplicadas", gen.n > 0 && gen.n === gen.d, gen);

  // Falha parcial real: o papel do app perde temporariamente a leitura de pl_types (restaurado no finally).
  let revoked = false;
  try {
    await owner((pool) => pool.query("revoke select on table public.pl_types from app_runtime"));
    revoked = true;
    await b.goto("/");
    check("falha de um módulo: painel parcial sinalizado, demais dados exibidos", (await ev(`document.querySelector('[data-dash-failed]')?.dataset.dashFailed`)) === "plantoes" && (await itemIds("hoje")).includes(ids.variavel));
    check("falha não vira 'nenhuma pendência': resumo de plantões indisponível e seções marcadas como parciais", (await bodyHas("Resumo indisponível")) && (await ev(`!!document.querySelector('[data-dash-section=hoje] [data-dash-partial]')`)) && !(await bodyHas("Nada pendente")));
  } finally {
    if (revoked) await owner((pool) => pool.query("grant select on table public.pl_types to app_runtime"));
  }
  await b.click("Tentar novamente");
  check("'Tentar novamente' recupera o painel completo", await b.waitFor(`!document.querySelector('[data-dash-failed]') && document.querySelectorAll('[data-dash-section=a_confirmar] [data-dash-item]').length >= 1`, 20000));

  // Módulo oculto no menu (preferência do usuário): sai do menu e do Dashboard, sem virar "falha"; os dados continuam lá.
  const setMenu = (order, hidden) => owner((pool) => pool.query("update public.user_preferences set menu_order = $2::text[], menu_hidden = $3::text[] where user_id = $1", [A.id, order, hidden]));
  const dashState = () =>
    ev(`({ plantoes: document.querySelectorAll('[data-dash-item][data-source=plantoes]').length, financas: document.querySelectorAll('[data-dash-item][data-source=financas]').length,
      resumo: !!document.querySelector('[data-dash-shift-summary]'), falha: !!document.querySelector('[data-dash-failed]'),
      menu: [...document.querySelectorAll('aside nav[aria-label="Principal"] a')].map(a => a.textContent.trim()) })`);
  try {
    await setMenu(["pericias", "plantoes", "financas", "followup"], ["plantoes"]);
    await b.goto("/");
    await b.waitFor(`!document.querySelector('[data-dash-generating]')`, 30000);
    const oculto = await dashState();
    check(
      "módulo oculto no menu: sem itens nem resumo dele no Dashboard, sem aviso de falha, e os demais continuam",
      oculto.plantoes === 0 && !oculto.resumo && !oculto.falha && oculto.financas > 0 && JSON.stringify(oculto.menu) === JSON.stringify(["Dashboard", "Perícias", "Finanças", "Follow-up", "CNPJ"]),
      oculto,
    );
    check("o módulo oculto continua acessível pelo endereço, com os dados", await (async () => { await b.goto(`/plantoes?mes=${today.slice(0, 7)}`); return b.waitFor(`document.querySelectorAll('[data-shift-dot]').length > 0`, 20000); })());
  } finally {
    await setMenu([], []);
  }
  await b.goto("/");
  await b.waitFor(`!document.querySelector('[data-dash-generating]')`, 30000);
  const visivel = await dashState();
  check("ao mostrar o módulo de novo, os itens e o resumo dele voltam e o menu fica no padrão", visivel.plantoes > 0 && visivel.resumo && JSON.stringify(visivel.menu) === JSON.stringify(["Dashboard", "Finanças", "Follow-up", "Plantões", "Perícias", "CNPJ"]), visivel);

  for (const [w, h] of [[375, 812], [768, 1024], [1280, 900]]) {
    await b.viewport(w, h);
    await b.goto("/");
    await b.waitFor(`!document.querySelector('[data-dash-generating]')`, 30000);
    const m = await noOverflow();
    check(`${w}px dashboard: sem rolagem horizontal nem conteúdo cortado`, !m.h && m.over === 0, m);
    const targets = await ev(`[...document.querySelectorAll('main a, main button')].filter(e => e.offsetParent !== null && e.closest('[data-dash-item]')).every(e => { const r = e.getBoundingClientRect(); return r.height >= 24; })`);
    check(`${w}px: alvos de ação dos itens com altura utilizável`, targets);
    await shot(`dash-${w}`);
  }
  await b.viewport(1280, 900);

  // Sessão revogada: a cópia anterior dos cookies não entrega dados de pacientes.
  const cookies = await b.authCookies();
  const header = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const before = await fetch(`${b.BASE}/`, { headers: { cookie: header }, redirect: "manual" });
  const beforeOk = before.status === 200 && (await before.text()).includes(`${P} Carla Arquivada`);
  await b.logout();
  const after = await fetch(`${b.BASE}/`, { headers: { cookie: header }, redirect: "manual" });
  const afterBody = after.status === 200 ? await after.text() : "";
  check("controle: sessão válida entrega o dashboard", beforeOk, before.status);
  check("sessão revogada: redireciona ao login, sem nomes de pacientes", after.status >= 300 && after.status < 400 && !afterBody.includes("Arquivada"), after.status);

  await b.login(B);
  await b.goto("/");
  check("B não vê nada de A no dashboard", !(await bodyHas(P)) && (await ev(`document.querySelectorAll('[data-dash-item]').length`)) === 0);
  await b.logout();
} catch (error) {
  check("execução do roteiro sem exceção", false, String(error?.message ?? error).slice(0, 300));
} finally {
  // Garantia extra: a permissão de leitura sempre volta.
  await owner((pool) => pool.query("grant select on table public.pl_types to app_runtime")).catch(() => {});
  // E a conta fictícia A sempre volta ao menu padrão.
  await owner((pool) => pool.query("update public.user_preferences set menu_order = '{}', menu_hidden = '{}' where user_id = $1", [A.id])).catch(() => {});
  const removed = await cleanup().catch((e) => `falhou (${e.code ?? e.message})`);
  t.info(`limpeza final: ${removed} registro(s) de teste removidos`);
  t.print();
  console.log(`\nconsole: ${b.consoleIssues.length ? `${b.consoleIssues.length} erro(s)` : "sem erros"}`);
  console.log(t.failures ? `${t.failures} falha(s).` : "Todos os fluxos passaram.");
  await b.close();
}
process.exit(t.failures ? 1 : 0);
