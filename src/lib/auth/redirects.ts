/** Regras de redirecionamento de autenticação (puras, usadas no proxy e no login). */

export const LOGIN_PATH = "/login";
export const RESET_PASSWORD_PATH = "/redefinir-senha";
export const DEFAULT_AFTER_LOGIN = "/";

/** Rotas acessíveis sem sessão. Todas as demais exigem login. */
const PUBLIC_PATHS = new Set([LOGIN_PATH, RESET_PASSWORD_PATH]);

const MAX_NEXT_LENGTH = 512;
const INTERNAL_ORIGIN = "http://interno.invalid";

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Valida o parâmetro de retorno após o login. Aceita apenas caminhos
 * internos; qualquer outra coisa volta para o Dashboard.
 */
export function sanitizeNextPath(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_AFTER_LOGIN;
  if (value.length === 0 || value.length > MAX_NEXT_LENGTH) return DEFAULT_AFTER_LOGIN;
  // Precisa começar com uma única barra; "//host" e "/\host" viram URLs externas.
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_AFTER_LOGIN;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_AFTER_LOGIN;

  let url: URL;
  try {
    url = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
  if (url.origin !== INTERNAL_ORIGIN) return DEFAULT_AFTER_LOGIN;
  if (isPublicPath(url.pathname)) return DEFAULT_AFTER_LOGIN;

  return `${url.pathname}${url.search}`;
}

/** URL de login preservando o destino pedido. */
export function buildLoginPath(pathname: string, search: string): string {
  const next = sanitizeNextPath(`${pathname}${search}`);
  if (next === DEFAULT_AFTER_LOGIN) return LOGIN_PATH;
  return `${LOGIN_PATH}?${new URLSearchParams({ next })}`;
}

/**
 * Decisão do proxy. O proxy só faz a verificação otimista: a autorização
 * real acontece no servidor (requireUser) e no banco (RLS).
 */
export function getProxyRedirect(
  pathname: string,
  search: string,
  isAuthenticated: boolean,
): string | null {
  if (isPublicPath(pathname) || isAuthenticated) return null;
  return buildLoginPath(pathname, search);
}
