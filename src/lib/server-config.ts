/**
 * Configuração do servidor (Neon Auth + banco). Nenhuma destas variáveis é
 * NEXT_PUBLIC: nada vai para o navegador. Mensagens citam só nomes, nunca valores.
 */

export type ServerConfig = {
  /** URL do Neon Auth (Managed Better Auth) da branch. */
  authBaseUrl: string;
  /** Segredo que assina o cache de sessão em cookie (mín. 32 caracteres). */
  cookieSecret: string;
  /** Conexão do papel de EXECUÇÃO (sem BYPASSRLS), nunca a do dono do banco. */
  databaseUrl: string;
};

export type ServerConfigResult = { ok: true; config: ServerConfig } | { ok: false; problems: string[] };

type EnvSource = Record<string, string | undefined>;

export const COOKIE_SECRET_MIN_LENGTH = 32;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function parseServerConfig(env: EnvSource): ServerConfigResult {
  const problems: string[] = [];
  const authBaseUrl = env.NEON_AUTH_BASE_URL?.trim() ?? "";
  const cookieSecret = env.NEON_AUTH_COOKIE_SECRET?.trim() ?? "";
  const databaseUrl = env.APP_DATABASE_URL?.trim() ?? "";

  if (!authBaseUrl) problems.push("NEON_AUTH_BASE_URL ausente");
  else if (parseUrl(authBaseUrl)?.protocol !== "https:") problems.push("NEON_AUTH_BASE_URL inválida (use a URL https do Neon Auth)");

  if (!cookieSecret) problems.push("NEON_AUTH_COOKIE_SECRET ausente");
  else if (cookieSecret.length < COOKIE_SECRET_MIN_LENGTH) {
    problems.push(`NEON_AUTH_COOKIE_SECRET curta (mínimo ${COOKIE_SECRET_MIN_LENGTH} caracteres)`);
  }

  if (!databaseUrl) {
    problems.push("APP_DATABASE_URL ausente");
  } else {
    const url = parseUrl(databaseUrl);
    if (!url || !["postgres:", "postgresql:"].includes(url.protocol)) {
      problems.push("APP_DATABASE_URL inválida (use a string postgresql:// do papel de execução)");
    } else if (/_owner$/i.test(decodeURIComponent(url.username))) {
      // O dono do banco no Neon tem BYPASSRLS: nunca pode ser a conexão do app.
      problems.push("APP_DATABASE_URL usa o dono do banco; use o papel de execução (app_runtime)");
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { authBaseUrl, cookieSecret, databaseUrl } };
}

let warned = false;

/** Configuração do processo, ou `null` (com aviso único no terminal) se incompleta. */
export function getServerConfig(): ServerConfig | null {
  const result = parseServerConfig(process.env);
  if (!result.ok) {
    if (!warned) {
      warned = true;
      console.warn(
        `[Meu Painel] Configuração incompleta: ${result.problems.join("; ")}. ` +
          "Veja .env.example e o README. O acesso ao sistema permanece bloqueado até lá.",
      );
    }
    return null;
  }
  return result.config;
}
