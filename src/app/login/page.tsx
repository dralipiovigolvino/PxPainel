import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { APP_CONFIG } from "@/config/app";
import { sanitizeNextPath } from "@/lib/auth/redirects";
import { getCurrentUser } from "@/lib/auth/session";
import { getServerConfig } from "@/lib/server-config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

async function isSignedIn(): Promise<boolean> {
  try {
    return (await getCurrentUser()) !== null;
  } catch {
    // Serviço fora do ar: mostra o formulário; o envio informará a indisponibilidade.
    return false;
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next: rawNext, senha } = await searchParams;
  const next = sanitizeNextPath(rawNext);
  const configured = getServerConfig() !== null;

  if (configured && (await isSignedIn())) redirect(next);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm gap-6 py-6 shadow-xs ring-border">
        <CardHeader className="gap-1 px-6">
          <p className="text-sm font-semibold tracking-tight text-primary">{APP_CONFIG.name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="text-sm text-muted-foreground">Acesse com seu e-mail e senha.</p>
        </CardHeader>
        <CardContent className="px-6">
          {configured && senha === "definida" && (
            <p role="status" className="mb-4 rounded-lg border bg-accent/60 px-3 py-2 text-sm text-accent-foreground">
              Senha definida. Entre com o seu e-mail e a nova senha.
            </p>
          )}
          {configured ? (
            <LoginForm next={next} />
          ) : (
            <div role="alert" className="flex gap-3 rounded-lg border bg-muted/50 p-3 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <p>
                O acesso está indisponível no momento. Tente novamente mais tarde.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
