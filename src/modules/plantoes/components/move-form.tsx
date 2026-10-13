"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { daysBetween, formatCivilDate, parseCivilDate, type CivilDate } from "@/lib/dates";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { moveShiftAction, previewSeriesAction, type ActionState } from "../actions";
import { MAX_DATE, MIN_DATE, NOTES_MAX } from "../domain/schemas";
import type { PlShift, PlType } from "../types";
import { weekday } from "./shift-details";

const initial: ActionState = { status: "idle" };

type Scope = "este" | "proximas" | "futuras";

/**
 * Mover / registrar troca. Mostra data antiga e nova antes de confirmar. Recorrente: pergunta o alcance
 * (padrão "Somente este"). Mesmo dia não gera alteração. Usado pelo arraste e pelo botão "Mover".
 */
export function MoveForm({ shift, type, initialDate, today, onSuccess, onCancel }: { shift: PlShift; type?: PlType; initialDate: CivilDate; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(moveShiftAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [date, setDate] = useState(values?.newDate ?? initialDate);
  const [scope, setScope] = useState<Scope>("este");
  const valid = parseCivilDate(date) !== null;
  const same = date === shift.date;
  const delta = valid ? daysBetween(shift.date, date) : 0;
  const recurring = Boolean(shift.seriesId);
  const seriesTooFar = scope !== "este" && Math.abs(delta) > 6;
  const fromDate = scope === "proximas" ? (shift.originalDate ?? shift.date) : today;

  const [impact, setImpact] = useState<{ key: string; n: number; kept: number } | null>(null);
  useEffect(() => {
    if (scope === "este" || !shift.seriesId) return;
    let active = true;
    previewSeriesAction(shift.seriesId, fromDate).then((v) => active && v && setImpact({ key: `${scope}:${fromDate}`, n: v.replaceCount, kept: v.preservedCount }));
    return () => {
      active = false;
    };
  }, [scope, fromDate, shift.seriesId]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Mover plantão</DialogTitle>
        <DialogDescription>
          {type?.name ?? "Plantão"}. Para registrar uma troca, use a observação (ex.: &quot;Troca com Fulano&quot;). Nada é enviado a outra pessoa.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={shift.id} />
      <input type="hidden" name="scope" value={scope} />
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-move-preview="">
        <span>
          {formatCivilDate(shift.date)} ({weekday(shift.date)})
        </span>
        <ArrowRight className="size-4" aria-label="para" />
        <span className="font-medium">{valid ? `${formatCivilDate(date)} (${weekday(date)})` : "data inválida"}</span>
      </div>
      <Field id="move-date" label="Nova data" error={errors?.newDate} hint={same ? "Escolha uma data diferente da atual." : undefined}>
        {(d, i) => <Input id="move-date" name="newDate" type="date" min={MIN_DATE} max={MAX_DATE} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
      </Field>
      {recurring && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium">Alcance</legend>
          {(
            [
              ["este", "Somente este plantão (troca individual)"],
              ["proximas", "Este e os próximos da recorrência"],
              ["futuras", "Futuras ocorrências da recorrência (a partir de hoje)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="radio" name="scopeChoice" value={value} checked={scope === value} onChange={() => setScope(value)} className="size-4" data-scope={value} />
              {label}
            </label>
          ))}
          {scope !== "este" && (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm" data-move-impact="">
              {seriesTooFar
                ? "Para a recorrência, mova no máximo 6 dias. Para mais, mova só este plantão."
                : !impact || impact.key !== `${scope}:${fromDate}`
                  ? "Calculando…"
                  : `A recorrência passa a cair ${Math.abs(delta)} dia(s) ${delta > 0 ? "depois" : "antes"} a partir de ${formatCivilDate(fromDate)}: ${impact.n} plantão(ões) gerado(s) serão refeitos na nova data${impact.kept ? `; ${impact.kept} preservado(s) (realizados, recebidos, movidos ou alterados)` : ""}.`}
            </p>
          )}
        </fieldset>
      )}
      <Field id="move-note" label="Observação da troca" optional error={errors?.note}>
        {(d, i) => <Textarea id="move-note" name="note" rows={2} maxLength={NOTES_MAX * 2} defaultValue={values?.note ?? ""} placeholder="Ex.: Troca com colega" aria-invalid={i || undefined} aria-describedby={d} />}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || same || !valid || seriesTooFar} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Confirmar movimentação
        </Button>
      </DialogFooter>
    </form>
  );
}
