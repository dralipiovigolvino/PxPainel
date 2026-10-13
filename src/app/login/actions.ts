"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { discardNewSession } from "@/lib/auth/cookies";
import { getNeonAuth, isAuthNetworkError } from "@/lib/auth/neon-auth";
import { sanitizeNextPath } from "@/lib/auth/redirects";
import { userFromSession } from "@/lib/auth/session-user";
import { getServerConfig } from "@/lib/server-config";

export type LoginState = { status: "idle" } | { status: "error"; message: string; email: string };

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
});

const INVALID = "E-mail ou senha incorretos.";
const UNAVAILABLE = "O serviço de acesso está indisponível no momento. Tente novamente em instantes.";
const RATE_LIMITED = "Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.";

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const next = sanitizeNextPath(formData.get("next"));

  const parsed = credentialsSchema.safeParse({ email, password: formData.get("password") });
  // Formato inválido recebe a mesma mensagem genérica de credencial incorreta.
  if (!parsed.success) return { status: "error", message: INVALID, email };

  const auth = getNeonAuth();
  const config = getServerConfig();
  if (!auth || !config) return { status: "error", message: UNAVAILABLE, email };

  let result;
  try {
    result = await auth.signIn.email(parsed.data);
  } catch {
    return { status: "error", message: UNAVAILABLE, email };
  }

  const { data, error } = result;
  if (error) {
    // Nunca registra e-mail ou senha; só a categoria do erro.
    if (isAuthNetworkError(error) || (error.status ?? 0) >= 500) {
      console.error(`[Meu Painel] login: serviço indisponível (código ${error.code ?? error.status ?? "?"})`);
      return { status: "error", message: UNAVAILABLE, email };
    }
    if (error.status === 429) return { status: "error", message: RATE_LIMITED, email };
    return { status: "error", message: INVALID, email };
  }

  // Conta sem papel autorizado (criada fora do provisionamento): encerra a sessão criada.
  const signedIn = data as { user?: Record<string, unknown> } | null;
  if (!userFromSession({ user: signedIn?.user, session: {} })) {
    await discardNewSession(config.authBaseUrl);
    return { status: "error", message: INVALID, email };
  }

  revalidatePath("/", "layout");
  redirect(next);
}
