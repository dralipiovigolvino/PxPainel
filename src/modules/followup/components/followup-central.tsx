"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { NoticeRegion, useNotice } from "@/modules/financas/components/form-bits";
import { CENTRAL_FILTER_LABELS, CENTRAL_FILTERS, centralCounts, matchesCentralFilter, sortCentral, type CentralFilter } from "../domain/plan";
import { matchesPatientSearch } from "../domain/search";
import { describeDeadline, needsAttention, planDeadline } from "../domain/deadline";
import type { FuAppointment, FuCentralStep, FuPatient, FuPlanDeadline, FuTemplate } from "../types";
import { CentralAttendanceForm } from "./consultation-dialogs";
import { DeadlineBadge, NextAppointmentText } from "./deadline-bits";
import { StepActionsProvider, StepItem } from "./step-item";

const EMPTY: Record<CentralFilter, string> = {
  hoje: "Nenhum acompanhamento para hoje.",
  atrasados: "Nenhum acompanhamento atrasado.",
  proximos: "Nenhum acompanhamento futuro pendente.",
  concluidos: "Nenhum acompanhamento realizado.",
  todos: "Nenhum acompanhamento.",
};

const href = (filter: CentralFilter, canceled: boolean) => `/follow-up?filtro=${filter}${canceled && filter === "todos" ? "&cancelados=1" : ""}`;

type CentralProps = {
  steps: FuCentralStep[];
  filter: CentralFilter;
  showCanceled: boolean;
  today: CivilDate;
  /** Acompanhamentos ativos com duração definida. */
  deadlines: FuPlanDeadline[];
  /** Próximas consultas com data passada, aguardando confirmação do atendimento. */
  toConfirm: Array<FuAppointment & { patientName: string }>;
  patients: FuPatient[];
  templates: FuTemplate[];
};

/** Avisos de término: perto de encerrar, terminando hoje e encerrados há até 60 dias sem próxima consulta. */
function DeadlineNotices({ deadlines, toConfirm, today }: Pick<CentralProps, "deadlines" | "toConfirm" | "today">) {
  const items = deadlines
    .map((p) => ({ p, d: planDeadline(p.consultDate, p.durationDays, p.noticeDays, today) }))
    .filter(({ p, d }) => d.state === "perto_de_encerrar" || d.state === "termina_hoje" || (d.state === "encerrado" && p.nextAppointment === null && (d.daysLeft ?? 0) >= -60));
  if (items.length === 0 && toConfirm.length === 0) return null;
  return (
    <section aria-labelledby="avisos-prazo" className="rounded-xl border bg-card shadow-xs" data-deadline-notices="">
      <div className="border-b px-4 py-3">
        <h2 id="avisos-prazo" className="text-base font-semibold">
          Prazos e próximas consultas <span className="font-normal text-muted-foreground">({items.length + toConfirm.length})</span>
        </h2>
      </div>
      <ul className="divide-y">
        {toConfirm.map((a) => (
          <li key={a.id} className="flex flex-col gap-1 px-4 py-3 text-sm" data-notice="confirmar">
            <Link href={`/follow-up/pacientes/${a.patientId}`} className="inline-flex min-h-6 w-fit items-center font-medium break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {a.patientName}
            </Link>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">Confirmar atendimento</span>
              <span className="text-muted-foreground">
                Próxima consulta estava marcada para {formatCivilDate(a.date)}
                {a.time ? ` às ${a.time}` : ""}.
              </span>
            </span>
          </li>
        ))}
        {items.map(({ p, d }) => (
          <li key={p.planId} className="flex flex-col gap-1 px-4 py-3 text-sm" data-notice={d.state}>
            <Link href={`/follow-up/pacientes/${p.patientId}`} className="inline-flex min-h-6 w-fit items-center font-medium break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {p.patientName}
            </Link>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <DeadlineBadge deadline={d} />
              <span className="text-muted-foreground">{describeDeadline(d)}</span>
              <NextAppointmentText next={p.nextAppointment} highlight={needsAttention(d, p.nextAppointment !== null)} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FollowupCentral({ steps, filter, showCanceled, today, deadlines, toConfirm, patients, templates }: CentralProps) {
  const [notice, showNotice] = useNotice();
  // Busca só no navegador: o termo nunca vai para a URL, o servidor ou logs.
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const done = useCallback((message: string) => showNotice(message), [showNotice]);
  const counts = centralCounts(steps, today);
  const searched = steps.filter((s) => matchesPatientSearch({ name: s.patientName, phone: null }, query));
  const visible = sortCentral(
    searched.filter((s) => matchesCentralFilter(s, filter, today, showCanceled)),
    filter,
  );
  const countFor: Partial<Record<CentralFilter, number>> = {
    hoje: counts.hoje,
    atrasados: counts.atrasados,
    proximos: counts.proximos,
    concluidos: counts.concluidos,
  };

  return (
    <div className="flex flex-col gap-4">
      <div><Button className="h-10 px-4" onClick={() => setAdding(true)}><Plus aria-hidden="true" />Adicionar atendimento</Button></div>
      <DeadlineNotices deadlines={deadlines} toConfirm={toConfirm} today={today} />
      <nav aria-label="Filtros de acompanhamento">
        <ul className="flex flex-wrap gap-1.5">
          {CENTRAL_FILTERS.map((f) => (
            <li key={f}>
              <Link
                href={href(f, showCanceled)}
                aria-current={f === filter ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  f === filter ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
                  f === "atrasados" && f !== filter && counts.atrasados > 0 && "border-destructive/40 text-destructive",
                )}
                data-filter={f}
              >
                {CENTRAL_FILTER_LABELS[f]}
                {countFor[f] !== undefined && (
                  <span className="rounded-md bg-background/20 px-1.5 tabular-nums" data-count={f}>
                    {countFor[f]}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Buscar por paciente</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por paciente"
            autoComplete="off"
            className="h-10 pl-9"
            data-central-search=""
          />
        </label>
        {filter === "todos" && (
          <Link
            href={href("todos", !showCanceled)}
            className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium underline-offset-4 hover:underline"
            data-toggle-canceled=""
          >
            {showCanceled ? "Ocultar cancelados" : "Mostrar cancelados"}
          </Link>
        )}
      </div>
      <NoticeRegion notice={notice} />

      {/* Fora da condição de lista vazia: a última etapa do filtro pode sair dele após a ação. */}
      <StepActionsProvider onDone={done}>
        <section aria-labelledby="central-titulo" className="rounded-xl border bg-card shadow-xs">
          <h2 id="central-titulo" className="border-b px-4 py-2.5 font-semibold">
            {CENTRAL_FILTER_LABELS[filter]} <span className="font-normal text-muted-foreground">{visible.length}</span>
          </h2>
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{query ? "Nenhum acompanhamento encontrado para a busca." : EMPTY[filter]}</p>
          ) : (
            <ul className="divide-y">
              {visible.map((s) => (
                <StepItem
                  key={s.id}
                  step={s}
                  ctx={{
                    patientName: s.patientName,
                    consultDate: s.consultDate,
                    planActive: s.planStatus === "ativo",
                  }}
                  today={today}
                  head={
                    <p className="flex flex-wrap items-center gap-x-2 text-sm" data-central-patient="">
                      <Link href={`/follow-up/pacientes/${s.patientId}`} className="font-medium break-words underline-offset-4 hover:underline">
                        {s.patientName}
                      </Link>
                      <span className="text-muted-foreground">· consulta de {formatCivilDate(s.consultDate)}</span>
                      {s.patientArchived && <span className="rounded-md bg-muted px-1.5 text-xs">paciente arquivado</span>}
                    </p>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </StepActionsProvider>
      <Dialog open={adding} onOpenChange={setAdding}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"><CentralAttendanceForm patients={patients} templates={templates} today={today} onSuccess={(m) => { setAdding(false); done(m); }} onCancel={() => setAdding(false)} /></DialogContent></Dialog>
    </div>
  );
}
