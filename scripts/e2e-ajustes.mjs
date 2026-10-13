// Ajustes (CNPJ e imposto estimado, Perícias, plantões por CNPJ e previsão, entradas e imposto em Finanças,
// cartão simplificado, prazo do follow-up e próxima consulta, Dashboard) na APLICAÇÃO, com Neon Auth e
// Neon reais. Conta fictícia A (B para isolamento). Registros "[teste-aj]" são removidos ao final.
// Uso: npm run test:e2e:ajustes     Capturas opcionais: E2E_SHOTS_DIR=<pasta>.

import { Pool } from "@neondatabase/serverless";
import { assertBranch } from "./lib/branch-guard.mjs";
import { createChecks, sleep, startBrowser } from "./lib/browser.mjs";
import { requireEnv } from "./lib/env-file.mjs";

requireEnv(["DATABASE_URL_UNPOOLED", "APP_DATABASE_URL", "RLS_TEST_A_EMAIL", "RLS_TEST_A_PASSWORD", "RLS_TEST_A_ID", "RLS_TEST_B_EMAIL", "RLS_TEST_B_PASSWORD"]);
assertBranch("test:e2e:ajustes");
const A = { email: process.env.RLS_TEST_A_EMAIL, password: process.env.RLS_TEST_A_PASSWORD, id: process.env.RLS_TEST_A_ID };
const B = { email: process.env.RLS_TEST_B_EMAIL, password: process.env.RLS_TEST_B_PASSWORD };
const P = "[teste-aj]";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const today = fmt.format(new Date());
const addDays = (civil, n) => new Date(Date.parse(`${civil}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const addMonthsYm = (value, n) => {
  const [y, m] = value.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const weekdayOf = (civil) => new Date(`${civil}T12:00:00Z`).getUTCDay();
const br = (civil) => civil.split("-").reverse().join("/");
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "2026-11" → "novembro". */
const monthName = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1];
const runStart = new Date(Date.now() - 5000).toISOString();

async function owner(fn) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** Remove só os registros "[teste-aj]" da conta A e o que depende deles. */
async function cleanup() {
  return owner(async (pool) => {
    const c = await pool.connect();
    let n = 0;
    const q = async (sql, params) => (n += (await c.query(sql, params)).rowCount ?? 0);
    const ids = async (table, column) => (await c.query(`select id from public.${table} where user_id = $1 and ${column} like $2`, [A.id, `${P}%`])).rows.map((r) => r.id);
    try {
      await c.query("begin");
      const companies = await ids("per_companies", "name");
      await q("delete from public.per_events where company_id = any($1::uuid[]) or exam_id in (select id from public.per_exams where company_id = any($1::uuid[]))", [companies]);
      await q("delete from public.per_exams where company_id = any($1::uuid[])", [companies]);
      await q("delete from public.per_companies where id = any($1::uuid[])", [companies]);

      const types = await ids("pl_types", "name");
      await q("delete from public.pl_events where user_id = $1 and (type_id = any($2::uuid[]) or shift_id in (select id from public.pl_shifts where type_id = any($2::uuid[])) or created_at >= $3::timestamptz)", [A.id, types, runStart]);
      await q("delete from public.pl_shifts where type_id = any($1::uuid[])", [types]);
      await q("delete from public.pl_series_exceptions where series_id in (select id from public.pl_series where type_id = any($1::uuid[]))", [types]);
      await q("delete from public.pl_series where type_id = any($1::uuid[])", [types]);
      await q("delete from public.pl_types where id = any($1::uuid[])", [types]);
      // CNPJs da rodada, depois dos plantões e das perícias que os usam.
      await q("delete from public.cnpjs where user_id = $1 and name like $2", [A.id, `${P}%`]);

      const areas = await ids("fin_areas", "name");
      const cards = await ids("fin_cards", "name");
      await q("update public.fin_invoices set status = 'pendente', paid_on = null where card_id = any($1::uuid[]) and status <> 'pendente'", [cards]);
      await q("delete from public.fin_events where entity_id = any($1::uuid[]) or entity_id in (select id from public.fin_invoices where card_id = any($1::uuid[])) or entity_id in (select id from public.fin_card_purchases where card_id = any($1::uuid[]))", [cards]);
      await q("delete from public.fin_card_charges where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_card_purchases where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_invoices where card_id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_cards where id = any($1::uuid[])", [cards]);
      await q("delete from public.fin_entries where area_id = any($1::uuid[])", [areas]);
      await q("delete from public.fin_areas where id = any($1::uuid[])", [areas]);

      const patients = await ids("fu_patients", "name");
      const templates = await ids("fu_templates", "name");
      await q("delete from public.fu_appointments where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_events where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_steps where plan_id in (select id from public.fu_plans where patient_id = any($1::uuid[]))", [patients]);
      await q("delete from public.fu_plans where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_consultations where patient_id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_patients where id = any($1::uuid[])", [patients]);
      await q("delete from public.fu_template_steps where template_id = any($1::uuid[])", [templates]);
      await q("delete from public.fu_templates where id = any($1::uuid[])", [templates]);
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

/** Inserções fictícias com o PAPEL DO APP e o contexto de A (regras do banco valem). */
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

const t = createChecks();
const b = await startBrowser({ port: 9345 });
const { ev } = b;
const check = t.check;
const shot = async (name) => process.env.E2E_SHOTS_DIR && b.shot(`${process.env.E2E_SHOTS_DIR}/${name}.png`);
const plain = `(s) => (s ?? '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim()`;
const text = (selector = "body") => ev(`(${plain})(document.querySelector(${JSON.stringify(selector)})?.innerText)`);
const noticeText = () => ev(`document.querySelector('main [data-notice] p')?.textContent ?? ''`);
const waitNotice = (start) => b.waitFor(`!document.querySelector('[role=dialog], [role=alertdialog]') && (document.querySelector('main [data-notice] p')?.textContent ?? '').startsWith(${JSON.stringify(start)})`, 30000);
const dialogSubmit = () => ev(`[...document.querySelectorAll('[role=dialog] form button[type=submit]:not([name])')].at(-1).click()`);
const confirmDialog = async () => {
  await b.waitFor(`document.querySelector('[role=alertdialog] form button[type=submit]')`);
  await ev(`document.querySelector('[role=alertdialog] form button[type=submit]').click()`);
};
const selectOption = (selector, startsWith) =>
  ev(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); const o = [...s.options].find(o => o.textContent.trim().startsWith(${JSON.stringify(startsWith)}));
    if (!o) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const value = (selector) => ev(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
const selected = (selector) => ev(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); return s ? s.options[s.selectedIndex]?.textContent.trim() : null; })()`);
const noOverflow = () => ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`);
const escape = async () => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
};

const cnpjName = `${P} Empresa Médica`;
const company = `${P} Empresa Pericial`;
const typeName = `${P} Hospital Central`;
const cardName = `${P} Cartão`;
const areaName = `${P} Casa`;
const patientName = `${P} Paciente Fictício`;
const templateName = `${P} Modelo 45`;

try {
  t.info(`limpeza prévia: ${await cleanup()} registro(s)`);
  // O percentual sugerido para um CNPJ novo vem das preferências da conta (9% por padrão).
  await owner((pool) => pool.query("insert into public.user_preferences (user_id, tax_rate_bp) values ($1, 900) on conflict (user_id) do update set tax_rate_bp = 900", [A.id]));
  await b.viewport(1280, 900);
  await b.login(A);

  // ------------------------------------------------------------------ 1. CNPJ
  t.info("— 1. Cadastro do CNPJ —");
  await b.goto("/minha-conta");
  check("Minha conta não tem mais a seção de impostos (o percentual agora é do CNPJ)", !(await ev(`!!document.querySelector('#impostos-titulo, [data-tax-form]')`)) && !/Impostos estimados/.test(await text("main")));
  await b.goto("/cnpj");
  check("página do CNPJ começa com o convite para cadastrar", /Cadastre o CNPJ pelo qual você recebe/.test(await text("[data-cnpj-empty]")), await text("main"));
  await ev(`document.querySelector('[data-new-cnpj]').click()`);
  await b.waitFor(`document.querySelector('[data-cnpj-form]')`);
  check("formulário sugere 9% e dia 20, com o exemplo de R$ 1.000,00 → R$ 90,00", (await value("#cnpj-rate")) === "9" && (await value("#cnpj-due-day")) === "20" && /R\$ 1\.000,00 recebidos por CNPJ em um mês → R\$ 90,00 de imposto estimado no mês seguinte/.test(await text("[data-cnpj-example]")), await text("[data-cnpj-example]"));
  await b.type("#cnpj-number", "11.222.333/0001-80");
  await b.type("#cnpj-rate", "abc");
  await dialogSubmit();
  await b.waitFor(`document.querySelector('#cnpj-name-erro')`, 20000);
  const cnpjErrors = { nome: await text("#cnpj-name-erro"), numero: await text("#cnpj-number-erro"), percentual: await text("#cnpj-rate-erro") };
  check("sem nome, número com dígito errado e percentual inválido: um erro em cada campo", /Informe um nome/.test(cnpjErrors.nome) && /CNPJ inválido/.test(cnpjErrors.numero) && /Percentual inválido/.test(cnpjErrors.percentual), cnpjErrors);
  check("o que foi digitado continua no formulário depois do erro", (await value("#cnpj-number")) === "11.222.333/0001-80" && (await value("#cnpj-rate")) === "abc");
  await b.type("#cnpj-name", cnpjName);
  await b.type("#cnpj-number", "11.222.333/0001-81");
  await b.type("#cnpj-rate", "9");
  await dialogSubmit();
  check("CNPJ cadastrado; o aviso diz o próximo passo", await waitNotice('CNPJ cadastrado. Agora marque "Recebo por CNPJ"'), await noticeText());
  const cnpjCard = await text("[data-cnpj]");
  check("cartão do CNPJ: nome, número com máscara, percentual e dia do pagamento", cnpjCard.includes(cnpjName) && cnpjCard.includes("11.222.333/0001-81") && /Imposto estimado: 9% · pago no dia 20 do mês seguinte ao trabalho/.test(cnpjCard), cnpjCard);
  check("sem nada marcado ainda, a tela diz onde marcar (sem tabela zerada)", /Nada marcado como recebido por este CNPJ/.test(await text("[data-cnpj-no-work]")) && !(await ev(`!!document.querySelector('[data-cnpj-taxes]')`)));
  check("o módulo CNPJ aparece no menu", (await ev(`[...document.querySelectorAll('aside nav a')].map(a => a.textContent.trim())`)).includes("CNPJ"));
  await shot("aj-cnpj");

  // ------------------------------------------------------------------ 2. Perícias
  t.info("— 2. Perícias —");
  const cnpjChecked = (scope = "[role=dialog]") => ev(`document.querySelector('${scope} [data-cnpj-toggle]')?.checked ?? null`);
  const toggleCnpj = () => ev(`document.querySelector('[role=dialog] [data-cnpj-toggle]').click()`);
  await b.goto("/pericias");
  check("página de Perícias com estado vazio verdadeiro (sem seção de próximas vazia)", /Nenhuma perícia neste mês/.test(await text("main")) && !(await ev(`!!document.querySelector('[data-exams-upcoming]')`)));
  await b.click("Nova perícia");
  await b.waitFor(`document.querySelector('[data-exam-form]')`);
  const examDate = addDays(today, 2);
  const examPayMonth = monthName(addMonthsYm(examDate.slice(0, 7), 1));
  await b.setValue("#exam-date", examDate);
  await b.setValue("#exam-time", "14:30");
  await b.type("#exam-notes", "Observação fictícia");
  check("perícia nova começa sem a marcação de CNPJ (nada é presumido)", (await cnpjChecked()) === false);
  // Cadastrar a empresa sem sair do fluxo, marcando que ela paga por CNPJ, e voltar ao formulário.
  await ev(`document.querySelector('[data-new-company]').click()`);
  await b.waitFor(`document.querySelector('[data-company-form]')`);
  await b.type("#company-name", company);
  await b.type("#company-amount", "1.000,00");
  await toggleCnpj();
  check("empresa: 'Recebo por CNPJ' fica marcado (com um CNPJ só, não há o que escolher)", (await cnpjChecked()) === true && !(await ev(`!!document.querySelector('[data-company-form] [data-cnpj-select]')`)));
  await ev(`document.querySelector('[data-company-form] button[type=submit]').click()`);
  const back = await b.waitFor(`document.querySelector('[data-exam-form]') && document.querySelector('#exam-company')?.selectedOptions[0]?.textContent.includes(${JSON.stringify(company)})`, 30000);
  check("empresa cadastrada pelo formulário da perícia já vem selecionada na volta", back, await selected("#exam-company"));
  check("data, horário e observação digitados antes continuam preenchidos", (await value("#exam-date")) === examDate && (await value("#exam-time")) === "14:30" && (await value("#exam-notes")) === "Observação fictícia");
  check("valor preenchido com o padrão da empresa", (await value("#exam-amount")) === "1.000,00", await value("#exam-amount"));
  await b.waitFor(`document.querySelector('[data-exam-form] [data-cnpj-tax]')`, 15000);
  const examTax = await text("[data-exam-form] [data-cnpj-tax]");
  check("a marcação de CNPJ vem do padrão da empresa e mostra o imposto estimado e o mês do pagamento", (await cnpjChecked()) === true && examTax === `Imposto estimado: R$ 90,00 (9%), pago em ${examPayMonth}.`, examTax);
  await dialogSubmit();
  check("perícia agendada", await waitNotice("Perícia agendada."), await noticeText());
  await b.goto(`/pericias?mes=${examDate.slice(0, 7)}`);
  let totals = await text("[data-exams-total=agendadas]");
  check("resumo do mês: 1 agendada, R$ 1.000,00, R$ 90,00 de imposto estimado, R$ 910,00 depois do imposto", totals === "Agendadas 1 R$ 1.000,00 R$ 90,00 R$ 910,00", totals);
  check("agenda destaca a perícia em 'Hoje e próximas', marcada como por CNPJ", (await text("[data-exams-upcoming]")).includes(company) && /por CNPJ · imposto est\. R\$ 90,00/.test(await text("[data-exams-upcoming]")));

  // Alterar o padrão da empresa não muda a perícia existente.
  await b.goto("/pericias/empresas");
  check("lista de empresas mostra o valor padrão e a marcação de CNPJ", /R\$ 1\.000,00 por perícia · por CNPJ/.test(await text("main")), (await text("main")).slice(0, 300));
  await b.click(`Editar ${company}`);
  await b.waitFor(`document.querySelector('#company-amount')`);
  check("edição da empresa abre com a marcação de CNPJ que ela tem", (await cnpjChecked()) === true);
  await b.type("#company-amount", "1.500,00");
  await ev(`document.querySelector('[data-company-form] button[type=submit]').click()`);
  check("empresa atualizada", await waitNotice("Empresa atualizada."), await noticeText());
  await b.goto(`/pericias?mes=${examDate.slice(0, 7)}`);
  check("perícia existente mantém R$ 1.000,00 depois de mudar o padrão da empresa", (await text("[data-exams-total=agendadas]")).startsWith("Agendadas 1 R$ 1.000,00"), await text("[data-exams-total=agendadas]"));

  // Nova perícia: herda o novo padrão; ajuste individual; erro de validação preserva os campos.
  await b.click("Nova perícia");
  await b.waitFor(`document.querySelector('[data-exam-form]')`);
  check("com uma única empresa ativa, ela já vem escolhida com o novo padrão R$ 1.500,00 e por CNPJ", (await selected("#exam-company")) === company && (await value("#exam-amount")) === "1.500,00" && (await cnpjChecked()) === true, await value("#exam-amount"));
  await b.type("#exam-amount", "1.200,00");
  await b.setValue("#exam-date", examDate);
  await dialogSubmit(); // sem horário
  const timeError = await b.waitFor(`document.querySelector('#exam-time-erro')`, 20000);
  check("sem horário: erro no campo, sem salvar", timeError && /Informe o horário/.test(await text("#exam-time-erro")), await text("[data-exam-form]"));
  check("após o erro, empresa, valor ajustado e marcação de CNPJ continuam como estavam", (await selected("#exam-company")) === company && (await value("#exam-amount")) === "1.200,00" && (await value("#exam-date")) === examDate && (await cnpjChecked()) === true, `${await selected("#exam-company")} / ${await value("#exam-amount")} / ${await cnpjChecked()}`);
  await b.setValue("#exam-time", "09:00");
  await dialogSubmit();
  check("segunda perícia agendada com valor ajustado", await waitNotice("Perícia agendada."), await noticeText());
  await b.goto(`/pericias?mes=${examDate.slice(0, 7)}`);
  totals = await text("[data-exams-total=agendadas]");
  check("resumo: 2 agendadas = R$ 2.200,00, R$ 198,00 de imposto, R$ 2.002,00 depois do imposto", totals === "Agendadas 2 R$ 2.200,00 R$ 198,00 R$ 2.002,00", totals);
  const order = await ev(`[...document.querySelectorAll('[data-exams-agenda] [data-exam] button')].map(x => x.innerText.slice(0, 5))`);
  check("agenda em ordem de horário (09:00 antes de 14:30)", order[0] === "09:00" && order[1] === "14:30", order);

  // Perícia que não é por CNPJ: entra no valor, sem imposto estimado.
  await b.click("Nova perícia");
  await b.waitFor(`document.querySelector('[data-exam-form]')`);
  await b.setValue("#exam-date", examDate);
  await b.setValue("#exam-time", "16:00");
  await b.type("#exam-amount", "300,00");
  await toggleCnpj();
  check("desmarcar 'Recebo por CNPJ' tira o imposto estimado da tela", (await cnpjChecked()) === false && !(await ev(`!!document.querySelector('[data-exam-form] [data-cnpj-tax]')`)));
  await dialogSubmit();
  check("perícia sem CNPJ agendada", await waitNotice("Perícia agendada."), await noticeText());
  await b.goto(`/pericias?mes=${examDate.slice(0, 7)}`);
  totals = await text("[data-exams-total=agendadas]");
  check("resumo: a perícia sem CNPJ soma no valor e não muda o imposto (R$ 2.500,00, R$ 198,00, R$ 2.302,00)", totals === "Agendadas 3 R$ 2.500,00 R$ 198,00 R$ 2.302,00", totals);
  const plainRow = await ev(`[...document.querySelectorAll('[data-exams-agenda] [data-exam] button')].find(x => x.innerText.startsWith('16:00'))?.innerText.replace(/\\u00a0/g, ' ') ?? ''`);
  check("na agenda, a perícia sem CNPJ aparece só com o valor", /R\$ 300,00/.test(plainRow) && !/CNPJ|imposto/i.test(plainRow), plainRow);
  await ev(`[...document.querySelectorAll('[data-exams-agenda] [data-exam] button')].find(x => x.innerText.startsWith('16:00')).click()`);
  await b.waitFor(`document.querySelector('[data-exam-details]')`);
  check("detalhes da perícia sem CNPJ: valor, sem quadro de imposto", /Valor R\$ 300,00/.test(await text("[data-exam-details]")) && !(await ev(`!!document.querySelector('[data-exam-details] [data-tax-breakdown]')`)), await text("[data-exam-details]"));
  await b.click("Excluir", "[role=dialog]");
  await confirmDialog();
  check("perícia sem CNPJ excluída (as contas seguintes usam só as duas por CNPJ)", await waitNotice("Perícia excluída."), await noticeText());

  // Realizada × recebimento × cancelada
  await b.goto(`/pericias?mes=${examDate.slice(0, 7)}`);
  await ev(`document.querySelectorAll('[data-exams-agenda] [data-exam] button')[0].click()`);
  await b.waitFor(`document.querySelector('[data-exam-details]')`);
  const examDetails = await text("[data-exam-details]");
  check("detalhes da perícia por CNPJ: valor, imposto estimado, o que sobra e o mês do pagamento", /Valor R\$ 1\.200,00 · por CNPJ/.test(examDetails) && /Imposto estimado \(9%\) R\$ 108,00/.test(examDetails) && /Depois do imposto R\$ 1\.092,00/.test(examDetails) && examDetails.includes(`Imposto pago em ${examPayMonth}`), examDetails);
  await b.click("Marcar realizada", "[role=dialog]");
  await confirmDialog();
  check("marcar realizada", await waitNotice("Perícia marcada como realizada."), await noticeText());
  await b.goto(`/pericias?mes=${examDate.slice(0, 7)}`);
  const done = await text("[data-exams-total=realizadas]");
  check("realizada: R$ 1.200,00, R$ 108,00 de imposto, R$ 1.092,00 depois do imposto; agendadas voltam a 1", done === "Realizadas 1 R$ 1.200,00 R$ 108,00 R$ 1.092,00" && (await text("[data-exams-total=agendadas]")).startsWith("Agendadas 1 "), done);
  await ev(`document.querySelectorAll('[data-exams-agenda] [data-exam] button')[0].click()`);
  await b.waitFor(`document.querySelector('[data-exam-details]')`);
  check("realizar não registra recebimento", /Sem recebimento registrado/.test(await text("[data-exam-details]")));
  await escape();
  await ev(`document.querySelectorAll('[data-exams-agenda] [data-exam] button')[1].click()`);
  await b.waitFor(`document.querySelector('[data-exam-details]')`);
  await b.click("Cancelar perícia", "[role=dialog]");
  await confirmDialog();
  check("cancelar perícia", await waitNotice("Perícia cancelada."), await noticeText());
  await b.goto(`/pericias?mes=${examDate.slice(0, 7)}`);
  check("cancelada fica fora dos totais (0 agendadas; 1 realizada)", (await text("[data-exams-total=agendadas]")).startsWith("Agendadas 0 ") && (await text("[data-exams-total=realizadas]")).startsWith("Realizadas 1 "), await text("[data-exams-totals]"));
  check("a nota do resumo explica o imposto e leva ao CNPJ", /Imposto estimado só das perícias recebidas por CNPJ, pago no mês seguinte/.test(await text("[data-exams-tax-note]")) && (await ev(`document.querySelector('[data-exams-tax-note] a')?.getAttribute('href')`)) === "/cnpj");
  await selectOption("[data-filter=situacao]", "Canceladas");
  await b.waitFor(`location.search.includes('situacao=cancelada')`);
  await b.settle(600);
  check("filtro por situação mostra a cancelada", (await ev(`document.querySelectorAll('[data-exams-agenda] [data-exam]').length`)) === 1);
  await shot("aj-pericias");

  // ------------------------------------------------------------------ 3. Percentual do CNPJ: vale do mês corrente em diante
  t.info("— 3. Mudança do percentual do CNPJ —");
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthDay = addDays(monthStart, -1);
  // Uma perícia agendada à frente e uma do mês passado, as duas por CNPJ a 9%.
  await asA(async (c) => {
    const row = (await c.query("select id, cnpj_id from public.per_companies where name = $1", [company])).rows[0];
    await c.query("insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, cnpj_id) values ($1, $2, $3::date, '10:00', 100000, 900, $4), ($1, $2, $5::date, '10:00', 100000, 900, $4)", [A.id, row.id, addDays(today, 5), row.cnpj_id, lastMonthDay]);
  });
  await b.goto("/cnpj");
  const taxRows = await text("[data-cnpj-taxes]");
  check("o CNPJ mostra o imposto por mês de pagamento, sobre o trabalho do mês anterior", taxRows.includes(`Sobre ${monthName(lastMonthDay.slice(0, 7))}: R$ 1.000,00 (1 perícia)`) && /este mês/.test(taxRows), taxRows);
  const currentRow = await text(`[data-cnpj-tax-month="${today.slice(0, 7)}"]`);
  check("o imposto deste mês é o do trabalho do mês passado (R$ 1.000,00 → R$ 90,00, vence dia 20)", currentRow.includes("R$ 90,00") && currentRow.includes(`vence 20/${today.slice(5, 7)}/${today.slice(0, 4)}`), currentRow);
  await b.click(`Editar ${cnpjName}`);
  await b.waitFor(`document.querySelector('[data-cnpj-form]')`);
  check("edição abre com os dados gravados (número com máscara)", (await value("#cnpj-name")) === cnpjName && (await value("#cnpj-number")) === "11.222.333/0001-81" && (await value("#cnpj-rate")) === "9");
  await b.type("#cnpj-rate", "11");
  check("exemplo com 11% e aviso de quando o novo percentual vale", /R\$ 110,00 de imposto estimado/.test(await text("[data-cnpj-example]")) && (await text("[data-cnpj-rate-change]")).includes(`vale para o trabalho de ${monthName(today.slice(0, 7))} em diante`), await text("[data-cnpj-form]"));
  await dialogSubmit();
  check("percentual salvo; o aviso diz desde quando vale e que meses anteriores não mudam", await waitNotice(`CNPJ salvo. 11% vale para o trabalho de ${monthName(today.slice(0, 7))} em diante`), await noticeText());
  check("o aviso conta as perícias já lançadas que passaram a usar o novo percentual", /perícias? já lançad/.test(await noticeText()) && /Meses anteriores ficam como estavam/.test(await noticeText()), await noticeText());
  await b.goto(`/pericias?mes=${examDate.slice(0, 7)}`);
  check("perícia realizada deste mês passou a 11% (R$ 1.200,00 → R$ 132,00 → R$ 1.068,00)", (await text("[data-exams-total=realizadas]")) === "Realizadas 1 R$ 1.200,00 R$ 132,00 R$ 1.068,00", await text("[data-exams-totals]"));
  const rates = await owner(async (pool) => (await pool.query("select to_char(e.exam_date, 'YYYY-MM-DD') as d, e.tax_rate_bp from public.per_exams e join public.per_companies c on c.id = e.company_id where c.name = $1 and e.user_id = $2 order by e.exam_date", [company, A.id])).rows);
  check("no banco: o mês passado continua com 9%; deste mês em diante, 11%", rates.length >= 3 && rates.every((r) => (r.d < monthStart ? r.tax_rate_bp === 900 : r.tax_rate_bp === 1100)), rates);
  await b.goto("/cnpj");
  check("o imposto deste mês (trabalho do mês passado) continua R$ 90,00", (await text(`[data-cnpj-tax-month="${today.slice(0, 7)}"]`)).includes("R$ 90,00"), await text("[data-cnpj-taxes]"));
  // Volta a 9% pelo mesmo caminho (as seções seguintes usam 9%).
  await b.click(`Editar ${cnpjName}`);
  await b.waitFor(`document.querySelector('[data-cnpj-form]')`);
  await b.type("#cnpj-rate", "9");
  await dialogSubmit();
  check("percentual de volta a 9%", await waitNotice("CNPJ salvo. 9% vale para o trabalho de"), await noticeText());

  // ------------------------------------------------------------------ 4. Plantões
  t.info("— 4. Plantões: recebo por CNPJ, repetição semanal e previsão —");
  await b.goto("/plantoes/tipos");
  await b.click("Novo tipo");
  await b.waitFor(`document.querySelector('#type-name')`);
  await b.type("#type-name", typeName);
  await b.type("#type-amount", "1.000,00");
  check("tipo novo começa sem a marcação de CNPJ; não há mais a escolha bruto/líquido", (await cnpjChecked()) === false && !(await ev(`!!document.querySelector('[role=dialog] input[name=amountKind]')`)));
  await toggleCnpj();
  await b.type("#type-pay-day", "20");
  check("regra de pagamento explicada com exemplo", /Pagamento no dia 20 do mês seguinte ao plantão/.test(await text("[role=dialog]")));
  await dialogSubmit();
  check("tipo criado por CNPJ, pagamento no dia 20 do mês seguinte", await waitNotice("Tipo de plantão criado."), await noticeText());
  check("lista de tipos mostra o valor por CNPJ e a regra", /R\$ 1\.000,00 por CNPJ/.test(await text("main")) && /Pagamento no dia 20 do mês seguinte ao plantão/.test(await text("main")), (await text("main")).slice(0, 400));

  // Repetição semanal a partir do formulário do plantão: toda quinta do mês seguinte.
  const m1 = addMonthsYm(today.slice(0, 7), 1);
  const m2 = addMonthsYm(today.slice(0, 7), 2);
  let firstThu = `${m1}-01`;
  while (weekdayOf(firstThu) !== 4) firstThu = addDays(firstThu, 1);
  await b.goto(`/plantoes?mes=${m1}`);
  await ev(`document.querySelector('[data-day="${firstThu}"]').click()`);
  await b.waitFor(`document.querySelector('#shift-amount')`);
  const shiftForm = await text("[role=dialog]");
  check(
    "formulário herda do tipo: por CNPJ, com o imposto estimado, o mês do pagamento e a previsão no dia 20",
    (await cnpjChecked()) === true && shiftForm.includes(`Imposto estimado: R$ 90,00 (9%), pago em ${monthName(m2)}.`) && shiftForm.includes(`Pagamento no dia 20 do mês seguinte ao plantão: 20/${m2.slice(5)}/${m2.slice(0, 4)}`),
    shiftForm,
  );
  await ev(`document.querySelector('[data-repeat-toggle]').click()`);
  await b.waitFor(`document.querySelector('[data-repeat-preview]')`);
  const repeatPreview = await text("[data-repeat-preview]");
  check("'Repetir semanalmente' sugere o dia da semana da data e mostra as próximas ocorrências", /Toda quinta, desde/.test(repeatPreview) && repeatPreview.includes(br(addDays(firstThu, 7))), repeatPreview);
  check("na repetição, o imposto estimado é por plantão, pago no mês seguinte", /Imposto estimado por plantão: R\$ 90,00 \(9%\), pago no mês seguinte\./.test(await text("[role=dialog] [data-cnpj-tax]")), await text("[role=dialog] [data-cnpj-tax]"));
  await dialogSubmit();
  check("repetição semanal criada", await waitNotice("Repetição semanal criada"), await noticeText());
  await b.goto(`/plantoes?mes=${m1}`);
  const thursdays = (await ev(`[...document.querySelectorAll('[data-shift-dot]')].map(d => d.closest('td').dataset.date)`)).filter((d) => d.startsWith(m1));
  const expectedThu = [];
  for (let d = firstThu; d.slice(0, 7) === m1; d = addDays(d, 7)) expectedThu.push(d);
  check("todas as quintas do mês aparecem no calendário, uma vez cada", JSON.stringify(thursdays) === JSON.stringify(expectedThu), thursdays);
  check("calendário continua simples: número do dia e bolinhas", (await ev(`document.querySelector('[data-day-dots="${firstThu}"]').innerText.trim()`)) === "");
  await ev(`document.querySelector('[data-day-dots="${firstThu}"] [data-shift-dot]').click()`);
  await b.waitFor(`document.querySelector('[data-shift-details]')`);
  const det = await text("[data-shift-details]");
  check("detalhes: valor por CNPJ, imposto estimado, o que sobra e o mês do pagamento", /Valor R\$ 1\.000,00 · por CNPJ/.test(det) && /Imposto estimado \(9%\) R\$ 90,00/.test(det) && /Depois do imposto R\$ 910,00/.test(det) && det.includes(`Imposto pago em ${monthName(m2)}`), det);
  check("detalhes distinguem 'Data prevista de pagamento' de 'Data em que recebi'", det.includes(`Data prevista de pagamento 20/${m2.slice(5)}/${m2.slice(0, 4)}`) && /Data em que recebi Ainda não registrado/.test(det) && /É previsão, não recebimento/.test(det), det);
  await escape();

  // Plantão avulso sem CNPJ, com data manual.
  const loose = addDays(firstThu, 1);
  await ev(`document.querySelector('[data-day="${loose}"]').click()`);
  await b.waitFor(`document.querySelector('#shift-amount')`);
  await toggleCnpj();
  await b.settle(300);
  check("sem CNPJ: valor mantido, sem imposto estimado", (await cnpjChecked()) === false && !(await ev(`!!document.querySelector('[role=dialog] [data-cnpj-tax]')`)));
  await ev(`document.querySelector('[data-pay-manual]').click()`);
  await b.waitFor(`document.querySelector('#shift-pay-date')`);
  await dialogSubmit();
  check("previsão manual sem data: erro no campo", await b.waitFor(`document.querySelector('#shift-pay-date-erro')`, 20000), await text("[role=dialog]"));
  {
    const after = { tipo: await selected("#shift-type"), cnpj: await cnpjChecked(), valor: await value("#shift-amount"), manual: await ev(`document.querySelector('[data-pay-manual]').checked`) };
    check("após o erro, tipo, CNPJ desmarcado, valor e a opção de data manual continuam", after.tipo === typeName && after.cnpj === false && after.valor === "1.000,00" && after.manual === true, after);
  }
  const manualDate = `${m2}-05`;
  await b.setValue("#shift-pay-date", manualDate);
  await dialogSubmit();
  check("plantão sem CNPJ com previsão manual adicionado", await waitNotice("Plantão adicionado."), await noticeText());
  const brutos = expectedThu.length * 1000;
  const taxOf = (n) => (n * 9) / 100;
  const money = (n) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const byCnpj = await text("[data-cnpj-total]");
  check("resumo do mês mostra o que é por CNPJ, o imposto estimado e o mês do pagamento", byCnpj === `Por CNPJ (${expectedThu.length}): ${money(brutos)} · imposto estimado ${money(taxOf(brutos))}, pago em ${monthName(m2)}`, byCnpj);

  // Recebimentos previstos agrupados por data.
  await b.goto("/plantoes/previsao");
  const group20 = await text(`[data-forecast-group="${m2}-20"]`);
  const inGroup = (date) => ev(`document.querySelectorAll('[data-forecast-group="${date}"] [data-forecast-shift]').length`);
  check("previsão: todas as quintas do mês agrupadas no dia 20 do mês seguinte", (await inGroup(`${m2}-20`)) === expectedThu.length, group20.slice(0, 400));
  check("total do grupo e a parte por CNPJ com o imposto estimado", (await text(`[data-forecast-group="${m2}-20"] [data-forecast-sums]`)) === `${money(brutos)} por CNPJ ${money(brutos)} · imposto estimado ${money(taxOf(brutos))}`, group20.slice(0, 400));
  const manualGroup = await text(`[data-forecast-group="${manualDate}"]`);
  check("o plantão com data manual forma outro grupo (05), sem CNPJ, marcado como ajustado", manualGroup.includes("data ajustada") && !/CNPJ/.test(manualGroup), manualGroup);
  await shot("aj-previsao");

  // Mover: previsão automática acompanha; a manual fica.
  await b.goto(`/plantoes?mes=${m1}`);
  await ev(`document.querySelector('[data-day-dots="${loose}"] [data-shift-dot]').click()`);
  await b.waitFor(`document.querySelector('[data-shift-details]')`);
  const looseDet = await text("[data-shift-details]");
  check("detalhe do plantão manual mostra a data ajustada, sem quadro de imposto", looseDet.includes(`${br(manualDate)} (ajustada manualmente)`) && /Valor R\$ 1\.000,00/.test(looseDet) && !/CNPJ|Imposto/.test(looseDet), looseDet);
  await escape();

  // O CNPJ e a Visão geral de Finanças somam o mesmo imposto, no mês seguinte ao do trabalho.
  await b.goto("/cnpj");
  const m2Row = await text(`[data-cnpj-tax-month="${m2}"]`);
  check("CNPJ: o imposto de daqui a dois meses é o dos plantões do mês que vem", m2Row.includes(`Sobre ${monthName(m1)}: ${money(brutos)} (${expectedThu.length} plantões)`) && m2Row.includes(money(taxOf(brutos))), m2Row);
  await b.goto(`/financas?mes=${m2}`);
  const flow = await ev(`Object.fromEntries([...document.querySelectorAll('[data-summary] [data-stat]')].map(d => [d.dataset.stat, d.textContent.replace(/\\u00a0/g, ' ').trim()]))`);
  check(
    "Finanças: entradas pelo dia previsto (quintas no dia 20 e o avulso no dia 05), imposto como saída e o resultado",
    flow.entradas === money(brutos + 1000) && flow["a-receber"] === money(brutos + 1000) && flow.recebido === money(0) && flow.imposto === money(taxOf(brutos)) && flow.saidas === money(taxOf(brutos)) && flow.resultado === `+ ${money(brutos + 1000 - taxOf(brutos))}`,
    flow,
  );
  const sources = await ev(`[...document.querySelectorAll('[data-chart=grafico-entradas] [data-bar]')].map(li => li.innerText.replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim())`);
  check("Finanças: 'De onde veio' mostra o tipo de plantão com o total do mês", sources.length === 1 && sources[0].startsWith(`Plantões · ${typeName} ${money(brutos + 1000)} 100%`), sources);
  check("Finanças: o imposto estimado tem a linha dele nas saídas", (await text("[data-chart=grafico-categorias]")).includes(`Imposto estimado (CNPJ) ${money(taxOf(brutos))}`), await text("[data-chart=grafico-categorias]"));
  check("Finanças: fora do mês de hoje não aparece a lista dos próximos 30 dias", !(await ev(`!!document.querySelector('[data-chart=proximos]')`)));
  await shot("aj-financas-fluxo");
  await b.goto("/financas");
  const soon = await text("[data-chart=proximos]");
  // À frente, em até 30 dias: as duas perícias ainda sem recebimento (R$ 1.200,00 em dois dias e R$ 1.000,00 em cinco).
  check("Finanças (mês de hoje): 'Próximos 30 dias' junta o que vai entrar, pela data", (await text("[data-upcoming=receber]")) === "R$ 2.200,00" && soon.includes(`Perícia · ${company}`) && soon.includes(br(addDays(today, 2))) && soon.includes(br(addDays(today, 5))), soon);
  if (Number(today.slice(8)) <= 20) {
    check("Finanças (mês de hoje): o imposto estimado do mês aparece na lista, no dia 20, como saída", soon.includes(`Imposto estimado · ${cnpjName}`) && soon.includes(`20/${today.slice(5, 7)}/${today.slice(0, 4)} · a pagar`), soon);
  }

  // Regra do tipo muda: nada muda sozinho; aplicar é explícito, com prévia.
  await b.goto("/plantoes/tipos");
  await b.click(`Editar ${typeName}`);
  await b.waitFor(`document.querySelector('#type-pay-day')`);
  check("edição do tipo abre com a marcação de CNPJ que ele tem", (await cnpjChecked()) === true);
  await b.type("#type-pay-day", "5");
  await dialogSubmit();
  check("mudar a regra avisa que os plantões existentes ficam como estão", await waitNotice("Tipo atualizado. A regra de pagamento mudou"), await noticeText());
  await b.goto("/plantoes/previsao");
  check("previsões existentes não mudaram sozinhas", (await ev(`!!document.querySelector('[data-forecast-group="${m2}-20"]')`)) === true);
  await b.goto("/plantoes/tipos");
  await b.openMenu(`Ações: ${typeName}`);
  await b.menuItem("Aplicar previsão");
  await b.waitFor(`document.querySelector('[data-rule-impact]')`, 20000);
  const impact = await text("[data-rule-impact]");
  check("prévia do impacto: agendados futuros trocam; o ajustado manualmente é preservado", Number(/(\d+) plantões agendados de hoje em diante trocam/.exec(impact)?.[1] ?? 0) >= expectedThu.length && /1 recorrência ativa passa/.test(impact) && /1 plantão fica como está/.test(impact), impact);
  await ev(`document.querySelector('[data-apply-rule] button[type=submit]').click()`);
  check("regra aplicada aos futuros", await waitNotice("Previsão aplicada a"), await noticeText());
  await b.goto("/plantoes/previsao");
  check("depois de aplicar: quintas no dia 05; a data manual continua", (await inGroup(`${m2}-05`)) === expectedThu.length + 1 && !(await ev(`!!document.querySelector('[data-forecast-group="${m2}-20"]')`)), (await text("main")).slice(0, 400));
  // Desmarcar o CNPJ no tipo vale só para os próximos plantões.
  await b.goto("/plantoes/tipos");
  await b.click(`Editar ${typeName}`);
  await b.waitFor(`document.querySelector('#type-pay-day')`);
  await toggleCnpj();
  await dialogSubmit();
  check("mudar a marcação de CNPJ do tipo avisa que os plantões já criados não mudam", await waitNotice("Tipo atualizado. A marcação de CNPJ vale para os próximos plantões"), await noticeText());
  await b.goto(`/plantoes?mes=${m1}`);
  check("os plantões já criados continuam por CNPJ", (await text("[data-cnpj-total]")).startsWith(`Por CNPJ (${expectedThu.length})`), await text("[data-cnpj-total]"));

  // ------------------------------------------------------------------ 5. Finanças: cartão
  t.info("— 5. Finanças: despesa no cartão —");
  await asA((c) => c.query("insert into public.fin_areas (user_id, name, color) values ($1, $2, '#2563eb'), ($1, $3, '#16a34a')", [A.id, areaName, `${P} Trabalho`]));
  await b.goto("/financas/mes");
  check("'Formas de pagamento' fácil de achar: aba de Finanças", await ev(`!!document.querySelector('nav[aria-label="Seções de Finanças"] a[href="/financas/formas-de-pagamento"]')`));
  const chooseRadio = (name, label) =>
    ev(`(() => { const i = [...document.querySelectorAll('[role=dialog] input[type=radio][name=${name}]')].find(i => i.closest('label').textContent.trim().startsWith(${JSON.stringify(label)})); if (!i) return false; i.click(); return true; })()`);
  const chosenRadio = (name) => ev(`(() => { const i = document.querySelector('[role=dialog] input[type=radio][name=${name}]:checked'); return i ? i.closest('label').textContent.trim() : null; })()`);
  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  check("sem cartão cadastrado: a forma de pagamento oferece 'Cadastrar cartão'", (await ev(`!![...document.querySelectorAll('[role=dialog] a')].find(a => a.textContent.trim() === 'Cadastrar cartão')`)) && !(await ev(`[...document.querySelectorAll('[role=dialog] input[name=method]')].some(i => i.value.startsWith('cartao:'))`)));
  await ev(`[...document.querySelectorAll('[role=dialog] a')].find(a => a.textContent.trim() === 'Cadastrar cartão').click()`);
  await b.waitFor(`location.pathname === '/financas/formas-de-pagamento' && document.querySelector('#card-name')`, 20000);
  check("o link abre o cadastro de cartão já aberto", /Cadastrar cartão/.test(await text("[role=dialog]")) && (await ev(`!!document.querySelector('#card-closing') && !!document.querySelector('#card-due')`)));
  await b.type("#card-name", cardName);
  await b.type("#card-closing", "10");
  await b.type("#card-due", "20");
  await dialogSubmit();
  check("cartão cadastrado (sem área padrão)", await waitNotice("Cartão criado."), await noticeText());
  check("cartão sem padrão não mostra área (cada compra pede a área)", !(await ev(`!![...document.querySelectorAll('[data-card]')].find(li => li.textContent.includes(${JSON.stringify(cardName)}))?.querySelector('[data-card-default-area]')`)));

  const entriesBefore = await owner(async (pool) => (await pool.query("select count(*)::int as n from public.fin_entries where user_id = $1", [A.id])).rows[0].n);
  await b.goto("/financas/mes");
  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  await chooseRadio("method", cardName);
  await b.waitFor(`document.querySelector('#purchase-total')`);
  check("fluxo curto: total e parcelas à vista; data e 1ª parcela recolhidas; data = hoje", (await ev(`document.querySelector('[data-purchase-details]').open`)) === false && (await value("#purchase-date")) === today);
  await b.type("#purchase-total", "100,00");
  await b.type("#purchase-count", "3");
  check("cartão sem área padrão pede a área (nunca escolhe a primeira)", (await chosenRadio("areaId")) === null, await chosenRadio("areaId"));
  await b.waitFor(`document.querySelector('[data-purchase-summary]')`, 20000);
  const prev = await text("[data-purchase-preview]");
  const firstRef = today.slice(8) < "10" ? today.slice(0, 7) : addMonthsYm(today.slice(0, 7), 1);
  const dueOf = (ref) => `20/${ref.slice(5)}/${ref.slice(0, 4)}`;
  check("prévia: total, parcelas com centavos distribuídos e vencimentos", /R\$ 100,00 em 3 parcelas: 1× R\$ 33,34 \+ 2× R\$ 33,33/.test(prev) && prev.includes(`Vencimentos de ${dueOf(firstRef)} a ${dueOf(addMonthsYm(firstRef, 2))}`), prev);
  await dialogSubmit();
  check("sem área: erro no campo", await b.waitFor(`document.querySelector('#purchase-area-erro')`, 20000), await text("[data-purchase-form]"));
  check("após o erro, cartão, total e parcelas continuam; a área não foi escolhida sozinha", (await chosenRadio("method")) === cardName && (await value("#purchase-total")) === "100,00" && (await value("#purchase-count")) === "3" && (await chosenRadio("areaId")) === null, `${await chosenRadio("areaId")}`);
  await chooseRadio("areaId", areaName);
  await ev(`document.querySelector('input[name=saveDefaultArea]').click()`);
  await dialogSubmit();
  check("compra parcelada lançada; o aviso diz quando vence a 1ª", await waitNotice(`Compra lançada em 3 parcelas. A 1ª vence em ${dueOf(firstRef)}`), await noticeText());
  const entriesAfter = await owner(async (pool) => (await pool.query("select count(*)::int as n from public.fin_entries where user_id = $1", [A.id])).rows[0].n);
  check("nenhuma conta independente criada para as parcelas", entriesAfter === entriesBefore, { entriesBefore, entriesAfter });
  await b.goto(`/financas/mes?mes=${firstRef}`);
  const charge = await ev(`[...document.querySelectorAll('[data-charge-id]')].find(li => li.textContent.includes('Compra de ${br(today)}'))?.innerText.replace(/\\u00a0/g, ' ') ?? ''`);
  const cardBlock = await ev(`[...document.querySelectorAll('[data-card-group]')].find(s => s.textContent.includes(${JSON.stringify(cardName)}))?.innerText.replace(/\\u00a0/g, ' ') ?? ''`);
  check("a 1ª parcela aparece no Mês do vencimento, debaixo da linha do cartão (R$ 33,34, 1 de 3)", charge.includes("R$ 33,34") && charge.includes("Parcela 1 de 3") && cardBlock.includes(cardName) && cardBlock.includes("Parcela 1 de 3"), cardBlock);
  await b.goto("/financas/formas-de-pagamento");
  check("a área da compra virou padrão do cartão", (await ev(`[...document.querySelectorAll('[data-card]')].find(li => li.textContent.includes(${JSON.stringify(cardName)}))?.querySelector('[data-card-default-area]')?.textContent ?? ''`)).includes(areaName));
  const purchase = await owner(async (pool) => (await pool.query("select description from public.fin_card_purchases where user_id = $1 and card_id = (select id from public.fin_cards where name = $2)", [A.id, cardName])).rows[0]?.description);
  check("descrição automática quando em branco", purchase === `Compra de ${br(today)}`, purchase);
  // Segunda compra: a área padrão é herdada e pode ser trocada só nesta compra.
  await b.goto("/financas/mes");
  await b.click("Nova conta");
  await b.waitFor(`document.querySelector('[role=dialog] input[name=method]')`);
  await chooseRadio("method", cardName);
  await b.waitFor(`document.querySelector('#purchase-total')`);
  check("com área padrão, a compra já vem com ela", (await chosenRadio("areaId")) === areaName, await chosenRadio("areaId"));
  await escape();
  await shot("aj-cartao");

  // ------------------------------------------------------------------ 6. Follow-up
  t.info("— 6. Follow-up: duração, aviso e próxima consulta —");
  await b.goto("/follow-up/modelos");
  await b.click("Novo modelo");
  await b.waitFor(`document.querySelector('#template-name')`);
  await b.type("#template-name", templateName);
  await b.type("[data-step-offset]", "30");
  await b.type("[data-step-message]", "Mensagem fictícia de {dia_followup}");
  check("aviso vem sugerido em 7 dias", (await value("#template-notice")) === "7");
  await b.type("#template-duration", "20");
  check("duração menor que a última etapa é avisada na hora (sem remover etapa)", await b.waitFor(`document.querySelector('#template-duration-erro')?.textContent.includes('menor que a última etapa (D30)')`, 10000), await text("[data-duration-fields]"));
  await dialogSubmit();
  check("o servidor também recusa a duração incoerente", await b.waitFor(`document.querySelector('[role=dialog] [role=alert]')`, 20000) && (await ev(`document.querySelectorAll('[data-template-step]').length`)) === 1);
  await b.type("#template-duration", "45");
  check("resumo: termina em D45 e quando o aviso aparece", /Termina em D45; aviso a partir de 7 dia\(s\) antes\./.test(await text("[data-duration-summary]")), await text("[data-duration-summary]"));
  await dialogSubmit();
  check("modelo criado com duração", await waitNotice("Modelo criado."), await noticeText());
  check("lista de modelos mostra duração e aviso", /Duração: 45 dias após a consulta · aviso 7 dia\(s\) antes do término/.test(await text("main")), (await text("main")).slice(0, 500));

  const patientId = await asA(async (c) => (await c.query("insert into public.fu_patients (user_id, name) values ($1, $2) returning id", [A.id, patientName])).rows[0].id);
  await b.goto(`/follow-up/pacientes/${patientId}`);
  check("paciente sem agendamento: 'Próxima consulta não agendada'", /Próxima consulta não agendada/.test(await text("[data-next-appointment-card]")));
  await b.click("Registrar consulta");
  await b.waitFor(`document.querySelector('#consult-date')`);
  const consultDate = addDays(today, -40);
  await b.setValue("#consult-date", consultDate);
  await selectOption("#consult-template", templateName);
  await b.waitFor(`document.querySelector('[data-plan-end]')`);
  check("ao gerar o acompanhamento, a data final é mostrada (consulta + 45 dias)", (await text("[data-plan-end]")).includes(`Término do acompanhamento: ${br(addDays(consultDate, 45))} (D45)`), await text("[data-plan-end]"));
  await dialogSubmit();
  check("consulta registrada com acompanhamento", await waitNotice("Consulta registrada com acompanhamento"), await noticeText());
  const planLine = await text("[data-plan-deadline]");
  check("indicador: perto de encerrar, com data de término e dias restantes", /Perto de encerrar/.test(planLine) && planLine.includes(`Termina em ${br(addDays(consultDate, 45))} (faltam 5 dias)`), planLine);
  check("destaque: perto de encerrar e sem próxima consulta", (await ev(`!!document.querySelector('[data-attention]')`)) && /Próxima consulta não agendada/.test(planLine), planLine);
  check("o fim do prazo não mexe nas etapas (D30 continua pendente)", /D30/.test(await text("main")) && /Atrasada|Pendente/.test(await text("main")));

  // Agendar, reagendar e cancelar.
  await b.click("Agendar próxima consulta");
  await b.waitFor(`document.querySelector('[data-appointment-form]')`);
  await dialogSubmit();
  check("data obrigatória", await b.waitFor(`document.querySelector('#appointment-date-erro')`, 20000), await text("[data-appointment-form]"));
  const apptDate = addDays(today, 10);
  await b.setValue("#appointment-date", apptDate);
  await b.setValue("#appointment-time", "14:30");
  await dialogSubmit();
  check("próxima consulta agendada (horário opcional informado)", await waitNotice("Próxima consulta agendada."), await noticeText());
  check("tela mostra 'Próxima consulta: DD/MM/AAAA às 14:30' e o destaque some", (await text("[data-next-appointment-card]")).includes(`Próxima consulta: ${br(apptDate)} às 14:30`) && !(await ev(`!!document.querySelector('[data-attention]')`)), await text("[data-next-appointment-card]"));
  const counts = await owner(async (pool) => (await pool.query("select (select count(*) from public.fu_consultations where patient_id = $1)::int as c, (select count(*) from public.fu_plans where patient_id = $1)::int as p", [patientId])).rows[0]);
  check("agendar não registra consulta realizada nem inicia novo acompanhamento", counts.c === 1 && counts.p === 1, counts);
  await b.goto("/follow-up/pacientes");
  check("lista de pacientes mostra o prazo e a próxima consulta", (await text("[data-patient-followup]")).includes(`Próxima consulta: ${br(apptDate)} às 14:30`) && /Perto de encerrar/.test(await text("[data-patient-followup]")), await text("[data-patient-followup]"));
  await b.goto(`/follow-up/pacientes/${patientId}`);
  await b.click("Reagendar");
  await b.waitFor(`document.querySelector('[data-appointment-form]')`);
  const newDate = addDays(today, 12);
  await b.setValue("#appointment-date", newDate);
  await b.setValue("#appointment-time", "");
  await dialogSubmit();
  check("reagendada, agora sem horário", (await waitNotice("Próxima consulta reagendada.")) && (await text("[data-next-appointment-card]")).includes(`Próxima consulta: ${br(newDate)}`) && !(await text("[data-next-appointment-card]")).includes("às"), await text("[data-next-appointment-card]"));
  await b.openMenu("Mais ações do agendamento");
  await b.menuItem("Cancelar agendamento");
  await confirmDialog();
  check("agendamento cancelado: volta a 'não agendada' e o histórico guarda o registro", (await waitNotice("Agendamento cancelado.")) && /Próxima consulta não agendada/.test(await text("[data-next-appointment-card]")) && /Agendamentos anteriores \(1\)/.test(await text("[data-next-appointment-card]")), await text("[data-next-appointment-card]"));
  // Data passada sem confirmação (simulada pelo dono do banco, porque o app só agenda de hoje em diante).
  await b.click("Agendar próxima consulta");
  await b.waitFor(`document.querySelector('[data-appointment-form]')`);
  await b.setValue("#appointment-date", today);
  await dialogSubmit();
  await waitNotice("Próxima consulta agendada.");
  await owner((pool) => pool.query("update public.fu_appointments set scheduled_date = $2::date where patient_id = $1 and status = 'agendada'", [patientId, addDays(today, -1)]));
  await b.goto(`/follow-up/pacientes/${patientId}`);
  check("data passou sem confirmação: a tela pede para confirmar a realização", /confirme o atendimento/.test(await text("[data-appointment-confirm]")) && (await ev(`document.querySelector('[data-next-appointment-card]').dataset.nextAppointmentCard`)) === "a-confirmar", await text("[data-next-appointment-card]"));
  await b.goto("/follow-up");
  const notices = await text("[data-deadline-notices]");
  check("central: aviso de término e atendimento a confirmar", notices.includes(patientName) && /Confirmar atendimento/.test(notices) && /Perto de encerrar/.test(notices), notices.slice(0, 500));
  // Plano antigo sem duração: indicado e configurável explicitamente.
  await asA(async (c) => {
    const cid = (await c.query("insert into public.fu_consultations (user_id, patient_id, consult_date) values ($1, $2, $3::date) returning id", [A.id, patientId, addDays(today, -3)])).rows[0].id;
    const pid = (await c.query("insert into public.fu_plans (user_id, patient_id, consultation_id, template_name, template_version, request_id) values ($1, $2, $3, 'Modelo antigo', 1, gen_random_uuid()) returning id", [A.id, patientId, cid])).rows[0].id;
    await c.query("insert into public.fu_steps (user_id, plan_id, day_offset, message, original_date, due_date) values ($1, $2, 7, 'Mensagem fictícia', $3::date, $3::date)", [A.id, pid, addDays(today, 4)]);
  });
  await b.goto(`/follow-up/pacientes/${patientId}`);
  check("acompanhamento antigo: 'Sem duração definida' e opção para definir", /Sem duração definida/.test(await text("[data-plan-deadline=sem_prazo]")) && (await b.openMenu(`Mais ações do acompanhamento da consulta de ${br(addDays(today, -3))}`)) && (await b.menuItem("Definir duração")));
  await b.waitFor(`document.querySelector('[data-plan-deadline-form]')`);
  await b.type("#plan-duration", "30");
  await dialogSubmit();
  check("prazo definido explicitamente; etapas intactas", (await waitNotice("Prazo do acompanhamento salvo.")) && (await text("main")).includes(`Termina em ${br(addDays(today, 27))} (faltam 27 dias)`), await noticeText());
  await shot("aj-paciente");

  // ------------------------------------------------------------------ 7. Dashboard e navegação
  t.info("— 7. Dashboard e navegação —");
  await asA(async (c) => {
    const row = (await c.query("select id, cnpj_id from public.per_companies where name = $1", [company])).rows[0];
    await c.query("insert into public.per_exams (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, cnpj_id) values ($1, $2, $3::date, '23:59', 100000, 900, $4)", [A.id, row.id, today, row.cnpj_id]);
  });
  await b.goto("/");
  await b.settle(1500);
  for (const s of ["hoje", "proximos", "prazos"]) await ev(`document.querySelector('[data-dash-section=${s}] [data-dash-more]')?.click()`);
  const hoje = await text("[data-dash-section=hoje]");
  check("Dashboard: perícia de hoje, com horário, sem entrar em pagamentos", hoje.includes(company) && /Perícia às 23:59/.test(hoje) && !/1\.000,00/.test(await text("[data-dash-section=hoje] [data-dash-summary]")), hoje.slice(0, 500));
  check("Dashboard: perícias próximas", (await text("[data-dash-section=proximos]")).includes(company));
  const prazos = await text("[data-dash-section=prazos]");
  check("Dashboard: aviso de término com a situação da próxima consulta e atendimento a confirmar", prazos.includes(patientName) && /Perto de encerrar/.test(prazos) && /faltam 5 dias/.test(prazos) && /Confirmar atendimento/.test(prazos), prazos.slice(0, 600));
  check("Dashboard: avisos não trazem telefone, observação nem mensagem", !/Mensagem fictícia|WhatsApp/.test(prazos));
  const shiftCard = await text("[data-dash-shift-summary]");
  check("Dashboard: pagamentos previstos de plantões no resumo de plantões, separados das contas", /Pagamentos previstos/.test(shiftCard) && shiftCard.includes(br(`${m2}-05`)) && !(await text("[data-dash-section=hoje]")).includes("previsto"), shiftCard.slice(0, 900));
  check("Dashboard: resumo de perícias com o valor e o imposto estimado das que são por CNPJ", /Valor/.test(await text("[data-dash-exam-summary]")) && /Imposto \(est\.\)/.test(await text("[data-dash-exam-summary]")), await text("[data-dash-exam-summary]"));
  check("Dashboard: nenhum 'saldo' misturando despesas, previsões e impostos", !/saldo/i.test(await text("main")));
  await ev(`[...document.querySelectorAll('[data-dash-section=hoje] [data-dash-link]')].find(a => a.textContent.includes(${JSON.stringify(company)})).click()`);
  check("link da perícia abre o registro", await b.waitFor(`location.pathname === '/pericias' && document.querySelector('[data-exam-details]')`, 20000), await b.loc());
  const side = await ev(`[...document.querySelectorAll('aside nav a')].map(a => a.textContent.trim())`);
  check("navegação no computador: seis itens, com Perícias e CNPJ", JSON.stringify(side) === JSON.stringify(["Dashboard", "Finanças", "Follow-up", "Plantões", "Perícias", "CNPJ"]), side);
  await shot("aj-dashboard-1280");

  for (const w of [375, 768, 1280]) {
    await b.viewport(w, w === 375 ? 740 : w === 768 ? 1024 : 900);
    const bad = [];
    for (const path of ["/", "/pericias", "/pericias/empresas", "/plantoes", "/plantoes/previsao", "/plantoes/tipos", "/financas", "/financas/mes", "/financas/formas-de-pagamento", "/follow-up", "/follow-up/pacientes", `/follow-up/pacientes/${patientId}`, "/follow-up/modelos", "/cnpj", "/minha-conta"]) {
      await b.goto(path);
      if (!(await noOverflow())) bad.push(path);
    }
    check(`${w}px: 15 telas sem rolagem horizontal`, bad.length === 0, bad);
    if (w === 375) {
      const nav = await ev(`(() => { const n = [...document.querySelectorAll('nav')].find(x => getComputedStyle(x).position === 'fixed'); const links = [...n.querySelectorAll('a')];
        return { labels: links.map(a => a.textContent.trim()), fits: links.every(a => a.scrollWidth <= a.clientWidth + 1 && a.getBoundingClientRect().width >= 44), h: n.scrollWidth <= n.clientWidth + 1 }; })()`);
      check("375px: barra inferior com os seis itens, rótulos inteiros e alvos ≥ 44 px", JSON.stringify(nav.labels) === JSON.stringify(["Dashboard", "Finanças", "Follow-up", "Plantões", "Perícias", "CNPJ"]) && nav.fits && nav.h, nav);
      await b.goto("/pericias");
      await b.click("Nova perícia");
      await b.waitFor(`document.querySelector('[data-exam-form]')`);
      const fit = await ev(`(() => { const d = document.querySelector('[role=dialog]').getBoundingClientRect(); return d.left >= -1 && d.right <= innerWidth + 1 && d.bottom <= innerHeight + 1; })()`);
      check("375px: formulário de perícia cabe na tela", fit);
      await shot("aj-pericia-form-375");
      await escape();
      await b.goto("/");
      await shot("aj-dashboard-375");
    }
  }
  await b.viewport(1280, 900);

  // ------------------------------------------------------------------ 8. Isolamento
  t.info("— 8. Isolamento —");
  await b.logout();
  await b.login(B);
  const seen = [];
  for (const path of ["/", "/pericias", "/pericias/empresas", "/plantoes/previsao", "/plantoes/tipos", "/financas", "/financas/mes", "/financas/formas-de-pagamento", "/follow-up", "/follow-up/pacientes", "/cnpj"]) {
    await b.goto(path);
    await b.settle(600);
    if ((await text("main")).includes(P)) seen.push(path);
  }
  check("B não vê empresas, perícias, previsões, cartões, pacientes nem o CNPJ de A", seen.length === 0, seen);
  await b.goto(`/follow-up/pacientes/${patientId}`);
  check("página do paciente de A responde 'não encontrado' para B", !(await text("body")).includes(patientName));
  await b.goto("/cnpj");
  check("B começa sem CNPJ: vê o convite para cadastrar, não o cadastro de A", (await ev(`!!document.querySelector('[data-cnpj-empty]')`)) && !(await ev(`!!document.querySelector('[data-cnpj]')`)));
  await b.goto("/pericias");
  await b.click("Nova perícia");
  await b.waitFor(`document.querySelector('[data-exam-form]')`);
  check("sem CNPJ cadastrado, a marcação fica desligada e aponta para o cadastro", (await ev(`document.querySelector('[role=dialog] [data-cnpj-toggle]')?.disabled`)) === true && /cadastre o seu CNPJ/.test(await text("[role=dialog] [data-cnpj-field]")), await text("[role=dialog] [data-cnpj-field]"));
  await escape();
  await b.logout();
} catch (error) {
  check("execução do roteiro sem exceção", false, String(error?.message ?? error).slice(0, 300));
} finally {
  const removed = await cleanup().catch((e) => `falhou (${e.code ?? e.message})`);
  t.info(`limpeza final: ${removed} registro(s) de teste removidos`);
  t.print();
  console.log(`\nconsole: ${b.consoleIssues.length ? `${b.consoleIssues.length} erro(s)` : "sem erros"}`);
  console.log(t.failures ? `${t.failures} falha(s).` : "Todos os fluxos passaram.");
  await b.close();
}
process.exit(t.failures ? 1 : 0);
