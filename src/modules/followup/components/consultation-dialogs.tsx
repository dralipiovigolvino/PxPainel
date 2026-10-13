"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { consultationNotesAction, saveCentralAttendanceAction, saveConsultationAction, type ActionState } from "../actions";
import { CONSULT_NOTES_MAX, MIN_CONSULT_DATE, PATIENT_NAME_MAX } from "../domain/schemas";
import type { FuConsultation, FuPatient, FuTemplate } from "../types";
import { PlanPreview, TemplateSelect } from "./plan-dialogs";
import { selectClass } from "@/modules/financas/components/series-fields";

const initial: ActionState = { status: "idle" };

function Footer({ pending, label, onCancel }: { pending: boolean; label: string; onCancel: () => void }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="submit" disabled={pending} className="h-10 px-4">
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {pending ? "Salvando…" : label}
      </Button>
    </DialogFooter>
  );
}

type CreateProps = { patientId: string; patientName: string; templates: FuTemplate[]; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void };

/** Registrar consulta REALIZADA (hoje ou retroativa) e, opcionalmente, aplicar um modelo na mesma operação. */
export function ConsultationCreateForm({ patientId, patientName, templates, today, onSuccess, onCancel }: CreateProps) {
  const [state, action, pending] = useActionState(saveConsultationAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  // Idempotência: um id por formulário aberto (duplo envio não cria outra consulta nem outro plano).
  const [requestId] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(values?.consultDate ?? today);
  const [templateId, setTemplateId] = useState(values?.templateId ?? "");
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
      <DialogHeader>
        <DialogTitle>Registrar consulta</DialogTitle>
        <DialogDescription>Consulta já realizada, hoje ou antes.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="requestId" value={requestId} />
      <Field id="consult-date" label="Data da consulta" error={errors?.consultDate}>
        {(describedBy, invalid) => (
          <Input id="consult-date" name="consultDate" type="date" min={MIN_CONSULT_DATE} max={today} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <Field id="consult-notes" label="Observação" optional error={errors?.notes}>
        {(describedBy, invalid) => <Textarea id="consult-notes" name="notes" rows={3} maxLength={CONSULT_NOTES_MAX * 2} defaultValue={values?.notes ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} />}
      </Field>
      <TemplateSelect id="consult-template" templates={templates} value={templateId} onChange={setTemplateId} error={errors?.templateId} optional />
      <PlanPreview template={templates.find((t) => t.id === templateId)} consultDate={date} patientName={patientName} />
      <FormError state={state} />
      <Footer pending={pending} label={templateId ? "Registrar e gerar acompanhamento" : "Registrar consulta"} onCancel={onCancel} />
    </form>
  );
}

export function CentralAttendanceForm({ patients, templates, today, onSuccess, onCancel }: { patients: FuPatient[]; templates: FuTemplate[]; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(saveCentralAttendanceAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const [requestId] = useState(() => crypto.randomUUID());
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const active = patients.filter((p) => !p.archived);
  const [mode, setMode] = useState<"existing" | "new">(values?.patientMode === "new" || active.length === 0 ? "new" : "existing");
  const [date, setDate] = useState(values?.consultDate ?? today);
  const [templateId, setTemplateId] = useState(values?.templateId ?? "");
  const selected = active.find((p) => p.id === values?.patientId);
  return <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
    <DialogHeader><DialogTitle>Adicionar atendimento</DialogTitle><DialogDescription>Registre uma consulta realizada. Se o paciente for novo, o cadastro é criado junto.</DialogDescription></DialogHeader>
    <input type="hidden" name="requestId" value={requestId} />
    <input type="hidden" name="patientMode" value={mode} />
    <div className="flex gap-2">{active.length > 0 && <Button type="button" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")}>Paciente cadastrado</Button>}<Button type="button" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")}>Novo paciente</Button></div>
    {mode === "existing" ? <Field id="attendance-patient" label="Paciente" error={errors?.patientId}>{(d, i) => <select id="attendance-patient" name="patientId" defaultValue={values?.patientId ?? (active.length === 1 ? active[0].id : "")} className={selectClass} aria-invalid={i || undefined} aria-describedby={d}><option value="">Escolha o paciente</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field> : <div className="grid gap-4 sm:grid-cols-2"><Field id="attendance-name" label="Nome" error={errors?.name}>{(d, i) => <Input id="attendance-name" name="name" maxLength={PATIENT_NAME_MAX * 2} defaultValue={values?.name ?? ""} aria-invalid={i || undefined} aria-describedby={d} />}</Field><Field id="attendance-phone" label="Telefone" optional error={errors?.phone}>{(d, i) => <Input id="attendance-phone" name="phone" inputMode="tel" defaultValue={values?.phone ?? ""} aria-invalid={i || undefined} aria-describedby={d} />}</Field></div>}
    <Field id="attendance-date" label="Data do atendimento" error={errors?.consultDate}>{(d, i) => <Input id="attendance-date" name="consultDate" type="date" min={MIN_CONSULT_DATE} max={today} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} />}</Field>
    <Field id="attendance-notes" label="Observação" optional error={errors?.notes}>{(d, i) => <Textarea id="attendance-notes" name="notes" rows={3} maxLength={CONSULT_NOTES_MAX * 2} defaultValue={values?.notes ?? ""} aria-invalid={i || undefined} aria-describedby={d} />}</Field>
    <TemplateSelect id="attendance-template" templates={templates} value={templateId} onChange={setTemplateId} error={errors?.templateId} optional />
    <PlanPreview template={templates.find((t) => t.id === templateId)} consultDate={date} patientName={mode === "new" ? (values?.name ?? "Paciente") : (selected?.name ?? "Paciente")} />
    <FormError state={state} /><Footer pending={pending} label="Registrar atendimento" onCancel={onCancel} />
  </form>;
}

export function ConsultationNotesForm({ consultation, onSuccess, onCancel }: { consultation: FuConsultation; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(consultationNotesAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Observação da consulta</DialogTitle>
        <DialogDescription>Consulta de {formatCivilDate(consultation.consultDate)}.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={consultation.id} />
      <Field id="consult-notes-edit" label="Observação" optional error={errors?.notes}>
        {(describedBy, invalid) => (
          <Textarea id="consult-notes-edit" name="notes" rows={4} maxLength={CONSULT_NOTES_MAX * 2} defaultValue={values?.notes ?? consultation.notes ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
        )}
      </Field>
      <FormError state={state} />
      <Footer pending={pending} label="Salvar" onCancel={onCancel} />
    </form>
  );
}
