import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { APP_CONFIG } from "@/config/app";
import { LOGIN_PATH } from "@/lib/auth/redirects";
import { getServerConfig } from "@/lib/server-config";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Definir senha", referrer: "no-referrer" };

/**
 * Destino do link enviado por e-mail no provisionamento administrativo ou na
 * recuperação de acesso. Não há pedido de link público nesta tela.
 */
export default async function RedefinirSenhaPage({ searchParams }: PageProps<"/redefinir-senha">) {
  const { token } = await searchParams;
  const validToken = typeof token === "string" && token.length > 0 && token.length <= 512 ? token : null;
  const configured = getServerConfig() !== null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm gap-6 py-6 shadow-xs ring-border">
        <CardHeader className="gap-1 px-6">
          <p className="text-sm font-semibold tracking-tight text-primary">{APP_CONFIG.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Definir senha</h1>
          <p className="text-sm text-muted-foreground">Escolha a senha de acesso da sua conta.</p>
        </CardHeader>
        <CardContent className="px-6">
          {configured && validToken ? (
            <ResetPasswordForm token={validToken} />
          ) : (
            <div role="alert" className="flex flex-col gap-3 rounded-lg border bg-muted/50 p-3 text-sm">
              <p className="flex gap-3">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {configured
                  ? "Este link é inválido ou expirou. Peça um novo link ao administrador."
                  : "O acesso está indisponível no momento. Tente novamente mais tarde."}
              </p>
              <Link href={LOGIN_PATH} className="font-medium text-primary underline-offset-4 hover:underline">
                Voltar ao login
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
