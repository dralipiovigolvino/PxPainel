"use client";

import { useActionState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { payEntryAction, type ActionState } from "../actions";
import { MIN_DATE } from "../domain/schemas";
import type { FinEntry } from "../types";
import { Field, FormError, useActionOutcome } from "./form-bits";

const initial: ActionState = { status: "idle" };

type Props = {
  entry: FinEntry | null;
  today: CivilDate;
  onOpenChange: (open: boolean) => void;
  onSuccess: (message: string) => void;
};

export function PayDialog({ entry, today, onOpenChange, onSuccess }: Props) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {entry && <PayForm entry={entry} today={today} onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PayForm({ entry, today, onSuccess, onCancel }: { entry: FinEntry; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(payEntryAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Marcar como paga</DialogTitle>
        <DialogDescription>
          {entry.description} · {entry.amountCents === null ? "valor a informar" : formatCents(entry.amountCents)} · vence em {formatCivilDate(entry.dueDate)}
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={entry.id} />
      <Field id="pay-date" label="Data do pagamento" error={errors?.paidOn} hint="Hoje ou uma data anterior.">
        {(describedBy, invalid) => (
          <Input
            id="pay-date"
            name="paidOn"
            type="date"
            required
            min={MIN_DATE}
            max={today}
            defaultValue={values?.paidOn ?? today}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
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
          {pending ? "Salvando…" : "Confirmar pagamento"}
        </Button>
      </DialogFooter>
    </form>
  );
}
