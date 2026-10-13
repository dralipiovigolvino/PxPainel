"use client";

import { useActionState, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCnpj } from "@/lib/cnpj";
import { formatCents } from "@/lib/money";
import { estimateTax, formatRate, formatRateForInput, parseRate } from "@/lib/tax";
import type { ActionState } from "@/modules/financas/actions";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { saveCnpjAction } from "../actions";
import { CNPJ_ABBREVIATION_MAX, CNPJ_NAME_MAX } from "../domain/schemas";
import { DEFAULT_TAX_DUE_DAY } from "../domain/tax";
import type { Cnpj } from "../types";

const initial: ActionState = { status: "idle" };
const EXAMPLE_CENTS = 100_000;

type Props = {
  /** Edição; sem ele, cadastro. */
  cnpj: Cnpj | null;
  /** Percentual sugerido para um CNPJ novo. */
  suggestedRateBp: number;
  /** Nome do mês corrente (ex.: "outubro"): o percentual alterado vale para o trabalho dele em diante. */
  currentMonth: string;
  onSuccess: (message: string) => void;
  onCancel: () => void;
};

/** CNPJ: nome, número (opcional), estimativa de imposto e dia do pagamento no mês seguinte ao trabalho. */
export function CnpjForm({ cnpj, suggestedRateBp, currentMonth, onSuccess, onCancel }: Props) {
  const [state, action, pending] = useActionState(saveCnpjAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [rate, setRate] = useState(values?.taxRate ?? formatRateForInput(cnpj?.taxRateBp ?? suggestedRateBp));
  const parsed = parseRate(rate);
  const example = parsed.ok ? estimateTax(EXAMPLE_CENTS, parsed.rateBp) : null;
  const rateChanged = Boolean(cnpj) && parsed.ok && parsed.rateBp !== cnpj?.taxRateBp;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate data-cnpj-form="">
      <DialogHeader>
        <DialogTitle>{cnpj ? "Editar CNPJ" : "Novo CNPJ"}</DialogTitle>
        <DialogDescription>O percentual é usado para estimar o imposto dos plantões e das perícias marcados como recebidos por este CNPJ.</DialogDescription>
      </DialogHeader>
      {cnpj && <input type="hidden" name="id" value={cnpj.id} />}
      <Field id="cnpj-name" label="Nome" error={errors?.name} hint="Razão social ou um apelido.">
        {(d, i) => <Input id="cnpj-name" name="name" maxLength={CNPJ_NAME_MAX * 2} autoComplete="off" defaultValue={values?.name ?? cnpj?.name ?? ""} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
      </Field>
      <Field id="cnpj-abbreviation" label="Abreviação" error={errors?.abbreviation} hint="Nome curto exibido nos seletores.">
        {(d, i) => <Input id="cnpj-abbreviation" name="abbreviation" maxLength={CNPJ_ABBREVIATION_MAX * 2} autoComplete="off" defaultValue={values?.abbreviation ?? cnpj?.abbreviation ?? ""} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
      </Field>
      <Field id="cnpj-number" label="CNPJ" optional error={errors?.number}>
        {(d, i) => (
          <Input
            id="cnpj-number"
            name="number"
            placeholder="00.000.000/0000-00"
            autoComplete="off"
            maxLength={24}
            defaultValue={values?.number ?? (cnpj?.number ? formatCnpj(cnpj.number) : "")}
            aria-invalid={i || undefined}
            aria-describedby={d}
            className="h-10 tabular-nums"
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cnpj-rate" label="Imposto estimado (%)" error={errors?.taxRate}>
          {(d, i) => (
            <Input id="cnpj-rate" name="taxRate" inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10 tabular-nums" />
          )}
        </Field>
        <Field id="cnpj-due-day" label="Dia do pagamento do imposto" error={errors?.taxDueDay} hint="No mês seguinte ao do trabalho.">
          {(d, i) => (
            <Input
              id="cnpj-due-day"
              name="taxDueDay"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={values?.taxDueDay ?? String(cnpj?.taxDueDay ?? DEFAULT_TAX_DUE_DAY)}
              aria-invalid={i || undefined}
              aria-describedby={d}
              className="h-10 tabular-nums"
            />
          )}
        </Field>
      </div>
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm" aria-live="polite" data-cnpj-example="">
        {example && parsed.ok
          ? `Com ${formatRate(parsed.rateBp)}: ${formatCents(EXAMPLE_CENTS)} recebidos por CNPJ em um mês → ${formatCents(example.taxCents)} de imposto estimado no mês seguinte.`
          : "Use um número de 0 a 100, com vírgula para decimais (ex.: 9 ou 9,5)."}
      </p>
      {rateChanged && (
        <p className="text-sm text-muted-foreground" data-cnpj-rate-change="">
          O novo percentual vale para o trabalho de {currentMonth} em diante. Meses anteriores ficam como estavam.
        </p>
      )}
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : cnpj ? "Salvar" : "Cadastrar CNPJ"}
        </Button>
      </DialogFooter>
    </form>
  );
}
