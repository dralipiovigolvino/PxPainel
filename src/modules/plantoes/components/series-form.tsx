"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatCivilDate, parseCivilDate, type CivilDate } from "@/lib/dates";
import { formatCentsForInput } from "@/lib/money";
import { formatRate } from "@/lib/tax";
import { CnpjField } from "@/modules/cnpj/components/cnpj-field";
import type { CnpjOption } from "@/modules/cnpj/types";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { selectClass } from "@/modules/financas/components/series-fields";
import { previewSeriesAction, saveSeriesAction, type ActionState } from "../actions";
import { describePayRule } from "../domain/payment";
import { describeRule, occurrencesBetween, WEEKDAY_SHORT } from "../domain/recurrence";
import { MAX_DATE, MIN_DATE, NOTES_MAX } from "../domain/schemas";
import type { PlSeries } from "../series-data";
import type { PlType } from "../types";
import { HoursFields } from "./hours-fields";

/** "Recebo por CNPJ" dos plantões da recorrência (herdado do tipo ou da série; remonta ao trocar o tipo). */
function SeriesCnpj({ initial: start, options, error }: { initial: string; options: CnpjOption[]; error?: string }) {
  const [cnpjId, setCnpjId] = useState(start);
  const cnpj = options.find((o) => o.id === cnpjId);
  return (
    <div className="flex flex-col gap-1">
      <CnpjField idPrefix="series" options={options} value={cnpjId} onChange={setCnpjId} error={error} />
      {cnpj && (
        <p className="text-sm text-muted-foreground" data-cnpj-tax="">
          Imposto estimado de {formatRate(cnpj.taxRateBp)} sobre cada plantão, pago no mês seguinte.
        </p>
      )}
    </div>
  );
}

const initial: ActionState = { status: "idle" };

/** Prévia do servidor (somente leitura) do que a edição a partir de `fromDate` substitui e preserva. */
function Impact({ seriesId, fromDate }: { seriesId: string; fromDate: CivilDate }) {
  const [impact, setImpact] = useState<{ key: string; value: Awaited<ReturnType<typeof previewSeriesAction>> } | null>(null);
  const key = `${seriesId}:${fromDate}`;
  useEffect(() => {
    let active = true;
    previewSeriesAction(seriesId, fromDate).then((value) => active && setImpact({ key, value }));
    return () => {
      active = false;
    };
  }, [seriesId, fromDate, key]);
  if (!impact || impact.key !== key) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Calculando a prévia…
      </p>
    );
  }
  const v = impact.value;
  if (!v) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-series-impact="">
      <p>
        {v.replaceCount === 0
          ? "Nenhum plantão gerado será substituído."
          : `${v.replaceCount === 1 ? "1 plantão gerado será substituído" : `${v.replaceCount} plantões gerados serão substituídos`}${v.replaceFrom && v.replaceTo ? ` (de ${formatCivilDate(v.replaceFrom)} a ${formatCivilDate(v.replaceTo)})` : ""} pela nova regra.`}
      </p>
      {v.preservedCount > 0 && (
        <p>
          {v.preservedCount === 1 ? "1 plantão realizado, recebido, movido ou alterado individualmente será mantido" : `${v.preservedCount} plantões realizados, recebidos, movidos ou alterados individualmente serão mantidos`} como está.
        </p>
      )}
      <p className="text-muted-foreground">Plantões anteriores à data não mudam. Exclusões continuam valendo.</p>
    </div>
  );
}

type Props = {
  types: PlType[];
  /** Edição: a série e a data a partir da qual muda ("este e os próximos" ou "futuras"). */
  edit?: { series: PlSeries; fromDate: CivilDate } | null;
  defaultDate: CivilDate;
  /** CNPJs cadastrados, para a marcação "Recebo por CNPJ". */
  cnpjs: CnpjOption[];
  onSuccess: (m: string) => void;
  onCancel: () => void;
};

export function SeriesForm({ types, edit, defaultDate, cnpjs, onSuccess, onCancel }: Props) {
  const [state, action, pending] = useActionState(saveSeriesAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const active = types.filter((t) => !t.archived);
  const base = edit?.series;
  const [typeId, setTypeId] = useState(base?.typeId ?? values?.typeId ?? (active.length === 1 ? active[0].id : ""));
  const type = types.find((t) => t.id === typeId);
  const [weekdays, setWeekdays] = useState<number[]>(values?.weekdays ? values.weekdays.split(",").filter(Boolean).map(Number) : (base?.weekdays ?? []));
  const [interval, setIntervalWeeks] = useState(values?.intervalWeeks ?? String(base?.intervalWeeks ?? 1));
  const [startDate, setStartDate] = useState(values?.startDate ?? edit?.fromDate ?? defaultDate);
  const [until, setUntil] = useState(values?.until ?? base?.endDate ?? "");
  const source = base ? { amountCents: base.amountCents, hours: base.hours, notes: base.notes } : type ? { amountCents: type.amountCents, hours: type.hours, notes: type.notes } : null;

  const n = /^\d{1,2}$/.test(interval) ? Number(interval) : NaN;
  const validRule = weekdays.length > 0 && Number.isInteger(n) && n >= 1 && n <= 12 && parseCivilDate(startDate) !== null;
  const rule = validRule ? { startDate, intervalWeeks: n, weekdays: [...weekdays].sort((a, b) => a - b), endDate: until && parseCivilDate(until) ? until : null } : null;
  const next = rule ? occurrencesBetween(rule, startDate, addDays(startDate, 366)).slice(0, 6) : [];

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{edit ? "Alterar recorrência" : "Nova recorrência"}</DialogTitle>
        <DialogDescription>
          {edit
            ? `A nova regra vale a partir de ${formatCivilDate(edit.fromDate)}. Realizados, recebidos, movidos e alterados individualmente são preservados.`
            : "Os plantões são gerados até 12 meses à frente e ampliados quando você navega para meses mais distantes."}
        </DialogDescription>
      </DialogHeader>
      {edit && (
        <>
          <input type="hidden" name="seriesId" value={edit.series.id} />
          <input type="hidden" name="fromDate" value={edit.fromDate} />
          <input type="hidden" name="typeId" value={edit.series.typeId} />
        </>
      )}
      {!edit && (
        <Field id="series-type" label="Tipo" error={errors?.typeId}>
          {(d, i) => (
            <select id="series-type" name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className={selectClass}>
              <option value="" disabled>
                Escolha o tipo
              </option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Dias da semana</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_SHORT.map((label, d) => {
            const on = weekdays.includes(d);
            return (
              <label key={d} className={`inline-flex h-10 min-w-12 cursor-pointer items-center justify-center rounded-lg border px-2 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>
                <input
                  type="checkbox"
                  name="weekday"
                  value={d}
                  checked={on}
                  onChange={(e) => setWeekdays((list) => (e.target.checked ? [...list, d] : list.filter((x) => x !== d)))}
                  className="sr-only"
                  data-weekday={d}
                />
                {label}
              </label>
            );
          })}
        </div>
        {errors?.weekdays && <p className="text-sm text-destructive">{errors.weekdays}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="series-interval" label="A cada (semanas)" error={errors?.intervalWeeks} hint="1 = toda semana; 2 = alternadas">
          {(d, i) => <Input id="series-interval" name="intervalWeeks" inputMode="numeric" value={interval} onChange={(e) => setIntervalWeeks(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
        </Field>
        <Field id="series-start" label={edit ? "Nova regra a partir de" : "Data inicial"} error={errors?.startDate}>
          {(d, i) => (
            <Input id="series-start" name="startDate" type="date" min={edit?.fromDate ?? MIN_DATE} max={MAX_DATE} value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />
          )}
        </Field>
        <Field id="series-until" label="Data final" optional error={errors?.until}>
          {(d, i) => <Input id="series-until" name="until" type="date" min={startDate} max={MAX_DATE} value={until} onChange={(e) => setUntil(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
        </Field>
      </div>
      {rule && (
        <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm" data-series-preview="">
          <p className="font-medium">{describeRule(rule)}</p>
          <p className="text-muted-foreground">Próximas: {next.length ? next.map(formatCivilDate).join(", ") : "nenhuma no período"}</p>
        </div>
      )}
      {source ? (
        <div key={base?.id ?? typeId} className="flex flex-col gap-4">
          <Field id="series-amount" label="Valor de cada plantão (R$)" error={errors?.amount}>
            {(d, i) => <Input id="series-amount" name="amount" inputMode="decimal" defaultValue={values?.amount ?? formatCentsForInput(source.amountCents)} aria-invalid={i || undefined} aria-describedby={d} className="h-10 tabular-nums" />}
          </Field>
          {/* Na edição vale a marcação da própria recorrência (inclusive "sem CNPJ"); na criação, o padrão do tipo. */}
          <SeriesCnpj initial={values?.cnpjId ?? (base ? (base.cnpjId ?? "") : (type?.cnpjId ?? ""))} options={cnpjs} error={errors?.cnpjId} />
          <p className="text-sm text-muted-foreground" data-series-pay-rule="">
            Previsão de pagamento dos plantões gerados: {describePayRule(base ? base.payDay : (type?.payDay ?? null), base ? base.payMonthOffset : (type?.payMonthOffset ?? 1)).toLowerCase()} (regra do tipo).
          </p>
          <HoursFields idPrefix="series" initial={source.hours} errors={errors} />
          <Field id="series-notes" label="Observação" optional error={errors?.notes}>
            {(d, i) => <Textarea id="series-notes" name="notes" rows={2} maxLength={NOTES_MAX * 2} defaultValue={values?.notes ?? source.notes ?? ""} aria-invalid={i || undefined} aria-describedby={d} />}
          </Field>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Escolha o tipo para preencher valor e horários.</p>
      )}
      {edit && <Impact seriesId={edit.series.id} fromDate={edit.fromDate} />}
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !source} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : edit ? "Aplicar a partir desta data" : "Criar recorrência"}
        </Button>
      </DialogFooter>
    </form>
  );
}
