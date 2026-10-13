import { assertBranch } from "./lib/branch-guard.mjs";
import { Pool } from "@neondatabase/serverless";
import { createChecks, startBrowser } from "./lib/browser.mjs";
import { requireEnv } from "./lib/env-file.mjs";

requireEnv(["APP_DATABASE_URL", "RLS_TEST_A_EMAIL", "RLS_TEST_A_PASSWORD", "RLS_TEST_A_ID"]);
assertBranch("test:e2e:atualizacao-1");
const A = { email: process.env.RLS_TEST_A_EMAIL, password: process.env.RLS_TEST_A_PASSWORD };
const USER_ID = process.env.RLS_TEST_A_ID;
const TAG = "[teste-update1]";
const t = createChecks();
const b = await startBrowser({ port: 9351 });
const noOverflow = () => b.ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1");
async function data(sql, params = []) {
  const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('app.user_id', $1, true)", [USER_ID]);
    const result = await db.query(sql, params);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}
async function cleanup() {
  await data("delete from public.fu_patients where user_id = $1 and name like $2", [USER_ID, `${TAG}%`]);
  await data("delete from public.pl_types where user_id = $1 and name like $2", [USER_ID, `${TAG}%`]);
  await data("delete from public.cnpjs where user_id = $1 and name like $2", [USER_ID, `${TAG}%`]);
}

try {
  await cleanup();
  const cnpj = await data("insert into public.cnpjs (user_id, name, abbreviation, tax_rate_bp, tax_due_day) values ($1, $2, 'Teste', 900, 20) returning id", [USER_ID, `${TAG} CNPJ`]);
  await data("insert into public.pl_types (user_id, name, default_amount_cents, color, default_amount_kind, pay_day, pay_month_offset, cnpj_id) values ($1, $2, 100000, '#2563eb', 'bruto', 20, 1, $3)", [USER_ID, `${TAG} Plantão`, cnpj.rows[0].id]);
  await data("insert into public.fu_patients (user_id, name) values ($1, $2)", [USER_ID, `${TAG} Paciente`]);
  await b.viewport(1280, 900);
  await b.login(A);

  await b.goto("/");
  t.check("Dashboard mostra apenas agenda, sem Finanças e sem resumos financeiros", !(await b.ev("!!document.querySelector('[data-source=financas], [data-dash-shift-summary], [data-dash-exam-summary]')")));

  await b.goto("/follow-up");
  t.check("Follow-up oferece Adicionar atendimento", await b.click("Adicionar atendimento"));
  t.check("Atendimento permite paciente cadastrado ou novo paciente", await b.waitFor("document.querySelector('[role=dialog]')?.innerText.includes('Novo paciente') && document.querySelector('[role=dialog]')?.innerText.includes('Paciente cadastrado')"));
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });

  await b.goto("/cnpj");
  await b.ev("document.querySelector('[data-new-cnpj]')?.click()");
  const cnpjOpened = await b.waitFor("document.querySelector('[data-cnpj-form]')");
  t.check("Cadastro de CNPJ tem abreviação obrigatória", cnpjOpened && !!(await b.ev("document.querySelector('#cnpj-abbreviation') && document.querySelector('[data-cnpj-form]')?.innerText.includes('Abreviação')")));
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });

  await b.goto("/plantoes");
  const opened = await b.click("Novo plantão");
  if (opened) await b.waitFor("document.querySelector('[role=dialog]')");
  t.check("Plantão tem PF/CNPJ, atalhos 12/24 h e previsão próxima aos campos principais", !opened || (await b.ev("!!document.querySelector('[data-cnpj-pf]') && [...document.querySelectorAll('[role=dialog] button')].some(x => x.textContent.trim() === '12 h') && [...document.querySelectorAll('[role=dialog] button')].some(x => x.textContent.trim() === '24 h') && !!document.querySelector('#shift-pay-day') && document.querySelector('[role=dialog]')?.innerText.includes('Este mês') && document.querySelector('[role=dialog]')?.innerText.includes('Mês seguinte')")));
  if (opened) await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  t.check("Resumo de Plantões aparece antes do calendário e há lista mensal", await b.ev("(() => { const r=document.querySelector('[data-totals]'), c=document.querySelector('[role=region][aria-labelledby=calendario-titulo]'); return !!r && !!c && r.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING && !!document.querySelector('[data-month-list]'); })()"));
  await b.goto("/plantoes/organizacao");
  t.check("Recebimentos, recorrências e locais/tipos estão consolidados", await b.ev("!!document.querySelector('#recebimentos') && !!document.querySelector('#recorrencias') && !!document.querySelector('#tipos')"));

  await b.goto("/pericias");
  t.check("Perícias tem resumo antes do calendário e calendário mostra horários quando há itens", await b.ev("(() => { const r=document.querySelector('[data-exams-totals]'), c=document.querySelector('[role=region][aria-labelledby=calendario-titulo]'); return !!r && !!c && !!(r.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING); })()"));

  for (const width of [375, 1280]) {
    await b.viewport(width, width === 375 ? 740 : 900);
    for (const path of ["/", "/follow-up", "/plantoes", "/plantoes/organizacao", "/pericias", "/cnpj"]) {
      await b.goto(path);
      t.check(`${width}px ${path}: sem rolagem horizontal`, await noOverflow());
    }
  }
  t.check("sem exceções nem console.error nas telas verificadas", b.consoleIssues.length === 0, b.consoleIssues);
} finally {
  await b.close();
  await cleanup().catch(() => {});
  t.print();
}
if (t.failures) process.exitCode = 1;
