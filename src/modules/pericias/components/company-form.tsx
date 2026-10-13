"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCentsForInput } from "@/lib/money";
import { CnpjField } from "@/modules/cnpj/components/cnpj-field";
import type { CnpjOption } from "@/modules/cnpj/types";
import type { ActionState } from "@/modules/financas/actions";
import { Field, FormError } from "@/modules/financas/components/form-bits";
import { saveCompanyAction } from "../actions";
import { COMPANY_NAME_MAX } from "../domain/schemas";
import type { PerCompany } from "../types";

const initial: ActionState = { status: "idle" };

type Props = {
  company: PerCompany | null;
  /** CNPJs cadastrados, para a marcação "Recebo por CNPJ". */
  cnpjs: CnpjOption[];
  /** `id` = empresa criada (para o formulário de perícia selecioná-la). */
  onSuccess: (message: string, id?: string) => void;
  onCancel: () => void;
  /** Texto do botão de voltar quando aberto a partir do formulário de perícia. */
  cancelLabel?: string;
};

/** Empresa: nome, valor padrão por perícia e se as perícias dela são recebidas por CNPJ. */
export function CompanyForm({ company, cnpjs, onSuccess, onCancel, cancelLabel = "Cancelar" }: Props) {
  const [state, action, pending] = useActionState(saveCompanyAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.status === "success") onSuccess(state.message, state.id);
    if (state.status === "error") formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [state, onSuccess]);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [cnpjId, setCnpjId] = useState(values?.cnpjId ?? company?.cnpjId ?? "");

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate data-company-form="">
      <DialogHeader>
        <DialogTitle>{company ? "Editar empresa" : "Nova empresa"}</DialogTitle>
        <DialogDescription>
          O valor e a marcação de CNPJ são copiados para cada perícia nova e podem ser ajustados nela.{company && " Alterar aqui não muda perícias já cadastradas."}
        </DialogDescription>
      </DialogHeader>
      {company && <input type="hidden" name="id" value={company.id} />}
      <Field id="company-name" label="Nome da empresa" error={errors?.name}>
        {(d, i) => <Input id="company-name" name="name" maxLength={COMPANY_NAME_MAX * 2} autoComplete="off" defaultValue={values?.name ?? company?.name ?? ""} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
      </Field>
      <Field id="company-amount" label="Valor padrão por perícia (R$)" error={errors?.amount}>
        {(d, i) => (
          <Input
            id="company-amount"
            name="amount"
            inputMode="decimal"
            placeholder="0,00"
            autoComplete="off"
            defaultValue={values?.amount ?? (company ? formatCentsForInput(company.defaultAmountCents) : "")}
            aria-invalid={i || undefined}
            aria-describedby={d}
            className="h-10 tabular-nums"
          />
        )}
      </Field>
      <CnpjField idPrefix="company" options={cnpjs} value={cnpjId} onChange={setCnpjId} error={errors?.cnpjId} />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : company ? "Salvar" : "Cadastrar empresa"}
        </Button>
      </DialogFooter>
    </form>
  );
}
