"use client";

import { useActionState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { savePatientAction, type ActionState } from "../actions";
import { formatPhone, PHONE_HINT } from "../domain/phone";
import { PATIENT_NAME_MAX, PATIENT_NOTES_MAX } from "../domain/schemas";
import type { FuPatient } from "../types";

const initial: ActionState = { status: "idle" };

type Props = { open: boolean; onOpenChange: (open: boolean) => void; patient: FuPatient | null; onSuccess: (message: string) => void };

export function PatientFormDialog({ open, onOpenChange, patient, onSuccess }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{open && <PatientForm patient={patient} onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function PatientForm({ patient, onSuccess, onCancel }: { patient: FuPatient | null; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(savePatientAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate autoComplete="off">
      <DialogHeader>
        <DialogTitle>{patient ? "Editar paciente" : "Novo paciente"}</DialogTitle>
        <DialogDescription className="sr-only">Dados do paciente.</DialogDescription>
      </DialogHeader>
      {patient && <input type="hidden" name="id" value={patient.id} />}
      <Field id="patient-name" label="Nome" error={errors?.name}>
        {(describedBy, invalid) => (
          <Input id="patient-name" name="name" maxLength={PATIENT_NAME_MAX * 2} defaultValue={values?.name ?? patient?.name ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <Field id="patient-phone" label="WhatsApp" optional error={errors?.phone} hint={PHONE_HINT}>
        {(describedBy, invalid) => (
          <Input
            id="patient-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            maxLength={40}
            defaultValue={values?.phone ?? formatPhone(patient?.phone ?? null)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>
      <Field id="patient-notes" label="Observação" optional error={errors?.notes}>
        {(describedBy, invalid) => (
          <Textarea id="patient-notes" name="notes" rows={3} maxLength={PATIENT_NOTES_MAX * 2} defaultValue={values?.notes ?? patient?.notes ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
        )}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : patient ? "Salvar" : "Cadastrar paciente"}
        </Button>
      </DialogFooter>
    </form>
  );
}
