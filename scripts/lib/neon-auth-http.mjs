// Chamadas administrativas aos endpoints do Neon Auth (Better Auth) para scripts locais.
// Não imprime tokens, cookies nem senhas.

export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export function authBase() {
  const base = process.env.NEON_AUTH_BASE_URL;
  if (!base) {
    console.error("NEON_AUTH_BASE_URL ausente em .env.local.");
    process.exit(2);
  }
  return base.replace(/\/$/, "");
}

/** Cliente mínimo que guarda os cookies de sessão entre chamadas. */
export function createAuthHttp() {
  const base = authBase();
  const jar = new Map();
  async function call(method, path, body) {
    const headers = { origin: APP_URL };
    if (body) headers["content-type"] = "application/json";
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const response = await fetch(`${base}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {}
    return { ok: response.ok, status: response.status, code: data?.code ?? null, data };
  }
  return { call };
}

/** Pergunta no terminal; com `hidden`, não ecoa o que é digitado. */
export async function ask(question, { hidden = false } = {}) {
  const readline = await import("node:readline");
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}
