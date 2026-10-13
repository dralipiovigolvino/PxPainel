"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { ensureGenerationAction } from "../actions";

/** Aviso de totais incompletos: a geração de recorrências tem limite de segurança. */
export function CoverageNotice({ limit }: { limit: CivilDate }) {
  return (
    <p role="note" data-coverage-limit={limit} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
      Incompleto: contas recorrentes só são geradas até {formatCivilDate(limit)} (10 anos à frente). Valores com vencimento depois dessa data não incluem recorrências.
    </p>
  );
}

/**
 * Quando o servidor indica que há recorrências ainda não geradas até `target`, dispara
 * UMA operação autenticada explícita (Server Action) depois que a tela é montada no navegador.
 * Não roda na renderização do servidor nem em prefetch. A geração é idempotente.
 */
export function GenerationSync({ target }: { target: CivilDate | null }) {
  const router = useRouter();
  const started = useRef<CivilDate | null>(null);
  const [state, setState] = useState<"idle" | "running" | "error">("idle");

  useEffect(() => {
    if (!target || started.current === target) return;
    started.current = target;
    setState("running");
    ensureGenerationAction(target)
      .then((result) => {
        if (!result.ok) return setState("error");
        setState("idle");
        if (result.created > 0) router.refresh();
      })
      .catch(() => setState("error"));
  }, [target, router]);

  if (!target || state === "idle") return null;
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      {state === "running" ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Gerando contas recorrentes até {formatCivilDate(target)}…
        </>
      ) : (
        "Não foi possível gerar as contas recorrentes agora. Recarregue a página para tentar de novo."
      )}
    </p>
  );
}
