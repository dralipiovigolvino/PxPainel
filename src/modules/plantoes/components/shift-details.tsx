"use client";

import { useEffect, useState } from "react";
import { Ban, BadgeCheck, CheckCircle2, Loader2, Pencil, RotateCcw, Trash2, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { TaxBreakdown } from "@/modules/cnpj/components/tax-breakdown";
import { shiftEventsAction } from "../actions";
import { describeHours, endDate } from "../domain/hours";
import { describePlEvent } from "../domain/history";
import { describeExpected, describePayRule } from "../domain/payment";
import type { PlEvent, PlShift, PlType } from "../types";
import { Dot } from "./types-manager";

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
export const weekday = (d: CivilDate) => WEEKDAY.format(new Date(`${d}T12:00:00Z`));
export const formatInstant = (v: string) => `${formatCivilDate(v.slice(0, 10))} às ${v.slice(11, 16)}`;

export const STATUS_LABEL: Record<PlShift["status"], string> = { agendado: "Agendado", realizado: "Realizado", cancelado: "Cancelado" };

/** Histórico da ocorrência, carregado sob demanda (somente leitura). */
function History({ shiftId }: { shiftId: string }) {
  const [events, setEvents] = useState<{ id: string; list: PlEvent[] | null } | null>(null);
  useEffect(() => {
    let active = true;
    shiftEventsAction(shiftId).then((list) => active && setEvents({ id: shiftId, list }));
    return () => {
      active = false;
    };
  }, [shiftId]);
  if (!events || events.id !== shiftId) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Carregando histórico…
      </p>
    );
  }
  if (!events.list || events.list.length === 0) return <p className="text-sm text-muted-foreground">Sem histórico.</p>;
  return (
    <ol className="flex flex-col gap-1 text-sm" data-shift-history="">
      {events.list.map((e) => (
        <li key={e.id} className="break-words">
          <span className="text-muted-foreground tabular-nums">{formatInstant(e.createdAt)}</span> · {describePlEvent(e.action, e.details)}
        </li>
      ))}
    </ol>
  );
}

export type DetailActions = {
  onEdit: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onDone: () => void;
  onUndoDone: () => void;
  onReceive: () => void;
  onUndoReceipt: () => void;
  /** Ações das etapas seguintes (mover, realizar, receber), quando existirem. */
  extra?: React.ReactNode;
};

/** Detalhes de uma ocorrência: tudo o que a bolinha não mostra. */
export function ShiftDetails({ shift, type, today, actions }: { shift: PlShift; type: PlType | undefined; today: CivilDate; actions: DetailActions }) {
  const canceled = shift.status === "cancelado";
  const received = Boolean(shift.receivedOn);
  const done = shift.status === "realizado";
  const toConfirm = shift.status === "agendado" && shift.date < today;
  // Previsão vencida: data prevista já passou e não há recebimento registrado (independe de estar realizado).
  const forecastOverdue = !canceled && !received && shift.expectedPayDate !== null && shift.expectedPayDate < today;
  return (
    <div className="flex flex-col gap-4" data-shift-details={shift.id}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {type && <Dot color={type.color} className="size-3.5" />}
          {type?.name ?? "Plantão"}
        </DialogTitle>
        <DialogDescription className={type?.location ? undefined : "sr-only"}>{type?.location ?? "Detalhes do plantão"}</DialogDescription>
      </DialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Data</dt>
        <dd data-detail="date">
          {formatCivilDate(shift.date)} ({weekday(shift.date)})
          {shift.moved && shift.originalDate && shift.originalDate !== shift.date && <span className="block text-xs text-muted-foreground">Movido; data original {formatCivilDate(shift.originalDate)}.</span>}
        </dd>
        {shift.hours && (
          <>
            <dt className="text-muted-foreground">Horário</dt>
            <dd data-detail="hours">{describeHours(shift.hours, shift.date)}</dd>
          </>
        )}
        {shift.hours?.nextDay && (
          <>
            <dt className="text-muted-foreground">Término</dt>
            <dd>{formatCivilDate(endDate(shift.date, shift.hours))}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Valor</dt>
        <dd className="font-medium tabular-nums" data-detail="amount">
          {formatCents(shift.amountCents)}
          {shift.cnpjId && <span className="font-normal text-muted-foreground"> · por CNPJ</span>}
        </dd>
        <dt className="text-muted-foreground">Situação</dt>
        <dd data-detail="status">
          {STATUS_LABEL[shift.status]}
          {done && shift.doneAt && ` em ${formatInstant(shift.doneAt)}`}
          {toConfirm && " · a confirmar"}
        </dd>
        {!canceled && shift.expectedPayDate !== null && (
          <>
            <dt className="text-muted-foreground">Data prevista de pagamento</dt>
            <dd data-detail="expected">
              {describeExpected(shift.expectedPayDate, shift.expectedPayManual)}
              {!shift.expectedPayManual && shift.payDay !== null && <span className="block text-xs text-muted-foreground">{describePayRule(shift.payDay)}. É previsão, não recebimento.</span>}
              {forecastOverdue && (
                <span className="mt-0.5 block w-fit rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive" data-forecast-overdue="">
                  Previsão vencida, sem recebimento registrado
                </span>
              )}
            </dd>
          </>
        )}
        {(shift.receivedOn || !canceled) && (
          <>
            <dt className="text-muted-foreground">Data em que recebi</dt>
            <dd data-detail="receipt">
              {shift.receivedOn ? `${formatCivilDate(shift.receivedOn)} · ${formatCents(shift.receivedCents ?? shift.amountCents)}` : "Ainda não registrado (a receber)"}
            </dd>
          </>
        )}
        {shift.seriesId && (
          <>
            <dt className="text-muted-foreground">Origem</dt>
            <dd>Recorrência{shift.isOverride ? " (alterado individualmente)" : ""}</dd>
          </>
        )}
        {shift.notes && (
          <>
            <dt className="text-muted-foreground">Observação</dt>
            <dd className="break-words whitespace-pre-wrap">{shift.notes}</dd>
          </>
        )}
      </dl>
      <TaxBreakdown amountCents={shift.amountCents} rateBp={shift.cnpjId ? shift.taxRateBp : null} workDate={shift.date} />
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
              Marcar realizado
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
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-locks="">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {received ? "Recebido: para alterar o valor ou cancelar, desfaça o recebimento antes." : "Realizado: para cancelar, desfaça a realização antes."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.extra}
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
              Cancelar plantão
            </Button>
          )
        ) : (
          <Button variant="outline" className="h-10 px-3" onClick={actions.onRestore}>
            <RotateCcw aria-hidden="true" />
            Restaurar
          </Button>
        )}
        {shift.status === "agendado" && !shift.receivedOn && (
          <Button variant="ghost" className="h-10 px-3 text-destructive hover:text-destructive" onClick={actions.onDelete}>
            <Trash2 aria-hidden="true" />
            Excluir
          </Button>
        )}
      </div>
      <section aria-label="Histórico" className="border-t pt-3">
        <h3 className="mb-1.5 text-sm font-semibold">Histórico</h3>
        <History shiftId={shift.id} />
      </section>
    </div>
  );
}
