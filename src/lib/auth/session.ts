import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { getNeonAuth, isAuthNetworkError } from "./neon-auth";
import { LOGIN_PATH } from "./redirects";
import { userFromSession, type AuthUser } from "./session-user";

export type { AuthUser } from "./session-user";

/** Serviço de autenticação inacessível (rede, indisponibilidade). */
export class AuthUnavailableError extends Error {
  constructor() {
    super("Serviço de autenticação indisponível");
    this.name = "AuthUnavailableError";
  }
}

function isCookieMutationError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Cookies can only be modified in a Server Action or Route Handler");
}

async function resolveUser(fresh: boolean): Promise<AuthUser | null> {
  // Autorização é sempre por requisição: telas protegidas nunca são pré-renderizadas.
  await connection();

  const auth = getNeonAuth();
  if (!auth) return null; // sem configuração: acesso bloqueado, nunca liberado

  let result;
  try {
    result = await auth.getSession(fresh ? { query: { disableCookieCache: "true" } } : undefined);
  } catch (error) {
    // Validação sem cache em Server Component: ao descobrir que a sessão foi revogada, o SDK tenta
    // apagar os cookies e o Next recusa (só ações e rotas podem alterá-los). Isso significa
    // "sem sessão válida": vai para o login, sem ler dados. Qualquer outra falha não libera acesso.
    if (fresh && isCookieMutationError(error)) return null;
    throw new AuthUnavailableError();
  }
  const { data, error } = result;
  if (error) {
    // 429 (limite de requisições do serviço) é indisponibilidade temporária, não "sessão inválida":
    // o acesso continua negado, mas o usuário vê "tente novamente" em vez de ser levado ao login.
    if (isAuthNetworkError(error) || (typeof error.status === "number" && (error.status >= 500 || error.status === 429))) {
      throw new AuthUnavailableError();
    }
    return null;
  }
  return userFromSession(data);
}

/**
 * Usuário da requisição atual. Aceita o cache de sessão (assinado, curto);
 * memorizado por renderização com React.cache.
 */
export const getCurrentUser = cache(() => resolveUser(false));

/**
 * Autorização central para páginas e leituras. Sem usuário válido,
 * redireciona para o login.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}

const getVerifiedUser = cache(() => resolveUser(true));

/**
 * Leituras de dados sensíveis (pacientes): confirma a sessão no servidor do Neon Auth, sem o
 * cache de sessão de 60 s. Sessão revogada não lê dados com uma cópia antiga dos cookies.
 * Memorizado por renderização (uma confirmação por requisição).
 */
export async function requireVerifiedUser(): Promise<AuthUser> {
  const user = await getVerifiedUser();
  if (!user) redirect(LOGIN_PATH);
  return user;
}

/**
 * Autorização para mutações: ignora o cache e confirma a sessão no servidor
 * do Neon Auth, para que sessões encerradas não gravem dados.
 */
export async function requireFreshUser(): Promise<AuthUser> {
  const user = await resolveUser(true);
  if (!user) redirect(LOGIN_PATH);
  return user;
}
