"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addDays, formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCentsForInput } from "@/lib/money";
import { endSeriesAction, previewSeriesAction, resumeSeriesAction, saveSeriesAction, type ActionState } from "../actions";
import { MAX_DATE, MIN_DATE } from "../domain/schemas";
import type { FinArea, FinSeries, SeriesImpact } from "../types";
import { Field, FormError, useActionOutcome } from "./form-bits";
import { SeriesFields } from "./series-fields";

const initial: ActionState = { status: "idle" };

/** Texto da prévia: quantidade e período afetados + o que é preservado. */
export function ImpactText({ impact, verb }: { impact: SeriesImpact | null | "loading"; verb: "substituídas" | "removidas" }) {
  if (impact === "loading" || impact === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Calculando a prévia…
      </p>
    );
  }
  const { replaceCount, replaceFrom, replaceTo, preservedCount } = impact;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm" aria-live="polite">
      <p>
        {replaceCount === 0
          ? `Nenhuma conta pendente já gerada será ${verb.slice(0, -1)}.`
          : `${replaceCount} ${replaceCount === 1 ? "conta pendente gerada será" : "contas pendentes geradas serão"} ${
              replaceCount === 1 ? verb.slice(0, -1) : verb
            }${replaceFrom && replaceTo ? ` (de ${formatCivilDate(replaceFrom)} a ${formatCivilDate(replaceTo)})` : ""}.`}
      </p>
      {preservedCount > 0 && (
        <p>
          {preservedCount === 1 ? "1 conta" : `${preservedCount} contas`} a partir dessa data{" "}
          {preservedCount === 1 ? "está paga, personalizada ou com valor informado e será mantida" : "estão pagas, personalizadas ou com valor informado e serão mantidas"}{" "}
          como {preservedCount === 1 ? "está" : "estão"}.
        </p>
      )}
    </div>
  );
}

/** Prévia do servidor para (série, data). Enquanto a resposta da chave atual não chega: "loading". */
function usePreview(seriesId: string, fromDate: CivilDate | null): SeriesImpact | null | "loading" {
  const key = fromDate ? `${seriesId}:${fromDate}` : null;
  const [result, setResult] = useState<{ key: string; impact: SeriesImpact | null } | null>(null);
  useEffect(() => {
    if (!key || !fromDate) return;
    let active = true;
    previewSeriesAction(seriesId, fromDate).then((impact) => {
      if (active) setResult({ key, impact });
    });
    return () => {
      active = false;
    };
  }, [key, seriesId, fromDate]);
  return result && result.key === key ? result.impact : "loading";
}

export type ChangeScope = "proximas" | "futuras";

type ChangeProps = {
  request: { series: FinSeries; scope: ChangeScope; fromDate: CivilDate } | null;
  areas: FinArea[];
  categories: string[];
  onOpenChange: (open: boolean) => void;
  onSuccess: (message: string) => void;
};

/** "Esta e as próximas" ou "futuras a partir de hoje": nova regra a partir de uma data. */
export function SeriesChangeDialog({ request, areas, categories, onOpenChange, onSuccess }: ChangeProps) {
  return (
    <Dialog open={request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {request && <SeriesChangeForm {...request} areas={areas} categories={categories} onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SeriesChangeForm({
  series,
  scope,
  fromDate,
  areas,
  categories,
  onSuccess,
  onCancel,
}: { series: FinSeries; scope: ChangeScope; fromDate: CivilDate; areas: FinArea[]; categories: string[]; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(saveSeriesAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const impact = usePreview(series.id, fromDate);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const areaIsActive = areas.some((a) => a.id === series.areaId && !a.archived);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{series.description}</DialogTitle>
        <DialogDescription>
          {scope === "proximas" ? `Alteração a partir de ${formatCivilDate(fromDate)}.` : `Alteração a partir de hoje (${formatCivilDate(fromDate)}).`} Contas pagas e anteriores não mudam.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="seriesId" value={series.id} />
      <input type="hidden" name="fromDate" value={fromDate} />
      <ImpactText impact={impact} verb="substituídas" />
      <SeriesFields
        key={series.id}
        areas={areas}
        categories={categories}
        showPayment
        minStart={fromDate}
        errors={errors}
        defaults={
          values ?? {
            description: series.description,
            areaId: areaIsActive ? series.areaId : "",
            category: series.category ?? "",
            notes: series.notes ?? "",
            amountKind: series.amountKind,
            amount: series.amountCents !== null ? formatCentsForInput(series.amountCents) : "",
            frequency: series.frequency,
            intervalMonths: String(series.intervalMonths),
            startDate: fromDate,
            endDate: series.endDate ?? "",
            paymentMethod: series.paymentMethod ?? "",
          }
        }
      />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || impact === "loading"} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Aplicando…" : "Aplicar alteração"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type SimpleProps = {
  series: FinSeries | null;
  today: CivilDate;
  onOpenChange: (open: boolean) => void;
  onSuccess: (message: string) => void;
};

/** Encerrar: nada é gerado depois da data; pendentes posteriores (não personalizadas) somem. */
export function EndSeriesDialog({ series, today, onOpenChange, onSuccess }: SimpleProps) {
  return (
    <Dialog open={series !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{series && <EndSeriesForm series={series} today={today} onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function EndSeriesForm({ series, today, onSuccess, onCancel }: { series: FinSeries; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(endSeriesAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const [endDate, setEndDate] = useState(state.status === "error" ? (state.values?.endDate ?? today) : today);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(endDate);
  const impact = usePreview(series.id, valid ? addDays(endDate, 1) : null);
  const errors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Encerrar recorrência</DialogTitle>
        <DialogDescription>&quot;{series.description}&quot; para de gerar contas depois da data escolhida.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="seriesId" value={series.id} />
      <Field id="end-date" label="Última data com conta" error={errors?.endDate}>
        {(describedBy, invalid) => (
          <Input
            id="end-date"
            name="endDate"
            type="date"
            min={MIN_DATE}
            max={MAX_DATE}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>
      {valid && <ImpactText impact={impact} verb="removidas" />}
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="destructive" disabled={pending || !valid} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Encerrar recorrência
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Retomar série suspensa a partir de uma data (o intervalo suspenso não é preenchido). */
export function ResumeSeriesDialog({ series, today, onOpenChange, onSuccess }: SimpleProps) {
  return (
    <Dialog open={series !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{series && <ResumeForm series={series} today={today} onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ResumeForm({ series, today, onSuccess, onCancel }: { series: FinSeries; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(resumeSeriesAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Retomar recorrência</DialogTitle>
        <DialogDescription>&quot;{series.description}&quot; volta a gerar contas a partir da data escolhida.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="seriesId" value={series.id} />
      <Field id="resume-date" label="Retomar a partir de" error={errors?.fromDate}>
        {(describedBy, invalid) => (
          <Input
            id="resume-date"
            name="fromDate"
            type="date"
            min={MIN_DATE}
            max={MAX_DATE}
            defaultValue={state.status === "error" ? state.values?.fromDate : today}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Retomar
        </Button>
      </DialogFooter>
    </form>
  );
}
