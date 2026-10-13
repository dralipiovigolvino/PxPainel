// Teste ponta a ponta de login, sessão, preferências e isolamento na APLICAÇÃO, com o
// Neon Auth e o Neon reais, usando o Chrome instalado (DevTools Protocol, sem dependências).
//
// Pré-requisitos:
//   - App rodando em APP_URL (padrão http://localhost:3000): npm run build && npm run start
//   - Contas fictícias A e B em .env.local (npm run auth:create-test-users)
//   - CHROME_PATH, se o Chrome não estiver no caminho padrão do Windows
//
// Uso: npm run test:e2e
// Não imprime senhas, cookies nem tokens.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireEnv } from "./lib/env-file.mjs";

requireEnv(["RLS_TEST_A_EMAIL", "RLS_TEST_A_PASSWORD", "RLS_TEST_B_EMAIL", "RLS_TEST_B_PASSWORD"]);
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const A = { email: process.env.RLS_TEST_A_EMAIL, password: process.env.RLS_TEST_A_PASSWORD };
const B = { email: process.env.RLS_TEST_B_EMAIL, password: process.env.RLS_TEST_B_PASSWORD };
const PORT = 9335;

const profile = mkdtempSync(join(tmpdir(), "painel-e2e-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) throw new Error("Chrome não respondeu. Defina CHROME_PATH.");
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
const consoleIssues = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") consoleIssues.push(m.params.exceptionDetails.text);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleIssues.push("console.error");
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");

const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const viewport = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
const loc = () => ev("location.pathname + location.search");
async function settle(ms = 1200) {
  await sleep(ms);
  for (let i = 0; i < 30 && (await ev("document.readyState")) !== "complete"; i++) await sleep(200);
}
async function goto(path) {
  await send("Page.navigate", { url: BASE + path });
  await settle();
}
async function waitFor(expr, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await ev(`!!(${expr})`)) return true;
    await sleep(250);
  }
  return false;
}
async function type(selector, text) {
  await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  if (text) await send("Input.insertText", { text });
}
const authCookies = async () => (await send("Network.getCookies", { urls: [BASE] })).cookies.filter((c) => c.name.startsWith("__Secure-neon-auth"));

async function login(account, path = "/login") {
  await goto(path);
  await type("#email", account.email);
  await type("#password", account.password);
  await ev(`document.querySelector('form button[type=submit]').click()`);
  await waitFor(`location.pathname !== '/login'`);
  await settle(800);
}
async function logout() {
  await goto("/minha-conta");
  await ev(`[...document.querySelectorAll('main form button[type=submit]')].find(b => b.textContent.includes('Sair')).click()`);
  await waitFor(`location.pathname === '/login'`);
  await settle(500);
}
async function saveName(value) {
  await type("#display_name", value);
  await ev(`[...document.querySelectorAll('form button[type=submit]')].find(b => b.textContent.includes('Salvar')).click()`);
  await waitFor(`document.querySelector('#display_name-status')?.textContent`);
  return ev(`document.querySelector('#display_name-status').textContent`);
}
const nameInput = () => ev(`document.querySelector('#display_name')?.value ?? null`);

// Menu do usuário (Minha conta → Menu): ordem dos módulos e módulos ocultos.
const DEFAULT_MENU = ["Dashboard", "Finanças", "Follow-up", "Plantões", "Perícias", "CNPJ"];
const CUSTOM_MENU = ["Dashboard", "Plantões", "Finanças", "Follow-up", "CNPJ"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sidebarMenu = () => ev(`[...document.querySelectorAll('aside nav[aria-label="Principal"] a')].map(a => a.textContent.trim())`);
const bottomMenu = () => ev(`[...document.querySelectorAll('nav[aria-label="Principal"]')].filter(n => getComputedStyle(n).position === 'fixed').flatMap(n => [...n.querySelectorAll('a')].map(a => a.textContent.trim()))`);
const menuForm = () => ev(`[...document.querySelectorAll('[data-menu-form] [data-menu-item]')].map(li => li.dataset.menuItem + (li.hasAttribute('data-hidden') ? ':oculto' : ''))`);
/** Clica no botão do formulário do menu pelo nome acessível; false se não existir ou estiver desativado. */
const menuButton = (label) =>
  ev(`(() => { const b = [...document.querySelectorAll('[data-menu-form] button')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
async function saveMenu() {
  await ev(`document.querySelector('[data-menu-form] button[type=submit]').click()`);
  await waitFor(`document.querySelector('#menu-status')?.textContent === 'Menu salvo.'`, 20000);
  return ev(`document.querySelector('#menu-status')?.textContent ?? ''`);
}
/** Rede de segurança: a conta fictícia A volta ao menu padrão mesmo se o roteiro parar no meio. */
async function resetMenuOfA() {
  if (!process.env.DATABASE_URL_UNPOOLED || !process.env.RLS_TEST_A_ID || process.env.NEON_BRANCH !== "development") return;
  const { Client } = await import("@neondatabase/serverless");
  const c = new Client(process.env.DATABASE_URL_UNPOOLED);
  await c.connect();
  try {
    await c.query("update public.user_preferences set menu_order = '{}', menu_hidden = '{}' where user_id = $1", [process.env.RLS_TEST_A_ID]);
  } finally {
    await c.end();
  }
}

const results = [];
let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  results.push(`${ok ? "PASSOU" : "FALHOU"}  ${name}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

try {
  await viewport(1280, 800);

  // Visitante
  await goto("/plantoes?mes=2024-02");
  check("visitante vai ao login preservando /plantoes?mes=2024-02", (await loc()) === "/login?next=%2Fplantoes%3Fmes%3D2024-02", await loc());

  // Login inválido (conta existente, senha errada)
  await type("#email", A.email);
  await type("#password", "senha-errada-ficticia");
  await ev(`document.querySelector('form button[type=submit]').click()`);
  await waitFor(`document.querySelector('[role=alert]')`);
  check("senha errada: erro genérico", (await ev(`document.querySelector('[role=alert]')?.textContent`)) === "E-mail ou senha incorretos.");

  // Login válido volta ao destino
  await type("#password", A.password);
  await ev(`document.querySelector('form button[type=submit]').click()`);
  await waitFor(`location.pathname === '/plantoes'`);
  check("login de A volta a /plantoes?mes=2024-02", (await loc()) === "/plantoes?mes=2024-02", await loc());
  check("calendário mostra Fevereiro de 2024", (await ev(`document.querySelector('#calendario-titulo')?.textContent`)) === "Fevereiro de 2024");
  const cookies = await authCookies();
  check("cookies de sessão HttpOnly e Secure", cookies.length > 0 && cookies.every((c) => c.httpOnly && c.secure), cookies.map((c) => c.name));
  check("nenhum token na URL", !/token|session/i.test(await loc()));

  await send("Page.reload");
  await settle(2000);
  check("recarregar mantém a sessão", (await loc()) === "/plantoes?mes=2024-02" && (await ev(`!!document.querySelector('#calendario-titulo')`)));
  await goto("/login");
  await waitFor(`location.pathname === '/'`);
  check("autenticado em /login vai ao Dashboard", (await loc()) === "/");

  // Preferências: salvar, editar, remover
  await goto("/minha-conta");
  check("salvar nome", (await saveName("  Ana   Fictícia ")) === "Nome salvo.");
  await waitFor(`document.querySelector('aside a[href="/minha-conta"]')?.textContent.includes('Ana Fictícia')`);
  check("nome normalizado aparece no menu", await ev(`document.querySelector('aside a[href="/minha-conta"]').textContent.includes('Ana Fictícia')`));
  await send("Page.reload");
  await settle(2000);
  check("nome persiste após recarregar", (await nameInput()) === "Ana Fictícia", await nameInput());
  check("editar nome", (await saveName("Ana Teste")) === "Nome salvo.");
  check("remover nome", (await saveName("")) === "Nome removido.");
  await send("Page.reload");
  await settle(2000);
  check("remoção persiste (campo vazio, menu mostra e-mail)", (await nameInput()) === "" && (await ev(`document.querySelector('aside a[href="/minha-conta"]').textContent.includes(${JSON.stringify(A.email)})`)));
  check("nome longo rejeitado", (await saveName("a".repeat(61))) === "Use no máximo 60 caracteres.");
  check("salvar nome final de A", (await saveName("Ana Fictícia")) === "Nome salvo.");

  // Menu: ordem dos módulos e módulos ocultos
  check("menu padrão: Dashboard, Finanças, Follow-up, Plantões, Perícias e CNPJ", same(await sidebarMenu(), DEFAULT_MENU), await sidebarMenu());
  check(
    "formulário do menu: Dashboard fixo (sem botões) e os cinco módulos; salvar desativado sem mudanças",
    same(await menuForm(), ["dashboard", "financas", "followup", "plantoes", "pericias", "cnpj"]) &&
      (await ev(`document.querySelector('[data-menu-form] button[type=submit]').disabled`)) === true &&
      !(await ev(`!!document.querySelector('[data-menu-item=dashboard] button')`)),
    await menuForm(),
  );
  check("o primeiro módulo não sobe e o último não desce", !(await menuButton("Subir Finanças")) && !(await menuButton("Descer CNPJ")));
  await menuButton("Subir Plantões");
  await menuButton("Subir Plantões");
  await menuButton("Ocultar Perícias");
  check(
    "antes de salvar, o menu não muda e a tela avisa que há alterações",
    same(await sidebarMenu(), DEFAULT_MENU) && same(await menuForm(), ["dashboard", "plantoes", "financas", "followup", "pericias:oculto", "cnpj"]) && (await ev(`document.querySelector('#menu-status').textContent`)) === "Alterações ainda não salvas.",
    await menuForm(),
  );
  check("salvar o menu", (await saveMenu()) === "Menu salvo.");
  await waitFor(`document.querySelectorAll('aside nav[aria-label="Principal"] a').length === 5`);
  check("menu lateral na nova ordem, sem o módulo oculto", same(await sidebarMenu(), CUSTOM_MENU), await sidebarMenu());
  await send("Page.reload");
  await settle(2000);
  check("a preferência persiste após recarregar (menu e formulário)", same(await sidebarMenu(), CUSTOM_MENU) && same(await menuForm(), ["dashboard", "plantoes", "financas", "followup", "pericias:oculto", "cnpj"]), await menuForm());
  await goto("/pericias");
  check("módulo oculto continua acessível pelo endereço (nada é apagado nem bloqueado)", (await loc()) === "/pericias" && (await ev(`document.querySelector('main h1')?.textContent`)) === "Perícias", await loc());
  await viewport(375, 812);
  await goto("/");
  const barra = await ev(`(() => { const d = document.documentElement; return { h: d.scrollWidth > d.clientWidth }; })()`);
  check("no celular, a barra inferior segue a mesma ordem, sem o módulo oculto", same(await bottomMenu(), CUSTOM_MENU) && !barra.h, await bottomMenu());
  await viewport(1280, 800);

  // Logout
  const oldCookies = await authCookies();
  await logout();
  check("Sair leva ao login", (await loc()) === "/login");
  check("cookies de sessão removidos", (await authCookies()).length === 0);
  await ev("history.back()");
  await settle(2000);
  check("voltar após sair não mostra tela protegida", (await loc()).startsWith("/login") && !(await ev(`!!document.querySelector('aside')`)), await loc());
  await goto("/minha-conta");
  check("acesso direto após sair é bloqueado", (await loc()).startsWith("/login?next=%2Fminha-conta"), await loc());

  // Reuso de uma CÓPIA dos cookies feita antes do logout (simula cookie copiado/roubado).
  const loggedOutAt = Date.now();
  const restoreOldCookies = async () => {
    for (const c of oldCookies) {
      await send("Network.setCookie", { name: c.name, value: c.value, url: BASE, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite });
    }
  };
  await restoreOldCookies();
  await goto("/minha-conta");
  const readAfterLogout = (await loc()) === "/minha-conta";
  results.push(
    `INFO    cópia de cookies ${Math.round((Date.now() - loggedOutAt) / 1000)} s após o logout: leitura ${readAfterLogout ? "ACEITA (dentro do cache de sessão)" : "recusada"}`,
  );
  if (readAfterLogout) {
    const nameShown = await nameInput();
    const status = await saveName("Tentativa com sessão encerrada");
    await settle(1500);
    check("cópia de cookies: gravação recusada (revalidação no Neon Auth leva ao login)", (await loc()).startsWith("/login"), { loc: await loc(), status });
    check("cópia de cookies: leitura exibiu o nome de A (sem vazamento de outro usuário)", nameShown === "Ana Fictícia", nameShown);
  }
  // Após o prazo do cache (60 s), a mesma cópia não deve mais ler.
  const waitMs = Math.max(0, 70_000 - (Date.now() - loggedOutAt));
  results.push(`INFO    aguardando ${Math.round(waitMs / 1000)} s para expirar o cache de sessão`);
  await sleep(waitMs);
  await send("Network.clearBrowserCookies");
  await restoreOldCookies();
  await goto("/minha-conta");
  check("cópia de cookies após 70 s: leitura recusada (vai ao login)", (await loc()).startsWith("/login"), await loc());
  await send("Network.clearBrowserCookies");

  // Confirma no banco (pela aplicação) que a gravação com sessão encerrada não ocorreu.
  await login(A);
  await goto("/minha-conta");
  check("nome de A inalterado após a tentativa com sessão encerrada", (await nameInput()) === "Ana Fictícia", await nameInput());
  await logout();

  // Novo login de A: nome persiste
  await login(A);
  await goto("/minha-conta");
  check("nome de A persiste após novo login", (await nameInput()) === "Ana Fictícia", await nameInput());
  await logout();

  // B não vê nem altera o nome de A
  await login(B);
  await goto("/minha-conta");
  const bName = await nameInput();
  check("B não vê o nome de A", bName !== "Ana Fictícia", bName);
  check("o menu de B continua no padrão (a preferência de A não vaza)", same(await sidebarMenu(), DEFAULT_MENU) && same(await menuForm(), ["dashboard", "financas", "followup", "plantoes", "pericias", "cnpj"]), await sidebarMenu());
  check("B salva o próprio nome", (await saveName("Bruno Fictício")) === "Nome salvo.");
  await logout();
  await login(A);
  await goto("/minha-conta");
  check("A continua com o próprio nome após B salvar", (await nameInput()) === "Ana Fictícia", await nameInput());
  check("o menu de A persiste após sair e entrar de novo", same(await sidebarMenu(), CUSTOM_MENU), await sidebarMenu());
  // Volta ao padrão pela própria tela (mostrar de novo e descer duas posições).
  await menuButton("Mostrar Perícias");
  await menuButton("Descer Plantões");
  await menuButton("Descer Plantões");
  check("voltar ao menu padrão pela tela", (await saveMenu()) === "Menu salvo.");
  await waitFor(`document.querySelectorAll('aside nav[aria-label="Principal"] a').length === 6`);
  check("menu de volta à ordem original, com todos os módulos", same(await sidebarMenu(), DEFAULT_MENU), await sidebarMenu());

  // Celular
  await viewport(375, 812);
  for (const path of ["/", "/minha-conta", "/plantoes"]) {
    await goto(path);
    const m = await ev(`(() => { const d = document.documentElement; window.scrollTo(0, d.scrollHeight);
      const nav = [...document.querySelectorAll('nav[aria-label="Principal"]')].find(n => getComputedStyle(n).position === 'fixed' && getComputedStyle(n).display !== 'none');
      const content = document.querySelector('main > div'); const bottom = content.getBoundingClientRect().bottom; const top = nav ? nav.getBoundingClientRect().top : Infinity; window.scrollTo(0, 0);
      return { h: d.scrollWidth > d.clientWidth, livre: bottom <= top + 0.5, itens: nav ? nav.querySelectorAll('a').length : 0 }; })()`);
    check(`375px ${path}: sem rolagem horizontal, sem sobreposição, 6 itens`, !m.h && m.livre && m.itens === 6, m);
  }
  await logout();
  check("375px: Sair funciona", (await loc()) === "/login");
} catch (error) {
  check("execução do roteiro sem exceção", false, String(error?.message ?? error).slice(0, 300));
} finally {
  await resetMenuOfA().catch(() => results.push("INFO    não foi possível redefinir o menu da conta A pelo banco"));
  console.log(results.join("\n"));
  console.log(`\nconsole: ${consoleIssues.length ? `${consoleIssues.length} erro(s)` : "sem erros"}`);
  console.log(failures ? `${failures} falha(s).` : "Todos os fluxos passaram.");
  ws.close();
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
