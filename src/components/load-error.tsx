"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Falha de consulta: nunca exibir uma lista vazia falsa. */
export function LoadError() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <p className="flex items-center gap-2 font-medium">
        <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
        Não foi possível carregar os dados. Nada foi alterado.
      </p>
      <Button className="h-10 px-4" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Tentar novamente
      </Button>
    </div>
  );
}
