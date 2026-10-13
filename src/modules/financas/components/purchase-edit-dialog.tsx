"use client";

import { useActionState, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { ActionState } from "../actions";
import { deletePurchaseAction, savePurchaseEditAction } from "../card-actions";
import { DESCRIPTION_MAX } from "../domain/schemas";
import type { CardCharge, FinArea } from "../types";
import type { ConfirmRequest } from "./confirm-dialog";
import { AreaChoice, DetailsFields, Field, FormError, useActionOutcome } from "./form-bits";

const initial: ActionState = { status: "idle" };

type Props = {
  charge: CardCharge | null;
  areas: FinArea[];
  categories: string[];
  onOpenChange: (open: boolean) => void;
  onAskConfirm: (request: ConfirmRequest) => void;
  onSuccess: (message: string) => void;
};

/** Compra no cartão: corrige descrição, área, categoria e observação, ou exclui com todas as parcelas. */
export function PurchaseEditDialog({ charge, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={charge !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">{charge && <PurchaseEditForm charge={charge} {...rest} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function PurchaseEditForm({ charge, areas, categories, onAskConfirm, onSuccess, onCancel }: Omit<Props, "charge" | "onOpenChange"> & { charge: CardCharge; onCancel: () => void }) {
  const [state, action, pending] = useActionState(savePurchaseEditAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [areaId, setAreaId] = useState(values?.areaId ?? charge.areaId);
  const split = charge.count > 1 ? `em ${charge.count}x` : "à vista";

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Compra no cartão</DialogTitle>
        <DialogDescription>
          {formatCents(charge.purchaseTotalCents)} {split} no {charge.cardName}, em {formatCivilDate(charge.purchaseDate)}. Para mudar valor, parcelas ou cartão, exclua e lance de novo.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={charge.purchaseId} />
      <Field id="purchase-edit-description" label="Descrição" error={errors?.description}>
        {(describedBy, invalid) => (
          <Input
            id="purchase-edit-description"
            name="description"
            maxLength={DESCRIPTION_MAX * 2}
            autoComplete="off"
            defaultValue={values?.description ?? charge.description}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>
      <AreaChoice id="purchase-edit-area" areas={areas} value={areaId} onChange={setAreaId} keepId={charge.areaId} error={errors?.areaId} />
      <DetailsFields idPrefix="purchase-edit" categories={categories} category={values?.category ?? charge.category ?? ""} notes={values?.notes ?? charge.notes ?? ""} errors={errors} />
      <FormError state={state} />
      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3 text-destructive hover:text-destructive"
          onClick={() =>
            onAskConfirm({
              title: "Excluir compra?",
              description:
                charge.count > 1 ? `"${charge.description}" será excluída com as ${charge.count} parcelas.` : `"${charge.description}" (${formatCents(charge.amountCents)}) será excluída.`,
              confirmLabel: "Excluir compra",
              destructive: true,
              action: deletePurchaseAction,
              fields: { id: charge.purchaseId },
            })
          }
        >
          <Trash2 aria-hidden="true" />
          Excluir compra
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Salvar
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
