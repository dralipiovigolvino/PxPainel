"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, MoveRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatCivilDate, formatYearMonth, type CivilDate, type YearMonth } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CnpjOption } from "@/modules/cnpj/types";
import { ConfirmDialog, type ConfirmRequest } from "@/modules/financas/components/confirm-dialog";
import { NoticeRegion, useNotice } from "@/modules/financas/components/form-bits";
import { cancelShiftAction, deleteShiftAction, doneShiftAction, undoReceiptAction } from "../actions";
import { PL_PAYMENT_LABELS, PL_PAYMENTS, PL_SITUATION_LABELS, PL_SITUATIONS, type PlPayment, type PlSituation } from "../domain/totals";
import { selectClass } from "@/modules/financas/components/series-fields";
import { ReceiveForm } from "./receive-form";
import type { CalendarDay } from "../calendar-grid";
import type { PlSeries } from "../series-data";
import type { PlShift, PlType } from "../types";
import { MoveForm } from "./move-form";
import { PlCoverageNotice, PlGenerationSync } from "./pl-generation-sync";
import { SeriesForm } from "./series-form";
import { useShiftDrag } from "./use-shift-drag";
import { MonthCalendar } from "./month-calendar";
import { ShiftDetails, STATUS_LABEL } from "./shift-details";
import { ShiftForm } from "./shift-form";

export type PlantoesViewProps = {
  month: YearMonth;
  today: CivilDate;
  types: PlType[];
  shifts: PlShift[];
  showCanceled: boolean;
  series: PlSeries[];
  /** Geração pendente até esta data (null = já gerado). */
  generationTarget: CivilDate | null;
  /** Período exibido além do limite de geração (null = completo). */
  coverageLimit: CivilDate | null;
  filters: { typeId: string | null; situation: PlSituation; payment: PlPayment };
  /** Totais já formatados (competência: mês de início; cancelados fora). */
  totals: { programado: string; recebidoDoMes: string; aReceber: string; count: number };
  /** Recebido no mês pela data real do recebimento. */
  receivedInMonth: { total: string; count: number };
  /** Agendados com data passada (qualquer mês). */
  toConfirm: PlShift[];
  /** Abre os detalhes desta ocorrência ao carregar (link do dashboard), se estiver no mês. */
  openShiftId?: string | null;
  /** CNPJs cadastrados, para a marcação "Recebo por CNPJ" dos formulários. */
  cnpjs: CnpjOption[];
  /** Plantões do mês recebidos por CNPJ (valores já formatados); null = nenhum. */
  cnpjTotal: CnpjTotal | null;
};

/** `payMonth`: mês em que o imposto estimado é pago (o seguinte ao exibido), em minúsculas. */
export type CnpjTotal = { count: number; amount: string; tax: string; net: string };

type Panel =
  | { kind: "novo"; date: CivilDate }
  | { kind: "detalhes"; shift: PlShift }
  | { kind: "editar"; shift: PlShift }
  | { kind: "mover"; shift: PlShift; date: CivilDate }
  | { kind: "serie"; series: PlSeries; fromDate: CivilDate }
  | { kind: "receber"; shift: PlShift }
  | null;

/** Nome acessível da bolinha: tipo + data (+ situação e indicadores), sem depender da cor. */
export function dotLabel(shift: PlShift, type: PlType | undefined) {
  const extras = [
    shift.status !== "agendado" ? STATUS_LABEL[shift.status].toLowerCase() : null,
    shift.receivedOn ? "recebido" : null,
    shift.moved ? "movido" : null,
    shift.notes ? "com observação" : null,
  ].filter(Boolean);
  return `Plantão ${type?.name ?? ""} em ${formatCivilDate(shift.date)}${extras.length ? `, ${extras.join(", ")}` : ""}`;
}

/** Bolinha: pequena no visual, alvo de toque de 28 px. Contorno discreto = observação ou troca. */
export function ShiftDot({ shift, type, onOpen, dragProps }: { shift: PlShift; type: PlType | undefined; onOpen: () => void; dragProps?: React.HTMLAttributes<HTMLButtonElement> }) {
  const color = type?.color ?? "#64748b";
  const marked = Boolean(shift.notes) || shift.moved;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={dotLabel(shift, type)}
      title={dotLabel(shift, type)}
      data-shift-dot={shift.id}
      data-status={shift.status}
      className="flex size-7 items-center justify-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
      {...dragProps}
    >
      <span
        aria-hidden="true"
        className={cn("block size-3 rounded-full", marked && "ring-2 ring-foreground/50 ring-offset-1 ring-offset-card", shift.status === "cancelado" && "opacity-60")}
        style={shift.status === "cancelado" ? { border: `2px solid ${color}` } : { backgroundColor: color }}
      />
    </button>
  );
}

export function Legend({ types }: { types: PlType[] }) {
  if (types.length === 0) return null;
  return (
    <details className="border-t px-4 py-2 text-sm" data-legend="">
      <summary className="cursor-pointer py-1 text-muted-foreground">Legenda</summary>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 py-2">
        {types.map((t) => (
          <li key={t.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="block size-3 rounded-full" style={{ backgroundColor: t.color }} />
            {t.name}
            {t.archived && <span className="text-muted-foreground">(arquivado)</span>}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span aria-hidden="true" className="block size-3 rounded-full bg-muted-foreground/40 ring-2 ring-foreground/50 ring-offset-1" />
          contorno = observação ou troca
        </li>
      </ul>
    </details>
  );
}

export function PlantoesView({ month, today, types, shifts, showCanceled, series, generationTarget, coverageLimit, filters, totals, receivedInMonth, toConfirm, openShiftId, cnpjs, cnpjTotal }: PlantoesViewProps) {
  const router = useRouter();
  const [notice, showNotice] = useNotice();
  const [panel, setPanel] = useState<Panel>(() => {
    const target = openShiftId ? (shifts.find((s) => s.id === openShiftId) ?? toConfirm.find((s) => s.id === openShiftId)) : undefined;
    return target ? { kind: "detalhes", shift: target } : null;
  });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const typeById = new Map(types.map((t) => [t.id, t]));
  const seriesById = new Map(series.map((x) => [x.id, x]));
  // Arrastar uma bolinha para outro dia abre a confirmação (nada muda antes de confirmar e gravar).
  const { drag, dragProps } = useShiftDrag((shift, date) => setPanel({ kind: "mover", shift, date }));
  const done = useCallback(
    (m: string) => {
      setPanel(null);
      setConfirm(null);
      showNotice(m);
    },
    [showNotice],
  );
  // As ocorrências chegam já filtradas por tipo/situação/pagamento; cancelados só com o filtro.
  const visible = shifts.filter((s) => showCanceled || filters.situation === "cancelado" || s.status !== "cancelado");
  const byDate = new Map<CivilDate, PlShift[]>();
  for (const s of visible) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const hasActiveTypes = types.some((t) => !t.archived);
  const query = (overrides: Partial<{ mes: string; tipo: string | null; situacao: PlSituation; pagamento: PlPayment; cancelados: boolean }>) => {
    const next = { mes: formatYearMonth(month), tipo: filters.typeId, situacao: filters.situation, pagamento: filters.payment, cancelados: showCanceled, ...overrides };
    const params = new URLSearchParams({ mes: next.mes });
    if (next.tipo) params.set("tipo", next.tipo);
    if (next.situacao !== "todos") params.set("situacao", next.situacao);
    if (next.pagamento !== "todos") params.set("pagamento", next.pagamento);
    if (next.cancelados) params.set("cancelados", "1");
    return `/plantoes?${params}`;
  };
  const monthParam = (m: YearMonth) => query({ mes: formatYearMonth(m) });
  const filtered = filters.typeId !== null || filters.situation !== "todos" || filters.payment !== "todos";
  const groups = [...new Set(visible.filter((s) => s.status !== "cancelado").map((s) => s.typeId))].map((typeId) => ({ type: typeById.get(typeId), shifts: visible.filter((s) => s.typeId === typeId && s.status !== "cancelado") }));

  const renderDay = (cell: CalendarDay) => {
    const isToday = cell.date === today;
    const dayShifts = byDate.get(cell.date) ?? [];
    return (
      <div className="flex flex-col items-start gap-0.5">
        <button
          type="button"
          onClick={() => hasActiveTypes && setPanel({ kind: "novo", date: cell.date })}
          aria-label={`${formatCivilDate(cell.date)}${isToday ? " (hoje)" : ""}: adicionar plantão${dayShifts.length ? `; ${dayShifts.length} plantão(ões) no dia` : ""}`}
          aria-current={isToday ? "date" : undefined}
          disabled={!hasActiveTypes}
          data-day={cell.date}
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-sm tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent",
            isToday && "bg-primary/10 font-semibold text-primary ring-1 ring-primary/40",
          )}
        >
          <time dateTime={cell.date}>{cell.day}</time>
        </button>
        {dayShifts.length > 0 && (
          <div className="flex flex-wrap" data-day-dots={cell.date}>
            {dayShifts.map((s) => (
              <ShiftDot key={s.id} shift={s} type={typeById.get(s.typeId)} onOpen={() => setPanel({ kind: "detalhes", shift: s })} dragProps={dragProps(s)} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-10 px-4" disabled={!hasActiveTypes} onClick={() => setPanel({ kind: "novo", date: month.year === Number(today.slice(0, 4)) && month.month === Number(today.slice(5, 7)) ? today : `${formatYearMonth(month)}-01` })}>
          <Plus aria-hidden="true" />
          Novo plantão
        </Button>
        {!hasActiveTypes && (
          <p className="text-sm text-muted-foreground">
            Crie um tipo em{" "}
            <Link href="/plantoes/organizacao#tipos" className="underline">
              Tipos
            </Link>{" "}
            para adicionar plantões.
          </p>
        )}
      </div>
      <PlGenerationSync target={generationTarget} />
      {coverageLimit && <PlCoverageNotice limit={coverageLimit} />}
      <NoticeRegion notice={notice} />
      <section aria-labelledby="pl-totais" className="rounded-xl border bg-card p-4 shadow-xs" data-totals="">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pl-totais" className="font-semibold">Resumo do mês</h2>
            <span className="text-sm text-muted-foreground" data-total-count="">{totals.count === 1 ? "1 plantão" : `${totals.count} plantões`}{filtered ? " (com filtros)" : ""}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div data-total="programado"><dt className="text-xs text-muted-foreground">Programado</dt><dd className="text-sm font-semibold tabular-nums sm:text-base">{totals.programado}</dd></div>
            <div data-total="recebido-do-mes"><dt className="text-xs text-muted-foreground">Recebido</dt><dd className="text-sm font-semibold tabular-nums sm:text-base">{totals.recebidoDoMes}</dd></div>
            <div data-total="a-receber"><dt className="text-xs text-muted-foreground">A receber</dt><dd className="text-sm font-semibold tabular-nums sm:text-base">{totals.aReceber}</dd></div>
            {cnpjTotal && <div data-total="liquido"><dt className="text-xs text-muted-foreground">Líquido estimado</dt><dd className="text-sm font-semibold tabular-nums sm:text-base">{cnpjTotal.net}</dd></div>}
          </dl>
          {cnpjTotal && <p className="mt-3 border-t pt-2 text-sm" data-cnpj-total=""><span className="text-muted-foreground">Por CNPJ ({cnpjTotal.count}):</span> <span className="tabular-nums" data-value="amount">{cnpjTotal.amount}</span><span className="text-muted-foreground"> · imposto estimado <span className="font-medium text-foreground tabular-nums" data-value="tax">{cnpjTotal.tax}</span></span></p>}
          {receivedInMonth.count > 0 && <p className="mt-2 text-xs text-muted-foreground" data-received-in-month="">Entrou neste mês (plantões de qualquer data): <span className="font-medium text-foreground tabular-nums">{receivedInMonth.total}</span></p>}
      </section>
      <MonthCalendar month={month} today={today} renderDay={renderDay} monthHref={monthParam} footer={<Legend types={types} />} dropTarget={drag?.target ?? null} />
      <section aria-labelledby="pl-lista-mes" className="rounded-xl border bg-card shadow-xs" data-month-list="">
        <h2 id="pl-lista-mes" className="border-b px-4 py-2.5 font-semibold">Plantões do mês</h2>
        {groups.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground">Nenhum plantão neste mês.</p> : groups.map(({ type, shifts: items }) => (
          <div key={type?.id ?? items[0].typeId} className="border-b last:border-b-0">
            <h3 className="bg-muted/40 px-4 py-2 text-sm font-medium">{type?.location || type?.name || "Sem local"} <span className="font-normal text-muted-foreground">· {items.length}</span></h3>
            <ul className="divide-y">{items.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"><button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => setPanel({ kind: "detalhes", shift: s })}><span className="font-medium">{type?.name ?? "Plantão"}</span> · {formatCivilDate(s.date)}{s.hours ? ` · ${s.hours.start}–${s.hours.end}${s.hours.nextDay ? " (+1)" : ""}` : ""}</button><span className="flex items-center gap-2"><span className="font-medium tabular-nums">{formatCents(s.amountCents)}</span>{s.receivedOn ? <span className="text-emerald-700">Pago</span> : <Button variant="outline" className="h-9 px-3" onClick={() => setPanel({ kind: "receber", shift: s })}>Marcar pago</Button>}</span></li>)}</ul>
          </div>
        ))}
      </section>
      {toConfirm.length > 0 && (
        <section aria-labelledby="pl-a-confirmar" className="rounded-xl border bg-card shadow-xs" data-to-confirm="">
          <h2 id="pl-a-confirmar" className="border-b px-4 py-2.5 font-semibold">
            A confirmar <span className="font-normal text-muted-foreground">{toConfirm.length}</span>
          </h2>
          <ul className="divide-y">
            {toConfirm.slice(0, 20).map((s) => {
              const t = typeById.get(s.typeId);
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="block size-3 shrink-0 rounded-full" style={{ backgroundColor: t?.color ?? "#64748b" }} />
                    <span className="truncate">
                      {t?.name ?? "Plantão"} · {formatCivilDate(s.date)}
                    </span>
                  </span>
                  <Button variant="outline" className="h-9 px-3" onClick={() => setPanel({ kind: "detalhes", shift: s })} aria-label={`Abrir plantão ${t?.name ?? ""} de ${formatCivilDate(s.date)}`}>
                    Abrir
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <details className="rounded-xl border bg-card shadow-xs" open={filtered || showCanceled || undefined} data-filters="">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Filtros{filtered ? " (ativos)" : ""}</summary>
        <div className="grid gap-3 border-t p-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Tipo
            <select className={selectClass} value={filters.typeId ?? ""} onChange={(e) => router.push(query({ tipo: e.target.value || null }))} data-filter="tipo">
              <option value="">Todos os tipos</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Situação
            <select className={selectClass} value={filters.situation} onChange={(e) => router.push(query({ situacao: e.target.value as PlSituation }))} data-filter="situacao">
              {PL_SITUATIONS.map((v) => (
                <option key={v} value={v}>
                  {PL_SITUATION_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Pagamento
            <select className={selectClass} value={filters.payment} onChange={(e) => router.push(query({ pagamento: e.target.value as PlPayment }))} data-filter="pagamento">
              {PL_PAYMENTS.map((v) => (
                <option key={v} value={v}>
                  {PL_PAYMENT_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
          <Link href={query({ cancelados: !showCanceled })} className="inline-flex h-10 w-fit items-center text-sm font-medium underline-offset-4 hover:underline" data-toggle-canceled="">
            {showCanceled ? "Ocultar cancelados" : "Mostrar cancelados"}
          </Link>
        </div>
      </details>
      {drag && (
        <span
          aria-hidden="true"
          data-drag-ghost=""
          className="pointer-events-none fixed z-50 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg ring-2 ring-background"
          style={{ left: drag.x, top: drag.y, backgroundColor: typeById.get(drag.shift.typeId)?.color ?? "#64748b" }}
        />
      )}

      <Dialog open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          {panel?.kind === "novo" && <ShiftForm types={types} defaultDate={panel.date} cnpjs={cnpjs} onSuccess={done} onCancel={() => setPanel(null)} />}
          {panel?.kind === "editar" && <ShiftForm types={types} shift={panel.shift} defaultDate={panel.shift.date} cnpjs={cnpjs} onSuccess={done} onCancel={() => setPanel(null)} />}
          {panel?.kind === "mover" && (
            <MoveForm shift={panel.shift} type={typeById.get(panel.shift.typeId)} initialDate={panel.date} today={today} onSuccess={done} onCancel={() => setPanel(null)} />
          )}
          {panel?.kind === "receber" && <ReceiveForm shift={panel.shift} today={today} onSuccess={done} onCancel={() => setPanel(null)} />}
          {panel?.kind === "serie" && <SeriesForm types={types} cnpjs={cnpjs} edit={{ series: panel.series, fromDate: panel.fromDate }} defaultDate={panel.fromDate} onSuccess={done} onCancel={() => setPanel(null)} />}
          {panel?.kind === "detalhes" && (
            <ShiftDetails
              shift={panel.shift}
              type={typeById.get(panel.shift.typeId)}
              today={today}
              actions={{
                extra: panel.shift.status !== "cancelado" && (
                  <>
                    <Button variant="outline" className="h-10 px-3" onClick={() => setPanel({ kind: "mover", shift: panel.shift, date: panel.shift.date })}>
                      <MoveRight aria-hidden="true" />
                      Mover
                    </Button>
                    {panel.shift.seriesId && seriesById.get(panel.shift.seriesId) && (
                      <Button
                        variant="ghost"
                        className="h-10 px-3"
                        onClick={() => setPanel({ kind: "serie", series: seriesById.get(panel.shift.seriesId!)!, fromDate: panel.shift.originalDate ?? panel.shift.date })}
                      >
                        <CalendarRange aria-hidden="true" />
                        Alterar recorrência a partir deste
                      </Button>
                    )}
                  </>
                ),
                onEdit: () => setPanel({ kind: "editar", shift: panel.shift }),
                onDone: () =>
                  setConfirm({
                    title: "Marcar como realizado?",
                    description: "O instante desta marcação fica registrado no histórico.",
                    confirmLabel: "Marcar realizado",
                    action: doneShiftAction,
                    fields: { id: panel.shift.id, done: "true" },
                  }),
                onUndoDone: () =>
                  setConfirm({
                    title: "Desfazer a realização?",
                    description: "O plantão volta a agendado. O registro anterior fica no histórico.",
                    confirmLabel: "Desfazer realização",
                    action: doneShiftAction,
                    fields: { id: panel.shift.id, done: "false" },
                  }),
                onReceive: () => setPanel({ kind: "receber", shift: panel.shift }),
                onUndoReceipt: () =>
                  setConfirm({
                    title: "Desfazer o recebimento?",
                    description: "A data do recebimento é apagada e o plantão volta a constar como a receber. O registro anterior fica no histórico.",
                    confirmLabel: "Desfazer recebimento",
                    destructive: true,
                    action: undoReceiptAction,
                    fields: { id: panel.shift.id },
                  }),
                onCancel: () =>
                  setConfirm({
                    title: "Cancelar este plantão?",
                    description: "Ele sai do calendário padrão e dos totais, mas continua no histórico e no filtro de cancelados.",
                    confirmLabel: "Cancelar plantão",
                    destructive: true,
                    action: cancelShiftAction,
                    fields: { id: panel.shift.id, cancel: "true" },
                  }),
                onRestore: () =>
                  setConfirm({
                    title: "Restaurar este plantão?",
                    description: "Ele volta a agendado e entra de novo nos totais.",
                    confirmLabel: "Restaurar",
                    action: cancelShiftAction,
                    fields: { id: panel.shift.id, cancel: "false" },
                  }),
                onDelete: () =>
                  setConfirm({
                    title: "Excluir este plantão?",
                    description: "A ocorrência será apagada. O registro da exclusão fica no histórico do tipo.",
                    confirmLabel: "Excluir",
                    destructive: true,
                    action: deleteShiftAction,
                    fields: { id: panel.shift.id },
                  }),
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} onOpenChange={(o) => !o && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
