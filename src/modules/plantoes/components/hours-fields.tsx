"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/modules/financas/components/form-bits";
import { describeHours, parseHours, type Hours } from "../domain/hours";

/**
 * Início, fim e "termina no dia seguinte" (explícito). Prévia da duração: 12 h e 24 h sem ambiguidade.
 * Campos controlados para a prévia; os valores vão no formulário pelos nomes start/end/nextDay.
 */
export function HoursFields({ idPrefix, initial, errors, date }: { idPrefix: string; initial: Hours; errors?: Record<string, string>; date?: string }) {
  const [start, setStart] = useState(initial?.start ?? "");
  const [end, setEnd] = useState(initial?.end ?? "");
  const [nextDay, setNextDay] = useState(initial?.nextDay ?? false);
  const parsed = parseHours(start, end, nextDay);
  const preset = (hours: 12 | 24) => {
    const base = /^\d{2}:\d{2}$/.test(start) ? start : "08:00";
    const [h, m] = base.split(":").map(Number);
    const total = h * 60 + m + hours * 60;
    setStart(base);
    setEnd(`${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
    setNextDay(total >= 1440);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">
        Horário <span className="font-normal text-muted-foreground">(opcional)</span>
      </legend>
      <div className="flex gap-2" aria-label="Duração rápida">
        <Button type="button" variant="outline" className="h-9 px-3" onClick={() => preset(12)}>12 h</Button>
        <Button type="button" variant="outline" className="h-9 px-3" onClick={() => preset(24)}>24 h</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${idPrefix}-start`} label="Início" error={errors?.start}>
          {(describedBy, invalid) => (
            <Input id={`${idPrefix}-start`} name="start" type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
        <Field id={`${idPrefix}-end`} label="Fim" error={errors?.end}>
          {(describedBy, invalid) => (
            <Input id={`${idPrefix}-end`} name="end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} className="size-4" data-next-day="" />
        Termina no dia seguinte (mesmo horário = 24 h)
      </label>
      <input type="hidden" name="nextDay" value={String(nextDay)} />
      {errors?.nextDay && <p className="text-sm text-destructive">{errors.nextDay}</p>}
      {(start || end) && (
        <p className="text-xs text-muted-foreground" data-hours-preview="">
          {parsed.ok ? describeHours(parsed.hours, date) : parsed.error}
        </p>
      )}
    </fieldset>
  );
}
