"use client";

import { useActionState, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatCivilDate, type CivilDate } from "@/lib/dates";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { saveTemplateAction, type ActionState } from "../actions";
import { DEFAULT_NOTICE_DAYS } from "../domain/deadline";
import { MESSAGE_MAX, messageError, normalizeMessage, renderMessage, stepLabel, VARIABLES } from "../domain/messages";
import { DurationFields } from "./deadline-bits";
import { MAX_TEMPLATE_STEPS, TEMPLATE_DESCRIPTION_MAX, TEMPLATE_NAME_MAX } from "../domain/schemas";
import type { FuTemplate } from "../types";

const initial: ActionState = { status: "idle" };
/** Dados de exemplo da prévia (fictícios; nunca de um paciente real). */
const SAMPLE_NAME = "Maria Exemplo";

type StepDraft = { key: number; dayOffset: string; message: string };

type Props = { open: boolean; onOpenChange: (open: boolean) => void; template: FuTemplate | null; today: CivilDate; onSuccess: (message: string) => void };

export function TemplateFormDialog({ open, onOpenChange, template, today, onSuccess }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {open && <TemplateForm template={template} today={today} onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function initialSteps(template: FuTemplate | null, submitted?: string): StepDraft[] {
  if (submitted) {
    try {
      const parsed = JSON.parse(submitted) as Array<{ dayOffset: string; message: string }>;
      if (Array.isArray(parsed)) return parsed.map((s, i) => ({ key: i, dayOffset: String(s.dayOffset ?? ""), message: String(s.message ?? "") }));
    } catch {}
  }
  if (template) return template.steps.map((s, i) => ({ key: i, dayOffset: String(s.dayOffset), message: s.message }));
  return [{ key: 0, dayOffset: "", message: "" }];
}

function TemplateForm({ template, today, onSuccess, onCancel }: { template: FuTemplate | null; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(saveTemplateAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [steps, setSteps] = useState<StepDraft[]>(() => initialSteps(template, values?.steps));
  const [duration, setDuration] = useState(values?.durationDays ?? (template?.durationDays != null ? String(template.durationDays) : ""));
  // Aviso sugerido: 7 dias antes do término (editável; só vale quando há duração).
  const [notice, setNotice] = useState(values?.noticeDays ?? String(template?.noticeDays ?? DEFAULT_NOTICE_DAYS));
  const nextKey = useRef(steps.length);
  const textareas = useRef(new Map<number, HTMLTextAreaElement>());

  const update = (key: number, patch: Partial<StepDraft>) => setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (index: number, delta: number) =>
    setSteps((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  const insertVariable = (key: number, label: string) => {
    const el = textareas.current.get(key);
    const current = steps.find((s) => s.key === key)?.message ?? "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    update(key, { message: current.slice(0, start) + label + current.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + label.length, start + label.length);
    });
  };

  const offsets = steps.map((s) => (/^\d{1,4}$/.test(s.dayOffset.trim()) ? Number(s.dayOffset) : null));
  const payload = JSON.stringify(steps.map((s) => ({ dayOffset: s.dayOffset, message: s.message })));

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{template ? "Editar modelo" : "Novo modelo"}</DialogTitle>
        <DialogDescription>
          Cada etapa tem um intervalo em dias após a consulta (D0 = dia da consulta, D1 = dia seguinte) e uma mensagem.
          {template && " Salvar cria uma nova versão; acompanhamentos já gerados não mudam."}
        </DialogDescription>
      </DialogHeader>
      {template && <input type="hidden" name="id" value={template.id} />}
      <input type="hidden" name="steps" value={payload} />
      <Field id="template-name" label="Nome" error={errors?.name}>
        {(describedBy, invalid) => (
          <Input id="template-name" name="name" maxLength={TEMPLATE_NAME_MAX * 2} autoComplete="off" defaultValue={values?.name ?? template?.name ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <Field id="template-description" label="Descrição" optional error={errors?.description}>
        {(describedBy, invalid) => (
          <Textarea id="template-description" name="description" rows={2} maxLength={TEMPLATE_DESCRIPTION_MAX * 2} defaultValue={values?.description ?? template?.description ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
        )}
      </Field>

      <DurationFields
        idPrefix="template"
        duration={duration}
        notice={notice}
        onDuration={setDuration}
        onNotice={setNotice}
        errors={errors}
        stepOffsets={offsets.filter((o): o is number => o !== null)}
        optional
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Etapas</legend>
        {errors?.steps && <p className="text-sm text-destructive">{errors.steps}</p>}
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => {
            const offset = offsets[index];
            const duplicate = offset !== null && offsets.indexOf(offset) !== index;
            const liveError = step.message.trim() === "" ? null : messageError(normalizeMessage(step.message));
            const offsetError = errors?.[`step-${index}-offset`] ?? (duplicate ? `D${offset} já existe neste modelo.` : undefined);
            const msgError = errors?.[`step-${index}-message`] ?? liveError ?? undefined;
            return (
              <li key={step.key} className="flex flex-col gap-2 rounded-lg border p-3" data-template-step="">
                <div className="flex flex-wrap items-end gap-2">
                  <Field id={`step-${step.key}-offset`} label="Dias após a consulta" error={offsetError} className="w-40">
                    {(describedBy, invalid) => (
                      <Input
                        id={`step-${step.key}-offset`}
                        inputMode="numeric"
                        placeholder="Ex.: 7"
                        value={step.dayOffset}
                        onChange={(e) => update(step.key, { dayOffset: e.target.value })}
                        aria-invalid={invalid || undefined}
                        aria-describedby={describedBy}
                        className="h-10"
                        data-step-offset=""
                      />
                    )}
                  </Field>
                  <span className="pb-2.5 text-sm font-medium text-muted-foreground">{offset !== null ? stepLabel(offset) : "D?"}</span>
                  <div className="ml-auto flex gap-1">
                    <Button type="button" variant="ghost" size="icon" className="size-10" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir etapa ${index + 1}`}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="size-10" disabled={index === steps.length - 1} onClick={() => move(index, 1)} aria-label={`Descer etapa ${index + 1}`}>
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-10 text-destructive hover:text-destructive"
                      disabled={steps.length === 1}
                      onClick={() => setSteps((list) => list.filter((s) => s.key !== step.key))}
                      aria-label={`Remover etapa ${index + 1}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <Field id={`step-${step.key}-message`} label="Mensagem" error={msgError}>
                  {(describedBy, invalid) => (
                    <Textarea
                      id={`step-${step.key}-message`}
                      ref={(el) => {
                        if (el) textareas.current.set(step.key, el);
                        else textareas.current.delete(step.key);
                      }}
                      rows={3}
                      maxLength={MESSAGE_MAX * 2}
                      placeholder="Ex.: Olá, {nome}! Como você está desde a consulta de {data_consulta}?"
                      value={step.message}
                      onChange={(e) => update(step.key, { message: e.target.value })}
                      aria-invalid={invalid || undefined}
                      aria-describedby={describedBy}
                      data-step-message=""
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-1.5" aria-label="Inserir variável">
                  {VARIABLES.map((v) => (
                    <Button key={v.key} type="button" variant="outline" className="h-8 px-2 text-xs" title={v.help} onClick={() => insertVariable(step.key, v.label)}>
                      {v.label}
                    </Button>
                  ))}
                </div>
                {step.message.trim() !== "" && !liveError && offset !== null && (
                  <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm" data-step-preview="">
                    <p className="text-xs text-muted-foreground">
                      Prévia com dados de exemplo · consulta {formatCivilDate(today)} → {stepLabel(offset)} em {formatCivilDate(addDays(today, offset))}
                    </p>
                    <p className="mt-1 break-words whitespace-pre-wrap">{renderMessage(normalizeMessage(step.message), { patientName: SAMPLE_NAME, consultDate: today, dayOffset: offset })}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-fit px-3"
          disabled={steps.length >= MAX_TEMPLATE_STEPS}
          onClick={() => setSteps((list) => [...list, { key: nextKey.current++, dayOffset: "", message: "" }])}
        >
          <Plus aria-hidden="true" />
          Adicionar etapa
        </Button>
      </fieldset>

      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : template ? "Salvar nova versão" : "Criar modelo"}
        </Button>
      </DialogFooter>
    </form>
  );
}
