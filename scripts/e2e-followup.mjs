// Fluxos de Follow-up (Etapas 8 e 9) na APLICAÇÃO, com Neon Auth e Neon reais.
// Conta fictícia A (B para isolamento); pacientes e modelos "[teste-e2e]" FICTÍCIOS, removidos ao final.
// Uso: npm run test:e2e:followup -- [etapa8] [etapa9]   (sem argumentos = todas)
// Capturas opcionais para inspeção visual: E2E_SHOTS_DIR=<pasta>.

import { Pool } from "@neondatabase/serverless";
import { createChecks, sleep, startBrowser } from "./lib/browser.mjs";

const A = { email: process.env.RLS_TEST_A_EMAIL, password: process.env.RLS_TEST_A_PASSWORD, id: process.env.RLS_TEST_A_ID };
const B = { email: process.env.RLS_TEST_B_EMAIL, password: process.env.RLS_TEST_B_PASSWORD };
const P = "[teste-e2e]";
const wanted = new Set(process.argv.slice(2));
const run = (stage) => wanted.size === 0 || wanted.has(stage);

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const today = fmt.format(new Date());
const addDays = (civil, n) => new Date(Date.parse(`${civil}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const br = (civil) => civil.split("-").reverse().join("/");
const norm = (s) => (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const runStart = new Date(Date.now() - 5000).toISOString();

/** Remove só os dados de teste da conta A: pacientes e modelos "[teste-e2e]" e o histórico deles. */
async function cleanup() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  const c = await pool.connect();
  let removed = 0;
  const exists = async (t) => (await c.query("select to_regclass($1) is not null as ok", [`public.${t}`])).rows[0].ok;
  try {
    await c.query("begin");
    const patients = (await c.query("select id from public.fu_patients where user_id = $1 and name like $2", [A.id, `${P}%`])).rows.map((r) => r.id);
    const templates = (await c.query("select id from public.fu_templates where user_id = $1 and name like $2", [A.id, `${P}%`])).rows.map((r) => r.id);
    if (await exists("fu_events")) {
      removed += (await c.query("delete from public.fu_events where user_id = $1 and (patient_id = any($2::uuid[]) or created_at >= $3::timestamptz)", [A.id, patients, runStart])).rowCount ?? 0;
    }
    if (await exists("fu_steps")) {
      removed += (await c.query("delete from public.fu_steps where plan_id in (select id from public.fu_plans where patient_id = any($1::uuid[]))", [patients])).rowCount ?? 0;
      removed += (await c.query("delete from public.fu_plans where patient_id = any($1::uuid[])", [patients])).rowCount ?? 0;
    }
    removed += (await c.query("delete from public.fu_consultations where patient_id = any($1::uuid[])", [patients])).rowCount ?? 0;
    removed += (await c.query("delete from public.fu_patients where id = any($1::uuid[])", [patients])).rowCount ?? 0;
    removed += (await c.query("delete from public.fu_template_steps where template_id = any($1::uuid[])", [templates])).rowCount ?? 0;
    removed += (await c.query("delete from public.fu_templates where id = any($1::uuid[])", [templates])).rowCount ?? 0;
    await c.query("commit");
  } catch (error) {
    await c.query("rollback").catch(() => {});
    throw error;
  } finally {
    c.release();
    await pool.end();
  }
  return removed;
}

const t = createChecks();
const b = await startBrowser({ port: 9339 });
const { ev } = b;
const check = t.check;
const shot = async (name) => process.env.E2E_SHOTS_DIR && b.shot(`${process.env.E2E_SHOTS_DIR}/${name}.png`);

const noticeText = () => ev(`document.querySelector('main [data-notice] p')?.textContent ?? ''`);
const waitNotice = (text) =>
  b.waitFor(`!document.querySelector('[role=dialog], [role=alertdialog]') && document.querySelector('main [data-notice] p')?.textContent === ${JSON.stringify(text)}`, 30000);
const dialogSubmit = () => ev(`document.querySelector('[role=dialog] form button[type=submit]').click()`);
const selectOption = (selector, startsWith) =>
  ev(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); const o = [...s.options].find(o => o.textContent.startsWith(${JSON.stringify(startsWith)}));
    if (!o) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const bodyHas = (text) => ev(`document.body.innerText.includes(${JSON.stringify(text)})`);
const escape = async () => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
};
const noOverflow = () =>
  ev(`(() => { const d = document.documentElement; const main = document.querySelector('main'); const r = main.getBoundingClientRect().right;
    const over = [...main.querySelectorAll('*')].filter(el => el.offsetParent !== null && el.getBoundingClientRect().right > r + 1).length;
    return { h: d.scrollWidth > d.clientWidth, over }; })()`);
const patientLinks = (name) =>
  ev(`[...document.querySelectorAll('[data-patient] a')].filter(a => a.offsetParent !== null && a.querySelector('p')?.textContent === ${JSON.stringify(name)}).map(a => a.getAttribute('href'))`);

async function createPatient(name, phone = "") {
  await b.goto("/follow-up/pacientes");
  await b.click("Novo paciente");
  await b.waitFor(`document.querySelector('#patient-name')`);
  await b.type("#patient-name", name);
  if (phone) await b.type("#patient-phone", phone);
  await dialogSubmit();
  return waitNotice("Paciente cadastrado.");
}

/** Cria um modelo pela interface: etapas [[dias, mensagem], …]. */
async function createTemplate(name, steps) {
  await b.goto("/follow-up/modelos");
  await b.click("Novo modelo");
  await b.waitFor(`document.querySelector('#template-name')`);
  await b.type("#template-name", name);
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) await b.click("Adicionar etapa", "[role=dialog]");
    await b.waitFor(`document.querySelectorAll('[data-step-offset]').length === ${i + 1}`);
    await ev(`(() => { const el = document.querySelectorAll('[data-step-offset]')[${i}]; el.id = 'e2e-off-${i}'; const m = document.querySelectorAll('[data-step-message]')[${i}]; m.id = 'e2e-msg-${i}'; })()`);
    await b.type(`#e2e-off-${i}`, String(steps[i][0]));
    await b.type(`#e2e-msg-${i}`, steps[i][1]);
  }
  await dialogSubmit();
  return waitNotice("Modelo criado.");
}

try {
  t.info(`limpeza prévia: ${await cleanup()} registro(s)`);
  await b.viewport(1280, 900);
  await b.login(A);

  // -------------------------------------------------------------------------
  if (run("etapa8")) {
    t.info("— Etapa 8: pacientes, consultas e modelos —");
    await b.goto("/follow-up");
    check("abas Acompanhamentos, Pacientes e Modelos", await ev(`[...document.querySelectorAll('nav[aria-label="Seções de Follow-up"] a')].map(a => a.textContent).join('|') === 'Acompanhamentos|Pacientes|Modelos'`));

    const joana = `${P} Joana Exemplo`;
    await b.goto("/follow-up/pacientes");
    check("nenhum paciente pré-cadastrado para a conta de teste", !(await bodyHas(P)));
    await b.click("Novo paciente");
    await b.waitFor(`document.querySelector('#patient-name')`);
    await b.type("#patient-name", joana);
    await b.type("#patient-phone", "123");
    await dialogSubmit();
    check(
      "telefone inválido é recusado com orientação junto ao campo",
      await b.waitFor(`(document.getElementById('patient-phone-erro')?.textContent ?? '').includes('ex.: (11) 98765-4321')`),
      await ev(`document.getElementById('patient-phone-erro')?.textContent`),
    );
    await b.type("#patient-phone", "(11) 98765-4321");
    await dialogSubmit();
    check("cadastrar paciente com WhatsApp", await waitNotice("Paciente cadastrado."), await noticeText());
    check("cadastrar homônimo sem telefone", await createPatient(joana), await noticeText());
    check("dois pacientes com o mesmo nome na lista", (await patientLinks(joana)).length === 2, await patientLinks(joana));

    const urlBefore = await b.loc();
    await b.type("[data-patient-search]", "JOANA exemplo");
    check("busca por nome ignora maiúsculas e encontra os dois", (await patientLinks(joana)).length === 2);
    await b.type("[data-patient-search]", "98765-4321");
    check("busca por telefone encontra só quem tem o número", (await patientLinks(joana)).length === 1);
    await b.type("[data-patient-search]", "zzz-inexistente");
    check("busca sem resultado informa", (await bodyHas("Nenhum paciente encontrado.")) && (await patientLinks(joana)).length === 0);
    check("termo de busca não vai para a URL", (await b.loc()) === urlBefore && !(await b.loc()).includes("joana"), await b.loc());
    await b.type("[data-patient-search]", "98765");
    const withPhone = (await patientLinks(joana))[0];
    await b.type("[data-patient-search]", "");
    const noPhone = (await patientLinks(joana)).find((h) => h !== withPhone);

    await b.goto(withPhone);
    check("página do paciente mostra telefone formatado", await bodyHas("+55 (11) 98765-4321"));
    check("URL do paciente não contém nome nem telefone", !/joana|98765/i.test(await b.loc()), await b.loc());
    await b.click("Editar");
    await b.waitFor(`document.querySelector('#patient-notes')`);
    await b.type("#patient-notes", "Prefere contato à tarde.\nPaciente fictícia.");
    await dialogSubmit();
    check("editar paciente", await waitNotice("Paciente atualizado."), await noticeText());

    await b.click("Registrar consulta");
    await b.waitFor(`document.querySelector('#consult-date')`);
    await b.setValue("#consult-date", addDays(today, 1));
    await dialogSubmit();
    check("consulta futura é recusada", await b.waitFor(`(document.getElementById('consult-date-erro')?.textContent ?? '').includes('data futura')`));
    await b.setValue("#consult-date", addDays(today, -20));
    await b.type("#consult-notes", "Consulta retroativa fictícia.");
    await dialogSubmit();
    check("registrar consulta retroativa", await waitNotice("Consulta registrada."), await noticeText());
    await b.click("Registrar consulta");
    await b.waitFor(`document.querySelector('#consult-date')`);
    await dialogSubmit();
    check("registrar segunda consulta (hoje)", await waitNotice("Consulta registrada."), await noticeText());
    const consults = await ev(`[...document.querySelectorAll('[data-consultation]')].map(li => li.dataset.consultation)`);
    check("duas consultas no histórico, mais recente primeiro", JSON.stringify(consults) === JSON.stringify([today, addDays(today, -20)]), consults);
    await b.openMenu(`Mais ações da consulta de ${br(today)}`);
    await b.menuItem("Observação");
    await b.waitFor(`document.querySelector('#consult-notes-edit')`);
    await b.type("#consult-notes-edit", "Retorno fictício.");
    await dialogSubmit();
    check("editar observação da consulta", await waitNotice("Observação da consulta salva."), await noticeText());

    await b.openMenu("Mais ações do paciente");
    await b.menuItem("Arquivar");
    check("arquivar paciente (pelo menu de ações)", await waitNotice("Paciente arquivado."), await noticeText());
    check(
      "arquivado: aviso e 'Registrar consulta' desativado",
      (await ev(`!!document.querySelector('[data-archived-note]')`)) && (await ev(`[...document.querySelectorAll('button')].find(x => x.textContent.includes('Registrar consulta'))?.disabled === true`)),
    );
    await b.openMenu("Mais ações do paciente");
    await b.menuItem("Restaurar");
    check("restaurar paciente", await waitNotice("Paciente restaurado."), await noticeText());
    await b.openMenu("Mais ações do paciente");
    check("com consultas, 'Excluir' não é oferecido", !(await ev(`[...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent.trim() === 'Excluir')`)));
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await b.goto(withPhone);
    check("dados persistem após recarregar", (await bodyHas("Prefere contato à tarde.")) && (await bodyHas("Retorno fictício.")) && (await bodyHas("Consulta retroativa fictícia.")));

    await b.goto(noPhone);
    check("homônimo sem telefone mostra 'Sem telefone'", await bodyHas("Sem telefone"));
    await b.openMenu("Mais ações do paciente");
    await b.menuItem("Excluir");
    await b.waitFor(`document.querySelector('[role=alertdialog]')`);
    await b.click("Excluir paciente", "[role=alertdialog]");
    check("excluir paciente sem consultas volta à lista com aviso", await b.waitFor(`location.pathname === '/follow-up/pacientes' && document.querySelector('main [data-notice] p')?.textContent === 'Paciente excluído.'`, 30000));

    // Modelos
    await b.goto("/follow-up/modelos");
    check("nenhum modelo pré-criado para a conta de teste", !(await bodyHas(P)));
    await b.click("Novo modelo");
    await b.waitFor(`document.querySelector('#template-name')`);
    await b.type("#template-name", `${P} Pós-consulta`);
    await ev(`(() => { document.querySelectorAll('[data-step-offset]')[0].id = 'off0'; document.querySelectorAll('[data-step-message]')[0].id = 'msg0'; })()`);
    await b.type("#off0", "0");
    await b.type("#msg0", "Olá, {nome}!\nObrigado pela consulta de {data_consulta}.");
    check(
      "prévia renderiza variáveis com dados de exemplo e preserva quebra de linha",
      await b.waitFor(`(document.querySelector('[data-step-preview]')?.innerText ?? '').includes('Olá, Maria Exemplo!\\nObrigado pela consulta de ${br(today)}.')`),
      await ev(`document.querySelector('[data-step-preview]')?.innerText`),
    );
    await b.click("Adicionar etapa", "[role=dialog]");
    await b.waitFor(`document.querySelectorAll('[data-step-offset]').length === 2`);
    await ev(`(() => { document.querySelectorAll('[data-step-offset]')[1].id = 'off1'; document.querySelectorAll('[data-step-message]')[1].id = 'msg1'; })()`);
    await b.type("#off1", "0");
    check("intervalo duplicado é apontado no formulário", await b.waitFor(`document.querySelector('[role=dialog]').innerText.includes('D0 já existe neste modelo.')`));
    await b.type("#off1", "45");
    await b.type("#msg1", "Dr. {medico}: como está, {nome}?");
    check("variável desconhecida é apontada", await b.waitFor(`document.querySelector('[role=dialog]').innerText.includes('Variável desconhecida: {medico}')`));
    await dialogSubmit();
    check("servidor também recusa a variável desconhecida", await b.waitFor(`document.querySelector('[role=dialog] [role=alert]')?.textContent === 'Revise os campos destacados.'`, 20000));
    await b.type("#msg1", "Como está, {nome}? ({dia_followup})");
    await dialogSubmit();
    check("criar modelo com D0 e D45", await waitNotice("Modelo criado."), await noticeText());
    const card = norm(await ev(`[...document.querySelectorAll('[data-template]')].find(li => li.innerText.includes(${JSON.stringify(`${P} Pós-consulta`)}))?.innerText`));
    const templateVersion = () => ev(`[...document.querySelectorAll('[data-template]')].find(li => li.innerText.includes(${JSON.stringify(`${P} Pós-consulta`)}))?.dataset.templateVersion`);
    check("modelo lista as etapas D0 e D45 (versão 1, sem poluir a linha)", card.includes("D0") && card.includes("D45") && !card.includes("versão") && (await templateVersion()) === "1", card);
    await b.click(`Editar modelo ${P} Pós-consulta`);
    await b.waitFor(`document.querySelectorAll('[data-step-offset]').length === 2`);
    await b.click("Adicionar etapa", "[role=dialog]");
    await b.waitFor(`document.querySelectorAll('[data-step-offset]').length === 3`);
    await ev(`(() => { document.querySelectorAll('[data-step-offset]')[2].id = 'off2'; document.querySelectorAll('[data-step-message]')[2].id = 'msg2'; })()`);
    await b.type("#off2", "7");
    await b.type("#msg2", "Uma semana depois, {nome}.");
    await dialogSubmit();
    check("editar modelo cria nova versão", await waitNotice("Modelo atualizado. Acompanhamentos já gerados não mudam."), await noticeText());
    const card2 = norm(await ev(`[...document.querySelectorAll('[data-template]')].find(li => li.innerText.includes(${JSON.stringify(`${P} Pós-consulta`)}))?.innerText`));
    check("versão 2 com D7 incluído", card2.includes("D7") && (await templateVersion()) === "2", card2);
    await b.openMenu(`Ações do modelo ${P} Pós-consulta`);
    await b.menuItem("Arquivar");
    check("arquivar modelo (pelo menu de ações)", await waitNotice("Modelo arquivado. Acompanhamentos já gerados não mudam."), await noticeText());
    check(
      "modelo arquivado continua na mesma lista, marcado, sem seção de arquivados",
      (await b.waitFor(`[...document.querySelectorAll('[data-template][data-archived]')].some(li => li.innerText.includes(${JSON.stringify(`${P} Pós-consulta`)}) && li.innerText.includes('Arquivado'))`, 10000)) && !(await bodyHas("Modelos arquivados")),
    );
    await b.openMenu(`Ações do modelo ${P} Pós-consulta`);
    await b.menuItem("Restaurar");
    check("restaurar modelo", await waitNotice("Modelo restaurado."), await noticeText());

    // Isolamento pela aplicação.
    await b.logout();
    await b.login(B);
    await b.goto(withPhone);
    check("B recebe 404 na página do paciente de A", !(await bodyHas(joana)) && ((await bodyHas("não encontrad")) || (await bodyHas("404"))));
    await b.goto("/follow-up/pacientes");
    check("B não vê pacientes de A", !(await bodyHas(P)));
    await b.goto("/follow-up/modelos");
    check("B não vê modelos de A", !(await bodyHas(P)));
    await b.logout();
    await b.login(A);

    for (const [w, h] of [[375, 812], [768, 1024], [1280, 900]]) {
      await b.viewport(w, h);
      for (const [label, path] of [["pacientes", "/follow-up/pacientes"], ["paciente", withPhone], ["modelos", "/follow-up/modelos"]]) {
        await b.goto(path);
        const m = await noOverflow();
        check(`${w}px ${label}: sem rolagem horizontal nem conteúdo cortado`, !m.h && m.over === 0, m);
        await shot(`fu-${label}-${w}`);
      }
      await b.click(`Editar modelo ${P} Pós-consulta`);
      await b.waitFor(`document.querySelector('[role=dialog]')`);
      const fits = await ev(`(() => { const d = document.querySelector('[role=dialog]').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth + 1; })()`);
      check(`${w}px: formulário de modelo cabe na tela`, fits);
      await shot(`fu-modelo-form-${w}`);
      await escape();
    }
    await b.viewport(1280, 900);
  }
  // -------------------------------------------------------------------------
  if (run("etapa9")) {
    t.info("— Etapa 9: geração e execução —");
    const carlos = `${P} Carlos Fictício`;
    const padrao = `${P} Padrão`;
    check(
      "criar modelo Padrão (D0, D1, D7, D30)",
      await createTemplate(padrao, [
        [0, "Olá, {nome}! Consulta de {data_consulta}."],
        [1, "{dia_followup}: como está, {nome}?"],
        [7, "Uma semana depois ({dia_followup})."],
        [30, "Um mês após {data_consulta}."],
      ]),
    );
    check("criar paciente fictício", await createPatient(carlos));
    await b.goto("/follow-up/pacientes");
    const patientUrl = (await patientLinks(carlos))[0];
    await b.goto(patientUrl);

    const base = addDays(today, -10);
    await b.click("Registrar consulta");
    await b.waitFor(`document.querySelector('#consult-template')`);
    await b.setValue("#consult-date", base);
    await selectOption("#consult-template", padrao);
    const preview = norm(await ev(`document.querySelector('[data-plan-preview]')?.innerText`));
    check(
      "prévia mostra etapa, data calculada e mensagem renderizada",
      preview.includes(`D0 · ${br(base)}`) && preview.includes(`D30 · ${br(addDays(base, 30))}`) && preview.includes(`Olá, ${carlos}! Consulta de ${br(base)}.`) && preview.includes(`D1: como está, ${carlos}?`),
      preview,
    );
    await ev(`(() => { const btn = document.querySelector('[role=dialog] form button[type=submit]'); btn.click(); btn.click(); })()`);
    check("registrar consulta retroativa com acompanhamento (duplo clique)", await waitNotice("Consulta registrada com acompanhamento (4 etapas)."), await noticeText());
    check("duplo clique não duplicou a consulta", (await ev(`document.querySelectorAll('[data-consultation]').length`)) === 1);
    const statuses = await ev(`[...document.querySelectorAll('[data-step]')].map(li => li.dataset.step + ':' + li.querySelector('span.rounded-md')?.textContent)`);
    check("retroativa: D0, D1 e D7 atrasadas; D30 pendente", JSON.stringify(statuses) === JSON.stringify(["D0:Atrasada", "D1:Atrasada", "D7:Atrasada", "D30:Pendente"]), statuses);

    // Central
    await b.goto("/follow-up?filtro=atrasados");
    const counts = await ev(`Object.fromEntries([...document.querySelectorAll('[data-count]')].map(s => [s.dataset.count, s.textContent]))`);
    check("contadores: 0 hoje, 3 atrasados, 1 próximo, 0 concluídos", counts.hoje === "0" && counts.atrasados === "3" && counts.proximos === "1" && counts.concluidos === "0", counts);
    check("atrasados ordenados do mais antigo (D0, D1, D7)", JSON.stringify(await ev(`[...document.querySelectorAll('[data-step]')].map(li => li.dataset.step)`)) === JSON.stringify(["D0", "D1", "D7"]));
    check("central mostra paciente e data da consulta", norm(await ev(`document.querySelector('[data-central-patient]')?.innerText`)).includes(`${carlos} · consulta de ${br(base)}`));
    const urlBefore = await b.loc();
    await b.type("[data-central-search]", "carlos ficticio");
    check("busca por paciente (sem acento) encontra", (await ev(`document.querySelectorAll('[data-step]').length`)) === 3);
    await b.type("[data-central-search]", "zzz");
    check("busca sem resultado; termo fora da URL", (await ev(`document.querySelectorAll('[data-step]').length`)) === 0 && (await b.loc()) === urlBefore);
    await b.type("[data-central-search]", "");

    // Copiar (sucesso) — permissão de área de transferência concedida ao navegador de teste.
    await b.send("Browser.grantPermissions", { origin: b.BASE, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await b.click("Mensagem D1");
    await b.waitFor(`document.querySelector('[data-message-text]')`);
    const msg = await ev(`document.querySelector('[data-message-text]').value`);
    check("mensagem renderizada antes de copiar", msg === `D1: como está, ${carlos}?`, msg);
    await b.click("Copiar mensagem", "[role=dialog]");
    check("copiar mostra sucesso só após a área de transferência aceitar", await b.waitFor(`document.querySelector('[data-copy-status=copied]')`));
    check("área de transferência contém o texto exibido", (await ev(`navigator.clipboard.readText()`)) === msg);
    // Falha da Clipboard API: sem mensagem de sucesso, texto selecionado para cópia manual.
    await ev(`Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('negado')) }); true`);
    await b.click("Copiar mensagem", "[role=dialog]");
    check(
      "falha ao copiar: aviso e seleção manual, sem sucesso",
      (await b.waitFor(`document.querySelector('[data-copy-status=failed]')`)) &&
        (await ev(`(() => { const el = document.querySelector('[data-message-text]'); return document.activeElement === el && el.selectionEnd - el.selectionStart === el.value.length; })()`)) &&
        !(await ev(`document.body.innerText.includes('Mensagem copiada.')`)),
    );
    // Ajuste do texto só desta etapa.
    await b.type("[data-message-text]", "Oi, {nome}! Passando para saber como está.");
    await b.click("Salvar ajuste nesta etapa", "[role=dialog]");
    check("ajustar texto da etapa sem alterar o modelo", await waitNotice("Texto desta etapa ajustado. O modelo não mudou."), await noticeText());
    check("copiar não concluiu a etapa", (await ev(`document.querySelector('[data-step=D1]')?.dataset.stepStatus`)) === "pendente");

    // Realizar e desfazer
    await b.click("Marcar D1 como realizada");
    await b.waitFor(`document.querySelector('[data-done-preview]')`);
    check("realização mostra o texto que ficará registrado", norm(await ev(`document.querySelector('[data-done-preview]').innerText`)) === `Oi, ${carlos}! Passando para saber como está.`);
    await b.type(`[role=dialog] textarea[name=note]`, "Respondeu que está bem (fictício).");
    await dialogSubmit();
    check("marcar como realizada", await waitNotice("Etapa marcada como realizada."), await noticeText());
    await b.goto("/follow-up?filtro=concluidos");
    check("concluídos mostra a etapa com indicador de observação", (await ev(`document.querySelectorAll('[data-step=D1][data-step-status=realizado] [data-note-indicator]').length`)) === 1);
    await b.openMenu("Mais ações D1");
    await b.menuItem("Desfazer realização");
    await b.waitFor(`document.querySelector('[role=alertdialog]')`);
    check("desfazer pede confirmação", await ev(`document.querySelector('[role=alertdialog]').innerText.includes('fica guardada no histórico')`));
    await b.click("Desfazer", "[role=alertdialog]");
    check("desfazer realização", await waitNotice("Realização desfeita. A etapa voltou para pendente; o registro anterior ficou no histórico."), await noticeText());
    await b.goto("/follow-up?filtro=atrasados");
    check("após desfazer, volta para atrasados", (await ev(`document.querySelectorAll('[data-step=D1]').length`)) === 1);

    // Remarcar e cancelar
    await b.openMenu("Mais ações D7");
    await b.menuItem("Remarcar");
    await b.waitFor(`document.querySelector('[role=dialog] input[name=dueDate]')`);
    await b.setValue(`[role=dialog] input[name=dueDate]`, addDays(today, 3));
    await dialogSubmit();
    check("remarcar etapa", await waitNotice("Etapa remarcada. A data original continua registrada."), await noticeText());
    await b.goto("/follow-up?filtro=proximos");
    check("D7 remarcada aparece em próximos com a data original", norm(await ev(`document.querySelector('[data-step=D7]')?.innerText`)).includes(`Remarcada (original ${br(addDays(base, 7))})`));
    await b.openMenu("Mais ações D30");
    await b.menuItem("Cancelar D30");
    await b.waitFor(`document.querySelector('[role=dialog] input[name=reason]')`);
    await b.type(`[role=dialog] input[name=reason]`, "Teste fictício");
    await dialogSubmit();
    check("cancelar etapa", await waitNotice("Etapa cancelada. Ela continua visível no histórico."), await noticeText());
    await b.goto("/follow-up?filtro=todos");
    check("cancelada some de 'Todos' por padrão", (await ev(`document.querySelectorAll('[data-step=D30]').length`)) === 0);
    await b.goto("/follow-up?filtro=todos&cancelados=1");
    check("cancelada aparece com 'Mostrar cancelados'", (await ev(`document.querySelectorAll('[data-step=D30][data-step-status=cancelado]').length`)) === 1);

    // Corrigir data da consulta com prévia
    await b.goto(patientUrl);
    await b.openMenu(`Mais ações da consulta de ${br(base)}`);
    await b.menuItem("Corrigir data");
    await b.waitFor(`document.querySelector('#consult-date-fix')`);
    const fixed = addDays(base, -2);
    await b.setValue("#consult-date-fix", fixed);
    await b.waitFor(`document.querySelector('[data-date-preview]')`, 20000);
    const dp = norm(await ev(`document.querySelector('[data-date-preview]').innerText`));
    check(
      "prévia da correção: recalcula D0 e D1; mantém D7 remarcada",
      dp.includes(`D0 ${br(base)} → ${br(fixed)}`) && dp.includes(`D1 ${br(addDays(base, 1))} → ${br(addDays(fixed, 1))}`) && dp.includes(`Mantidas (remarcadas por você): D7 em ${br(addDays(today, 3))}`),
      dp,
    );
    await dialogSubmit();
    check("confirmar correção", await waitNotice("Data corrigida. 2 etapas pendentes recalculadas."), await noticeText());

    // Substituir pendentes
    check("criar modelo Curto (D1, D15)", await createTemplate(`${P} Curto`, [[1, "Curto D1"], [15, "Curto D15, {nome}."]]));
    await b.goto(patientUrl);
    await b.openMenu(`Mais ações do acompanhamento da consulta de ${br(fixed)}`);
    await b.menuItem("Substituir");
    await b.waitFor(`document.querySelector('#replace-template')`);
    await selectOption("#replace-template", `${P} Curto`);
    await b.waitFor(`document.querySelector('[data-replace-preview]')`, 20000);
    const rp = norm(await ev(`document.querySelector('[data-replace-preview]').innerText`));
    check(
      "prévia: remove D0; mantém D1 e D7 personalizadas; inclui D15",
      rp.includes("Removidas (substituídas): D0") && rp.includes("D1 (personalizada)") && rp.includes("D7 (personalizada)") && rp.includes(`Incluídas: D15 em ${br(addDays(fixed, 15))}`) && rp.includes("Não recriadas por já existirem: D1"),
      rp,
    );
    await dialogSubmit();
    check("substituir pendentes", await waitNotice("Etapas pendentes substituídas. Realizadas e personalizadas foram mantidas."), await noticeText());
    const alive = await ev(`[...document.querySelectorAll('[data-step]')].filter(li => li.dataset.stepStatus !== 'cancelado').map(li => li.dataset.step)`);
    check("etapas vivas sem duplicação: D1, D7, D15", JSON.stringify(alive) === JSON.stringify(["D1", "D7", "D15"]), alive);

    // Segunda consulta: aplicar depois, acompanhamentos simultâneos e cancelamento do plano
    await b.click("Registrar consulta");
    await b.waitFor(`document.querySelector('#consult-template')`);
    await dialogSubmit();
    check("registrar segunda consulta sem modelo", await waitNotice("Consulta registrada."), await noticeText());
    await b.click(`Aplicar modelo à consulta de ${br(today)}`);
    await b.waitFor(`document.querySelector('#apply-template')`);
    await selectOption("#apply-template", padrao);
    check("prévia ao aplicar depois", await b.waitFor(`document.querySelector('[role=dialog] [data-plan-preview]')`));
    await dialogSubmit();
    check("aplicar modelo à consulta sem acompanhamento", await waitNotice("Acompanhamento gerado (4 etapas)."), await noticeText());
    check("aviso de acompanhamentos simultâneos", await ev(`!!document.querySelector('[data-concurrent-note]')`));
    check("segunda consulta não encerrou a primeira", (await ev(`document.querySelectorAll('[data-plan=ativo]').length`)) === 2);
    await b.openMenu(`Mais ações do acompanhamento da consulta de ${br(today)}`);
    await b.menuItem("Cancelar acompanhamento");
    await b.waitFor(`document.querySelector('#plan-cancel-reason')`);
    await dialogSubmit();
    check("cancelar acompanhamento", await waitNotice("Acompanhamento cancelado (4 etapas pendentes canceladas). Realizadas foram mantidas."), await noticeText());

    // Histórico e persistência
    await b.goto(patientUrl);
    await ev(`document.querySelectorAll('[data-history]').forEach(d => d.open = true); true`);
    const hist = norm(await ev(`[...document.querySelectorAll('[data-history]')].map(d => d.innerText).join(' | ')`));
    check(
      "histórico registra cópia, realização desfeita (com texto), remarcação, correção e substituição",
      hist.includes("Mensagem de D1 copiada (não indica envio).") &&
        hist.includes("Realização de D1 desfeita") &&
        hist.includes(`Oi, ${carlos}! Passando para saber como está.`) &&
        hist.includes("D7 remarcada de") &&
        hist.includes(`Data da consulta corrigida de ${br(base)} para ${br(fixed)}`) &&
        hist.includes("Pendentes substituídas") &&
        hist.includes("Acompanhamento cancelado"),
      hist.slice(0, 400),
    );
    check("plano cancelado mostra cancelamento", await ev(`!!document.querySelector('[data-plan-canceled]')`));

    // Sessão revogada: a cópia anterior dos cookies não lê dados de pacientes.
    const cookies = await b.authCookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const before = await fetch(`${b.BASE}/follow-up/pacientes`, { headers: { cookie: cookieHeader }, redirect: "manual" });
    const beforeOk = before.status === 200 && (await before.text()).includes(carlos);
    await b.logout();
    const after = await fetch(`${b.BASE}/follow-up/pacientes`, { headers: { cookie: cookieHeader }, redirect: "manual" });
    const afterBody = after.status === 200 ? await after.text() : "";
    check("com sessão válida, a cópia dos cookies lê a lista (controle)", beforeOk, before.status);
    check("após sair (sessão revogada), a mesma cópia é redirecionada ao login, sem dados", after.status >= 300 && after.status < 400 && !afterBody.includes(carlos), after.status);

    // Isolamento pela aplicação
    await b.login(B);
    await b.goto(patientUrl);
    check("B recebe 404 no paciente de A (com acompanhamentos)", !(await bodyHas(carlos)) && ((await bodyHas("não encontrad")) || (await bodyHas("404"))));
    await b.goto("/follow-up?filtro=todos&cancelados=1");
    check("B não vê acompanhamentos de A", !(await bodyHas(P)));
    await b.logout();
    await b.login(A);

    for (const [w, h] of [[375, 812], [768, 1024], [1280, 900]]) {
      await b.viewport(w, h);
      for (const [label, path] of [["central", "/follow-up?filtro=todos&cancelados=1"], ["paciente-plano", patientUrl]]) {
        await b.goto(path);
        const m = await noOverflow();
        check(`${w}px ${label}: sem rolagem horizontal nem conteúdo cortado`, !m.h && m.over === 0, m);
        await shot(`fu-${label}-${w}`);
      }
      await b.goto("/follow-up?filtro=proximos");
      await b.click("Mensagem D7");
      await b.waitFor(`document.querySelector('[data-message-text]')`);
      const fits = await ev(`(() => { const d = document.querySelector('[role=dialog]').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth + 1; })()`);
      check(`${w}px: diálogo da mensagem cabe na tela`, fits);
      await shot(`fu-mensagem-${w}`);
      await escape();
    }
    await b.viewport(1280, 900);
  }
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
