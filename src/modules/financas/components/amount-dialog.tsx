"use client";

import { useActionState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate } from "@/lib/dates";
import { formatCentsForInput } from "@/lib/money";
import { setAmountAction, type ActionState } from "../actions";
import type { FinEntry } from "../types";
import { Field, FormError, useActionOutcome } from "./form-bits";

const initial: ActionState = { status: "idle" };

type Props = { entry: FinEntry | null; onOpenChange: (open: boolean) => void; onSuccess: (message: string) => void };

/** Informar ou corrigir o valor de uma ocorrência variável. */
export function AmountDialog({ entry, onOpenChange, onSuccess }: Props) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">{entry && <AmountForm entry={entry} onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function AmountForm({ entry, onSuccess, onCancel }: { entry: FinEntry; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(setAmountAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{entry.amountCents === null ? "Informar valor" : "Corrigir valor"}</DialogTitle>
        <DialogDescription>
          {entry.description} · vence em {formatCivilDate(entry.dueDate)}. Vale só para esta conta.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={entry.id} />
      <Field id="amount-value" label="Valor (R$)" error={errors?.amount} hint="Vazio = volta a ficar a informar.">
        {(describedBy, invalid) => (
          <Input
            id="amount-value"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            defaultValue={state.status === "error" ? state.values?.amount : entry.amountCents !== null ? formatCentsForInput(entry.amountCents) : ""}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10 tabular-nums"
          />
        )}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Salvar valor
        </Button>
      </DialogFooter>
    </form>
  );
}
