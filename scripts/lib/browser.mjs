// Controle mínimo do Chrome instalado via DevTools Protocol (sem dependências), para testes locais.
// Não imprime senhas, cookies nem tokens.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startBrowser({ base, port = 9336 } = {}) {
  const BASE = base ?? process.env.APP_URL ?? "http://localhost:3000";
  const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const profile = mkdtempSync(join(tmpdir(), "painel-e2e-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"]);
  let wsUrl;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await sleep(200);
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl;
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
  // Cada chamada ao navegador tem limite: um teste travado falha em vez de esperar para sempre.
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP sem resposta em 60 s: ${method}`));
      }, 60000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const b = {
    BASE,
    send,
    ev,
    consoleIssues,
    viewport: (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }),
    loc: () => ev("location.pathname + location.search"),
    async settle(ms = 1200) {
      await sleep(ms);
      for (let i = 0; i < 30 && (await ev("document.readyState")) !== "complete"; i++) await sleep(200);
    },
    async goto(path) {
      await send("Page.navigate", { url: BASE + path });
      await b.settle();
    },
    async waitFor(expr, timeout = 20000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await ev(`!!(${expr})`)) return true;
        await sleep(200);
      }
      return false;
    },
    /** Substitui o texto de um campo digitando de verdade (eventos de teclado). */
    async type(selector, text) {
      await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      if (text) await send("Input.insertText", { text });
    },
    /** Define valor de <input type=date> ou <select> e dispara os eventos. */
    async setValue(selector, value) {
      // Setter nativo do protótipo: atribuir el.value direto não avisa campos controlados do React.
      await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    },
    /** Clica no botão visível cujo texto ou aria-label contém `text`, opcionalmente dentro de `scope`. */
    async click(text, scope = "document") {
      return ev(`(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`};
        const el = [...(root?.querySelectorAll('button, a') ?? [])].find(e => e.offsetParent !== null && ((e.getAttribute('aria-label') ?? '').includes(${JSON.stringify(text)}) || e.textContent.trim().includes(${JSON.stringify(text)})));
        if (!el) return false; el.click(); return true; })()`);
    },
    /** Abre o menu "⋯" cujo nome acessível contém `label` (o gatilho reage a pointerdown, não a click). */
    async openMenu(label) {
      const opened = await ev(`(() => { const el = [...document.querySelectorAll('button[aria-haspopup=menu]')].find(e => e.offsetParent !== null && (e.getAttribute('aria-label') ?? '').includes(${JSON.stringify(label)}));
        if (!el) return false; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' })); return true; })()`);
      return opened && b.waitFor(`document.querySelector('[role=menu]')`, 5000);
    },
    /** Escolhe o item do menu aberto cujo texto ou nome acessível contém `text`. */
    async menuItem(text) {
      await b.waitFor(`[...document.querySelectorAll('[role=menuitem]')].some(e => e.textContent.includes(${JSON.stringify(text)}) || (e.getAttribute('aria-label') ?? '').includes(${JSON.stringify(text)}))`, 5000);
      return ev(`(() => { const el = [...document.querySelectorAll('[role=menuitem]')].find(e => e.textContent.includes(${JSON.stringify(text)}) || (e.getAttribute('aria-label') ?? '').includes(${JSON.stringify(text)}));
        if (!el || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled')) return false; el.click(); return true; })()`);
    },
    authCookies: async () => (await send("Network.getCookies", { urls: [BASE] })).cookies.filter((c) => c.name.startsWith("__Secure-neon-auth")),
    async login(account, path = "/login") {
      await b.goto(path);
      await b.type("#email", account.email);
      await b.type("#password", account.password);
      await ev(`document.querySelector('form button[type=submit]').click()`);
      await b.waitFor(`location.pathname !== '/login'`);
      await b.settle(800);
    },
    async logout() {
      await b.goto("/minha-conta");
      await ev(`[...document.querySelectorAll('main form button[type=submit]')].find(b => b.textContent.includes('Sair')).click()`);
      await b.waitFor(`location.pathname === '/login'`);
      await b.settle(500);
    },
    async shot(file) {
      const { cssContentSize: s } = await send("Page.getLayoutMetrics");
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: s.width, height: s.height, scale: 1 } });
      writeFileSync(file, Buffer.from(data, "base64"));
    },
    async close() {
      ws.close();
      chrome.kill();
      await sleep(500);
      rmSync(profile, { recursive: true, force: true });
    },
  };
  return b;
}

/** Acumulador de resultados PASSOU/FALHOU. */
export function createChecks() {
  const lines = [];
  let failures = 0;
  return {
    check(name, ok, detail) {
      if (!ok) failures++;
      lines.push(`${ok ? "PASSOU" : "FALHOU"}  ${name}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
    },
    info: (text) => lines.push(`INFO    ${text}`),
    get failures() {
      return failures;
    },
    print() {
      console.log(lines.join("\n"));
    },
  };
}
