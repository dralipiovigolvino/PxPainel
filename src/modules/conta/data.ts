import "server-only";

import { cache } from "react";
import { requireFreshUser, requireUser } from "@/lib/auth/session";
import { DEFAULT_MENU, normalizeMenu, type MenuPrefs } from "@/config/modules";
import { withUserContext } from "@/lib/db/user-context";
import type { DisplayName } from "./schema";

export type UserPreferences = { displayName: string | null; menu: MenuPrefs };

/** Registra apenas o código do erro, nunca dados do usuário. */
function logDbError(operation: string, error: unknown) {
  const code = (error as { code?: string })?.code;
  const missingTable = code === "42P01";
  console.error(
    `[Meu Painel] user_preferences/${operation} falhou (código ${code ?? (error as Error)?.name ?? "desconhecido"})` +
      (missingTable ? " — a migração ainda não foi aplicada (npm run db:migrate)." : ""),
  );
}

/**
 * Preferências do usuário autenticado. Se a leitura falhar, a interface
 * continua funcionando sem o nome e com o menu padrão (a falha fica registrada no servidor).
 */
export const getUserPreferences = cache(async (): Promise<UserPreferences> => {
  const user = await requireUser();
  try {
    const row = await withUserContext(user, async (db) => {
      // O filtro por user_id é redundante com o RLS, de propósito (defesa em camadas).
      const { rows } = await db.query<{ display_name: string | null; menu_order: string[]; menu_hidden: string[] }>(
        "select display_name, menu_order, menu_hidden from public.user_preferences where user_id = $1",
        [user.id],
      );
      return rows[0];
    });
    return { displayName: row?.display_name ?? null, menu: normalizeMenu(row?.menu_order ?? [], row?.menu_hidden ?? []) };
  } catch (error) {
    logDbError("select", error);
    return { displayName: null, menu: DEFAULT_MENU };
  }
});

/**
 * Grava a ordem do menu e os módulos ocultos do usuário autenticado (user_id sempre da sessão
 * revalidada). Idempotente: cria o registro na primeira vez e confirma com o que o banco devolveu.
 */
export async function saveMenuPrefs(menu: MenuPrefs): Promise<{ ok: true; menu: MenuPrefs } | { ok: false }> {
  const user = await requireFreshUser();
  try {
    const saved = await withUserContext(user, async (db) => {
      await db.query("insert into public.user_preferences (user_id) values ($1) on conflict (user_id) do nothing", [user.id]);
      const { rows } = await db.query<{ menu_order: string[]; menu_hidden: string[] }>(
        "update public.user_preferences set menu_order = $2::text[], menu_hidden = $3::text[] where user_id = $1 returning menu_order, menu_hidden",
        [user.id, menu.order, menu.hidden],
      );
      if (rows.length !== 1) throw new Error("Nenhuma linha atualizada");
      return normalizeMenu(rows[0].menu_order, rows[0].menu_hidden);
    });
    return { ok: true, menu: saved };
  } catch (error) {
    logDbError("menu", error);
    return { ok: false };
  }
}

/**
 * Grava o nome do usuário autenticado. O user_id vem sempre da sessão
 * revalidada no Neon Auth, nunca do formulário. Idempotente: cria o registro
 * na primeira vez e só confirma com o valor devolvido pelo banco.
 */
export async function saveDisplayName(
  displayName: DisplayName,
): Promise<{ ok: true; displayName: DisplayName } | { ok: false }> {
  const user = await requireFreshUser();
  try {
    const saved = await withUserContext(user, async (db) => {
      await db.query(
        "insert into public.user_preferences (user_id) values ($1) on conflict (user_id) do nothing",
        [user.id],
      );
      const { rows } = await db.query<{ display_name: string | null }>(
        "update public.user_preferences set display_name = $2 where user_id = $1 returning display_name",
        [user.id, displayName],
      );
      if (rows.length !== 1) throw new Error("Nenhuma linha atualizada");
      return rows[0].display_name;
    });
    return { ok: true, displayName: saved };
  } catch (error) {
    logDbError("save", error);
    return { ok: false };
  }
}
