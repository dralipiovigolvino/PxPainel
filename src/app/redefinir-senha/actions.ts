"use server";

import { redirect } from "next/navigation";
import { getNeonAuth, isAuthNetworkError } from "@/lib/auth/neon-auth";
import { LOGIN_PATH } from "@/lib/auth/redirects";
import { newPasswordSchema } from "./schema";

export type ResetPasswordState = { status: "idle" } | { status: "error"; message: string };

const UNAVAILABLE = "O serviço de acesso está indisponível no momento. Tente novamente em instantes.";
const INVALID_LINK = "Este link é inválido ou expirou. Peça um novo link ao administrador.";

export async function resetPasswordAction(
  _previous: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const parsed = newPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? INVALID_LINK };

  const auth = getNeonAuth();
  if (!auth) return { status: "error", message: UNAVAILABLE };

  let result;
  try {
    result = await auth.resetPassword({ newPassword: parsed.data.password, token: parsed.data.token });
  } catch {
    return { status: "error", message: UNAVAILABLE };
  }
  if (result.error) {
    // Não registra token nem senha.
    if (isAuthNetworkError(result.error) || (result.error.status ?? 0) >= 500) {
      return { status: "error", message: UNAVAILABLE };
    }
    // O SDK normaliza PASSWORD_TOO_SHORT/LONG → "weak_password".
    if (result.error.code === "weak_password") {
      return { status: "error", message: "A senha não atende aos requisitos do serviço." };
    }
    return { status: "error", message: INVALID_LINK };
  }

  redirect(`${LOGIN_PATH}?senha=definida`);
}
