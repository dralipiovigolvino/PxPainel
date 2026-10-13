"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearAuthCookies } from "./cookies";
import { getNeonAuth } from "./neon-auth";
import { LOGIN_PATH } from "./redirects";

/**
 * Logout por POST (Server Action), nunca por link GET.
 * Encerra a sessão no Neon Auth e apaga os cookies locais mesmo que o
 * serviço não responda.
 */
export async function signOutAction(): Promise<void> {
  const auth = getNeonAuth();
  if (auth) {
    try {
      const { error } = await auth.signOut();
      if (error) console.error(`[Meu Painel] logout: o serviço não confirmou o encerramento (código ${error.code ?? error.status ?? "?"})`);
    } catch {
      // Sem rede: segue para apagar os cookies locais.
    }
  }
  await clearAuthCookies();
  revalidatePath("/", "layout");
  redirect(LOGIN_PATH);
}
