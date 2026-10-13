"use client";

import { useActionState, useCallback, useState, useTransition } from "react";
import { Archive, ArchiveRestore, CalendarCheck, CalendarClock, CalendarCog, CalendarPlus, ListPlus, MoreHorizontal, NotebookPen, Pencil, Replace, Timer, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ConfirmDialog, type ConfirmRequest } from "@/modules/financas/components/confirm-dialog";
import { NoticeRegion, useActionOutcome, useNotice } from "@/modules/financas/components/form-bits";
import { archivePatientAction, cancelAppointmentAction, confirmAppointmentAction, deletePatientAction, type ActionState } from "../actions";
import { describeDeadline, needsAppointmentConfirmation, needsAttention, planDeadline } from "../domain/deadline";
import { describeEvent } from "../domain/history";
import { formatPhone } from "../domain/phone";
import type { FuAppointment, FuConsultation, FuEvent, FuPatient, FuPlan, FuTemplate } from "../types";
import { AppointmentForm, DeadlineBadge, NextAppointmentText, PlanDeadlineForm } from "./deadline-bits";
import { ConsultationCreateForm, ConsultationNotesForm } from "./consultation-dialogs";
import { PatientFormDialog } from "./patient-form-dialog";
import { ApplyTemplateForm, CancelPlanForm, DateCorrectionForm, ReplaceForm } from "./plan-dialogs";
import { AutoOpenStep, formatInstant, StepActionsProvider, StepItem } from "./step-item";

const initial: ActionState = { status: "idle" };

function MoreMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label={label}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

type DialogState =
  | { kind: "consulta" }
  | { kind: "nota"; consultation: FuConsultation }
  | { kind: "data"; consultation: FuConsultation }
  | { kind: "aplicar"; consultation: FuConsultation }
  | { kind: "substituir"; consultation: FuConsultation }
  | { kind: "cancelar"; plan: FuPlan }
  | { kind: "prazo"; plan: FuPlan; consultDate: CivilDate }
  | { kind: "agendar"; appointment: FuAppointment | null }
  | null;

export type PatientDetailProps = {
  patient: FuPatient;
  consultations: FuConsultation[];
  plans: FuPlan[];
  events: FuEvent[];
  templates: FuTemplate[];
  /** Agendamentos de próxima consulta (o em aberto primeiro). */
  appointments: FuAppointment[];
  today: CivilDate;
  /** Etapa a abrir ao carregar (links do dashboard). */
  openStep?: { stepId: string; panel: "mensagem" | "realizar" } | null;
};

function History({ events }: { events: FuEvent[] }) {
  if (events.length === 0) return null;
  return (
    <details className="rounded-lg border px-3 py-2 text-sm" data-history="">
      <summary className="cursor-pointer font-medium">Histórico ({events.length})</summary>
      <ol className="mt-2 flex flex-col gap-1.5">
        {events.map((e) => {
          const line = describeEvent(e.action, e.details);
          return (
            <li key={e.id} className="break-words" data-event={e.action}>
              <span className="text-muted-foreground tabular-nums">{formatInstant(e.createdAt)}</span> · {line.text}
              {line.quote && <span className="mt-1 block rounded-md bg-muted/60 px-2 py-1 whitespace-pre-wrap">{line.quote}</span>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

export function PatientDetail({ patient, consultations, plans, events, templates, appointments, today, openStep }: PatientDetailProps) {
  const [notice, showNotice] = useNotice();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const done = useCallback(
    (message: string) => {
      setEditing(false);
      setDialog(null);
      setConfirm(null);
      showNotice(message);
    },
    [showNotice],
  );
  const [archiveState, archiveAction, archiving] = useActionState(archivePatientAction, initial);
  const [, startArchive] = useTransition();
  const toggleArchive = () => {
    const fd = new FormData();
    fd.set("id", patient.id);
    fd.set("archive", String(!patient.archived));
    startArchive(() => archiveAction(fd));
  };
  useActionOutcome(archiveState, done);

  const planByConsultation = new Map(plans.map((p) => [p.consultationId, p]));
  const consultById = new Map(consultations.map((c) => [c.id, c]));
  const activeWithPending = plans.filter((p) => p.status === "ativo" && p.steps.some((s) => s.status === "pendente"));
  const usableTemplates = templates.filter((t) => !t.archived && t.steps.length > 0);
  // Próxima consulta: no máximo uma em aberto por paciente.
  const next = appointments.find((a) => a.status === "agendada") ?? null;
  const nextToConfirm = next !== null && needsAppointmentConfirmation(next, today);
  const pastAppointments = appointments.filter((a) => a.status !== "agendada");
  // Acompanhamentos ativos perto do fim (ou encerrados) sem próxima consulta marcada merecem destaque.
  const deadlines = plans
    .filter((p) => p.status === "ativo")
    .map((p) => planDeadline(consultById.get(p.consultationId)?.consultDate ?? today, p.durationDays, p.noticeDays, today));
  const attention = deadlines.some((d) => needsAttention(d, next !== null));

  const askDelete = () =>
    setConfirm({
      title: "Excluir paciente?",
      description: "O cadastro será excluído definitivamente. Só é possível porque não há consultas registradas.",
      confirmLabel: "Excluir paciente",
      destructive: true,
      // Em caso de sucesso, o servidor redireciona para a lista.
      action: deletePatientAction,
      fields: { id: patient.id },
    });

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="paciente-nome" className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="paciente-nome" className="text-lg font-semibold break-words" data-patient-name="">
              {patient.name}
            </h2>
            <p className="text-sm text-muted-foreground">{patient.phone ? <span className="tabular-nums">WhatsApp {formatPhone(patient.phone)}</span> : "Sem telefone"}</p>
            {patient.notes && <p className="mt-2 text-sm break-words whitespace-pre-wrap">{patient.notes}</p>}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" className="h-10 px-3" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Editar
            </Button>
            <MoreMenu label="Mais ações do paciente">
              <DropdownMenuItem disabled={archiving} onSelect={toggleArchive}>
                {patient.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                {patient.archived ? "Restaurar" : "Arquivar"}
              </DropdownMenuItem>
              {consultations.length === 0 && (
                <DropdownMenuItem variant="destructive" onSelect={askDelete}>
                  <Trash2 aria-hidden="true" />
                  Excluir
                </DropdownMenuItem>
              )}
            </MoreMenu>
          </div>
        </div>
        {patient.archived && (
          <p
            role="note"
            className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
            data-archived-note=""
          >
            Paciente arquivado: não recebe consultas novas.
            {patient.pendingSteps > 0 ? ` ${patient.pendingSteps === 1 ? "1 etapa pendente continua" : `${patient.pendingSteps} etapas pendentes continuam`} valendo.` : ""}
          </p>
        )}
        {activeWithPending.length > 1 && (
          <p role="note" className="mt-3 rounded-lg border px-3 py-2 text-sm" data-concurrent-note="">
            {activeWithPending.length} acompanhamentos ativos com etapas pendentes (consultas de{" "}
            {activeWithPending.map((p) => formatCivilDate(consultById.get(p.consultationId)?.consultDate ?? today)).join(" e ")}).
          </p>
        )}
      </section>

      <section
        aria-labelledby="proxima-consulta"
        className={cn("rounded-xl border bg-card p-4 shadow-xs", attention && "border-destructive/50")}
        data-next-appointment-card={next ? (nextToConfirm ? "a-confirmar" : "agendada") : "nao-agendada"}
      >
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <h2 id="proxima-consulta" className="flex items-center gap-2 text-base font-semibold">
              <CalendarClock className="size-4" aria-hidden="true" />
              Próxima consulta
            </h2>
            <p className="mt-1 text-sm">
              <NextAppointmentText next={next} highlight={attention} className="font-medium" />
            </p>
            {attention && (
              <p className="mt-1 text-sm text-destructive" data-attention="">
                Acompanhamento terminando sem próxima consulta marcada.
              </p>
            )}
            {nextToConfirm && (
              <p className="mt-1 text-sm text-amber-900" data-appointment-confirm="">
                A data já passou: confirme o atendimento, reagende ou cancele.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {!next ? (
              <Button className="h-10 px-3" onClick={() => setDialog({ kind: "agendar", appointment: null })} disabled={patient.archived} title={patient.archived ? "Restaure o paciente para agendar." : undefined}>
                <CalendarPlus aria-hidden="true" />
                Agendar próxima consulta
              </Button>
            ) : (
              <>
                {next.date <= today && (
                  <Button
                    className="h-10 px-3"
                    onClick={() =>
                      setConfirm({
                        title: "Confirmar que o atendimento aconteceu?",
                        description: `Será registrada uma consulta em ${formatCivilDate(next.date)}, sem acompanhamento. Depois você pode aplicar um modelo a ela, se quiser.`,
                        confirmLabel: "Confirmar atendimento",
                        action: confirmAppointmentAction,
                        fields: { id: next.id },
                      })
                    }
                  >
                    <CalendarCheck aria-hidden="true" />
                    Confirmar atendimento
                  </Button>
                )}
                <Button variant="outline" className="h-10 px-3" onClick={() => setDialog({ kind: "agendar", appointment: next })}>
                  <CalendarCog aria-hidden="true" />
                  Reagendar
                </Button>
                <MoreMenu label="Mais ações do agendamento">
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      setConfirm({
                        title: "Cancelar o agendamento?",
                        description: "A próxima consulta deixa de estar marcada. O acompanhamento e as etapas não mudam.",
                        confirmLabel: "Cancelar agendamento",
                        destructive: true,
                        action: cancelAppointmentAction,
                        fields: { id: next.id },
                      })
                    }
                  >
                    <XCircle aria-hidden="true" />
                    Cancelar agendamento
                  </DropdownMenuItem>
                </MoreMenu>
              </>
            )}
          </div>
        </div>
        {pastAppointments.length > 0 && (
          <details className="mt-3 rounded-lg border px-3 py-2 text-sm" data-appointment-history="">
            <summary className="cursor-pointer font-medium">Agendamentos anteriores ({pastAppointments.length})</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {pastAppointments.map((a) => (
                <li key={a.id} className="tabular-nums">
                  {formatCivilDate(a.date)}
                  {a.time ? ` às ${a.time}` : ""} · {a.status === "realizada" ? "atendimento confirmado" : "agendamento cancelado"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <NoticeRegion notice={notice} />
      {archiveState.status === "error" && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {archiveState.message}
        </p>
      )}

      <StepActionsProvider onDone={done}>
        {openStep &&
          (() => {
            const plan = plans.find((p) => p.steps.some((s) => s.id === openStep.stepId));
            const step = plan?.steps.find((s) => s.id === openStep.stepId);
            const consultation = plan && consultById.get(plan.consultationId);
            return step && consultation ? (
              <AutoOpenStep step={step} ctx={{ patientName: patient.name, consultDate: consultation.consultDate, planActive: plan.status === "ativo" }} panel={openStep.panel} />
            ) : null;
          })()}
        <section aria-labelledby="consultas-titulo" className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="consultas-titulo" className="text-base font-semibold">
              Consultas e acompanhamentos <span className="font-normal text-muted-foreground">({consultations.length})</span>
            </h2>
            <Button className="h-10 px-4" onClick={() => setDialog({ kind: "consulta" })} disabled={patient.archived}>
              <CalendarPlus aria-hidden="true" />
              Registrar consulta
            </Button>
          </div>
          {consultations.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground shadow-xs">Nenhuma consulta registrada.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {consultations.map((c) => {
                const plan = planByConsultation.get(c.id);
                const ctx = {
                  patientName: patient.name,
                  consultDate: c.consultDate,
                  planActive: plan?.status === "ativo",
                };
                const label = formatCivilDate(c.consultDate);
                return (
                  <li key={c.id} className="rounded-xl border bg-card shadow-xs" data-consultation={c.consultDate}>
                    <div className="flex items-start justify-between gap-2 border-b py-2 pr-2 pl-4">
                      <div className="min-w-0 py-1">
                        <h3 className="font-medium">Consulta de {label}</h3>
                        {c.notes && <p className="mt-1 text-sm break-words whitespace-pre-wrap text-muted-foreground">{c.notes}</p>}
                      </div>
                      <MoreMenu label={`Mais ações da consulta de ${label}`}>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: "nota", consultation: c })} aria-label={`Observação da consulta de ${label}`}>
                          <NotebookPen aria-hidden="true" />
                          Observação
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: "data", consultation: c })} aria-label={`Corrigir data da consulta de ${label}`}>
                          <CalendarCog aria-hidden="true" />
                          Corrigir data
                        </DropdownMenuItem>
                      </MoreMenu>
                    </div>
                    {!plan ? (
                      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-muted-foreground">Sem acompanhamento.</p>
                        <Button
                          variant="outline"
                          className="h-10 px-3"
                          disabled={usableTemplates.length === 0}
                          onClick={() => setDialog({ kind: "aplicar", consultation: c })}
                          aria-label={`Aplicar modelo à consulta de ${label}`}
                        >
                          <ListPlus aria-hidden="true" />
                          Aplicar modelo
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col" data-plan={plan.status}>
                        <div className="flex items-start justify-between gap-2 pt-2 pr-2 pl-4">
                          <p className="py-2 text-sm">
                            <span className="font-medium">Acompanhamento:</span> {plan.templateName}
                            {plan.status === "cancelado" && (
                              <span className="block text-muted-foreground" data-plan-canceled="">
                                Cancelado
                                {plan.canceledAt ? ` em ${formatInstant(plan.canceledAt)}` : ""}
                                {plan.cancelReason ? ` · motivo: ${plan.cancelReason}` : ""}.
                              </span>
                            )}
                          </p>
                          {plan.status === "ativo" && (
                            <MoreMenu label={`Mais ações do acompanhamento da consulta de ${label}`}>
                              <DropdownMenuItem
                                onSelect={() => setDialog({ kind: "prazo", plan, consultDate: c.consultDate })}
                                aria-label={`${plan.durationDays === null ? "Definir" : "Alterar"} duração do acompanhamento da consulta de ${label}`}
                              >
                                <Timer aria-hidden="true" />
                                {plan.durationDays === null ? "Definir duração" : "Alterar duração"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={usableTemplates.length === 0}
                                onSelect={() => setDialog({ kind: "substituir", consultation: c })}
                                aria-label={`Substituir pendentes da consulta de ${label}`}
                              >
                                <Replace aria-hidden="true" />
                                Substituir etapas pendentes
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: "cancelar", plan })} aria-label={`Cancelar acompanhamento da consulta de ${label}`}>
                                <XCircle aria-hidden="true" />
                                Cancelar acompanhamento
                              </DropdownMenuItem>
                            </MoreMenu>
                          )}
                        </div>
                        {plan.status === "ativo" &&
                          (() => {
                            const deadline = planDeadline(c.consultDate, plan.durationDays, plan.noticeDays, today);
                            return (
                              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2 text-sm" data-plan-deadline={deadline.state}>
                                <DeadlineBadge deadline={deadline} />
                                {deadline.state !== "sem_prazo" && <span className="text-muted-foreground">{describeDeadline(deadline)}</span>}
                                {deadline.state !== "sem_prazo" && deadline.state !== "em_acompanhamento" && <NextAppointmentText next={next} highlight={needsAttention(deadline, next !== null)} />}
                              </p>
                            );
                          })()}
                        <ul className="divide-y">
                          {plan.steps.map((s) => (
                            <StepItem key={s.id} step={s} ctx={ctx} today={today} />
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="px-4 pb-3">
                      <History events={events.filter((e) => e.consultationId === c.id)} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </StepActionsProvider>

      <PatientFormDialog open={editing} onOpenChange={setEditing} patient={patient} onSuccess={done} />
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          {dialog?.kind === "consulta" && (
            <ConsultationCreateForm patientId={patient.id} patientName={patient.name} templates={templates} today={today} onSuccess={done} onCancel={() => setDialog(null)} />
          )}
          {dialog?.kind === "nota" && <ConsultationNotesForm consultation={dialog.consultation} onSuccess={done} onCancel={() => setDialog(null)} />}
          {dialog?.kind === "data" && <DateCorrectionForm consultation={dialog.consultation} today={today} onSuccess={done} onCancel={() => setDialog(null)} />}
          {dialog?.kind === "aplicar" && (
            <ApplyTemplateForm consultation={dialog.consultation} templates={templates} patientName={patient.name} onSuccess={done} onCancel={() => setDialog(null)} />
          )}
          {dialog?.kind === "substituir" && <ReplaceForm consultation={dialog.consultation} templates={templates} onSuccess={done} onCancel={() => setDialog(null)} />}
          {dialog?.kind === "cancelar" && <CancelPlanForm plan={dialog.plan} onSuccess={done} onCancel={() => setDialog(null)} />}
          {dialog?.kind === "prazo" && <PlanDeadlineForm plan={dialog.plan} consultDate={dialog.consultDate} onSuccess={done} onCancel={() => setDialog(null)} />}
          {dialog?.kind === "agendar" && <AppointmentForm patientId={patient.id} appointment={dialog.appointment} today={today} onSuccess={done} onCancel={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} onOpenChange={(o) => !o && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
