"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatCivilDate, parseCivilDate, type CivilDate } from "@/lib/dates";
import { formatCentsForInput, parseBrlToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CnpjField, CnpjTaxNote } from "@/modules/cnpj/components/cnpj-field";
import type { CnpjOption } from "@/modules/cnpj/types";
import { Field, FormError, useActionOutcome } from "@/modules/financas/components/form-bits";
import { selectClass } from "@/modules/financas/components/series-fields";
import { saveShiftAction, type ActionState } from "../actions";
import type { Hours } from "../domain/hours";
import { describePayRule, expectedPayDate } from "../domain/payment";
import { describeRule, occurrencesBetween, weekdayOf, WEEKDAY_SHORT } from "../domain/recurrence";
import { MAX_DATE, MIN_DATE, NOTES_MAX } from "../domain/schemas";
import type { PlShift, PlType } from "../types";
import { HoursFields } from "./hours-fields";

const initial: ActionState = { status: "idle" };

type Props = {
  types: PlType[];
  /** Edição de uma ocorrência; sem ela, criação. */
  shift?: PlShift | null;
  defaultDate: CivilDate;
  /** CNPJs cadastrados, para a marcação "Recebo por CNPJ". */
  cnpjs: CnpjOption[];
  onSuccess: (m: string) => void;
  onCancel: () => void;
};

type Source = { amountCents: number; cnpjId: string | null; payDay: number | null; payMonthOffset: 0 | 1; hours: Hours; notes: string | null };

/**
 * Plantão avulso (criação), repetição semanal (criação) ou edição individual.
 * Ao escolher o tipo, copia valor, marcação de CNPJ, regra de pagamento, horários e observação padrão —
 * tudo ajustável só para este plantão.
 */
export function ShiftForm({ types, shift, defaultDate, cnpjs, onSuccess, onCancel }: Props) {
  const [state, action, pending] = useActionState(saveShiftAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [requestId] = useState(() => crypto.randomUUID());
  const active = types.filter((t) => !t.archived);
  const [typeId, setTypeId] = useState(shift?.typeId ?? values?.typeId ?? (active.length === 1 ? active[0].id : ""));
  const type = types.find((t) => t.id === typeId);
  const [date, setDate] = useState(shift?.date ?? values?.date ?? defaultDate);

  const submitting = useRef(false);
  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state]);

  // Valores copiados do tipo (ou da ocorrência, na edição). Trocar o tipo remonta os campos.
  const source: Source | null = shift
    ? { amountCents: shift.amountCents, cnpjId: shift.cnpjId, payDay: shift.payDay, payMonthOffset: shift.payMonthOffset, hours: shift.hours, notes: shift.notes }
    : type
      ? { amountCents: type.amountCents, cnpjId: type.cnpjId, payDay: type.payDay, payMonthOffset: type.payMonthOffset, hours: type.hours, notes: type.notes }
      : null;

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
    >
      <DialogHeader>
        <DialogTitle>{shift ? "Editar este plantão" : "Novo plantão"}</DialogTitle>
        <DialogDescription>
          {shift ? `Só este plantão (${formatCivilDate(shift.date)}). Para mudar a data, use "Mover".` : "Os dados vêm do tipo; ajuste se precisar."}
        </DialogDescription>
      </DialogHeader>
      {shift && <input type="hidden" name="id" value={shift.id} />}
      <input type="hidden" name="requestId" value={requestId} />
      {shift ? (
        <>
          <input type="hidden" name="typeId" value={shift.typeId} />
          <input type="hidden" name="date" value={shift.date} />
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="shift-type" label="Tipo" error={errors?.typeId}>
            {(d, i) => (
              <select id="shift-type" name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className={selectClass}>
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
          <Field id="shift-date" label="Data (início)" error={errors?.date}>
            {(d, i) => (
              <Input id="shift-date" name="date" type="date" min={MIN_DATE} max={MAX_DATE} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />
            )}
          </Field>
        </div>
      )}
      {source ? (
        <ShiftFields key={shift?.id ?? typeId} source={source} shift={shift ?? null} date={date} cnpjs={cnpjs} values={values} errors={errors} />
      ) : (
        <p className="text-sm text-muted-foreground">{active.length === 0 ? "Crie um tipo de plantão na aba Tipos." : "Escolha o tipo para preencher valor e horários."}</p>
      )}
      {state.status === "confirm" && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" data-overlap-warning="">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
          <Button type="submit" name="confirmOverlap" value="true" variant="outline" className="h-10 w-fit px-3" disabled={pending}>
            {shift ? "Salvar mesmo assim" : "Adicionar mesmo assim"}
          </Button>
        </div>
      )}
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !source} className="h-10 px-4" data-shift-submit="">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : shift ? "Salvar" : "Adicionar plantão"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type FieldsProps = {
  source: Source;
  shift: PlShift | null;
  date: CivilDate;
  cnpjs: CnpjOption[];
  values?: Record<string, string>;
  errors?: Record<string, string>;
};

function ShiftFields({ source, shift, date, cnpjs, values, errors }: FieldsProps) {
  const [amount, setAmount] = useState(values?.amount ?? formatCentsForInput(source.amountCents));
  const [cnpjId, setCnpjId] = useState(values?.cnpjId ?? source.cnpjId ?? "");
  const [payMode, setPayMode] = useState<"auto" | "manual">(values?.payMode === "manual" || (!values && shift?.expectedPayManual) ? "manual" : "auto");
  const [payDate, setPayDate] = useState(values?.payDate ?? (shift?.expectedPayManual ? (shift.expectedPayDate ?? "") : ""));
  const [payDay, setPayDay] = useState(values?.payDay ?? (source.payDay === null ? "" : String(source.payDay)));
  const [payMonthOffset, setPayMonthOffset] = useState<0 | 1>(values?.payMonthOffset === "0" || (!values && source.payMonthOffset === 0) ? 0 : 1);
  const [repeat, setRepeat] = useState(values?.repeat === "true");
  // Dias da repetição: começa no dia da semana da data escolhida e acompanha a data até ser alterado à mão.
  const [weekdays, setWeekdays] = useState<number[] | null>(values?.weekdays ? values.weekdays.split(",").filter(Boolean).map(Number) : null);
  const [until, setUntil] = useState(values?.until ?? "");
  // Detalhes abertos ao editar ou com data manual; depois, como o usuário deixar. Erro num campo de dentro sempre abre.
  const [moreToggle, setMoreToggle] = useState<boolean | null>(null);
  const moreOpen = ["start", "end", "nextDay", "payDate", "notes"].some((k) => errors?.[k]) || (moreToggle ?? (Boolean(shift) || payMode === "manual"));

  const validDate = parseCivilDate(date) !== null;
  const days = weekdays ?? (validDate ? [weekdayOf(date)] : []);
  const parsed = parseBrlToCents(amount);
  // No mesmo CNPJ do plantão vale a alíquota gravada nele; marcado ou trocado agora, o percentual atual do CNPJ.
  const rateBp = shift && shift.cnpjId === cnpjId && shift.taxRateBp !== null ? shift.taxRateBp : (cnpjs.find((c) => c.id === cnpjId)?.taxRateBp ?? null);
  const parsedPayDay = /^\d{1,2}$/.test(payDay) ? Number(payDay) : null;
  const autoDate = parsedPayDay !== null && parsedPayDay >= 1 && parsedPayDay <= 31 && validDate ? expectedPayDate(date, parsedPayDay, payMonthOffset) : null;
  const rule = repeat && validDate && days.length > 0 ? { startDate: date, intervalWeeks: 1, weekdays: [...days].sort((a, b) => a - b), endDate: until && parseCivilDate(until) ? until : null } : null;
  const next = rule ? occurrencesBetween(rule, date, addDays(date, 366)).slice(0, 6) : [];

  return (
    <div className="flex flex-col gap-4">
      <Field id="shift-amount" label="Valor deste plantão (R$)" error={errors?.amount}>
        {(d, i) => <Input id="shift-amount" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10 tabular-nums" />}
      </Field>
      <CnpjField idPrefix="shift" options={cnpjs} value={cnpjId} onChange={setCnpjId} error={errors?.cnpjId} />
      {parsed.ok && cnpjId !== "" && rateBp !== null && (
        <div aria-live="polite">
          <CnpjTaxNote amountCents={parsed.cents} rateBp={rateBp} workDate={repeat ? undefined : date} each={repeat} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]" data-pay-auto="">
        <Field id="shift-pay-day" label="Dia do pagamento" optional error={errors?.payDay}>
          {(d, i) => <Input id="shift-pay-day" name="payDay" inputMode="numeric" value={payDay} onChange={(e) => setPayDay(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">Mês do pagamento</legend>
          <input type="hidden" name="payMonthOffset" value={payMonthOffset} />
          <div className="flex gap-2">
            {([[0, "Este mês"], [1, "Mês seguinte"]] as const).map(([offset, label]) => <Button key={offset} type="button" variant={payMonthOffset === offset ? "default" : "outline"} className="h-10 px-3" onClick={() => setPayMonthOffset(offset)}>{label}</Button>)}
          </div>
        </fieldset>
      </div>
      {autoDate && <p className="text-sm text-muted-foreground">{describePayRule(parsedPayDay, payMonthOffset)}: {formatCivilDate(autoDate)}.</p>}

      {!shift && (
        <div className="flex flex-col gap-3" data-repeat="">
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="repeat" value="true" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="size-4 accent-primary" data-repeat-toggle="" />
            Repetir semanalmente
          </label>
          {repeat && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium" id="shift-weekdays-label">
                  Dia da semana
                </span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="shift-weekdays-label">
                  {WEEKDAY_SHORT.map((label, d) => {
                    const on = days.includes(d);
                    return (
                      <label
                        key={label}
                        className={cn(
                          "flex h-10 min-w-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring",
                          on && "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        <input
                          type="checkbox"
                          name="weekday"
                          value={d}
                          checked={on}
                          onChange={() => setWeekdays(on ? days.filter((x) => x !== d) : [...days, d])}
                          className="sr-only"
                          data-repeat-weekday={d}
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
                {errors?.weekdays && <p className="text-sm text-destructive">{errors.weekdays}</p>}
              </div>
              <Field id="shift-until" label="Até" optional error={errors?.until}>
                {(d, i) => <Input id="shift-until" name="until" type="date" min={date} max={MAX_DATE} value={until} onChange={(e) => setUntil(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
              </Field>
              <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm" aria-live="polite" data-repeat-preview="">
                {rule ? (
                  <>
                    <p className="font-medium">{describeRule(rule)}</p>
                    <p className="text-muted-foreground">{next.length > 0 ? `Próximas: ${next.map(formatCivilDate).join(", ")}${next.length === 6 ? "…" : ""}` : "Nenhuma ocorrência no período."}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Escolha pelo menos um dia da semana.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <details className="rounded-lg border" open={moreOpen || undefined} onToggle={(e) => setMoreToggle(e.currentTarget.open)} data-shift-more="">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">Horário, data de pagamento e observação</summary>
        <div className="flex flex-col gap-4 border-t p-3">
          <HoursFields idPrefix="shift" initial={source.hours} errors={errors} date={date} />
          <div className="flex flex-col gap-2" data-pay-forecast="">
            <input type="hidden" name="payMode" value={repeat ? "auto" : payMode} />
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={payMode === "manual" && !repeat} disabled={repeat} onChange={(e) => setPayMode(e.target.checked ? "manual" : "auto")} className="size-4 accent-primary" data-pay-manual="" />
              Usar outra data prevista de pagamento neste plantão
            </label>
            {payMode === "manual" && !repeat && (
              <Field id="shift-pay-date" label="Data prevista de pagamento" error={errors?.payDate}>
                {(d, i) => <Input id="shift-pay-date" name="payDate" type="date" min={MIN_DATE} value={payDate} onChange={(e) => setPayDate(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
              </Field>
            )}
            {repeat && errors?.payDate && <p className="text-sm text-destructive">{errors.payDate}</p>}
          </div>
          <Field id="shift-notes" label="Observação" optional error={errors?.notes}>
            {(d, i) => <Textarea id="shift-notes" name="notes" rows={2} maxLength={NOTES_MAX * 2} defaultValue={values?.notes ?? source.notes ?? ""} aria-invalid={i || undefined} aria-describedby={d} />}
          </Field>
        </div>
      </details>
    </div>
  );
}
