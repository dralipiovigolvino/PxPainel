"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarCheck, CalendarClock, CircleCheck, ClipboardCheck, Loader2, RefreshCw, Stethoscope, Sun, Timer, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ensureGenerationAction } from "@/modules/financas/actions";
import { NoticeRegion, useNotice } from "@/modules/financas/components/form-bits";
import { InvoiceDialog, type InvoiceSummary } from "@/modules/financas/components/invoice-dialog";
import { PayDialog } from "@/modules/financas/components/pay-dialog";
import type { FinEntry } from "@/modules/financas/types";
import { ensurePlGenerationAction } from "@/modules/plantoes/actions";
import type { DashboardItem, DashboardSection, DashboardSource, ExamMonthSummary, ForecastSummaryRow, ShiftMonthSummary } from "../contract";

export type DashboardSectionProp = { section: DashboardSection; items: DashboardItem[]; summary: string | null };

export type DashboardViewProps = {
  today: CivilDate;
  sections: DashboardSectionProp[];
  failed: DashboardSource[];
  generation: { financas: CivilDate | null; plantoes: CivilDate | null };
  notes: string[];
  shiftSummary: ShiftMonthSummary | null;
  examSummary: ExamMonthSummary | null;
  /** Resumos do mês a mostrar, na ordem do menu do usuário (módulo oculto fica de fora). */
  summaryOrder: Array<"plantoes" | "pericias">;
};

/** Itens visíveis por seção (o resumo e os contadores consideram TODOS). */
const VISIBLE = 5;

const SECTION_META: Record<DashboardSection, { title: string; icon: typeof Sun }> = {
  hoje: { title: "Hoje", icon: Sun },
  atrasados: { title: "Atrasados", icon: AlertCircle },
  proximos: { title: "Próximos 7 dias", icon: CalendarClock },
  a_confirmar: { title: "A confirmar", icon: CalendarCheck },
  prazos: { title: "Acompanhamentos", icon: Timer },
};

const SOURCE_META: Record<DashboardSource, { label: string; icon: typeof Wallet }> = {
  financas: { label: "Finanças", icon: Wallet },
  followup: { label: "Follow-up", icon: Stethoscope },
  plantoes: { label: "Plantões", icon: CalendarCheck },
  pericias: { label: "Perícias", icon: ClipboardCheck },
};

const STATUS_LABEL: Record<DashboardItem["status"], string> = {
  hoje: "",
  atrasado: "Atrasado",
  proximo: "",
  em_andamento: "Em andamento",
  a_confirmar: "A confirmar",
  perto_de_encerrar: "Perto de encerrar",
  termina_hoje: "Termina hoje",
  encerrado: "Prazo encerrado",
  confirmar_atendimento: "Confirmar atendimento",
};

function StatusChip({ item }: { item: DashboardItem }) {
  const label = STATUS_LABEL[item.status];
  if (!label) return null;
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-xs font-medium",
        (item.status === "atrasado" || item.status === "encerrado") && "bg-destructive/10 text-destructive",
        (item.status === "perto_de_encerrar" || item.status === "termina_hoje" || item.status === "confirmar_atendimento") && "bg-amber-100 text-amber-950",
        item.status === "em_andamento" && "bg-emerald-100 text-emerald-900",
        item.status === "a_confirmar" && "bg-muted",
      )}
    >
      {label}
    </span>
  );
}

/** Conta mínima para reutilizar o diálogo de pagamento de Finanças (mesmas validações). */
const asEntry = (a: Extract<DashboardItem["actions"][number], { kind: "pagar_conta" }>): FinEntry => ({
  id: a.entryId,
  areaId: "",
  description: a.description,
  amountCents: a.amountCents,
  dueDate: a.dueDate,
  category: null,
  notes: null,
  status: "pendente",
  paidOn: null,
  seriesId: null,
  occurrenceDate: null,
  isOverride: false,
  isVariable: false,
  installmentPlanId: null,
  installmentNumber: null,
  installmentCount: null,
  paymentMethod: null,
});

/** Fatura mínima para reutilizar o diálogo de pagamento do cartão de Finanças (mesmas validações). */
const asInvoice = (a: Extract<DashboardItem["actions"][number], { kind: "pagar_fatura" }>): InvoiceSummary => ({
  id: a.invoiceId,
  cardName: a.cardName,
  dueDate: a.dueDate,
  status: "pendente",
  paidOn: null,
  statedCents: a.statedCents,
  detailedCents: a.detailedCents,
  totalCents: a.statedCents ?? a.detailedCents,
});

type PayHandlers = { onPay: (entry: FinEntry) => void; onPayInvoice: (invoice: InvoiceSummary) => void };

function ItemRow({ item, today, onPay, onPayInvoice }: { item: DashboardItem; today: CivilDate } & PayHandlers) {
  const source = SOURCE_META[item.source];
  const Icon = source.icon;
  const meta = [item.date !== today ? formatCivilDate(item.date) : null, item.detail].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-dash-item={item.key} data-source={item.source} data-attention={item.attention ? "" : undefined}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" title={source.label}>
        <Icon className="size-4" aria-hidden="true" />
        <span className="sr-only">{source.label}</span>
      </span>
      <div className="min-w-0 flex-1">
        <Link href={item.href} className="inline-flex min-h-6 items-center font-medium break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" data-dash-link="">
          {item.title}
        </Link>
        {(meta || STATUS_LABEL[item.status]) && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {meta && <span className="tabular-nums">{meta}</span>}
            <StatusChip item={item} />
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
        {item.amount.kind === "known" && <span className="font-semibold tabular-nums">{formatCents(item.amount.cents)}</span>}
        {item.amount.kind === "unknown" && <span className="text-sm text-muted-foreground italic">Valor a informar</span>}
        {item.actions.map((a) =>
          a.kind === "pagar_conta" || a.kind === "pagar_fatura" ? (
            <Button key={a.kind} variant="outline" className="h-9 px-3" onClick={() => (a.kind === "pagar_conta" ? onPay(asEntry(a)) : onPayInvoice(asInvoice(a)))} aria-label={`Pagar ${item.title}`}>
              Pagar
            </Button>
          ) : (
            <Button key={a.kind} asChild variant="outline" className="h-9 px-3">
              <Link href={a.href} aria-label={`${a.kind === "abrir_mensagem" ? "Mensagem" : "Marcar realizada"}: ${item.title} ${item.detail ?? ""}`}>
                {a.kind === "abrir_mensagem" ? "Mensagem" : "Realizada"}
              </Link>
            </Button>
          ),
        )}
      </div>
    </li>
  );
}

function SectionCard({ s, today, partial, onPay, onPayInvoice }: { s: DashboardSectionProp; today: CivilDate; partial: DashboardSource[] } & PayHandlers) {
  const [all, setAll] = useState(false);
  const meta = SECTION_META[s.section];
  const Icon = meta.icon;
  const visible = all ? s.items : s.items.slice(0, VISIBLE);
  return (
    <section aria-labelledby={`dash-${s.section}`} className="rounded-xl border bg-card shadow-xs" data-dash-section={s.section}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <h2 id={`dash-${s.section}`} className={cn("flex items-center gap-2 font-semibold", s.section === "atrasados" && "text-destructive")}>
          <Icon className="size-4" aria-hidden="true" />
          {meta.title} <span className="font-normal text-muted-foreground" data-dash-count="">{s.items.length}</span>
        </h2>
        {s.summary && (
          <p className="text-sm font-medium tabular-nums" data-dash-summary="">
            {s.summary}
          </p>
        )}
        {partial.length > 0 && (
          <p className="w-full text-sm text-destructive" data-dash-partial="">
            Parcial: {partial.map((f) => SOURCE_META[f].label).join(" e ")} indisponível.
          </p>
        )}
      </div>
      <ul className="divide-y">
        {visible.map((item) => (
          <ItemRow key={item.key} item={item} today={today} onPay={onPay} onPayInvoice={onPayInvoice} />
        ))}
      </ul>
      {s.items.length > VISIBLE && (
        <div className="border-t px-2 py-1">
          <Button variant="ghost" className="h-10 px-3" onClick={() => setAll((v) => !v)} aria-expanded={all} data-dash-more="">
            {all ? "Mostrar menos" : `Ver todos (${s.items.length})`}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Módulos que alimentam cada seção: a falha de um deles torna a seção parcial. */
const SECTION_SOURCES: Record<DashboardSection, DashboardSource[]> = {
  hoje: ["financas", "followup", "plantoes", "pericias"],
  atrasados: ["financas", "followup"],
  proximos: ["financas", "followup", "plantoes", "pericias"],
  a_confirmar: ["plantoes", "pericias"],
  prazos: ["followup"],
};

/**
 * Gera recorrências pendentes de Finanças e Plantões pela operação autenticada de cada módulo,
 * depois de montar a tela (nunca na renderização). Idempotente; atualiza a página se algo foi criado.
 */
function useGeneration(targets: DashboardViewProps["generation"]) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">(targets.financas || targets.plantoes ? "running" : "idle");
  const started = useRef<string | null>(null);
  useEffect(() => {
    const key = `${targets.financas}|${targets.plantoes}`;
    if ((!targets.financas && !targets.plantoes) || started.current === key) return;
    started.current = key;
    Promise.all([targets.financas ? ensureGenerationAction(targets.financas) : null, targets.plantoes ? ensurePlGenerationAction(targets.plantoes) : null])
      .then((rs) => {
        const results = rs.filter((r): r is { ok: boolean; created: number } => r !== null);
        if (results.some((r) => !r.ok)) return setState("error");
        setState("idle");
        if (results.some((r) => r.created > 0)) router.refresh();
      })
      .catch(() => setState("error"));
  }, [targets.financas, targets.plantoes, router]);
  return state;
}

/** Uma data de recebimento previsto, com o total dos plantões pagos nela. */
function ForecastRow({ row }: { row: ForecastSummaryRow }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-sm" data-dash-forecast={row.date} data-overdue={row.overdue ? "" : undefined}>
      <span className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{formatCivilDate(row.date)}</span>
        {row.overdue && <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">Vencida</span>}
      </span>
      <span className="tabular-nums">{row.total}</span>
    </li>
  );
}

function Stat({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div data-dash-total={id}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums sm:text-base">{value}</dd>
    </div>
  );
}

export function DashboardView({ today, sections, failed, generation, notes, shiftSummary, examSummary, summaryOrder }: DashboardViewProps) {
  const router = useRouter();
  const [notice, showNotice] = useNotice();
  const [paying, setPaying] = useState<FinEntry | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<InvoiceSummary | null>(null);
  const generationState = useGeneration(generation);
  const done = useCallback(
    (m: string) => {
      setPaying(null);
      setPayingInvoice(null);
      showNotice(m);
    },
    [showNotice],
  );
  const generating = generationState === "running";
  const filled = sections.filter((s) => s.items.length > 0);
  const forecast = shiftSummary ? [...shiftSummary.forecast.overdue, ...shiftSummary.forecast.next].slice(0, 4) : [];
  // Resumos do mês só aparecem com algo a mostrar; se o módulo falhou, o cartão fica para avisar.
  const showShifts = summaryOrder.includes("plantoes") && (!shiftSummary || shiftSummary.count > 0 || forecast.length > 0);
  const showExams = summaryOrder.includes("pericias") && (!examSummary || examSummary.agendadas.count + examSummary.realizadas.count > 0);

  const shiftCard = showShifts ? (
    <section key="plantoes" aria-labelledby="dash-plantoes-mes" className="rounded-xl border bg-card p-4 shadow-xs" data-dash-shift-summary="">
      <h2 id="dash-plantoes-mes" className="flex items-center justify-between gap-2 font-semibold">
        <span className="flex items-center gap-2">
          <CalendarCheck className="size-4" aria-hidden="true" />
          Plantões em {shiftSummary?.monthLabel.split(" de ")[0].toLowerCase() ?? "este mês"}
        </span>
        {shiftSummary && <span className="text-sm font-normal text-muted-foreground">{shiftSummary.count === 1 ? "1 plantão" : `${shiftSummary.count} plantões`}</span>}
      </h2>
      {!shiftSummary ? (
        <p className="mt-2 text-sm text-destructive">Resumo indisponível.</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <Stat id="programado" label="Programado" value={shiftSummary.programado} />
            <Stat id="recebido-do-mes" label="Recebido" value={shiftSummary.recebidoDoMes} />
            <Stat id="a-receber" label="A receber" value={shiftSummary.aReceber} />
          </dl>
          {forecast.length > 0 && (
            <div className="mt-3 border-t pt-2" data-dash-forecast-block="">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">Pagamentos previstos</h3>
                <Link href="/plantoes/previsao" className="inline-flex min-h-6 items-center text-sm underline underline-offset-4">
                  Ver todos
                </Link>
              </div>
              <ul className="divide-y">
                {forecast.map((row) => (
                  <ForecastRow key={row.date} row={row} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  ) : null;
  const examCard = showExams ? (
    <section key="pericias" aria-labelledby="dash-pericias-mes" className="rounded-xl border bg-card p-4 shadow-xs" data-dash-exam-summary="">
      <h2 id="dash-pericias-mes" className="flex items-center gap-2 font-semibold">
        <ClipboardCheck className="size-4" aria-hidden="true" />
        Perícias em {examSummary?.monthLabel.split(" de ")[0].toLowerCase() ?? "este mês"}
      </h2>
      {!examSummary ? (
        <p className="mt-2 text-sm text-destructive">Resumo indisponível.</p>
      ) : (
        <table className="mt-3 w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="pb-1 text-left font-normal" />
              <th scope="col" className="pb-1 text-right font-normal">
                Valor
              </th>
              {examSummary.hasTax && (
                <th scope="col" className="pb-1 text-right font-normal">
                  Imposto (est.)
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["agendadas", "Agendadas", examSummary.agendadas],
                ["realizadas", "Realizadas", examSummary.realizadas],
              ] as const
            ).map(([key, label, g]) => (
              <tr key={key} className="border-t" data-dash-exams={key}>
                <th scope="row" className="py-1.5 text-left font-medium">
                  {label} <span className="font-normal text-muted-foreground">{g.count}</span>
                </th>
                <td className="py-1.5 text-right font-semibold">{g.gross}</td>
                {examSummary.hasTax && <td className="py-1.5 text-right">{g.tax}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {generating && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground" data-dash-generating="">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Atualizando recorrências…
        </p>
      )}
      {generationState === "error" && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-dash-generation-error="">
          Não foi possível gerar as recorrências agora. Recarregue para tentar de novo.
        </p>
      )}
      {failed.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between" data-dash-failed={failed.join(",")}>
          <span>Painel parcial: {failed.map((f) => SOURCE_META[f].label).join(" e ")} não pôde ser carregado.</span>
          <Button variant="outline" className="h-10 w-fit px-3" onClick={() => router.refresh()}>
            <RefreshCw aria-hidden="true" />
            Tentar novamente
          </Button>
        </div>
      )}
      {notes.map((n) => (
        <p key={n} role="note" className="rounded-lg border px-3 py-2 text-sm">
          {n}
        </p>
      ))}
      <NoticeRegion notice={notice} />

      {filled.length === 0 && failed.length === 0 && !generating ? (
        <p className="flex items-center gap-2 rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground shadow-xs" data-dash-empty="">
          <CircleCheck className="size-5 text-emerald-700" aria-hidden="true" />
          Nada pendente para hoje nem para os próximos 7 dias.
        </p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {filled.map((s) => (
            <SectionCard key={s.section} s={s} today={today} partial={failed.filter((f) => SECTION_SOURCES[s.section].includes(f))} onPay={setPaying} onPayInvoice={setPayingInvoice} />
          ))}
        </div>
      )}

      <div className="grid items-start gap-4 empty:hidden lg:grid-cols-2">
        {summaryOrder.map((key) => (key === "plantoes" ? shiftCard : examCard))}
      </div>

      <PayDialog entry={paying} today={today} onOpenChange={(o) => !o && setPaying(null)} onSuccess={done} />
      <InvoiceDialog request={payingInvoice ? { mode: "pagar", invoice: payingInvoice } : null} today={today} onOpenChange={(o) => !o && setPayingInvoice(null)} onSuccess={done} />
    </div>
  );
}
