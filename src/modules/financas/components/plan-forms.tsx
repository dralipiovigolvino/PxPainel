"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, parseCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents, parseBrlToCents } from "@/lib/money";
import { saveInstallmentEntryAction, savePlanAction, type ActionState } from "../actions";
import { describeSplit, installmentDates, MAX_INSTALLMENTS, splitCents, validateInstallments } from "../domain/installments";
import type { PaymentMethod } from "../domain/payment";
import { DESCRIPTION_MAX, MAX_DATE, MIN_DATE } from "../domain/schemas";
import type { FinArea, FinEntry } from "../types";
import { AreaChoice, DetailsFields, Field, FormError, PaymentChoice, useActionOutcome } from "./form-bits";

const initial: ActionState = { status: "idle" };

/** Prévia calculada no navegador com a MESMA função pura usada no servidor. */
function SplitPreview({ total, count, firstDue }: { total: string; count: string; firstDue: string }) {
  const parsed = parseBrlToCents(total);
  const n = /^\d{1,3}$/.test(count.trim()) ? Number(count) : NaN;
  if (!parsed.ok || !Number.isInteger(n) || !parseCivilDate(firstDue)) return null;
  const check = validateInstallments(parsed.cents, n);
  if (!check.ok) return <p className="text-sm text-destructive">{check.message}</p>;
  const parts = splitCents(parsed.cents, n);
  const dates = installmentDates(firstDue, n);
  return (
    <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm" aria-live="polite" data-split-preview="">
      {n} parcelas: {describeSplit(parts)}, de {formatCivilDate(dates[0])} a {formatCivilDate(dates[dates.length - 1])}.
    </p>
  );
}

type CreateProps = {
  areas: FinArea[];
  categories: string[];
  defaultAreaId?: string | null;
  defaultDueDate: CivilDate;
  paymentMethod: PaymentMethod;
  onSuccess: (message: string) => void;
  onCancel: () => void;
};

export function PlanCreateForm({ areas, categories, defaultAreaId, defaultDueDate, paymentMethod, onSuccess, onCancel }: CreateProps) {
  const [state, action, pending] = useActionState(savePlanAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  // Idempotência: um id por formulário aberto; reenvios usam o mesmo e não duplicam.
  const [requestId] = useState(() => crypto.randomUUID());
  const activeDefault = defaultAreaId && areas.some((a) => a.id === defaultAreaId && !a.archived) ? defaultAreaId : "";
  const [areaId, setAreaId] = useState(values?.areaId ?? activeDefault);
  const [total, setTotal] = useState(values?.total ?? "");
  const [count, setCount] = useState(values?.count ?? "");
  const [firstDue, setFirstDue] = useState(values?.firstDueDate ?? defaultDueDate);

  // Bloqueia o segundo envio enquanto o primeiro está em andamento (o requestId cobre o resto).
  const submitting = useRef(false);
  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state]);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(event) => {
        if (submitting.current) event.preventDefault();
        submitting.current = true;
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="paymentMethod" value={paymentMethod} />
      <div className="grid grid-cols-3 gap-4">
        <Field id="plan-total" label="Valor total (R$)" error={errors?.total} className="col-span-2">
          {(describedBy, invalid) => (
            <Input id="plan-total" name="total" inputMode="decimal" autoComplete="off" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10 tabular-nums" />
          )}
        </Field>
        <Field id="plan-count" label="Parcelas" error={errors?.count} hint={`2 a ${MAX_INSTALLMENTS}`}>
          {(describedBy, invalid) => (
            <Input id="plan-count" name="count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
      </div>
      <Field id="plan-first-due" label="Primeiro vencimento" error={errors?.firstDueDate}>
        {(describedBy, invalid) => (
          <Input id="plan-first-due" name="firstDueDate" type="date" min={MIN_DATE} max={MAX_DATE} value={firstDue} onChange={(e) => setFirstDue(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <SplitPreview total={total} count={count} firstDue={firstDue} />
      <Field id="plan-description" label="Descrição" error={errors?.description}>
        {(describedBy, invalid) => (
          <Input id="plan-description" name="description" maxLength={DESCRIPTION_MAX * 2} autoComplete="off" defaultValue={values?.description ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <AreaChoice id="plan-area" areas={areas} value={areaId} onChange={setAreaId} error={errors?.areaId} />
      <DetailsFields idPrefix="plan" categories={categories} category={values?.category ?? ""} notes={values?.notes ?? ""} errors={errors} />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Criando…" : "Criar parcelamento"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Edição de parcela: descrição, forma de pagamento, categoria, observação e (pendente) vencimento. */
export function InstallmentEditForm({ entry, area, categories, onSuccess, onCancel }: { entry: FinEntry; area?: FinArea; categories: string[]; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(saveInstallmentEntryAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const pendingEntry = entry.status === "pendente";
  const [method, setMethod] = useState<string>(values?.paymentMethod ?? entry.paymentMethod ?? "");

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          Parcela {entry.installmentNumber} de {entry.installmentCount}
        </DialogTitle>
        <DialogDescription>
          {entry.amountCents !== null ? formatCents(entry.amountCents) : "—"} · {area?.name ?? "—"}. Valor e área são fixos; para mudar, cancele as pendentes em Recorrências.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={entry.id} />
      <Field id="inst-description" label="Descrição" error={errors?.description}>
        {(describedBy, invalid) => (
          <Input id="inst-description" name="description" maxLength={DESCRIPTION_MAX * 2} defaultValue={values?.description ?? entry.description} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <Field id="inst-due" label="Vencimento" error={errors?.dueDate} hint={pendingEntry ? undefined : "Parcela paga: o vencimento não muda."}>
        {(describedBy, invalid) => (
          <Input
            id="inst-due"
            name="dueDate"
            type="date"
            min={MIN_DATE}
            max={MAX_DATE}
            readOnly={!pendingEntry}
            defaultValue={values?.dueDate ?? entry.dueDate}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>
      <PaymentChoice id="inst-payment" value={method} onChange={setMethod} allowEmpty={entry.paymentMethod === null} error={errors?.paymentMethod} />
      <DetailsFields idPrefix="inst" categories={categories} category={values?.category ?? entry.category ?? ""} notes={values?.notes ?? entry.notes ?? ""} errors={errors} />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Salvar parcela
        </Button>
      </DialogFooter>
    </form>
  );
}
