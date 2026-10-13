// Controle de acesso na APLICAÇÃO e no Neon Auth reais (branch development), só com contas fictícias:
// cadastro público bloqueado, papéis permitidos entram, conta sem papel permitido é recusada
// (no login e com sessão já aberta). O papel da conta fictícia B é rebaixado pela CLI oficial do Neon
// durante o teste e SEMPRE restaurado ao final.
// Uso: npm run test:e2e:acesso     (app rodando em APP_URL). Não imprime senhas, cookies nem tokens.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "@neondatabase/serverless";
import { assertBranch } from "./lib/branch-guard.mjs";
import { createChecks, sleep, startBrowser } from "./lib/browser.mjs";
import { requireEnv } from "./lib/env-file.mjs";
import { createAuthHttp } from "./lib/neon-auth-http.mjs";

requireEnv(["DATABASE_URL_UNPOOLED", "RLS_TEST_B_EMAIL", "RLS_TEST_B_PASSWORD", "RLS_TEST_B_ID"]);
const branch = assertBranch("test:e2e:acesso");
const B = { email: process.env.RLS_TEST_B_EMAIL, password: process.env.RLS_TEST_B_PASSWORD, id: process.env.RLS_TEST_B_ID };
const project = JSON.parse(readFileSync(".neon", "utf8")).projectId;
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const ALLOWED_ROLE = "painel";

/** CLI do Neon com argumentos fixos deste script; a saída não é impressa. */
function neon(args) {
  const r = spawnSync(["neon", "neon-auth", ...args, "--project-id", project, "--branch", branch].join(" "), { shell: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`neon neon-auth ${args.slice(0, 2).join(" ")} falhou (código ${r.status}).`);
  return r.stdout.trim();
}
const setRole = (role) => neon(["user", "set-role", B.id, "--roles", role]);

const t = createChecks();
const b = await startBrowser({ base: BASE, port: 9341 });
let demoted = false;
try {
  // ---------- Cadastro público ----------
  const config = JSON.parse(neon(["config", "email-password", "get", "--output", "json"]));
  t.check("configuração do serviço: cadastro público desligado", config.disable_sign_up === true);
  const providers = JSON.parse(neon(["oauth-provider", "list", "--output", "json"]));
  t.check("nenhum login social habilitado", Array.isArray(providers) ? providers.length === 0 : (providers.providers ?? []).length === 0);

  const email = `teste-cadastro-${randomBytes(6).toString("hex")}@example.com`;
  const signUp = await createAuthHttp().call("POST", "sign-up/email", { email, password: randomBytes(18).toString("base64url"), name: "Cadastro Fictício" });
  t.check("tentativa real de cadastro no Neon Auth é recusada", !signUp.ok, `HTTP ${signUp.status}, código ${signUp.code ?? "?"}`);
  const owner = new Client(process.env.DATABASE_URL_UNPOOLED);
  await owner.connect();
  const created = (await owner.query('select count(*)::int as n from neon_auth."user" where email = $1', [email])).rows[0].n;
  await owner.end();
  t.check("nenhuma conta foi criada pela tentativa (leitura, sem alterar o schema do provedor)", created === 0);
  for (const path of ["/api/auth/sign-up/email", "/cadastro", "/signup"]) {
    const r = await fetch(BASE + path, { method: path.startsWith("/api") ? "POST" : "GET", redirect: "manual", headers: { "content-type": "application/json" }, body: path.startsWith("/api") ? "{}" : undefined });
    const toLogin = (r.headers.get("location") ?? "").includes("/login");
    t.check(`o app não expõe cadastro em ${path}`, r.status === 404 || toLogin, `HTTP ${r.status}${toLogin ? " → login" : ""}`);
  }
  await b.goto("/login");
  const signUpUi = await b.ev(`[...document.querySelectorAll('a, button')].some(e => /cadastr|criar conta|sign ?up|registr/i.test(e.textContent))`);
  t.check("tela de login sem opção de cadastro", !signUpUi);

  // ---------- Papel permitido entra ----------
  await b.login(B);
  t.check(`conta com papel "${ALLOWED_ROLE}" entra`, (await b.loc()) === "/" && (await b.authCookies()).length > 0);

  // ---------- Sessão aberta + papel removido ----------
  setRole("user");
  demoted = true;
  // O papel vem com a sessão validada, que o serviço mantém em cache por até 60 s: a recusa de uma
  // sessão JÁ ABERTA não é instantânea. Mede a janela e exige a recusa em até 120 s.
  const t0 = Date.now();
  let denied = false;
  let leaked = false;
  while (!denied && Date.now() - t0 < 120000) {
    await b.goto("/");
    denied = (await b.loc()).startsWith("/login");
    if (!denied) {
      leaked ||= await b.ev(`[...document.querySelectorAll("[data-dash-item]")].length > 0`);
      await sleep(15000);
    }
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  t.check("sessão já aberta perde o acesso em até 120 s depois que o papel é removido", denied, `${seconds} s`);
  t.info(`sessão aberta recusada ${seconds} s após a remoção do papel (janela do cache de sessão de 60 s)`);
  t.check("conta fictícia B não exibiu itens de outras contas nessa janela", !leaked);

  // ---------- Login sem papel permitido ----------
  await b.send("Network.clearBrowserCookies");
  await b.goto("/login");
  await b.type("#email", B.email);
  await b.type("#password", B.password);
  await b.ev(`document.querySelector('form button[type=submit]').click()`);
  const shown = await b.waitFor(`document.querySelector('#login-erro')?.textContent.trim().length > 0`, 30000);
  const message = await b.ev(`document.querySelector('#login-erro')?.textContent.trim() ?? ''`);
  t.check("login com senha correta, mas sem papel permitido, é recusado", shown && (await b.loc()).startsWith("/login"), message);
  t.check("mensagem genérica (não revela que a senha estava certa)", !/papel|permiss|autoriza/i.test(message), message);
  t.check("nenhum cookie de sessão fica no navegador após a recusa", (await b.authCookies()).length === 0);
  await b.goto("/");
  t.check("sem sessão: Dashboard vai ao login", (await b.loc()).startsWith("/login"));

  // ---------- Papel restaurado ----------
  setRole(ALLOWED_ROLE);
  demoted = false;
  await b.login(B);
  t.check("papel restaurado: a conta volta a entrar", (await b.loc()) === "/");
  await b.logout();
} catch (error) {
  t.check("execução sem erro inesperado", false, error.message);
} finally {
  if (demoted) {
    try {
      setRole(ALLOWED_ROLE);
      t.info("papel da conta fictícia B restaurado");
    } catch {
      t.check(`restaurar o papel de B (rode: neon neon-auth user set-role <id de B> --roles ${ALLOWED_ROLE} --branch ${branch})`, false);
    }
  }
  t.print();
  console.log(t.failures ? `${t.failures} falha(s).` : "Todos os controles de acesso passaram.");
  await b.close();
}
process.exit(t.failures ? 1 : 0);
