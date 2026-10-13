"use server";

import { revalidatePath } from "next/cache";
import { requireFreshUser } from "@/lib/auth/session";
import { saveDisplayName, saveMenuPrefs } from "./data";
import { displayNameSchema, menuSchema } from "./schema";

export type SaveDisplayNameState =
  | { status: "idle" }
  | { status: "success"; message: string }
  /** `value` devolve o texto digitado, para não perdê-lo quando o formulário é reiniciado. */
  | { status: "error"; message: string; value: string };

export async function updateDisplayNameAction(
  _previous: SaveDisplayNameState,
  formData: FormData,
): Promise<SaveDisplayNameState> {
  // Autorização dentro da ação: ela é acessível por POST direto.
  await requireFreshUser();

  const raw = formData.get("display_name") ?? "";
  const value = typeof raw === "string" ? raw : "";
  const parsed = displayNameSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Nome inválido.", value };
  }

  const result = await saveDisplayName(parsed.data);
  if (!result.ok) {
    return { status: "error", message: "Não foi possível salvar agora. Tente novamente.", value };
  }

  revalidatePath("/", "layout");
  return {
    status: "success",
    message: result.displayName ? "Nome salvo." : "Nome removido.",
  };
}

export type SaveMenuState = { status: "idle" } | { status: "success"; message: string } | { status: "error"; message: string };

/** Ordem do menu e módulos ocultos. A lista vem do formulário; só módulos conhecidos são aceitos. */
export async function updateMenuAction(_previous: SaveMenuState, formData: FormData): Promise<SaveMenuState> {
  // Autorização dentro da ação: ela é acessível por POST direto.
  await requireFreshUser();

  const parsed = menuSchema.safeParse({ order: formData.get("order") ?? "", hidden: formData.get("hidden") ?? "" });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Menu inválido." };

  const result = await saveMenuPrefs(parsed.data);
  if (!result.ok) return { status: "error", message: "Não foi possível salvar agora. Tente novamente." };

  revalidatePath("/", "layout");
  return { status: "success", message: "Menu salvo." };
}
