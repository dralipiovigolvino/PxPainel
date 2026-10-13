"use server";

import { getNeonAuth, isAuthNetworkError } from "@/lib/auth/neon-auth";
import { requireFreshUser } from "@/lib/auth/session";
import { changePasswordSchema } from "./password-schema";

export type ChangePasswordState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const UNAVAILABLE = "O serviço de acesso está indisponível no momento. Tente novamente em instantes.";

export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  // Autorização dentro da ação, com a sessão revalidada no Neon Auth.
  await requireFreshUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const auth = getNeonAuth();
  if (!auth) return { status: "error", message: UNAVAILABLE };

  let result;
  try {
    result = await auth.changePassword({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      revokeOtherSessions: true,
    });
  } catch {
    return { status: "error", message: UNAVAILABLE };
  }

  if (result.error) {
    // Nunca registra as senhas.
    if (isAuthNetworkError(result.error) || (result.error.status ?? 0) >= 500) return { status: "error", message: UNAVAILABLE };
    if (result.error.status === 429) return { status: "error", message: "Muitas tentativas. Aguarde alguns minutos." };
    // O SDK normaliza INVALID_PASSWORD → "invalid_credentials" e PASSWORD_TOO_* → "weak_password".
    if (result.error.code === "invalid_credentials") return { status: "error", message: "A senha atual está incorreta." };
    if (result.error.code === "weak_password") {
      return { status: "error", message: "A nova senha não atende aos requisitos do serviço." };
    }
    return { status: "error", message: "Não foi possível alterar a senha agora. Tente novamente." };
  }

  return { status: "success", message: "Senha alterada. As outras sessões foram encerradas." };
}
