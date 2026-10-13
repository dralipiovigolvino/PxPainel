"use client";

import { createContext, useActionState, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, ClipboardCopy, Loader2, MessageSquareText, MoreHorizontal, NotebookPen, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ConfirmDialog, type ConfirmRequest } from "@/modules/financas/components/confirm-dialog";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { cancelStepAction, logCopiedAction, rescheduleStepAction, stepDoneAction, stepMessageAction, stepNoteAction, undoStepAction, type ActionState } from "../actions";
import { MESSAGE_MAX, renderMessage, stepLabel } from "../domain/messages";
import { isOverdue } from "../domain/plan";
import { REASON_MAX, STEP_NOTE_MAX } from "../domain/schemas";
import type { FuStep } from "../types";

const initial: ActionState = { status: "idle" };

export type StepContext = {
  patientName: string;
  consultDate: CivilDate;
  planActive: boolean;
};

/** Instante "AAAA-MM-DDTHH:MI" (São Paulo) → "DD/MM/AAAA às HH:MI". */
export const formatInstant = (value: string) => `${formatCivilDate(value.slice(0, 10))} às ${value.slice(11, 16)}`;

export function StepStatusTag({ step, today }: { step: Pick<FuStep, "status" | "dueDate" | "doneAt" | "cancelKind">; today: CivilDate }) {
  const base = "rounded-md px-2 py-0.5 text-xs font-medium";
  if (step.status === "realizado") return <span className={cn(base, "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100")}>Realizada</span>;
  if (step.status === "cancelado")
    return <span className={cn(base, "bg-muted text-muted-foreground line-through")}>{step.cancelKind === "substituido" ? "Substituída" : "Cancelada"}</span>;
  if (isOverdue(step, today)) return <span className={cn(base, "bg-destructive/10 text-destructive")}>Atrasada</span>;
  if (step.dueDate === today) return <span className={cn(base, "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100")}>Hoje</span>;
  return <span className={cn(base, "bg-muted")}>Pendente</span>;
}

type Panel = "mensagem" | "realizar" | "remarcar" | "cancelar" | "observacao";
type Open = { panel: Panel; step: FuStep; ctx: StepContext } | null;
type StepActions = {
  open: (panel: Panel, step: FuStep, ctx: StepContext) => void;
  confirmUndo: (step: FuStep) => void;
};

const StepActionsContext = createContext<StepActions | null>(null);

/**
 * Diálogos das etapas ficam AQUI, no nível da lista: quando a ação tira a etapa do filtro atual
 * (ex.: atrasada marcada como realizada), o item some, mas o diálogo e o aviso de sucesso continuam.
 */
export function StepActionsProvider({ onDone, children }: { onDone: (message: string) => void; children: React.ReactNode }) {
  const [current, setCurrent] = useState<Open>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const done = useCallback(
    (message: string) => {
      setCurrent(null);
      setConfirm(null);
      onDone(message);
    },
    [onDone],
  );
  const actions = useMemo<StepActions>(
    () => ({
      open: (panel, step, ctx) => setCurrent({ panel, step, ctx }),
      confirmUndo: (step) =>
        setConfirm({
          title: `Desfazer realização de ${stepLabel(step.dayOffset)}?`,
          description: "A etapa volta para pendente. A realização anterior (instante e texto registrado) fica guardada no histórico.",
          confirmLabel: "Desfazer",
          action: undoStepAction,
          fields: { id: step.id },
        }),
    }),
    [],
  );
  const close = () => setCurrent(null);
  return (
    <StepActionsContext.Provider value={actions}>
      {children}
      <Dialog open={current !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          {current?.panel === "mensagem" && (
            <MessagePanel key={current.step.id} step={current.step} ctx={current.ctx} onDone={done} onMarkDone={() => setCurrent({ ...current, panel: "realizar" })} />
          )}
          {current?.panel === "realizar" && <DonePanel step={current.step} ctx={current.ctx} onDone={done} onCancel={close} />}
          {current?.panel === "remarcar" && <ReschedulePanel step={current.step} ctx={current.ctx} onDone={done} onCancel={close} />}
          {current?.panel === "cancelar" && <CancelPanel step={current.step} onDone={done} onCancel={close} />}
          {current?.panel === "observacao" && <NotePanel step={current.step} onDone={done} onCancel={close} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} onOpenChange={(o) => !o && setConfirm(null)} onSuccess={done} />
    </StepActionsContext.Provider>
  );
}

/**
 * Abre um diálogo da etapa ao carregar a página (links do dashboard: "Mensagem" / "Realizada").
 * Usa os MESMOS diálogos e validações; só ajuda a chegar até eles. Uma vez por montagem.
 */
export function AutoOpenStep({ step, ctx, panel }: { step: FuStep; ctx: StepContext; panel: "mensagem" | "realizar" }) {
  const actions = useStepActions();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    document.getElementById(`etapa-${step.id}`)?.scrollIntoView({ block: "center" });
    // Realizar só faz sentido em etapa pendente de plano ativo; senão, abre a mensagem (leitura).
    actions.open(panel === "realizar" && step.status === "pendente" && ctx.planActive ? "realizar" : "mensagem", step, ctx);
  }, [actions, step, ctx, panel]);
  return null;
}

function useStepActions(): StepActions {
  const value = useContext(StepActionsContext);
  if (!value) throw new Error("StepItem precisa de StepActionsProvider");
  return value;
}

/** Uma etapa com suas ações (diálogos no StepActionsProvider). `head` permite à central mostrar paciente e consulta. */
export function StepItem({ step, ctx, today, head }: { step: FuStep; ctx: StepContext; today: CivilDate; head?: React.ReactNode }) {
  const actions = useStepActions();
  const setPanel = (panel: Panel) => actions.open(panel, step, ctx);
  const pending = step.status === "pendente" && ctx.planActive;
  const label = stepLabel(step.dayOffset);

  return (
    <li id={`etapa-${step.id}`} className="flex scroll-mt-24 flex-col gap-2 px-4 py-3" data-step={label} data-step-status={step.status}>
      {head}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold tabular-nums">{label}</span>
            <span className="text-sm tabular-nums">{formatCivilDate(step.dueDate)}</span>
            <StepStatusTag step={step} today={today} />
            {step.note && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Tem observação" data-note-indicator="">
                <NotebookPen className="size-3.5" aria-hidden="true" />
                observação
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {step.rescheduled && `Remarcada (original ${formatCivilDate(step.originalDate)}). `}
            {step.customMessage !== null && step.status === "pendente" && "Texto ajustado nesta etapa. "}
            {step.status === "realizado" && step.doneAt && `Realizada em ${formatInstant(step.doneAt)}. `}
            {step.status === "cancelado" &&
              step.canceledAt &&
              `${step.cancelKind === "substituido" ? "Substituída" : "Cancelada"} em ${formatInstant(step.canceledAt)}${step.cancelReason ? ` · motivo: ${step.cancelReason}` : ""}.`}
          </p>
          {step.note && <p className="mt-1 text-sm break-words whitespace-pre-wrap">{step.note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" className="h-10 px-3" onClick={() => setPanel("mensagem")} aria-label={`Mensagem ${label}`}>
            <MessageSquareText aria-hidden="true" />
            Mensagem
          </Button>
          {pending && (
            <Button className="h-10 px-3" onClick={() => setPanel("realizar")} aria-label={`Marcar ${label} como realizada`}>
              <Check aria-hidden="true" />
              Realizada
            </Button>
          )}
          {ctx.planActive && step.status !== "cancelado" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-10" aria-label={`Mais ações ${label}`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setPanel("observacao")} aria-label={`Observação ${label}`}>
                  <NotebookPen aria-hidden="true" />
                  Observação
                </DropdownMenuItem>
                {pending && (
                  <DropdownMenuItem onSelect={() => setPanel("remarcar")} aria-label={`Remarcar ${label}`}>
                    <CalendarClock aria-hidden="true" />
                    Remarcar
                  </DropdownMenuItem>
                )}
                {pending && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setPanel("cancelar")} aria-label={`Cancelar ${label}`}>
                    <XCircle aria-hidden="true" />
                    Cancelar etapa
                  </DropdownMenuItem>
                )}
                {step.status === "realizado" && (
                  <DropdownMenuItem onSelect={() => actions.confirmUndo(step)} aria-label={`Desfazer realização ${label}`}>
                    <Undo2 aria-hidden="true" />
                    Desfazer realização
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </li>
  );
}

function CancelButton({ onCancel, label = "Fechar" }: { onCancel: () => void; label?: string }) {
  return (
    <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
      {label}
    </Button>
  );
}

function Submit({ pending, label, variant }: { pending: boolean; label: string; variant?: "destructive" }) {
  return (
    <Button type="submit" disabled={pending} variant={variant ?? "default"} className="h-10 px-4">
      {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
      {label}
    </Button>
  );
}

/**
 * Mensagem: texto renderizado, editável só para esta etapa pendente; o que está na caixa é o que
 * será copiado. Copiar NÃO marca realizada e só mostra sucesso se a área de transferência aceitou.
 */
function MessagePanel({ step, ctx, onDone, onMarkDone }: { step: FuStep; ctx: StepContext; onDone: (m: string) => void; onMarkDone: () => void }) {
  const editable = step.status === "pendente" && ctx.planActive;
  const rendered =
    step.status === "realizado" && step.doneText
      ? step.doneText
      : renderMessage(step.customMessage ?? step.message, {
          ...ctx,
          dayOffset: step.dayOffset,
        });
  const [text, setText] = useState(rendered);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const area = useRef<HTMLTextAreaElement>(null);
  const [state, action, saving] = useActionState(stepMessageAction, initial);
  useActionOutcome(state, onDone);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const changed = text !== rendered;

  const doCopy = async () => {
    setCopy("idle");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("indisponível");
      await navigator.clipboard.writeText(text);
      setCopy("copied");
      void logCopiedAction(step.id).catch(() => {});
    } catch {
      setCopy("failed");
      area.current?.focus();
      area.current?.select();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          Mensagem {stepLabel(step.dayOffset)} · {ctx.patientName}
        </DialogTitle>
        <DialogDescription>
          {step.status === "realizado"
            ? "Texto registrado quando a etapa foi marcada como realizada."
            : editable
              ? "Este é o texto que será copiado. Você pode ajustá-lo só para esta etapa; o modelo não muda."
              : "Etapa cancelada: texto apenas para consulta."}
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="id" value={step.id} />
        <Field id={`msg-${step.id}`} label="Texto" error={errors?.message} hint={editable ? `Até ${MESSAGE_MAX} caracteres.` : undefined}>
          {(describedBy, invalid) => (
            <Textarea
              id={`msg-${step.id}`}
              ref={area}
              name="message"
              rows={7}
              value={text}
              readOnly={!editable}
              onChange={(e) => {
                setText(e.target.value);
                setCopy("idle");
              }}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              data-message-text=""
            />
          )}
        </Field>
        <div role="status" aria-live="polite" data-copy-status={copy}>
          {copy === "copied" && <p className="text-sm text-emerald-800 dark:text-emerald-200">Mensagem copiada. Isso não marca a etapa como realizada nem confirma envio.</p>}
          {copy === "failed" && (
            <p className="text-sm text-destructive">Não foi possível copiar automaticamente. O texto foi selecionado: copie manualmente (Ctrl+C ou toque longo → Copiar).</p>
          )}
        </div>
        <FormError state={state} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-10 px-4" onClick={doCopy} data-copy-button="">
            <ClipboardCopy aria-hidden="true" />
            Copiar mensagem
          </Button>
          {editable && changed && <Submit pending={saving} label="Salvar ajuste nesta etapa" />}
          {editable && step.customMessage !== null && !changed && (
            <Button type="submit" name="reset" value="true" variant="ghost" className="h-10 px-3" disabled={saving}>
              Voltar ao texto do modelo
            </Button>
          )}
          {editable && !changed && (
            <Button type="button" variant="outline" className="h-10 px-3" onClick={onMarkDone}>
              <Check aria-hidden="true" />
              Marcar como realizada
            </Button>
          )}
        </div>
        {editable && changed && (
          <p className="text-xs text-muted-foreground">Para registrar o ajuste, salve antes de marcar como realizada.</p>
        )}
      </form>
    </div>
  );
}

function DonePanel({ step, ctx, onDone, onCancel }: { step: FuStep; ctx: StepContext; onDone: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(stepDoneAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onDone, formRef);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const text = renderMessage(step.customMessage ?? step.message, {
    ...ctx,
    dayOffset: step.dayOffset,
  });
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Marcar {stepLabel(step.dayOffset)} como realizada?</DialogTitle>
        <DialogDescription>Fica registrado com a hora de agora e o texto abaixo. Não confirma o envio da mensagem.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={step.id} />
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm break-words whitespace-pre-wrap" data-done-preview="">
        {text}
      </p>
      <Field id={`done-note-${step.id}`} label="Observação" optional error={errors?.note}>
        {(describedBy, invalid) => (
          <Textarea
            id={`done-note-${step.id}`}
            name="note"
            rows={3}
            maxLength={STEP_NOTE_MAX * 2}
            defaultValue={step.note ?? ""}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <CancelButton onCancel={onCancel} label="Cancelar" />
        <Submit pending={pending} label="Confirmar realização" />
      </DialogFooter>
    </form>
  );
}

function ReschedulePanel({ step, ctx, onDone, onCancel }: { step: FuStep; ctx: StepContext; onDone: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(rescheduleStepAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onDone, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Remarcar {stepLabel(step.dayOffset)}</DialogTitle>
        <DialogDescription>
          Data original: {formatCivilDate(step.originalDate)}. A etapa continua se chamando {stepLabel(step.dayOffset)} e não é recalculada automaticamente se a data da consulta
          for corrigida.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={step.id} />
      <Field id={`resched-${step.id}`} label="Nova data prevista" error={errors?.dueDate}>
        {(describedBy, invalid) => (
          <Input
            id={`resched-${step.id}`}
            name="dueDate"
            type="date"
            min={ctx.consultDate}
            max="2100-12-31"
            defaultValue={values?.dueDate ?? step.dueDate}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <CancelButton onCancel={onCancel} label="Cancelar" />
        <Submit pending={pending} label="Remarcar" />
      </DialogFooter>
    </form>
  );
}

function CancelPanel({ step, onDone, onCancel }: { step: FuStep; onDone: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(cancelStepAction, initial);
  useActionOutcome(state, onDone);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Cancelar a etapa {stepLabel(step.dayOffset)}?</DialogTitle>
        <DialogDescription>Sai das pendências e continua no histórico. Não dá para reativar.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={step.id} />
      <Field id={`cancel-reason-${step.id}`} label="Motivo" optional error={errors?.reason}>
        {(describedBy, invalid) => (
          <Input id={`cancel-reason-${step.id}`} name="reason" maxLength={REASON_MAX * 2} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <CancelButton onCancel={onCancel} label="Voltar" />
        <Submit pending={pending} label="Cancelar etapa" variant="destructive" />
      </DialogFooter>
    </form>
  );
}

function NotePanel({ step, onDone, onCancel }: { step: FuStep; onDone: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(stepNoteAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onDone, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Observação da etapa {stepLabel(step.dayOffset)}</DialogTitle>
        <DialogDescription>Texto simples, visível só para você. Deixe vazio para remover.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={step.id} />
      <Field id={`note-${step.id}`} label="Observação" optional error={errors?.note} hint={`Até ${STEP_NOTE_MAX} caracteres.`}>
        {(describedBy, invalid) => (
          <Textarea
            id={`note-${step.id}`}
            name="note"
            rows={4}
            maxLength={STEP_NOTE_MAX * 2}
            defaultValue={values?.note ?? step.note ?? ""}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <CancelButton onCancel={onCancel} label="Cancelar" />
        <Submit pending={pending} label="Salvar observação" />
      </DialogFooter>
    </form>
  );
}
