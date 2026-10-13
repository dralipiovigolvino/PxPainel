// Revisão visual assistida (375, 768 e 1280 px) na APLICAÇÃO real, com a conta fictícia A.
// Percorre Dashboard, Finanças, Follow-up, Plantões, Perícias, CNPJ e Minha conta: estados vazios, telas com dados,
// diálogos e mensagens de erro. Em cada tela mede problemas OBJETIVOS (rolagem horizontal, elemento
// cortado, alvo de toque pequeno, diálogo fora da tela, texto sobreposto pela barra fixa) e grava
// capturas em VISUAL_SHOTS_DIR (fora do repositório) para inspeção.
// Uso: VISUAL_SHOTS_DIR=<pasta> npm run test:visual

import { mkdirSync } from "node:fs";
import { assertBranch } from "./lib/branch-guard.mjs";
import { createChecks, startBrowser } from "./lib/browser.mjs";
import { cleanupSeed, ids, seed } from "./lib/cenario-visual.mjs";
import { requireEnv } from "./lib/env-file.mjs";

requireEnv(["DATABASE_URL_UNPOOLED", "RLS_TEST_A_EMAIL", "RLS_TEST_A_PASSWORD", "RLS_TEST_A_ID", "RLS_TEST_B_ID"]);
assertBranch("test:visual");
const A = { email: process.env.RLS_TEST_A_EMAIL, password: process.env.RLS_TEST_A_PASSWORD };
const DIR = process.env.VISUAL_SHOTS_DIR;
if (DIR) mkdirSync(DIR, { recursive: true });
const WIDTHS = [375, 768, 1280];
const t = createChecks();
const b = await startBrowser({ base: process.env.APP_URL ?? "http://localhost:3000", port: 9343 });
const shot = async (name) => DIR && b.shot(`${DIR}/${name}.png`);

/** Problemas objetivos da tela atual (lista vazia = nada encontrado). */
const audit = () =>
  b.ev(`(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push('rolagem horizontal (' + document.documentElement.scrollWidth + ' > ' + vw + ')');
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && el.offsetParent !== null; };
    const scrollsX = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true; } return false; };
    const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 40);
    const dialog = document.querySelector('[role=dialog]');
    const root = dialog ?? document.body;
    for (const el of root.querySelectorAll('button, a[href], input, select, textarea, [role=button]')) {
      if (!visible(el) || el.closest('[aria-hidden=true]')) continue;
      // Só leitor de tela / visível ao focar (ex.: "Pular para o conteúdo").
      if (el.classList.contains('sr-only') || getComputedStyle(el).clipPath === 'inset(50%)' || getComputedStyle(el).clip === 'rect(0px, 0px, 0px, 0px)') continue;
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !scrollsX(el)) out.push('cortado na lateral: ' + label(el));
      if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') continue;
      if (r.width < 24 || r.height < 24) { if (!(el.tagName === 'A' && getComputedStyle(el).display === 'inline')) out.push('alvo menor que 24 px (' + Math.round(r.width) + 'x' + Math.round(r.height) + '): ' + label(el)); }
    }
    if (dialog) {
      const r = dialog.getBoundingClientRect();
      if (r.left < -1 || r.right > vw + 1) out.push('diálogo mais largo que a tela');
      if (r.top < -1 || r.bottom > innerHeight + 1) out.push('diálogo mais alto que a tela (' + Math.round(r.height) + ' > ' + innerHeight + ')');
      const btn = [...dialog.querySelectorAll('button[type=submit]')].filter(visible).at(-1);
      if (btn) { btn.scrollIntoView({ block: 'nearest' }); const q = btn.getBoundingClientRect(); if (q.bottom > innerHeight + 1 || q.top < 0) out.push('botão de enviar do diálogo inalcançável'); }
    } else {
      // Barra fixa inferior (celular) não pode cobrir o fim do conteúdo.
      const fixed = [...document.querySelectorAll('nav, footer, div')].find((e) => { const s = getComputedStyle(e); return s.position === 'fixed' && visible(e) && e.getBoundingClientRect().bottom >= innerHeight - 1 && e.getBoundingClientRect().height < 120 && e.getBoundingClientRect().width >= vw - 2; });
      const main = document.querySelector('main');
      if (fixed && main) {
        scrollTo(0, document.documentElement.scrollHeight);
        const last = [...main.querySelectorAll('button, a[href], p, li, td, h2, h3')].filter(visible).at(-1);
        if (last && last.getBoundingClientRect().bottom > fixed.getBoundingClientRect().top + 1) out.push('fim do conteúdo coberto pela barra fixa: ' + label(last));
        scrollTo(0, 0);
      }
    }
    return [...new Set(out)];
  })()`);

const viewport = async (w) => b.viewport(w, w === 375 ? 740 : w === 768 ? 1024 : 800);
async function gotoAuthenticated(path) {
  await b.goto(path);
  await b.waitFor("location.pathname === '/login' || !!document.querySelector('a[href=\"/minha-conta\"]')", 20000);
  // A revisão completa pode durar mais que a sessão curta usada no ambiente de
  // teste. Renove-a entre telas para não auditar a página de login por engano.
  if ((await b.loc()).startsWith("/login")) {
    await b.login(A);
    await b.goto(path);
  }
  await b.waitFor("!!document.querySelector('main') && !!document.querySelector('a[href=\"/minha-conta\"]')", 20000);
  await b.settle(800);
}
async function page(name, path, w) {
  await gotoAuthenticated(path);
  const issues = await audit();
  t.check(`${w}px ${name}: sem problema objetivo de layout`, issues.length === 0, issues);
  await shot(`${name}-${w}`);
}
/** Abre um diálogo pelo texto do botão, confere e fecha. `submitEmpty` envia vazio para ver as mensagens de erro. */
async function dialog(name, path, button, w, { submitEmpty = false, prepare = null } = {}) {
  await gotoAuthenticated(path);
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await b.settle(600);
    opened = (await b.click(button)) && (await b.waitFor(`document.querySelector('[role=dialog]')`, 5000));
  }
  if (!opened) return t.check(`${w}px diálogo ${name}: abre por "${button}"`, false, "não abriu");
  await b.settle(500);
  // Diálogos em etapas (ex.: Nova conta começa pela forma de pagamento): escolhe a etapa antes de medir.
  if (prepare) {
    await b.ev(prepare);
    await b.settle(900);
  }
  let issues = await audit();
  t.check(`${w}px diálogo ${name}: cabe na tela e o envio é alcançável`, issues.length === 0, issues);
  await shot(`dlg-${name}-${w}`);
  if (submitEmpty) {
    const selects = () => b.ev(`[...document.querySelectorAll("[role=dialog] select")].map((el) => el.value).join("|")`);
    const before = await selects();
    await b.ev(`(() => { const d = document.querySelector('[role=dialog]'); const f = d.querySelector('form'); f?.setAttribute('novalidate', ''); [...d.querySelectorAll('button[type=submit]')].at(-1)?.click(); })()`);
    const shown = await b.waitFor(`document.querySelector('[role=dialog] [role=alert], [role=dialog] [aria-invalid=true], [role=dialog] [data-error]')`, 10000);
    await b.settle(400);
    issues = await audit();
    t.check(`${w}px diálogo ${name}: envio vazio mostra erro sem quebrar o layout`, shown && issues.length === 0, shown ? issues : "nenhuma mensagem de erro apareceu");
    await shot(`dlg-${name}-erro-${w}`);
    const after = await selects();
    t.check(`${w}px diálogo ${name}: após o erro, os seletores continuam como o usuário deixou`, before === after, { antes: before, depois: after });
  }
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}

const PAGES_EMPTY = [["vazio-dashboard", "/"], ["vazio-financas", "/financas"], ["vazio-mes", "/financas/mes"], ["vazio-formas", "/financas/formas-de-pagamento"], ["vazio-followup", "/follow-up"], ["vazio-pacientes", "/follow-up/pacientes"], ["vazio-plantoes", "/plantoes"], ["vazio-organizacao", "/plantoes/organizacao"], ["vazio-cnpj", "/cnpj"], ["vazio-pericias", "/pericias"], ["vazio-empresas", "/pericias/empresas"]];
let seeded = false;
try {
  t.info(`limpeza prévia do cenário: ${await cleanupSeed().catch(() => 0)}`);
  await viewport(1280);
  await b.login(A);

  t.info("— estados vazios (conta sem dados) —");
  for (const w of [375, 1280]) {
    await viewport(w);
    for (const [name, path] of PAGES_EMPTY) await page(name, path, w);
  }

  await seed();
  seeded = true;
  const a = ids.A;
  const PAGES = [
    ["dashboard", "/"],
    ["financas", "/financas"],
    ["financas-ano", `/financas?periodo=ano&ano=${new Date().getFullYear()}`],
    ["financas-filtro", `/financas?forma=nenhuma`],
    ["financas-mes", "/financas/mes"],
    ["financas-mes-cartao", `/financas/mes?mes=${a.faturaMes}`],
    ["financas-areas", "/financas/areas"],
    ["financas-recorrencias", "/financas/recorrencias"],
    ["financas-formas", "/financas/formas-de-pagamento"],
    ["followup", "/follow-up"],
    ["followup-pacientes", "/follow-up/pacientes"],
    ["followup-paciente", `/follow-up/pacientes/${a.paciente}`],
    ["followup-modelos", "/follow-up/modelos"],
    ["plantoes", "/plantoes"],
    ["plantoes-detalhe", `/plantoes?plantao=${a.plantaoSerie}`],
    ["plantoes-organizacao", "/plantoes/organizacao"],
    ["plantoes-tipos", "/plantoes/tipos"],
    ["plantoes-recorrencias", "/plantoes/recorrencias"],
    ["plantoes-previsao", "/plantoes/previsao"],
    ["pericias", "/pericias"],
    ["pericias-empresas", "/pericias/empresas"],
    ["pericias-detalhe", `/pericias?pericia=${a.pericia}`],
    ["cnpj", "/cnpj"],
    ["minha-conta", "/minha-conta"],
  ];
  const DIALOGS = [
    ["nova-conta", "/financas/mes", "Nova conta", false],
    ["nova-conta-pix", "/financas/mes", "Nova conta", true, `document.querySelector('[role=dialog] input[name=method][value=pix]').click()`],
    ["nova-compra-cartao", "/financas/mes", "Nova conta", true, `[...document.querySelectorAll('[role=dialog] input[name=method]')].find(i => i.value.startsWith('cartao:')).click()`],
    ["fatura-cartao", `/financas/mes?mes=${a.faturaMes}`, "Abrir fatura do", false],
    ["pagar-cartao", `/financas/mes?mes=${a.faturaMes}`, "Pagar cartão", false],
    ["nova-recorrencia", "/financas/recorrencias", "Nova recorrência", false, `document.querySelector('[role=dialog] input[name=method][value=pix]').click()`],
    ["nova-area", "/financas/areas", "Nova área", true],
    ["novo-cartao", "/financas/formas-de-pagamento", "Cadastrar cartão", true],
    ["novo-paciente", "/follow-up/pacientes", "Novo paciente", true],
    ["adicionar-atendimento", "/follow-up", "Adicionar atendimento", false],
    ["nova-consulta", `/follow-up/pacientes/${a.paciente}`, "Registrar consulta", false],
    ["novo-modelo", "/follow-up/modelos", "Novo modelo", false],
    ["novo-plantao", "/plantoes", "Novo plantão", false],
    ["novo-tipo", "/plantoes/organizacao", "Novo tipo", true],
    ["nova-recorrencia-pl", "/plantoes/organizacao", "Nova recorrência", false],
    ["nova-pericia", "/pericias", "Nova perícia", true],
    ["nova-empresa", "/pericias/empresas", "Nova empresa", true],
    ["novo-cnpj", "/cnpj", "Adicionar outro CNPJ", true],
    ["editar-cnpj", "/cnpj", "Editar [teste-visual]", false],
    ["agendar-consulta", `/follow-up/pacientes/${a.paciente}`, "Agendar próxima consulta", true],
  ];
  for (const w of WIDTHS) {
    await viewport(w);
    t.info(`— ${w}px: telas com dados —`);
    for (const [name, path] of PAGES) await page(name, path, w);
    t.info(`— ${w}px: diálogos e erros —`);
    for (const [name, path, button, submitEmpty, prepare] of DIALOGS) await dialog(name, path, button, w, { submitEmpty, prepare });
    // Navegação: todos os destinos principais alcançáveis nesta largura.
    await gotoAuthenticated("/");
    const nav = await b.ev(`["/", "/financas", "/follow-up", "/plantoes", "/pericias", "/cnpj", "/minha-conta"].filter((h) => ![...document.querySelectorAll('a[href]')].some((x) => x.getAttribute('href') === h && x.getBoundingClientRect().width > 0))`);
    t.check(`${w}px navegação: Dashboard, Finanças, Follow-up, Plantões, Perícias, CNPJ e Minha conta visíveis`, nav.length === 0, nav);
  }
} catch (error) {
  t.check("execução do roteiro sem exceção", false, String(error?.message ?? error).slice(0, 300));
} finally {
  // Fecha o navegador antes da limpeza: uma geração de recorrências ainda em curso não pode recriar linhas no meio dela.
  await b.close();
  await new Promise((r) => setTimeout(r, 2000));
  if (seeded) t.info(`limpeza final do cenário: ${await cleanupSeed().catch((e) => `falhou (${e.message})`)} linha(s)`);
  t.print();
  console.log(`\nconsole: ${b.consoleIssues.length ? `${b.consoleIssues.length} erro(s)` : "sem erros"}`);
  console.log(t.failures ? `${t.failures} ponto(s) a examinar.` : "Nenhum problema objetivo encontrado.");
}
process.exit(t.failures ? 1 : 0);
