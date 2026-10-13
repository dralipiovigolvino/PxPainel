"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { BadgeCheck, Ban, CheckCircle2, Loader2, Pencil, RotateCcw, Trash2, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/lib/tax";
import { TaxBreakdown } from "@/modules/cnpj/components/tax-breakdown";
import type { ActionState } from "@/modules/financas/actions";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { examEventsAction, receiveExamAction } from "../actions";
import { MIN_DATE } from "../domain/schemas";
import type { PerEvent, PerExam } from "../types";

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
export const weekday = (d: CivilDate) => WEEKDAY.format(new Date(`${d}T12:00:00Z`));
const formatInstant = (v: string) => `${formatCivilDate(v.slice(0, 10))} às ${v.slice(11, 16)}`;

export const EXAM_STATUS_LABEL: Record<PerExam["status"], string> = { agendada: "Agendada", realizada: "Realizada", cancelada: "Cancelada" };

const money = (v: unknown) => (typeof v === "number" ? formatCents(v) : "?");
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? formatCivilDate(v.slice(0, 10)) : "?");
const yesNo = (v: unknown) => (v === true ? "sim" : "não");

/** Texto do histórico (só o que foi registrado; sem dados além dos da própria perícia). */
export function describePerEvent(action: string, details: Record<string, unknown>): string {
  const change = (key: string, label: string, format: (v: unknown) => string) => {
    const c = details[key] as { de?: unknown; para?: unknown } | undefined;
    return c ? `${label}: ${format(c.de)} → ${format(c.para)}` : null;
  };
  switch (action) {
    case "criada": {
      // Antes do cadastro de CNPJ toda perícia tinha imposto estimado: sem a marca, vale a alíquota registrada.
      const byCnpj = details.cnpj === true || (details.cnpj === undefined && typeof details.aliquota_bp === "number");
      return `Perícia agendada (${money(details.valor)}${byCnpj && typeof details.aliquota_bp === "number" ? `, por CNPJ, imposto estimado de ${formatRate(details.aliquota_bp)}` : ""})`;
    }
    case "editada":
      return (
        [
          change("data", "Data", date),
          change("horario", "Horário", String),
          change("valor", "Valor", money),
          change("cnpj", "Recebimento por CNPJ", yesNo),
          details.empresa ? "Empresa alterada" : null,
          details.observacao_alterada ? "Observação alterada" : null,
        ]
          .filter(Boolean)
          .join("; ") || "Perícia editada"
      );
    case "realizada":
      return "Marcada como realizada";
    case "realizacao_desfeita":
      return "Realização desfeita";
    case "cancelada":
      return "Cancelada";
    case "restaurada":
      return "Restaurada";
    case "recebida":
      return `Recebimento registrado em ${date(details.recebido_em)}`;
    case "recebimento_desfeito":
      return `Recebimento desfeito (era ${date(details.recebido_em)})`;
    case "aliquota_atualizada": {
      const c = details.aliquota_bp as { de?: unknown; para?: unknown } | undefined;
      const rate = (v: unknown) => (typeof v === "number" ? formatRate(v) : "?");
      return `Alíquota estimada atualizada: ${rate(c?.de)} → ${rate(c?.para)}`;
    }
    default:
      return action.replaceAll("_", " ");
  }
}

function History({ examId }: { examId: string }) {
  const [events, setEvents] = useState<{ id: string; list: PerEvent[] | null } | null>(null);
  useEffect(() => {
    let active = true;
    examEventsAction(examId).then((list) => active && setEvents({ id: examId, list }));
    return () => {
      active = false;
    };
  }, [examId]);
  if (!events || events.id !== examId) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Carregando histórico…
      </p>
    );
  }
  if (!events.list || events.list.length === 0) return <p className="text-sm text-muted-foreground">Sem histórico.</p>;
  return (
    <ol className="flex flex-col gap-1 text-sm" data-exam-history="">
      {events.list.map((e) => (
        <li key={e.id} className="break-words">
          <span className="text-muted-foreground tabular-nums">{formatInstant(e.createdAt)}</span> · {describePerEvent(e.action, e.details)}
        </li>
      ))}
    </ol>
  );
}

export type ExamDetailActions = {
  onEdit: () => void;
  onDone: () => void;
  onUndoDone: () => void;
  onReceive: () => void;
  onUndoReceipt: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onDelete: () => void;
};

export function ExamDetails({ exam, toConfirm, actions }: { exam: PerExam; toConfirm: boolean; actions: ExamDetailActions }) {
  const canceled = exam.status === "cancelada";
  const done = exam.status === "realizada";
  const received = Boolean(exam.receivedOn);
  return (
    <div className="flex flex-col gap-4" data-exam-details={exam.id}>
      <DialogHeader>
        <DialogTitle>{exam.companyName}</DialogTitle>
        <DialogDescription>Perícia</DialogDescription>
      </DialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Data</dt>
        <dd data-detail="date">
          {formatCivilDate(exam.date)} ({weekday(exam.date)})
        </dd>
        <dt className="text-muted-foreground">Horário</dt>
        <dd data-detail="time">{exam.time}</dd>
        <dt className="text-muted-foreground">Valor</dt>
        <dd className="font-medium tabular-nums" data-detail="amount">
          {formatCents(exam.amountCents)}
          {exam.cnpjId && <span className="font-normal text-muted-foreground"> · por CNPJ</span>}
        </dd>
        <dt className="text-muted-foreground">Situação</dt>
        <dd data-detail="status">
          {EXAM_STATUS_LABEL[exam.status]}
          {done && exam.doneAt && ` em ${formatInstant(exam.doneAt)}`}
          {toConfirm && " · a confirmar (horário passado; marque manualmente se foi realizada)"}
        </dd>
        <dt className="text-muted-foreground">Recebimento</dt>
        <dd data-detail="receipt">{exam.receivedOn ? `Recebimento registrado em ${formatCivilDate(exam.receivedOn)}` : canceled ? "—" : "Sem recebimento registrado"}</dd>
        <dt className="text-muted-foreground">Observação</dt>
        <dd className="break-words whitespace-pre-wrap">{exam.notes ?? "—"}</dd>
      </dl>
      <TaxBreakdown amountCents={exam.amountCents} rateBp={exam.cnpjId ? exam.taxRateBp : null} workDate={exam.date} />
      {!canceled && (
        <div className="flex flex-wrap gap-2" aria-label="Situação e recebimento">
          {done ? (
            <Button variant="ghost" className="h-10 px-3" onClick={actions.onUndoDone}>
              <Undo2 aria-hidden="true" />
              Desfazer realização
            </Button>
          ) : (
            <Button className="h-10 px-3" onClick={actions.onDone}>
              <BadgeCheck aria-hidden="true" />
              Marcar realizada
            </Button>
          )}
          {received ? (
            <Button variant="ghost" className="h-10 px-3" onClick={actions.onUndoReceipt}>
              <Undo2 aria-hidden="true" />
              Desfazer recebimento
            </Button>
          ) : (
            <Button variant="outline" className="h-10 px-3" onClick={actions.onReceive}>
              <Wallet aria-hidden="true" />
              Registrar recebimento
            </Button>
          )}
        </div>
      )}
      {(received || done) && !canceled && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {received ? "Com recebimento registrado: para alterar o valor ou cancelar, desfaça o recebimento antes." : "Realizada: para cancelar, desfaça a realização antes."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!canceled && (
          <Button variant="outline" className="h-10 px-3" onClick={actions.onEdit}>
            <Pencil aria-hidden="true" />
            Editar
          </Button>
        )}
        {!canceled ? (
          !received &&
          !done && (
            <Button variant="ghost" className="h-10 px-3 text-destructive hover:text-destructive" onClick={actions.onCancel}>
              <Ban aria-hidden="true" />
              Cancelar perícia
            </Button>
          )
        ) : (
          <Button variant="outline" className="h-10 px-3" onClick={actions.onRestore}>
            <RotateCcw aria-hidden="true" />
            Restaurar
          </Button>
        )}
        {exam.status === "agendada" && !received && (
          <Button variant="ghost" className="h-10 px-3 text-destructive hover:text-destructive" onClick={actions.onDelete}>
            <Trash2 aria-hidden="true" />
            Excluir
          </Button>
        )}
      </div>
      <section aria-label="Histórico" className="border-t pt-3">
        <h3 className="mb-1.5 text-sm font-semibold">Histórico</h3>
        <History examId={exam.id} />
      </section>
    </div>
  );
}

const initial: ActionState = { status: "idle" };

/** Recebimento: data obrigatória até hoje. Não marca a perícia como realizada. */
export function ExamReceiveForm({ exam, today, onSuccess, onCancel }: { exam: PerExam; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(receiveExamAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Registrar recebimento</DialogTitle>
        <DialogDescription>
          Perícia de {formatCivilDate(exam.date)} · {exam.companyName} · {formatCents(exam.amountCents)} brutos. Registra só a data em que você recebeu; não marca a perícia como realizada.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={exam.id} />
      <Field id="exam-receive-date" label="Data em que recebi" error={errors?.receivedOn} hint="Hoje ou uma data anterior.">
        {(d, i) => <Input id="exam-receive-date" name="receivedOn" type="date" min={MIN_DATE} max={today} defaultValue={values?.receivedOn ?? today} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Confirmar recebimento
        </Button>
      </DialogFooter>
    </form>
  );
}
