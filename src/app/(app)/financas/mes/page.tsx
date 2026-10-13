import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { addMonths, formatMonthLabel, formatYearMonth, isSameYearMonth, parseYearMonth, todayInSaoPaulo, yearMonthOf } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { listCardCharges, listCards, listInvoices } from "@/modules/financas/cards-data";
import { MonthView, type MonthViewProps } from "@/modules/financas/components/month-view";
import { listAreas, listMonthEntries } from "@/modules/financas/data";
import { cycleDueIn } from "@/modules/financas/domain/cards";
import { isUuid, monthRange } from "@/modules/financas/domain/filters";
import { buildInvoices, cardGroups, groupByArea, matchesMonthSituation, MONTH_SITUATIONS, monthTotals, type MonthSituation } from "@/modules/financas/domain/month";
import { generationWindow } from "@/modules/financas/domain/recurrence";
import { isOverdue } from "@/modules/financas/domain/status";
import { listCategories } from "@/modules/financas/overview-data";
import { listSeries, needsGeneration } from "@/modules/financas/series-data";
import { entryKind } from "@/modules/financas/types";

export const metadata: Metadata = { title: "Finanças · Mês" };

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function MesPage({ searchParams }: PageProps<"/financas/mes">) {
  const user = await requireUser();
  const today = todayInSaoPaulo();
  const params = await searchParams;
  const month = parseYearMonth(single(params.mes)) ?? yearMonthOf(today);
  const rawArea = single(params.area);
  const rawSituation = single(params.situacao);
  const situation: MonthSituation = (MONTH_SITUATIONS as readonly string[]).includes(rawSituation ?? "") ? (rawSituation as MonthSituation) : "todas";
  const focusEntryId = isUuid(single(params.conta)) ? single(params.conta)! : null;
  const focusInvoiceId = isUuid(single(params.fatura)) ? single(params.fatura)! : null;
  const { from, to } = monthRange(month);

  let loaded;
  try {
    const [areas, cards, series, entries, invoices, charges, categories] = await Promise.all([
      listAreas(user),
      listCards(user),
      listSeries(user),
      listMonthEntries(user, { month }),
      listInvoices(user, from, to),
      listCardCharges(user, from, to),
      listCategories(user),
    ]);
    // Somente leitura: se faltar gerar recorrências até o mês exibido, o navegador pede a geração.
    const window = generationWindow(to, today);
    const generationTarget = (await needsGeneration(user, window.target)) ? window.target : null;
    loaded = { areas, cards, series, entries, invoices, charges, categories, generationTarget, coverageLimit: window.truncated ? window.limit : null };
  } catch {
    return <LoadError />;
  }

  const { areas, cards } = loaded;
  // Área desconhecida na URL (apagada ou de outra conta): volta para "Todas".
  const areaId = rawArea && isUuid(rawArea) && areas.some((a) => a.id === rawArea.toLowerCase()) ? rawArea.toLowerCase() : null;
  const entries = loaded.entries.map((entry) => ({ ...entry, overdue: isOverdue(entry, today), kind: entryKind(entry) }));
  const invoices = buildInvoices(loaded.invoices, loaded.charges, today);
  // Com filtro de área: as contas dela e, em cada cartão, só as compras dela.
  const scopedEntries = areaId ? entries.filter((entry) => entry.areaId === areaId) : entries;
  const scopedCards = cardGroups(invoices, areaId);
  const totals = monthTotals(entries, invoices, areaId);

  const href = (overrides: { month?: typeof month; areaId?: string | null; situation?: MonthSituation }) => {
    const next = { month, areaId, situation, ...overrides };
    const query = new URLSearchParams({ mes: formatYearMonth(next.month) });
    if (next.areaId) query.set("area", next.areaId);
    if (next.situation !== "todas") query.set("situacao", next.situation);
    return `/financas/mes?${query}`;
  };
  const currentMonth = yearMonthOf(today);
  // Cartão ativo sem fatura neste mês: dá para informar o total (até o mês que vem; não polui os meses distantes).
  const offerInvoice = !areaId && formatYearMonth(month) <= formatYearMonth(addMonths(currentMonth, 1));

  const props: MonthViewProps = {
    today,
    monthLabel: formatMonthLabel(month),
    links: {
      prev: href({ month: addMonths(month, -1) }),
      next: href({ month: addMonths(month, 1) }),
      current: isSameYearMonth(month, currentMonth) ? null : href({ month: currentMonth }),
      areas: [{ id: null, href: href({ areaId: null }) }, ...areas.filter((a) => !a.archived || a.id === areaId).map((a) => ({ id: a.id, href: href({ areaId: a.id }) }))],
      situations: MONTH_SITUATIONS.map((s) => ({ id: s, href: href({ situation: s }) })),
    },
    areaId,
    situation,
    areas,
    cards,
    series: loaded.series,
    categories: loaded.categories,
    totals: {
      total: formatCents(totals.total),
      pago: formatCents(totals.pago),
      aPagar: formatCents(totals.aPagar),
      atrasado: formatCents(totals.atrasado),
      atrasadoCount: totals.atrasadoCount,
      unknownCount: totals.unknownCount,
    },
    groups: groupByArea(
      scopedEntries.filter((entry) => matchesMonthSituation(entry, situation)),
      areas,
    ).map((g) => ({ areaId: g.areaId, total: formatCents(g.totals.total), entries: g.entries })),
    cardGroups: scopedCards.filter((group) => matchesMonthSituation(group.invoice, situation)),
    missingCards: offerInvoice
      ? cards
          .filter((card) => !card.archived && !invoices.some((invoice) => invoice.cardId === card.id))
          .map((card) => ({ cardId: card.id, name: card.name, dueDate: cycleDueIn(month, card.closingDay, card.dueDay).dueDate }))
      : [],
    emptyMonth: scopedEntries.length === 0 && scopedCards.length === 0,
    // Nova conta: sugere hoje se estiver no mês exibido; senão, o dia 1 do mês.
    defaultDueDate: isSameYearMonth(month, currentMonth) ? today : from,
    generationTarget: loaded.generationTarget,
    coverageLimit: loaded.coverageLimit,
    focusEntryId,
    focusInvoiceId,
  };

  return <MonthView {...props} />;
}
