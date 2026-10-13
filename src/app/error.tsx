"use client";

import { Button } from "@/components/ui/button";

/** Falha ao carregar uma tela (ex.: serviço de autenticação fora do ar). Não expõe detalhes. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div role="alert" className="flex max-w-sm flex-col items-start gap-3 rounded-xl border bg-card p-6 shadow-xs">
        <h1 className="text-lg font-semibold">Não foi possível carregar esta tela</h1>
        <p className="text-sm text-muted-foreground">
          O serviço pode estar temporariamente indisponível. Nenhum dado foi alterado.
        </p>
        <Button onClick={reset} className="h-10 px-4">
          Tentar novamente
        </Button>
      </div>
    </main>
  );
}
