"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { selectClass } from "@/modules/financas/components/series-fields";
import {
  applyTemplateAction,
  cancelPlanAction,
  consultationDateAction,
  previewDateCorrectionAction,
  previewReplacementAction,
  replacePendingAction,
  type ActionState,
} from "../actions";
import { renderMessage, stepLabel } from "../domain/messages";
import { endDateOf } from "../domain/deadline";
import { buildSteps } from "../domain/plan";
import { MIN_CONSULT_DATE, REASON_MAX } from "../domain/schemas";
import type { DateCorrectionSummary, ReplacementSummary } from "../plans-data";
import type { FuConsultation, FuPlan, FuTemplate } from "../types";

const initial: ActionState = { status: "idle" };

function Footer({ pending, label, onCancel, disabled, variant }: { pending: boolean; label: string; onCancel: () => void; disabled?: boolean; variant?: "destructive" }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
        Cancelar
      </Button>
      <Button type="submit" disabled={pending || disabled} variant={variant ?? "default"} className="h-10 px-4">
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        {label}
      </Button>
    </DialogFooter>
  );
}

export function TemplateSelect({ id, templates, value, onChange, error, optional }: { id: string; templates: FuTemplate[]; value: string; onChange: (v: string) => void; error?: string; optional?: boolean }) {
  const usable = templates.filter((t) => !t.archived && t.steps.length > 0);
  return (
    <Field id={id} label="Modelo de acompanhamento" optional={optional} error={error} hint={usable.length === 0 ? "Crie um modelo na aba Modelos." : undefined}>
      {(describedBy, invalid) => (
        <select id={id} name="templateId" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={selectClass}>
          <option value="">{optional ? "Sem acompanhamento por enquanto" : "Escolha o modelo"}</option>
          {usable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.steps.map((s) => stepLabel(s.dayOffset)).join(", ")})
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Prévia calculada no navegador com as MESMAS funções puras do servidor (etapa, data, mensagem). */
export function PlanPreview({ template, consultDate, patientName }: { template: FuTemplate | undefined; consultDate: string; patientName: string }) {
  if (!template || !/^\d{4}-\d{2}-\d{2}$/.test(consultDate)) return null;
  const steps = buildSteps(consultDate, template.steps);
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3 text-sm" data-plan-preview="">
      <p className="font-medium">
        Prévia: {steps.length === 1 ? "1 etapa" : `${steps.length} etapas`} a partir da consulta de {formatCivilDate(consultDate)}
      </p>
      <p className="rounded-md bg-card px-2.5 py-2" data-plan-end="">
        {template.durationDays === null
          ? "Este modelo não tem duração definida: o acompanhamento não terá aviso de término (dá para definir depois)."
          : `Término do acompanhamento: ${formatCivilDate(endDateOf(consultDate, template.durationDays))} (D${template.durationDays}); aviso ${template.noticeDays === 0 ? "só no último dia" : `${template.noticeDays} dia(s) antes`}.`}
      </p>
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.dayOffset} className="rounded-md bg-card px-2.5 py-2">
            <p className="font-medium tabular-nums">
              {stepLabel(s.dayOffset)} · {formatCivilDate(s.dueDate)}
            </p>
            <p className="break-words whitespace-pre-wrap text-muted-foreground">{renderMessage(s.message, { patientName, consultDate, dayOffset: s.dayOffset })}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ApplyTemplateForm({
  consultation,
  templates,
  patientName,
  onSuccess,
  onCancel,
}: {
  consultation: FuConsultation;
  templates: FuTemplate[];
  patientName: string;
  onSuccess: (m: string) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(applyTemplateAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [templateId, setTemplateId] = useState("");
  // Um id por formulário aberto: reenvio/duplo clique não gera outro plano.
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Aplicar modelo</DialogTitle>
        <DialogDescription>Consulta de {formatCivilDate(consultation.consultDate)}. As etapas são copiadas: mudar o modelo depois não altera este acompanhamento.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="consultationId" value={consultation.id} />
      <input type="hidden" name="requestId" value={requestId} />
      <TemplateSelect id="apply-template" templates={templates} value={templateId} onChange={setTemplateId} error={errors?.templateId} />
      <PlanPreview template={templates.find((t) => t.id === templateId)} consultDate={consultation.consultDate} patientName={patientName} />
      <FormError state={state} />
      <Footer pending={pending} label="Gerar acompanhamento" onCancel={onCancel} disabled={!templateId} />
    </form>
  );
}

/** Prévia do servidor por chave; enquanto a resposta da chave atual não chega: "loading". */
function useServerPreview<T>(key: string | null, load: () => Promise<T>): T | "loading" | null {
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  useEffect(() => {
    if (!key) return;
    let active = true;
    const timer = setTimeout(() => {
      loader.current().then((value) => active && setResult({ key, value }));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key]);
  if (!key) return null;
  return result?.key === key ? result.value : "loading";
}

const Loading = () => (
  <p className="flex items-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Calculando a prévia…
  </p>
);

const offsets = (list: Array<{ dayOffset: number }>) => list.map((s) => stepLabel(s.dayOffset)).join(", ");

export function ReplaceForm({ consultation, templates, onSuccess, onCancel }: { consultation: FuConsultation; templates: FuTemplate[]; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(replacePendingAction, initial);
  useActionOutcome(state, onSuccess);
  const [templateId, setTemplateId] = useState("");
  const preview = useServerPreview<ReplacementSummary | { error: string }>(templateId ? `${consultation.id}:${templateId}` : null, () => previewReplacementAction(consultation.id, templateId));
  const ready = preview !== null && preview !== "loading" && !("error" in preview);
  const empty = ready && preview.remove.length === 0 && preview.add.length === 0;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Substituir etapas pendentes</DialogTitle>
        <DialogDescription>
          Consulta de {formatCivilDate(consultation.consultDate)}. Realizadas e pendentes personalizadas (remarcadas ou com texto ajustado) são mantidas; as substituídas ficam no histórico.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="consultationId" value={consultation.id} />
      <TemplateSelect id="replace-template" templates={templates} value={templateId} onChange={setTemplateId} />
      {preview === "loading" && <Loading />}
      {preview !== null && preview !== "loading" && "error" in preview && <p className="text-sm text-destructive">{preview.error}</p>}
      {ready && (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-replace-preview="">
          <p>
            <strong>Removidas (substituídas):</strong> {preview.remove.length ? offsets(preview.remove) : "nenhuma"}
          </p>
          <p>
            <strong>Mantidas:</strong> {preview.preserve.length ? preview.preserve.map((s) => `${stepLabel(s.dayOffset)} (${s.status === "realizado" ? "realizada" : "personalizada"})`).join(", ") : "nenhuma"}
          </p>
          <p>
            <strong>Incluídas:</strong> {preview.add.length ? preview.add.map((s) => `${stepLabel(s.dayOffset)} em ${formatCivilDate(s.dueDate)}`).join(", ") : "nenhuma"}
          </p>
          {preview.skipped.length > 0 && <p className="text-muted-foreground">Não recriadas por já existirem: {preview.skipped.map(stepLabel).join(", ")}.</p>}
          {empty && <p className="text-muted-foreground">Nada a substituir com este modelo.</p>}
        </div>
      )}
      <FormError state={state} />
      <Footer pending={pending} label="Confirmar substituição" onCancel={onCancel} disabled={!ready || empty} />
    </form>
  );
}

export function DateCorrectionForm({ consultation, today, onSuccess, onCancel }: { consultation: FuConsultation; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(consultationDateAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [date, setDate] = useState(consultation.consultDate);
  const changed = /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== consultation.consultDate;
  const preview = useServerPreview<DateCorrectionSummary | { error: string } | null>(changed ? `${consultation.id}:${date}` : null, () => previewDateCorrectionAction(consultation.id, date));
  const ready = preview !== null && preview !== "loading" && !("error" in preview);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Corrigir data da consulta</DialogTitle>
        <DialogDescription>Registrada como {formatCivilDate(consultation.consultDate)}. Veja o impacto antes de confirmar; nada muda até lá.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={consultation.id} />
      <Field id="consult-date-fix" label="Data correta" error={errors?.consultDate}>
        {(describedBy, invalid) => (
          <Input id="consult-date-fix" name="consultDate" type="date" min={MIN_CONSULT_DATE} max={today} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      {preview === "loading" && <Loading />}
      {preview !== null && preview !== "loading" && "error" in preview && <p className="text-sm text-destructive">{preview.error}</p>}
      {ready && preview && (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-date-preview="">
          {!preview.hasPlan ? (
            <p>Esta consulta não tem acompanhamento: só a data muda.</p>
          ) : (
            <>
              <p>
                <strong>Recalculadas:</strong>{" "}
                {preview.shift.length ? preview.shift.map((s) => `${stepLabel(s.dayOffset)} ${formatCivilDate(s.from)} → ${formatCivilDate(s.to)}`).join("; ") : "nenhuma"}
              </p>
              {preview.keepRescheduled.length > 0 && (
                <p>
                  <strong>Mantidas (remarcadas por você):</strong> {preview.keepRescheduled.map((s) => `${stepLabel(s.dayOffset)} em ${formatCivilDate(s.dueDate)}`).join(", ")}
                </p>
              )}
              {preview.keepDone.length > 0 && (
                <p>
                  <strong>Realizadas, preservadas:</strong> {offsets(preview.keepDone)}
                </p>
              )}
            </>
          )}
        </div>
      )}
      <FormError state={state} />
      <Footer pending={pending} label="Confirmar correção" onCancel={onCancel} disabled={!ready} />
    </form>
  );
}

export function CancelPlanForm({ plan, onSuccess, onCancel }: { plan: FuPlan; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(cancelPlanAction, initial);
  useActionOutcome(state, onSuccess);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const pendingCount = plan.steps.filter((s) => s.status === "pendente").length;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Cancelar este acompanhamento?</DialogTitle>
        <DialogDescription>
          {pendingCount === 1 ? "1 etapa pendente será cancelada" : `${pendingCount} etapas pendentes serão canceladas`}. Realizadas são mantidas. O acompanhamento cancelado continua no histórico e não pode ser reativado.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={plan.id} />
      <Field id="plan-cancel-reason" label="Motivo" optional error={errors?.reason}>
        {(describedBy, invalid) => <Input id="plan-cancel-reason" name="reason" maxLength={REASON_MAX * 2} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />}
      </Field>
      <FormError state={state} />
      <Footer pending={pending} label="Cancelar acompanhamento" onCancel={onCancel} variant="destructive" />
    </form>
  );
}
