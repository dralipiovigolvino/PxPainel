import "server-only";

import { cookies, headers } from "next/headers";

/** Cookies do Neon Auth: __Secure-neon-auth.session_token, .local.session_data etc. */
const NEON_AUTH_COOKIE_PREFIX = "__Secure-neon-auth";
const SESSION_TOKEN_COOKIE = `${NEON_AUTH_COOKIE_PREFIX}.session_token`;

/** Apaga todos os cookies de sessão do Neon Auth neste navegador. */
export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith(NEON_AUTH_COOKIE_PREFIX)) {
      // Cookies __Secure- só são aceitos com o atributo Secure, inclusive ao apagar.
      cookieStore.set(name, "", { path: "/", maxAge: 0, secure: true, httpOnly: true, sameSite: "lax" });
    }
  }
}

/**
 * Encerra no Neon Auth a sessão que acabou de ser criada nesta mesma requisição
 * (o SDK lê cookies da requisição original, então não a enxerga) e apaga os cookies.
 * Usado quando o login é válido no provedor, mas a conta não pode usar o sistema.
 */
export async function discardNewSession(authBaseUrl: string): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_TOKEN_COOKIE)?.value;
  if (token) {
    const origin = (await headers()).get("origin") ?? "";
    try {
      await fetch(`${authBaseUrl.replace(/\/$/, "")}/sign-out`, {
        method: "POST",
        headers: { cookie: `${SESSION_TOKEN_COOKIE}=${token}`, origin, "content-type": "application/json" },
        body: "{}",
      });
    } catch {
      // Sem rede: a sessão expira no servidor; os cookies locais são apagados abaixo.
    }
  }
  await clearAuthCookies();
}
