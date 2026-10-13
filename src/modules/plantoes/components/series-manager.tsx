"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Play, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addDays, formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { Field, FormError, NoticeRegion, useActionOutcome, useNotice } from "@/modules/financas/components/form-bits";
import { endSeriesAction, previewSeriesAction, resumeSeriesAction, type ActionState } from "../actions";
import { describeHours } from "../domain/hours";
import { describeRule } from "../domain/recurrence";
import { MAX_DATE } from "../domain/schemas";
import type { PlSeries } from "../series-data";
import type { CnpjOption } from "@/modules/cnpj/types";
import type { PlType } from "../types";
import { SeriesForm } from "./series-form";
import { Dot } from "./types-manager";

const initial: ActionState = { status: "idle" };

function EndForm({ series, today, onSuccess, onCancel }: { series: PlSeries; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(endSeriesAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [date, setDate] = useState(today > series.startDate ? today : series.startDate);
  const [impact, setImpact] = useState<{ key: string; n: number; kept: number } | null>(null);
  useEffect(() => {
    let active = true;
    previewSeriesAction(series.id, date, false).then((v) => active && v && setImpact({ key: date, n: v.replaceCount, kept: v.preservedCount }));
    return () => {
      active = false;
    };
  }, [series.id, date]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Encerrar recorrência</DialogTitle>
        <DialogDescription>Depois da data final nada é gerado. Plantões futuros não alterados são removidos; os demais ficam.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="seriesId" value={series.id} />
      <Field id="series-end-date" label="Último dia da recorrência" error={errors?.endDate}>
        {(d, i) => <Input id="series-end-date" name="endDate" type="date" min={addDays(series.startDate, -1)} max={MAX_DATE} value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
      </Field>
      <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm" data-end-impact="">
        {!impact || impact.key !== date
          ? "Calculando…"
          : `${impact.n === 1 ? "1 plantão futuro será removido" : `${impact.n} plantões futuros serão removidos`}${impact.kept ? `; ${impact.kept} preservado(s) (realizados, recebidos, movidos ou alterados)` : ""}.`}
      </p>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Voltar
        </Button>
        <Button type="submit" variant="destructive" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Encerrar
        </Button>
      </DialogFooter>
    </form>
  );
}

function ResumeForm({ series, today, onSuccess, onCancel }: { series: PlSeries; today: CivilDate; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(resumeSeriesAction, initial);
  useActionOutcome(state, onSuccess);
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Retomar recorrência</DialogTitle>
        <DialogDescription>Os plantões voltam a ser gerados a partir da data escolhida. O período suspenso não é preenchido.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="seriesId" value={series.id} />
      <Field id="series-resume" label="Retomar a partir de" error={errors?.fromDate}>
        {(d, i) => <Input id="series-resume" name="fromDate" type="date" defaultValue={today} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Voltar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Retomar
        </Button>
      </DialogFooter>
    </form>
  );
}

type Panel = { kind: "nova" } | { kind: "editar"; series: PlSeries; fromDate: CivilDate } | { kind: "encerrar"; series: PlSeries } | { kind: "retomar"; series: PlSeries } | null;

export function SeriesManager({ series, types, cnpjs, today }: { series: PlSeries[]; types: PlType[]; cnpjs: CnpjOption[]; today: CivilDate }) {
  const [notice, showNotice] = useNotice();
  const [panel, setPanel] = useState<Panel>(null);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const done = useCallback(
    (m: string) => {
      setPanel(null);
      showNotice(m);
    },
    [showNotice],
  );
  // Encerradas não aparecem: não há o que fazer com elas (os plantões gerados continuam no calendário).
  const current = series.filter((s) => s.endDate === null || s.endDate >= today);

  const item = (s: PlSeries) => {
    const t = typeById.get(s.typeId);
    return (
      <li key={s.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-start lg:justify-between" data-series="">
        <div className="flex min-w-0 items-start gap-3">
          {t && <Dot color={t.color} className="mt-1.5 size-3.5" />}
          <div className="min-w-0">
            <p className="font-medium break-words">
              {t?.name ?? "Tipo"}
              {s.suspended && <span className="ml-2 rounded-md bg-amber-100 px-1.5 text-xs text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">suspensa</span>}
            </p>
            <p className="text-sm">{describeRule(s)}</p>
            <p className="text-sm text-muted-foreground">
              {formatCents(s.amountCents)} · {describeHours(s.hours)}
              {s.nextDate && ` · próximo ${formatCivilDate(s.nextDate)}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="ghost" className="h-10 px-3" onClick={() => setPanel({ kind: "editar", series: s, fromDate: today > s.startDate ? today : s.startDate })}>
            <Pencil aria-hidden="true" />
            Alterar futuras
          </Button>
          {s.suspended ? (
            <Button variant="outline" className="h-10 px-3" onClick={() => setPanel({ kind: "retomar", series: s })}>
              <Play aria-hidden="true" />
              Retomar
            </Button>
          ) : (
            <Button variant="ghost" className="h-10 px-3 text-destructive hover:text-destructive" onClick={() => setPanel({ kind: "encerrar", series: s })}>
              <Square aria-hidden="true" />
              Encerrar
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button className="h-10 px-4" disabled={!types.some((t) => !t.archived)} onClick={() => setPanel({ kind: "nova" })}>
          <Plus aria-hidden="true" />
          Nova recorrência
        </Button>
      </div>
      <NoticeRegion notice={notice} />
      {current.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs">Nenhuma recorrência.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs" aria-label="Recorrências">
          {current.map(item)}
        </ul>
      )}
      <Dialog open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          {panel?.kind === "nova" && <SeriesForm types={types} cnpjs={cnpjs} defaultDate={today} onSuccess={done} onCancel={() => setPanel(null)} />}
          {panel?.kind === "editar" && <SeriesForm types={types} cnpjs={cnpjs} edit={{ series: panel.series, fromDate: panel.fromDate }} defaultDate={panel.fromDate} onSuccess={done} onCancel={() => setPanel(null)} />}
          {panel?.kind === "encerrar" && <EndForm series={panel.series} today={today} onSuccess={done} onCancel={() => setPanel(null)} />}
          {panel?.kind === "retomar" && <ResumeForm series={panel.series} today={today} onSuccess={done} onCancel={() => setPanel(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
