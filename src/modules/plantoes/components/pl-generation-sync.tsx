"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { ensurePlGenerationAction } from "../actions";

/**
 * Quando faltam ocorrências recorrentes até `target`, dispara UMA operação autenticada explícita
 * depois de montar a tela (nunca na renderização nem no prefetch). A geração é idempotente.
 */
export function PlGenerationSync({ target }: { target: CivilDate | null }) {
  const router = useRouter();
  const started = useRef<CivilDate | null>(null);
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  useEffect(() => {
    if (!target || started.current === target) return;
    started.current = target;
    setState("running");
    ensurePlGenerationAction(target)
      .then((r) => {
        if (!r.ok) return setState("error");
        setState("idle");
        if (r.created > 0) router.refresh();
      })
      .catch(() => setState("error"));
  }, [target, router]);
  if (!target || state === "idle") return null;
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground" data-pl-generation={state}>
      {state === "running" ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Gerando plantões recorrentes até {formatCivilDate(target)}…
        </>
      ) : (
        "Não foi possível gerar os plantões recorrentes agora. Recarregue a página para tentar de novo."
      )}
    </p>
  );
}

/** Período exibido além do limite de geração: o calendário e os totais não incluem recorrências depois dele. */
export function PlCoverageNotice({ limit }: { limit: CivilDate }) {
  return (
    <p role="note" data-coverage-limit={limit} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
      Incompleto: plantões recorrentes só são gerados até {formatCivilDate(limit)} (10 anos à frente). Depois dessa data, o calendário e os totais não incluem recorrências.
    </p>
  );
}
