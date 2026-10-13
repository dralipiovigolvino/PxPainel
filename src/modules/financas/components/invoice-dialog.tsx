"use client";

import { useActionState, useRef, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents, formatCentsForInput, parseBrlToCents } from "@/lib/money";
import type { ActionState } from "../actions";
import { payInvoiceAction, saveInvoiceTotalAction } from "../card-actions";
import { MIN_DATE } from "../domain/schemas";
import type { FinInvoice } from "../types";
import { Field, FormError, useActionOutcome } from "./form-bits";

const initial: ActionState = { status: "idle" };

/** Fatura do cartão num vencimento: o bastante para informar o total e pagar. */
export type InvoiceSummary = Pick<FinInvoice, "id" | "cardName" | "dueDate" | "status" | "paidOn" | "statedCents" | "detailedCents" | "totalCents">;

export type InvoiceRequest =
  /** Informar ou corrigir o total da fatura. */
  | { mode: "editar"; invoice: InvoiceSummary }
  /** Marcar o cartão como pago naquele vencimento (confirma o total e a data). */
  | { mode: "pagar"; invoice: InvoiceSummary }
  /** O cartão ainda não tem nada naquele vencimento: informar o total cria a fatura. */
  | { mode: "nova"; card: { id: string; name: string }; dueDate: CivilDate };

type Props = {
  request: InvoiceRequest | null;
  today: CivilDate;
  onOpenChange: (open: boolean) => void;
  onSuccess: (message: string) => void;
  /** Fatura paga: pedir a confirmação para voltar a pagar (aberta no lugar deste diálogo). */
  onAskUnpay?: (invoice: InvoiceSummary) => void;
};

export function InvoiceDialog({ request, today, onOpenChange, onSuccess, onAskUnpay }: Props) {
  const close = () => onOpenChange(false);
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {request?.mode === "pagar" && <PayForm invoice={request.invoice} today={today} onSuccess={onSuccess} onCancel={close} />}
        {request?.mode === "editar" && request.invoice.status === "pago" && <PaidSummary invoice={request.invoice} onCancel={close} onAskUnpay={onAskUnpay} />}
        {request?.mode === "editar" && request.invoice.status !== "pago" && (
          <TotalForm target={{ invoiceId: request.invoice.id }} cardName={request.invoice.cardName} dueDate={request.invoice.dueDate} statedCents={request.invoice.statedCents} detailedCents={request.invoice.detailedCents} onSuccess={onSuccess} onCancel={close} />
        )}
        {request?.mode === "nova" && (
          <TotalForm target={{ cardId: request.card.id, dueMonth: request.dueDate.slice(0, 7) }} cardName={request.card.name} dueDate={request.dueDate} statedCents={null} detailedCents={0} onSuccess={onSuccess} onCancel={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type TotalFieldProps = { value: string; onChange: (value: string) => void; detailedCents: number; error?: string; hint?: string };

/** Total que veio na fatura, com a diferença para as compras cadastradas calculada na hora. */
function TotalField({ value, onChange, detailedCents, error, hint }: TotalFieldProps) {
  const typed = value.trim() === "" ? null : parseBrlToCents(value);
  const cents = typed?.ok ? typed.cents : null;
  return (
    <div className="flex flex-col gap-2">
      <Field id="invoice-total" label="Total da fatura (R$)" error={error} hint={detailedCents > 0 ? "Em branco = soma das compras cadastradas." : hint}>
        {(describedBy, invalid) => (
          <Input
            id="invoice-total"
            name="total"
            inputMode="decimal"
            autoComplete="off"
            placeholder={detailedCents > 0 ? formatCentsForInput(detailedCents) : "0,00"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10 tabular-nums"
          />
        )}
      </Field>
      {detailedCents > 0 && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-sm" aria-live="polite" data-invoice-breakdown="">
          <dt className="text-muted-foreground">Compras cadastradas</dt>
          <dd className="text-right tabular-nums">{formatCents(detailedCents)}</dd>
          {cents !== null && cents > detailedCents && (
            <>
              <dt className="text-muted-foreground">Outros valores da fatura</dt>
              <dd className="text-right tabular-nums" data-invoice-difference="">
                {formatCents(cents - detailedCents)}
              </dd>
            </>
          )}
          {cents !== null && cents < detailedCents && (
            <dt className="col-span-2 text-amber-800" data-invoice-lower="">
              Menor que as compras cadastradas em {formatCents(detailedCents - cents)}. As compras não são alteradas.
            </dt>
          )}
        </dl>
      )}
    </div>
  );
}

type TotalFormProps = {
  target: { invoiceId: string } | { cardId: string; dueMonth: string };
  cardName: string;
  dueDate: CivilDate;
  statedCents: number | null;
  detailedCents: number;
  onSuccess: (message: string) => void;
  onCancel: () => void;
};

function TotalForm({ target, cardName, dueDate, statedCents, detailedCents, onSuccess, onCancel }: TotalFormProps) {
  const [state, action, pending] = useActionState(saveInvoiceTotalAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [total, setTotal] = useState(statedCents !== null ? formatCentsForInput(statedCents) : "");
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate data-invoice-form="total">
      <DialogHeader>
        <DialogTitle>Fatura do cartão</DialogTitle>
        <DialogDescription>
          {cardName} · vence em {formatCivilDate(dueDate)}
        </DialogDescription>
      </DialogHeader>
      {"invoiceId" in target ? (
        <input type="hidden" name="invoiceId" value={target.invoiceId} />
      ) : (
        <>
          <input type="hidden" name="cardId" value={target.cardId} />
          <input type="hidden" name="dueMonth" value={target.dueMonth} />
        </>
      )}
      <TotalField value={total} onChange={setTotal} detailedCents={detailedCents} error={errors?.total} hint={"invoiceId" in target ? "Em branco = tira o cartão deste mês." : undefined} />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

function PayForm({ invoice, today, onSuccess, onCancel }: { invoice: InvoiceSummary; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(payInvoiceAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [total, setTotal] = useState(invoice.statedCents !== null ? formatCentsForInput(invoice.statedCents) : "");
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate data-invoice-form="pagar">
      <DialogHeader>
        <DialogTitle>Marcar como paga</DialogTitle>
        <DialogDescription>
          {invoice.cardName} · vence em {formatCivilDate(invoice.dueDate)}
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="invoiceId" value={invoice.id} />
      <TotalField value={total} onChange={setTotal} detailedCents={invoice.detailedCents} error={errors?.total} />
      <Field id="invoice-pay-date" label="Data do pagamento" error={errors?.paidOn}>
        {(describedBy, invalid) => (
          <Input id="invoice-pay-date" name="paidOn" type="date" required min={MIN_DATE} max={today} defaultValue={values?.paidOn ?? today} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : "Confirmar pagamento"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Fatura já paga: o total não muda sem voltar para a pagar. */
function PaidSummary({ invoice, onCancel, onAskUnpay }: { invoice: InvoiceSummary; onCancel: () => void; onAskUnpay?: (invoice: InvoiceSummary) => void }) {
  return (
    <div className="flex flex-col gap-4" data-invoice-form="paga">
      <DialogHeader>
        <DialogTitle>Fatura do cartão</DialogTitle>
        <DialogDescription>
          {invoice.cardName} · vence em {formatCivilDate(invoice.dueDate)}
        </DialogDescription>
      </DialogHeader>
      <p className="text-sm">
        Paga em {formatCivilDate(invoice.paidOn ?? invoice.dueDate)}: <span className="font-semibold tabular-nums">{formatCents(invoice.totalCents)}</span>. Para alterar o total, volte para a pagar.
      </p>
      <DialogFooter className="sm:justify-between">
        {onAskUnpay ? (
          <Button type="button" variant="ghost" className="h-10 px-3" onClick={() => onAskUnpay(invoice)}>
            <Undo2 aria-hidden="true" />
            Voltar para a pagar
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Fechar
        </Button>
      </DialogFooter>
    </div>
  );
}
