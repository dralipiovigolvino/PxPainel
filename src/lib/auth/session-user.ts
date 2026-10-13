/** Usuário autenticado, derivado da sessão validada pelo Neon Auth. */
export type AuthUser = {
  id: string;
  email: string | null;
};

/**
 * Papéis que podem usar o sistema. São atribuídos administrativamente
 * (CLI/Console do Neon ou API admin). Uma conta criada por qualquer outro
 * caminho recebe o papel padrão "user" e é recusada.
 */
export const ALLOWED_ROLES = ["admin", "painel"] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionLike = {
  user?: { id?: unknown; email?: unknown; role?: unknown; banned?: unknown } | null;
  session?: { expiresAt?: unknown } | null;
} | null | undefined;

/** Better Auth guarda vários papéis como texto separado por vírgulas. */
export function parseRoles(role: unknown): string[] {
  if (typeof role !== "string") return [];
  return role.split(",").map((value) => value.trim()).filter(Boolean);
}

function isExpired(expiresAt: unknown, now: Date): boolean {
  if (expiresAt === undefined || expiresAt === null) return false;
  const time = new Date(expiresAt as string).getTime();
  return Number.isNaN(time) || time <= now.getTime();
}

/** Converte a sessão em usuário do sistema, ou `null` se não puder acessar. */
export function userFromSession(data: SessionLike, now: Date = new Date()): AuthUser | null {
  const user = data?.user;
  if (!user || !data?.session) return null;
  if (typeof user.id !== "string" || !UUID_PATTERN.test(user.id)) return null;
  if (user.banned === true) return null;
  if (isExpired(data.session.expiresAt, now)) return null;
  const roles = parseRoles(user.role);
  if (!roles.some((role) => (ALLOWED_ROLES as readonly string[]).includes(role))) return null;
  return { id: user.id.toLowerCase(), email: typeof user.email === "string" ? user.email : null };
}
