"use client";

import { useActionState, useRef, useState } from "react";
import { Archive, ArchiveRestore, Check, Loader2, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { archiveAreaAction, deleteAreaAction, saveAreaAction, type ActionState } from "../actions";
import { AREA_COLORS, AREA_NAME_MAX } from "../domain/schemas";
import type { FinArea } from "../types";
import type { ConfirmRequest } from "./confirm-dialog";
import { Field, FormError, useActionOutcome } from "./form-bits";

const initial: ActionState = { status: "idle" };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area?: FinArea | null;
  onSuccess: (message: string) => void;
  /** Arquivar, restaurar e excluir pedem confirmação (no lugar deste diálogo). Sem ele, só nome e cor. */
  onAskConfirm?: (request: ConfirmRequest) => void;
};

export function AreaFormDialog({ open, onOpenChange, area, onSuccess, onAskConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remonta a cada abertura: estado limpo. */}
        {open && <AreaForm area={area} onSuccess={onSuccess} onAskConfirm={onAskConfirm} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** Pedido de arquivar/restaurar/excluir, com o efeito nas recorrências dito antes. */
function areaRequest(area: FinArea, kind: "arquivar" | "restaurar" | "excluir"): ConfirmRequest {
  if (kind === "excluir") return { title: "Excluir área?", description: `"${area.name}" será excluída.`, confirmLabel: "Excluir", destructive: true, action: deleteAreaAction, fields: { id: area.id } };
  if (kind === "restaurar") {
    return { title: "Restaurar área?", description: `"${area.name}" volta a receber contas. Recorrências suspensas são retomadas em Recorrências.`, confirmLabel: "Restaurar", action: archiveAreaAction, fields: { id: area.id, archive: "false" } };
  }
  const series = area.activeSeries;
  return {
    title: "Arquivar área?",
    description: `"${area.name}" deixa de receber contas novas; as existentes continuam.${series > 0 ? ` ${series === 1 ? "1 recorrência para" : `${series} recorrências param`} de gerar contas.` : ""}`,
    confirmLabel: "Arquivar",
    action: archiveAreaAction,
    fields: { id: area.id, archive: "true", confirmSeries: "true" },
  };
}

function AreaForm({ area, onSuccess, onAskConfirm, onCancel }: { area?: FinArea | null; onSuccess: (m: string) => void; onAskConfirm?: (r: ConfirmRequest) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(saveAreaAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [color, setColor] = useState(values?.color || area?.color || AREA_COLORS[0].value);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{area ? area.name : "Nova área"}</DialogTitle>
        <DialogDescription>Cada área tem suas contas e seus totais separados.</DialogDescription>
      </DialogHeader>
      {area && <input type="hidden" name="id" value={area.id} />}
      <input type="hidden" name="color" value={color} />

      <Field id="area-name" label="Nome" error={errors?.name}>
        {(describedBy, invalid) => (
          <Input
            id="area-name"
            name="name"
            required
            maxLength={AREA_NAME_MAX * 2}
            autoComplete="off"
            defaultValue={values?.name ?? area?.name ?? ""}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Cor</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor da área">
          {AREA_COLORS.map(({ value: option, label }) => {
            const selected = option === color;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                title={label}
                onClick={() => setColor(option)}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected && "ring-2 ring-foreground/70 ring-offset-2",
                )}
                style={{ backgroundColor: option }}
              >
                {selected && <Check className="size-4 text-white" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        {errors?.color && <p className="text-sm text-destructive">{errors.color}</p>}
      </fieldset>

      <FormError state={state} />

      <DialogFooter className="sm:justify-between">
        {area && onAskConfirm ? (
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="ghost" className="h-10 px-3" onClick={() => onAskConfirm(areaRequest(area, area.archived ? "restaurar" : "arquivar"))}>
              {area.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
              {area.archived ? "Restaurar" : "Arquivar"}
            </Button>
            {area.entryCount === 0 && (
              <Button type="button" variant="ghost" className="h-10 px-3 text-destructive hover:text-destructive" onClick={() => onAskConfirm(areaRequest(area, "excluir"))}>
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
            {pending ? "Salvando…" : area ? "Salvar" : "Criar área"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
