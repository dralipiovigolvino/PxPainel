"use client";

import { useActionState, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { appointmentAction, planDeadlineAction, type ActionState } from "../actions";
import { checkDuration, DEADLINE_LABEL, DEFAULT_NOTICE_DAYS, describeNextAppointment, endDateOf, type Deadline, type DeadlineState } from "../domain/deadline";
import type { FuAppointment, FuPlan } from "../types";

const initial: ActionState = { status: "idle" };

const BADGE: Record<DeadlineState, string> = {
  sem_prazo: "bg-muted text-muted-foreground",
  em_acompanhamento: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  perto_de_encerrar: "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100",
  termina_hoje: "bg-amber-200 text-amber-950 dark:bg-amber-800/60 dark:text-amber-50",
  encerrado: "bg-destructive/10 text-destructive",
};

/** Situação do prazo em texto (não depende só da cor). */
export function DeadlineBadge({ deadline, className }: { deadline: Deadline; className?: string }) {
  return (
    <span className={cn("inline-flex w-fit items-center rounded-md px-1.5 py-0.5 text-xs font-medium", BADGE[deadline.state], className)} data-deadline={deadline.state}>
      {DEADLINE_LABEL[deadline.state]}
    </span>
  );
}

/** "Próxima consulta: …" ou "Próxima consulta não agendada", com destaque quando falta agendar. */
export function NextAppointmentText({ next, highlight, className }: { next: { date: CivilDate; time: string | null } | null; highlight?: boolean; className?: string }) {
  return (
    <span className={cn(next ? "text-foreground" : highlight ? "font-medium text-destructive" : "text-muted-foreground", className)} data-next-appointment={next ? "agendada" : "nao-agendada"}>
      {describeNextAppointment(next)}
    </span>
  );
}

const toInt = (text: string) => (/^\d{1,4}$/.test(text.trim()) ? Number(text) : null);

/** Campos de duração e aviso com a data de término calculada (usados no modelo e no plano). */
export function DurationFields({
  idPrefix,
  duration,
  notice,
  onDuration,
  onNotice,
  errors,
  /** Data da consulta (D0), quando conhecida: mostra a data de término. */
  consultDate,
  /** Dias das etapas, para avisar quando a duração não cobre a última. */
  stepOffsets,
  optional,
}: {
  idPrefix: string;
  duration: string;
  notice: string;
  onDuration: (v: string) => void;
  onNotice: (v: string) => void;
  errors?: Record<string, string>;
  consultDate?: CivilDate;
  stepOffsets: number[];
  optional?: boolean;
}) {
  const d = toInt(duration);
  const n = toInt(notice);
  const check = d !== null && n !== null ? checkDuration(d, n, stepOffsets) : null;
  const live = check && !check.ok ? check : null;
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3" data-duration-fields="">
      <legend className="px-1 text-sm font-medium">Duração do acompanhamento {optional && <span className="font-normal text-muted-foreground">(opcional)</span>}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${idPrefix}-duration`} label="Duração total (dias após a consulta)" error={errors?.durationDays ?? (live?.field === "durationDays" ? live.message : undefined)}>
          {(describedBy, invalid) => (
            <Input id={`${idPrefix}-duration`} name="durationDays" inputMode="numeric" placeholder="Ex.: 45" autoComplete="off" value={duration} onChange={(e) => onDuration(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
        <Field id={`${idPrefix}-notice`} label="Avisar quantos dias antes do término" error={errors?.noticeDays ?? (live?.field === "noticeDays" ? live.message : undefined)}>
          {(describedBy, invalid) => (
            <Input id={`${idPrefix}-notice`} name="noticeDays" inputMode="numeric" placeholder={String(DEFAULT_NOTICE_DAYS)} autoComplete="off" value={notice} onChange={(e) => onNotice(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite" data-duration-summary="">
        {d === null
          ? optional
            ? "Em branco: sem aviso de término."
            : "Contada a partir da consulta (D0)."
          : `Termina em D${d}${consultDate ? ` — ${formatCivilDate(endDateOf(consultDate, d))}` : ""}${n !== null ? `; aviso ${n === 0 ? "só no último dia" : `a partir de ${n} dia(s) antes`}` : ""}.`}
      </p>
    </fieldset>
  );
}

/** Define ou altera o prazo de um acompanhamento existente (explícito). */
export function PlanDeadlineForm({ plan, consultDate, onSuccess, onCancel }: { plan: FuPlan; consultDate: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(planDeadlineAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [duration, setDuration] = useState(values?.durationDays ?? (plan.durationDays !== null ? String(plan.durationDays) : ""));
  const [notice, setNotice] = useState(values?.noticeDays ?? String(plan.noticeDays ?? DEFAULT_NOTICE_DAYS));
  const offsets = plan.steps.filter((s) => s.status !== "cancelado").map((s) => s.dayOffset);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate data-plan-deadline-form="">
      <DialogHeader>
        <DialogTitle>{plan.durationDays === null ? "Definir duração do acompanhamento" : "Alterar duração do acompanhamento"}</DialogTitle>
        <DialogDescription>Consulta de {formatCivilDate(consultDate)} (D0). Vale só para este acompanhamento; as etapas não são alteradas e o modelo não muda.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="planId" value={plan.id} />
      <DurationFields idPrefix="plan" duration={duration} notice={notice} onDuration={setDuration} onNotice={setNotice} errors={errors} consultDate={consultDate} stepOffsets={offsets} />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : "Salvar prazo"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Agendar ou reagendar a próxima consulta: data obrigatória, horário opcional. */
export function AppointmentForm({ patientId, appointment, today, onSuccess, onCancel }: { patientId: string; appointment: FuAppointment | null; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(appointmentAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate data-appointment-form="">
      <DialogHeader>
        <DialogTitle>{appointment ? "Reagendar próxima consulta" : "Agendar próxima consulta"}</DialogTitle>
        <DialogDescription>Compromisso futuro. Depois da data, você confirma se o atendimento aconteceu.</DialogDescription>
      </DialogHeader>
      {appointment && <input type="hidden" name="id" value={appointment.id} />}
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="requestId" value={requestId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="appointment-date" label="Data" error={errors?.date}>
          {(describedBy, invalid) => (
            <Input id="appointment-date" name="date" type="date" min={today} max="2100-12-31" defaultValue={values?.date ?? (appointment && appointment.date >= today ? appointment.date : "")} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
        <Field id="appointment-time" label="Horário" optional error={errors?.time}>
          {(describedBy, invalid) => <Input id="appointment-time" name="time" type="time" defaultValue={values?.time ?? appointment?.time ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />}
        </Field>
      </div>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : appointment ? "Reagendar" : "Agendar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
