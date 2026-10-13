"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { NoticeRegion, useNotice } from "@/modules/financas/components/form-bits";
import { formatPhone } from "../domain/phone";
import { describeDeadline, needsAttention, planDeadline } from "../domain/deadline";
import { matchesPatientSearch } from "../domain/search";
import type { FuPatient } from "../types";
import { DeadlineBadge, NextAppointmentText } from "./deadline-bits";
import { PatientFormDialog } from "./patient-form-dialog";

export function PatientsManager({ patients, today, initialNotice }: { patients: FuPatient[]; today: CivilDate; initialNotice?: string }) {
  const [notice, showNotice] = useNotice(initialNotice);
  const [creating, setCreating] = useState(false);
  // Termo de busca só no estado do navegador: nunca na URL, no servidor ou em logs.
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const done = useCallback(
    (message: string) => {
      setCreating(false);
      showNotice(message);
    },
    [showNotice],
  );

  const matching = patients.filter((p) => matchesPatientSearch(p, query));
  // Ativos primeiro; arquivados só com a opção marcada, no fim da mesma lista (sem seção própria).
  const visible = [...matching.filter((p) => !p.archived), ...(showArchived ? matching.filter((p) => p.archived) : [])];
  const archivedTotal = patients.filter((p) => p.archived).length;

  const list = (items: FuPatient[]) => (
    <ul className="divide-y rounded-xl border bg-card shadow-xs" aria-label="Pacientes">
      {items.map((p) => (
        <li key={p.id} className={cn(p.archived && "opacity-60")} data-patient="" data-archived={p.archived ? "" : undefined}>
          <Link href={`/follow-up/pacientes/${p.id}`} className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{p.name}</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {[p.archived ? "Arquivado" : null, p.phone ? formatPhone(p.phone) : null, p.lastConsultDate ? `última consulta ${formatCivilDate(p.lastConsultDate)}` : "sem consultas"].filter(Boolean).join(" · ")}
              </p>
              {(() => {
                // Segunda linha só com o que pede atenção: etapas pendentes, prazo definido, próxima consulta.
                const deadline = p.latestPlan ? planDeadline(p.latestPlan.consultDate, p.latestPlan.durationDays, p.latestPlan.noticeDays, today) : null;
                const timed = deadline !== null && deadline.state !== "sem_prazo" ? deadline : null;
                const attention = deadline ? needsAttention(deadline, false) : false;
                const confirm = p.nextAppointment !== null && p.nextAppointment.date < today;
                const showNext = p.nextAppointment !== null || attention;
                if (p.pendingSteps === 0 && !timed && !showNext) return null;
                return (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-patient-followup="">
                    {p.pendingSteps > 0 && <span className="font-medium">{p.pendingSteps === 1 ? "1 etapa pendente" : `${p.pendingSteps} etapas pendentes`}</span>}
                    {timed && <DeadlineBadge deadline={timed} />}
                    {timed?.endDate && <span className="text-muted-foreground">{describeDeadline(timed)}</span>}
                    {showNext && <NextAppointmentText next={p.nextAppointment} highlight={attention} />}
                    {confirm && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">Confirmar atendimento</span>}
                  </p>
                );
              })()}
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-10 px-4" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          Novo paciente
        </Button>
      </div>
      <NoticeRegion notice={notice} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Buscar paciente por nome ou telefone</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            autoComplete="off"
            className="h-10 pl-9"
            data-patient-search=""
          />
        </label>
        {archivedTotal > 0 && (
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="size-4" />
            Mostrar arquivados ({archivedTotal})
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs">
          {patients.length === 0 ? "Nenhum paciente ainda. Cadastre o primeiro." : query ? "Nenhum paciente encontrado." : "Nenhum paciente ativo."}
        </p>
      ) : (
        list(visible)
      )}

      <PatientFormDialog open={creating} onOpenChange={setCreating} patient={null} onSuccess={done} />
    </div>
  );
}
