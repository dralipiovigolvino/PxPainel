"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatCivilDate, formatYearMonth, isSameYearMonth, yearMonthOf, type CivilDate, type YearMonth } from "@/lib/dates";
import { formatCents, formatCentsForInput } from "@/lib/money";
import { estimateTax } from "@/lib/tax";
import { cn } from "@/lib/utils";
import type { CnpjOption } from "@/modules/cnpj/types";
import { ConfirmDialog, type ConfirmRequest } from "@/modules/financas/components/confirm-dialog";
import { NoticeRegion, useNotice } from "@/modules/financas/components/form-bits";
import { selectClass } from "@/modules/financas/components/series-fields";
import { cancelExamAction, deleteExamAction, doneExamAction, undoExamReceiptAction } from "../actions";
import { needsConfirmation, PER_SITUATION_LABELS, PER_SITUATIONS, type PerSituation } from "../domain/totals";
import type { PerCompany, PerExam } from "../types";
import { CompanyForm } from "./company-form";
import { EXAM_STATUS_LABEL, ExamDetails, ExamReceiveForm, weekday } from "./exam-details";
import { ExamForm, type ExamDraft } from "./exam-form";
import { MonthCalendar } from "@/modules/plantoes/components/month-calendar";
import type { CalendarDay } from "@/modules/plantoes/calendar-grid";

type GroupTotals = { count: number; gross: string; tax: string; net: string };

export type PericiasViewProps = {
  month: YearMonth;
  today: CivilDate;
  /** Minutos desde 00:00 em São Paulo no momento da requisição (para "a confirmar" de hoje). */
  nowMinutes: number;
  companies: PerCompany[];
  /** Perícias do mês, já filtradas por empresa e situação. */
  exams: PerExam[];
  /** Agendadas de hoje em diante (qualquer mês), em ordem. */
  upcoming: PerExam[];
  /** Agendadas cujo horário já passou (qualquer mês). */
  toConfirm: PerExam[];
  filters: { companyId: string | null; situation: PerSituation };
  /** `hasTax`: alguma perícia do mês é recebida por CNPJ (há imposto estimado a mostrar). */
  totals: { agendadas: GroupTotals; realizadas: GroupTotals; total: GroupTotals; canceledCount: number; hasTax: boolean };
  /** CNPJs cadastrados, para a marcação "Recebo por CNPJ" dos formulários. */
  cnpjs: CnpjOption[];
  /** Abre os detalhes desta perícia ao carregar (link do dashboard). */
  openExamId?: string | null;
};

type Panel =
  | { kind: "form"; exam: PerExam | null }
  | { kind: "empresa"; exam: PerExam | null }
  | { kind: "detalhes"; exam: PerExam }
  | { kind: "receber"; exam: PerExam }
  | null;

const emptyDraft = (date: CivilDate, companies: PerCompany[]): ExamDraft => {
  const active = companies.filter((c) => !c.archived);
  // Uma única empresa ativa: já vem escolhida, com o valor padrão dela.
  const only = active.length === 1 ? active[0] : null;
  return { companyId: only?.id ?? "", date, time: "", amount: "", notes: "", amountAuto: true, cnpjId: "", cnpjAuto: true };
};
const draftOf = (e: PerExam): ExamDraft => ({ companyId: e.companyId, date: e.date, time: e.time, amount: formatCentsForInput(e.amountCents), notes: e.notes ?? "", amountAuto: false, cnpjId: e.cnpjId ?? "", cnpjAuto: false });

function StatusChip({ exam, toConfirm }: { exam: PerExam; toConfirm: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-xs font-medium",
          exam.status === "agendada" && "bg-muted",
          exam.status === "realizada" && "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
          exam.status === "cancelada" && "bg-destructive/10 text-destructive",
        )}
      >
        {EXAM_STATUS_LABEL[exam.status]}
      </span>
      {toConfirm && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">A confirmar</span>}
      {exam.receivedOn && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Recebimento registrado</span>}
    </span>
  );
}

function ExamRow({ exam, today, nowMinutes, showDate, onOpen }: { exam: PerExam; today: CivilDate; nowMinutes: number; showDate: boolean; onOpen: () => void }) {
  const { taxCents } = estimateTax(exam.amountCents, exam.taxRateBp);
  const canceled = exam.status === "cancelada";
  return (
    <li data-exam={exam.id} data-status={exam.status}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-1.5 px-4 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:flex-row sm:items-center sm:justify-between"
        aria-label={`Perícia ${exam.companyName}, ${formatCivilDate(exam.date)} às ${exam.time}, ${EXAM_STATUS_LABEL[exam.status].toLowerCase()}`}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className={cn("font-medium break-words", canceled && "text-muted-foreground line-through")}>
            <span className="tabular-nums">{exam.time}</span> · {exam.companyName}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {showDate && (
              <span className="tabular-nums">
                {formatCivilDate(exam.date)} ({weekday(exam.date)})
              </span>
            )}
            {exam.date === today && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">Hoje</span>}
            <StatusChip exam={exam} toConfirm={needsConfirmation(exam, today, nowMinutes)} />
          </span>
        </span>
        <span className="flex flex-col text-sm tabular-nums sm:items-end">
          <span className={cn("font-semibold", canceled && "font-normal text-muted-foreground line-through")}>{formatCents(exam.amountCents)}</span>
          {!canceled && exam.cnpjId && <span className="text-muted-foreground">por CNPJ · imposto est. {formatCents(taxCents)}</span>}
        </span>
      </button>
    </li>
  );
}

export function PericiasView({ month, today, nowMinutes, companies, exams, upcoming, toConfirm, filters, totals, cnpjs, openExamId }: PericiasViewProps) {
  const router = useRouter();
  const [notice, showNotice] = useNotice();
  const [panel, setPanel] = useState<Panel>(() => {
    const target = openExamId ? [...exams, ...upcoming, ...toConfirm].find((e) => e.id === openExamId) : undefined;
    return target ? { kind: "detalhes", exam: target } : null;
  });
  const [draft, setDraft] = useState<ExamDraft>(() => emptyDraft(today, companies));
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const done = useCallback(
    (m: string) => {
      setPanel(null);
      setConfirm(null);
      showNotice(m);
    },
    [showNotice],
  );
  const currentMonth = yearMonthOf(today);
  const isCurrent = isSameYearMonth(month, currentMonth);

  const query = (overrides: Partial<{ mes: string; empresa: string | null; situacao: PerSituation }>) => {
    const next = { mes: formatYearMonth(month), empresa: filters.companyId, situacao: filters.situation, ...overrides };
    const params = new URLSearchParams({ mes: next.mes });
    if (next.empresa) params.set("empresa", next.empresa);
    if (next.situacao !== "todas") params.set("situacao", next.situacao);
    return `/pericias?${params}`;
  };

  const openNew = () => {
    setDraft(emptyDraft(isCurrent ? today : `${formatYearMonth(month)}-01`, companies));
    setPanel({ kind: "form", exam: null });
  };
  const openEdit = (exam: PerExam) => {
    setDraft(draftOf(exam));
    setPanel({ kind: "form", exam });
  };

  // Canceladas só aparecem na lista quando o filtro as pede.
  const visible = exams.filter((e) => filters.situation === "cancelada" || filters.situation === "todas" || e.status !== "cancelada");
  const byDate = new Map<CivilDate, PerExam[]>();
  for (const e of visible) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const filtered = filters.companyId !== null || filters.situation !== "todas";

  const groups: Array<[key: string, label: string, t: GroupTotals]> = [
    ["agendadas", "Agendadas", totals.agendadas],
    ["realizadas", "Realizadas", totals.realizadas],
    ["total", "Agendadas + realizadas", totals.total],
  ];
  const renderDay = (cell: CalendarDay) => {
    const list = byDate.get(cell.date) ?? [];
    return <div className="flex min-w-0 flex-col gap-0.5"><button type="button" onClick={() => { setDraft(emptyDraft(cell.date, companies)); setPanel({ kind: "form", exam: null }); }} aria-label={`${formatCivilDate(cell.date)}: adicionar perícia`} className={cn("flex size-7 items-center justify-center rounded-full text-sm tabular-nums hover:bg-accent", cell.date === today && "bg-primary/10 font-semibold text-primary ring-1 ring-primary/40")}><time dateTime={cell.date}>{cell.day}</time></button>{list.map((e) => <button key={e.id} type="button" onClick={() => setPanel({ kind: "detalhes", exam: e })} className="w-full truncate rounded bg-primary/10 px-1 py-0.5 text-left text-[11px] leading-tight text-primary" title={`${e.time} · ${e.companyName}`}><span className="font-semibold tabular-nums">{e.time}</span> {e.companyName}</button>)}</div>;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button className="h-10 px-4" onClick={openNew}>
          <Plus aria-hidden="true" />
          Nova perícia
        </Button>
      </div>
      <NoticeRegion notice={notice} />
      <section aria-labelledby="per-resumo" className="rounded-xl border bg-card p-4 shadow-xs" data-exams-totals="">
        <h2 id="per-resumo" className="font-semibold">Resumo do mês</h2>
        {totals.total.count === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nenhuma perícia neste mês.</p> : <table className="mt-2 w-full text-sm tabular-nums"><thead className="text-xs text-muted-foreground"><tr><th className="pb-1 text-left font-normal" /><th className="pb-1 text-right font-normal">Valor</th>{totals.hasTax && <><th className="pb-1 text-right font-normal">Imposto (est.)</th><th className="pb-1 text-right font-normal">Líquido estimado</th></>}</tr></thead><tbody>{groups.map(([key, label, t]) => <tr key={key} className={cn("border-t", key === "total" && "font-semibold")} data-exams-total={key}><th className="py-1.5 text-left font-medium">{key === "total" ? "Total" : label} <span className="font-normal text-muted-foreground">{t.count}</span></th><td className="py-1.5 text-right" data-value="gross">{t.gross}</td>{totals.hasTax && <><td className="py-1.5 text-right" data-value="tax">{t.tax}</td><td className="py-1.5 text-right" data-value="net">{t.net}</td></>}</tr>)}</tbody></table>}
      </section>
      <MonthCalendar month={month} today={today} renderDay={renderDay} monthHref={(m) => query({ mes: formatYearMonth(m) })} />

      {toConfirm.length > 0 && (
        <section aria-labelledby="per-a-confirmar" className="rounded-xl border bg-card shadow-xs" data-exams-to-confirm="">
          <h2 id="per-a-confirmar" className="border-b px-4 py-2.5 font-semibold">
            A confirmar <span className="font-normal text-muted-foreground">{toConfirm.length}</span>
          </h2>
          <ul className="divide-y">
            {toConfirm.slice(0, 20).map((e) => (
              <ExamRow key={e.id} exam={e} today={today} nowMinutes={nowMinutes} showDate onOpen={() => setPanel({ kind: "detalhes", exam: e })} />
            ))}
          </ul>
        </section>
      )}


      <details className="rounded-xl border bg-card shadow-xs" open={filtered || undefined} data-filters="">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Filtros{filtered ? " (ativos)" : ""}</summary>
        <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Empresa
            <select className={selectClass} value={filters.companyId ?? ""} onChange={(e) => router.push(query({ empresa: e.target.value || null }))} data-filter="empresa">
              <option value="">Todas as empresas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? " (arquivada)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Situação
            <select className={selectClass} value={filters.situation} onChange={(e) => router.push(query({ situacao: e.target.value as PerSituation }))} data-filter="situacao">
              {PER_SITUATIONS.map((v) => (
                <option key={v} value={v}>
                  {PER_SITUATION_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>

      <Dialog open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          {panel?.kind === "form" && (
            <ExamForm
              companies={companies}
              exam={panel.exam}
              draft={draft}
              onDraft={setDraft}
              cnpjs={cnpjs}
              onNewCompany={() => setPanel({ kind: "empresa", exam: panel.exam })}
              onSuccess={done}
              onCancel={() => setPanel(null)}
            />
          )}
          {panel?.kind === "empresa" && (
            <CompanyForm
              company={null}
              cnpjs={cnpjs}
              cancelLabel="Voltar à perícia"
              onCancel={() => setPanel({ kind: "form", exam: panel.exam })}
              onSuccess={(message, id) => {
                // Volta ao formulário da perícia com a empresa nova escolhida; os demais campos ficam como estavam.
                if (id) setDraft((d) => ({ ...d, companyId: id, amountAuto: panel.exam ? d.amountAuto : true, cnpjAuto: panel.exam ? d.cnpjAuto : true }));
                setPanel({ kind: "form", exam: panel.exam });
                showNotice(message);
              }}
            />
          )}
          {panel?.kind === "receber" && <ExamReceiveForm exam={panel.exam} today={today} onSuccess={done} onCancel={() => setPanel(null)} />}
          {panel?.kind === "detalhes" && (
            <ExamDetails
              exam={panel.exam}
              toConfirm={needsConfirmation(panel.exam, today, nowMinutes)}
              actions={{
                onEdit: () => openEdit(panel.exam),
                onReceive: () => setPanel({ kind: "receber", exam: panel.exam }),
                onDone: () =>
                  setConfirm({ title: "Marcar como realizada?", description: "O instante desta marcação fica no histórico. Isso não registra recebimento.", confirmLabel: "Marcar realizada", action: doneExamAction, fields: { id: panel.exam.id, done: "true" } }),
                onUndoDone: () =>
                  setConfirm({ title: "Desfazer a realização?", description: "A perícia volta a agendada. O registro anterior fica no histórico.", confirmLabel: "Desfazer realização", action: doneExamAction, fields: { id: panel.exam.id, done: "false" } }),
                onUndoReceipt: () =>
                  setConfirm({
                    title: "Desfazer o recebimento?",
                    description: "A data do recebimento é apagada. O registro anterior fica no histórico.",
                    confirmLabel: "Desfazer recebimento",
                    destructive: true,
                    action: undoExamReceiptAction,
                    fields: { id: panel.exam.id },
                  }),
                onCancel: () =>
                  setConfirm({
                    title: "Cancelar esta perícia?",
                    description: "Ela sai dos totais, mas continua no histórico e no filtro de canceladas.",
                    confirmLabel: "Cancelar perícia",
                    destructive: true,
                    action: cancelExamAction,
                    fields: { id: panel.exam.id, cancel: "true" },
                  }),
                onRestore: () => setConfirm({ title: "Restaurar esta perícia?", description: "Ela volta a agendada e entra de novo nos totais.", confirmLabel: "Restaurar", action: cancelExamAction, fields: { id: panel.exam.id, cancel: "false" } }),
                onDelete: () =>
                  setConfirm({ title: "Excluir esta perícia?", description: "O registro será apagado. A exclusão fica no histórico da empresa.", confirmLabel: "Excluir", destructive: true, action: deleteExamAction, fields: { id: panel.exam.id } }),
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} onOpenChange={(o) => !o && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
