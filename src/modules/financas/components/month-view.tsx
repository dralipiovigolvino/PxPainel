"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FolderOpen, Plus } from "lucide-react";
import { FilterChips } from "@/components/filter-chips";
import { Button } from "@/components/ui/button";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { unpayEntryAction } from "../actions";
import { unpayInvoiceAction } from "../card-actions";
import { MONTH_SITUATION_LABELS, type CardGroup, type MonthSituation } from "../domain/month";
import type { CardCharge, EntryView, FinArea, FinCard, FinEntry, FinSeries } from "../types";
import { AmountDialog } from "./amount-dialog";
import { AreaFormDialog } from "./area-form-dialog";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { EntryFormDialog } from "./entry-form-dialog";
import { NoticeRegion, useNotice } from "./form-bits";
import { CoverageNotice, GenerationSync } from "./generation-sync";
import { InvoiceDialog, type InvoiceRequest, type InvoiceSummary } from "./invoice-dialog";
import { MonthList } from "./month-list";
import { PayDialog } from "./pay-dialog";
import { PurchaseEditDialog } from "./purchase-edit-dialog";
import { EndSeriesDialog, SeriesChangeDialog, type ChangeScope } from "./series-dialogs";

export type MonthViewProps = {
  today: CivilDate;
  monthLabel: string;
  links: {
    prev: string;
    next: string;
    /** null = já está no mês atual. */
    current: string | null;
    areas: Array<{ id: string | null; href: string }>;
    situations: Array<{ id: MonthSituation; href: string }>;
  };
  areaId: string | null;
  situation: MonthSituation;
  areas: FinArea[];
  cards: FinCard[];
  series: FinSeries[];
  categories: string[];
  totals: { total: string; pago: string; aPagar: string; atrasado: string; atrasadoCount: number; unknownCount: number };
  /** Contas fora do cartão, por área. */
  groups: Array<{ areaId: string; total: string; entries: EntryView[] }>;
  /** Faturas de cartão do mês, com as compras de cada uma. */
  cardGroups: CardGroup[];
  /** Cartões ativos ainda sem fatura neste mês: informar o total cria a fatura. */
  missingCards: Array<{ cardId: string; name: string; dueDate: CivilDate }>;
  /** Nada vence neste mês (na área escolhida), independentemente da situação. */
  emptyMonth: boolean;
  defaultDueDate: CivilDate;
  generationTarget: CivilDate | null;
  coverageLimit: CivilDate | null;
  /** Conta ou fatura a destacar (link do dashboard), ou null. */
  focusEntryId: string | null;
  focusInvoiceId: string | null;
};

export function MonthView(props: MonthViewProps) {
  const { areas, totals, today } = props;
  const [notice, showNotice] = useNotice();
  const [entryDialog, setEntryDialog] = useState<{ open: boolean; entry: EntryView | null }>({ open: false, entry: null });
  const [purchase, setPurchase] = useState<CardCharge | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRequest | null>(null);
  const [paying, setPaying] = useState<EntryView | null>(null);
  const [amountEntry, setAmountEntry] = useState<EntryView | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [seriesChange, setSeriesChange] = useState<{ series: FinSeries; scope: ChangeScope; fromDate: CivilDate } | null>(null);
  const [ending, setEnding] = useState<FinSeries | null>(null);
  const [areaDialog, setAreaDialog] = useState(false);
  const seriesById = new Map(props.series.map((s) => [s.id, s]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const activeAreas = areas.filter((a) => !a.archived);

  // Link direto (ex.: do dashboard): rola até a conta ou o cartão e destaca.
  useEffect(() => {
    const selector = props.focusEntryId ? `[data-entry-id="${props.focusEntryId}"]` : props.focusInvoiceId ? `[data-invoice-id="${props.focusInvoiceId}"]` : null;
    if (!selector) return;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("bg-primary/10", "outline", "outline-2", "outline-primary");
    el.setAttribute("data-focused", "");
  }, [props.focusEntryId, props.focusInvoiceId]);

  const finish = useCallback(
    (message: string) => {
      setEntryDialog({ open: false, entry: null });
      setPurchase(null);
      setInvoice(null);
      setPaying(null);
      setAmountEntry(null);
      setConfirm(null);
      setSeriesChange(null);
      setEnding(null);
      setAreaDialog(false);
      showNotice(message);
    },
    [showNotice],
  );

  const openSeries = (entry: FinEntry, scope: ChangeScope | "encerrar") => {
    const series = entry.seriesId ? seriesById.get(entry.seriesId) : undefined;
    setEntryDialog({ open: false, entry: null });
    if (!series) return;
    if (scope === "encerrar") setEnding(series);
    else setSeriesChange({ series, scope, fromDate: scope === "proximas" ? (entry.occurrenceDate ?? entry.dueDate) : today });
  };

  // Confirmações (excluir) aparecem no lugar do diálogo de edição.
  const askConfirm = (request: ConfirmRequest) => {
    setEntryDialog({ open: false, entry: null });
    setPurchase(null);
    setConfirm(request);
  };

  const askUnpay = (entry: EntryView) =>
    setConfirm({
      title: "Voltar para a pagar?",
      description: `"${entry.description}" deixa de constar como paga.`,
      confirmLabel: "Voltar para a pagar",
      action: unpayEntryAction,
      fields: { id: entry.id },
    });

  const askUnpayInvoice = (target: InvoiceSummary) => {
    setInvoice(null);
    setConfirm({
      title: "Voltar para a pagar?",
      description: `${target.cardName}, com vencimento em ${formatCivilDate(target.dueDate)}, deixa de constar como pago. O total informado continua.`,
      confirmLabel: "Voltar para a pagar",
      action: unpayInvoiceAction,
      fields: { invoiceId: target.id },
    });
  };

  if (areas.length === 0) {
    return (
      <section aria-labelledby="sem-areas" className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center shadow-xs">
        <FolderOpen className="size-6 text-muted-foreground" aria-hidden="true" />
        <h2 id="sem-areas" className="font-medium">
          Crie sua primeira área
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">Cada conta fica numa área (por exemplo, Casa ou Consultório).</p>
        <Button className="h-10 px-4" onClick={() => setAreaDialog(true)}>
          <Plus aria-hidden="true" />
          Criar área
        </Button>
        <NoticeRegion notice={notice} />
        <AreaFormDialog open={areaDialog} onOpenChange={setAreaDialog} onSuccess={finish} />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <GenerationSync target={props.generationTarget} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon" className="size-10">
            <Link href={props.links.prev} aria-label="Mês anterior" scroll={false}>
              <ChevronLeft aria-hidden="true" />
            </Link>
          </Button>
          <h2 className="min-w-36 text-center font-semibold" aria-live="polite" data-month-label="">
            {props.monthLabel}
          </h2>
          <Button asChild variant="outline" size="icon" className="size-10">
            <Link href={props.links.next} aria-label="Próximo mês" scroll={false}>
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
          {props.links.current && (
            <Button asChild variant="ghost" className="h-10 px-3">
              <Link href={props.links.current}>Hoje</Link>
            </Button>
          )}
        </div>
        <Button className="h-10 px-4" disabled={activeAreas.length === 0} onClick={() => setEntryDialog({ open: true, entry: null })}>
          <Plus aria-hidden="true" />
          Nova conta
        </Button>
      </div>

      {props.links.areas.length > 2 && (
        <FilterChips
          label="Área"
          items={props.links.areas.map(({ id, href }) => {
            const area = id ? areaById.get(id) : undefined;
            return { key: id ?? "todas", href, label: area?.name ?? "Todas", active: props.areaId === id, dot: area?.color };
          })}
        />
      )}

      <NoticeRegion notice={notice} />

      <section aria-label="Resumo do mês" className="rounded-xl border bg-card p-3 shadow-xs">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {(
            [
              ["total", "Total", totals.total],
              ["pago", "Pago", totals.pago],
              ["a-pagar", "A pagar", totals.aPagar],
            ] as const
          ).map(([key, label, value]) => (
            <div key={key} className={key === "total" ? "col-span-2 sm:col-span-1" : undefined} data-total={key}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold">{value}</dd>
              {key === "a-pagar" && totals.atrasadoCount > 0 && (
                <dd className="text-xs font-medium text-destructive" data-overdue="">
                  {totals.atrasado} atrasado{totals.atrasadoCount > 1 ? "s" : ""}
                </dd>
              )}
            </div>
          ))}
        </dl>
        {totals.unknownCount > 0 && (
          <p className="mt-2 text-xs text-muted-foreground" data-unknown="">
            {totals.unknownCount === 1 ? "1 conta com valor a informar (fora dos totais)." : `${totals.unknownCount} contas com valor a informar (fora dos totais).`}
          </p>
        )}
        {props.coverageLimit && <CoverageNotice limit={props.coverageLimit} />}
      </section>

      {!props.emptyMonth && (
        <FilterChips
          label="Situação"
          items={props.links.situations.map(({ id, href }) => ({ key: id, href, label: MONTH_SITUATION_LABELS[id], active: props.situation === id }))}
        />
      )}

      {props.emptyMonth ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs">Nenhuma conta neste mês.</p>
      ) : props.groups.length === 0 && props.cardGroups.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs">Nada nesta situação.</p>
      ) : (
        <MonthList
          groups={props.groups}
          cards={props.cardGroups}
          areaById={areaById}
          showAreaHeaders={!props.areaId}
          showAreaTags={!props.areaId && activeAreas.length > 1}
          onPay={setPaying}
          onUnpay={askUnpay}
          onSetAmount={setAmountEntry}
          onOpenEntry={(entry) => setEntryDialog({ open: true, entry })}
          onOpenCharge={setPurchase}
          onOpenInvoice={(target) => setInvoice({ mode: "editar", invoice: target })}
          onPayInvoice={(target) => setInvoice({ mode: "pagar", invoice: target })}
          onUnpayInvoice={askUnpayInvoice}
        />
      )}

      {props.missingCards.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Informar fatura de cartão">
          {props.missingCards.map((card) => (
            <Button key={card.cardId} variant="outline" className="h-10 px-3" onClick={() => setInvoice({ mode: "nova", card: { id: card.cardId, name: card.name }, dueDate: card.dueDate })} data-new-invoice={card.cardId}>
              <Plus aria-hidden="true" />
              Fatura do {card.name}
            </Button>
          ))}
        </div>
      )}

      <EntryFormDialog
        open={entryDialog.open}
        onOpenChange={(open) => setEntryDialog((current) => ({ open, entry: open ? current.entry : null }))}
        entry={entryDialog.entry}
        areas={areas}
        cards={props.cards}
        categories={props.categories}
        defaultAreaId={props.areaId}
        defaultDueDate={props.defaultDueDate}
        today={today}
        onSeriesAction={openSeries}
        onAskConfirm={askConfirm}
        onSuccess={finish}
      />
      <PurchaseEditDialog charge={purchase} areas={areas} categories={props.categories} onOpenChange={(open) => !open && setPurchase(null)} onAskConfirm={askConfirm} onSuccess={finish} />
      <InvoiceDialog request={invoice} today={today} onOpenChange={(open) => !open && setInvoice(null)} onSuccess={finish} onAskUnpay={askUnpayInvoice} />
      <PayDialog entry={paying} today={today} onOpenChange={(open) => !open && setPaying(null)} onSuccess={finish} />
      <AmountDialog entry={amountEntry} onOpenChange={(open) => !open && setAmountEntry(null)} onSuccess={finish} />
      <SeriesChangeDialog request={seriesChange} areas={areas} categories={props.categories} onOpenChange={(open) => !open && setSeriesChange(null)} onSuccess={finish} />
      <EndSeriesDialog series={ending} today={today} onOpenChange={(open) => !open && setEnding(null)} onSuccess={finish} />
      <ConfirmDialog request={confirm} onOpenChange={(open) => !open && setConfirm(null)} onSuccess={finish} />
    </div>
  );
}
