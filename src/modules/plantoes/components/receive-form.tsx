"use client";

import { useActionState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { receiveShiftAction, type ActionState } from "../actions";
import { MIN_DATE } from "../domain/schemas";
import type { PlShift } from "../types";

const initial: ActionState = { status: "idle" };

/** Recebimento integral: data obrigatória até hoje; pode ser antecipado (não marca realização). */
export function ReceiveForm({ shift, today, onSuccess, onCancel }: { shift: PlShift; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(receiveShiftAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Registrar recebimento</DialogTitle>
        <DialogDescription>
          Plantão de {formatCivilDate(shift.date)} · valor integral {formatCents(shift.amountCents)}. Pagamento parcial não existe nesta versão. Registrar o recebimento não marca o plantão como realizado.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={shift.id} />
      <Field id="receive-date" label="Data do recebimento" error={errors?.receivedOn} hint="Hoje ou uma data anterior.">
        {(d, i) => <Input id="receive-date" name="receivedOn" type="date" min={MIN_DATE} max={today} defaultValue={values?.receivedOn ?? today} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
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
