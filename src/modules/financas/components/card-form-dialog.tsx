"use client";

import { useActionState, useRef } from "react";
import { Archive, ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { archiveCardAction, deleteCardAction, saveCardAction } from "../card-actions";
import type { ActionState } from "../actions";
import { AREA_NAME_MAX } from "../domain/schemas";
import type { FinArea, FinCard } from "../types";
import type { ConfirmRequest } from "./confirm-dialog";
import { Field, FormError, useActionOutcome } from "./form-bits";
import { selectClass } from "./series-fields";

const initial: ActionState = { status: "idle" };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: FinCard | null;
  areas: FinArea[];
  onSuccess: (message: string) => void;
  /** Arquivar, restaurar e excluir pedem confirmação (no lugar deste diálogo). */
  onAskConfirm: (request: ConfirmRequest) => void;
};

export function CardFormDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">{open && <CardForm {...rest} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function CardForm({ card, areas, onSuccess, onAskConfirm, onCancel }: Omit<Props, "open" | "onOpenChange"> & { onCancel: () => void }) {
  // Áreas ativas; na edição, também a padrão atual (mesmo arquivada, para não trocar em silêncio).
  const areaOptions = areas.filter((a) => !a.archived || a.id === card?.defaultAreaId);
  const [state, action, pending] = useActionState(saveCardAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{card ? card.name : "Cadastrar cartão"}</DialogTitle>
        <DialogDescription>Compras até a véspera do fechamento vencem no próximo vencimento; a partir do fechamento, no seguinte.</DialogDescription>
      </DialogHeader>
      {card && <input type="hidden" name="id" value={card.id} />}
      <Field id="card-name" label="Nome" error={errors?.name}>
        {(describedBy, invalid) => (
          <Input id="card-name" name="name" maxLength={AREA_NAME_MAX * 2} autoComplete="off" defaultValue={values?.name ?? card?.name ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field id="card-closing" label="Dia de fechamento" error={errors?.closingDay}>
          {(describedBy, invalid) => (
            <Input id="card-closing" name="closingDay" inputMode="numeric" defaultValue={values?.closingDay ?? card?.closingDay ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
        <Field id="card-due" label="Dia de vencimento" error={errors?.dueDay}>
          {(describedBy, invalid) => (
            <Input id="card-due" name="dueDay" inputMode="numeric" defaultValue={values?.dueDay ?? card?.dueDay ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
      </div>
      <Field id="card-default-area" label="Área das compras" optional error={errors?.defaultAreaId} hint="Vem escolhida em cada compra deste cartão.">
        {(describedBy, invalid) => (
          <select id="card-default-area" name="defaultAreaId" defaultValue={values?.defaultAreaId ?? card?.defaultAreaId ?? ""} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={selectClass}>
            <option value="">Escolher em cada compra</option>
            {areaOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.archived ? " (arquivada)" : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      <input type="hidden" name="notes" value={values?.notes ?? card?.notes ?? ""} />
      <FormError state={state} />
      <DialogFooter className="sm:justify-between">
        {card ? (
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-10 px-3"
              onClick={() =>
                onAskConfirm(
                  card.archived
                    ? { title: "Restaurar cartão?", description: `"${card.name}" volta a aparecer nas formas de pagamento.`, confirmLabel: "Restaurar", action: archiveCardAction, fields: { id: card.id, archive: "false" } }
                    : {
                        title: "Arquivar cartão?",
                        description: `"${card.name}" deixa de aparecer nas formas de pagamento. As compras já lançadas continuam.`,
                        confirmLabel: "Arquivar",
                        action: archiveCardAction,
                        fields: { id: card.id, archive: "true" },
                      },
                )
              }
            >
              {card.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              {card.archived ? "Restaurar" : "Arquivar"}
            </Button>
            {card.links === 0 && (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-3 text-destructive hover:text-destructive"
                onClick={() => onAskConfirm({ title: "Excluir cartão?", description: `"${card.name}" será excluído.`, confirmLabel: "Excluir", destructive: true, action: deleteCardAction, fields: { id: card.id } })}
              >
                <Trash2 aria-hidden="true" />
                Excluir
              </Button>
            )}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending ? "Salvando…" : card ? "Salvar" : "Cadastrar cartão"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
