"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCentsForInput, parseBrlToCents } from "@/lib/money";
import { CnpjField, CnpjTaxNote } from "@/modules/cnpj/components/cnpj-field";
import type { CnpjOption } from "@/modules/cnpj/types";
import type { ActionState } from "@/modules/financas/actions";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { selectClass } from "@/modules/financas/components/series-fields";
import { saveExamAction } from "../actions";
import { MAX_DATE, MIN_DATE, NOTES_MAX } from "../domain/schemas";
import type { PerCompany, PerExam } from "../types";

const initial: ActionState = { status: "idle" };

/** Campos da perícia mantidos pela tela, para sobreviver à ida e volta ao cadastro de empresa. */
export type ExamDraft = {
  companyId: string;
  date: string;
  time: string;
  amount: string;
  notes: string;
  /** O valor acompanha o padrão da empresa escolhida até ser digitado (só na criação). */
  amountAuto: boolean;
  /** Id do CNPJ marcado em "Recebo por CNPJ"; "" = sem CNPJ. */
  cnpjId: string;
  /** A marcação acompanha o padrão da empresa escolhida até ser alterada (só na criação). */
  cnpjAuto: boolean;
};

type Props = {
  companies: PerCompany[];
  /** Edição; sem ela, criação. */
  exam: PerExam | null;
  draft: ExamDraft;
  onDraft: (draft: ExamDraft) => void;
  /** CNPJs cadastrados, para a marcação "Recebo por CNPJ". */
  cnpjs: CnpjOption[];
  onNewCompany: () => void;
  onSuccess: (m: string) => void;
  onCancel: () => void;
};

/**
 * Perícia: empresa, data, horário, valor e "Recebo por CNPJ" (copiados do padrão da empresa e ajustáveis)
 * e observação. Marcada por CNPJ, mostra na hora o imposto estimado e o mês em que é pago.
 */
export function ExamForm({ companies, exam, draft, onDraft, cnpjs, onNewCompany, onSuccess, onCancel }: Props) {
  const [state, action, pending] = useActionState(saveExamAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [requestId] = useState(() => crypto.randomUUID());
  // Empresas ativas; na edição, também a empresa atual (mesmo arquivada).
  const options = companies.filter((c) => !c.archived || c.id === exam?.companyId);
  const set = (patch: Partial<ExamDraft>) => onDraft({ ...draft, ...patch });

  const submitting = useRef(false);
  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state]);

  const company = companies.find((c) => c.id === draft.companyId);
  const amount = draft.amountAuto && company && !exam ? formatCentsForInput(company.defaultAmountCents) : draft.amount;
  const parsed = parseBrlToCents(amount);
  const cnpjId = draft.cnpjAuto && company && !exam ? (company.cnpjId ?? "") : draft.cnpjId;
  // No mesmo CNPJ da perícia vale a alíquota gravada nela; marcado ou trocado agora, o percentual atual do CNPJ.
  const rateBp = exam && exam.cnpjId === cnpjId ? exam.taxRateBp : (cnpjs.find((c) => c.id === cnpjId)?.taxRateBp ?? null);

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
      data-exam-form=""
    >
      <DialogHeader>
        <DialogTitle>{exam ? "Editar perícia" : "Nova perícia"}</DialogTitle>
        <DialogDescription className="sr-only">{exam ? "Dados desta perícia." : "Dados da nova perícia."}</DialogDescription>
      </DialogHeader>
      {exam && <input type="hidden" name="id" value={exam.id} />}
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-col gap-1.5">
        <Field id="exam-company" label="Empresa" error={errors?.companyId}>
          {(d, i) => (
            <select
              id="exam-company"
              name="companyId"
              value={draft.companyId}
              onChange={(e) => {
                // Criação: valor e CNPJ passam a acompanhar o padrão da empresa escolhida. Edição: os da perícia são preservados.
                set({ companyId: e.target.value, amountAuto: !exam, cnpjAuto: !exam });
              }}
              aria-invalid={i || undefined}
              aria-describedby={d}
              className={selectClass}
            >
              <option value="" disabled>
                Escolha a empresa
              </option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Button type="button" variant="ghost" className="h-10 w-fit px-2" onClick={onNewCompany} data-new-company="">
          <Plus aria-hidden="true" />
          Cadastrar empresa
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="exam-date" label="Data" error={errors?.date}>
          {(d, i) => <Input id="exam-date" name="date" type="date" min={MIN_DATE} max={MAX_DATE} value={draft.date} onChange={(e) => set({ date: e.target.value })} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
        </Field>
        <Field id="exam-time" label="Horário" error={errors?.time}>
          {(d, i) => <Input id="exam-time" name="time" type="time" value={draft.time} onChange={(e) => set({ time: e.target.value })} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
        </Field>
      </div>
      <Field id="exam-amount" label="Valor desta perícia (R$)" error={errors?.amount}>
        {(d, i) => (
          <Input
            id="exam-amount"
            name="amount"
            inputMode="decimal"
            placeholder="0,00"
            autoComplete="off"
            value={amount}
            onChange={(e) => set({ amount: e.target.value, amountAuto: false })}
            aria-invalid={i || undefined}
            aria-describedby={d}
            className="h-10 tabular-nums"
          />
        )}
      </Field>
      <CnpjField idPrefix="exam" options={cnpjs} value={cnpjId} onChange={(id) => set({ cnpjId: id, cnpjAuto: false })} error={errors?.cnpjId} />
      <div aria-live="polite">{parsed.ok && cnpjId !== "" && rateBp !== null && <CnpjTaxNote amountCents={parsed.cents} rateBp={rateBp} workDate={draft.date} />}</div>
      <Field id="exam-notes" label="Observação" optional error={errors?.notes}>
        {(d, i) => <Textarea id="exam-notes" name="notes" rows={2} maxLength={NOTES_MAX * 2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} aria-invalid={i || undefined} aria-describedby={d} />}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : exam ? "Salvar" : "Agendar perícia"}
        </Button>
      </DialogFooter>
    </form>
  );
}
