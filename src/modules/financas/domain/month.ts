import type { CivilDate } from "@/lib/dates";
import type { CardCharge, EntryView, FinArea, FinInvoice } from "../types";

/**
 * Aba Mês (pura, sem banco): contas fora do cartão e faturas de cartão que vencem no mês.
 * Cada fatura conta UMA vez, pelo total considerado (o pago; senão o informado; senão a soma das compras
 * cadastradas); as compras só detalham a fatura e nunca são somadas por fora dela.
 * Total = Pago + A pagar. Conta com "valor a informar" fica fora dos totais e é contada à parte.
 */

export const MONTH_SITUATIONS = ["todas", "a-pagar", "pagas"] as const;
export type MonthSituation = (typeof MONTH_SITUATIONS)[number];

export const MONTH_SITUATION_LABELS: Record<MonthSituation, string> = {
  todas: "Todas",
  "a-pagar": "A pagar",
  pagas: "Pagas",
};

/** Vale para contas e para faturas de cartão. */
export function matchesMonthSituation(item: { status: string }, situation: MonthSituation): boolean {
  if (situation === "todas") return true;
  return situation === "a-pagar" ? item.status === "pendente" : item.status === "pago";
}

/** Contas por vencimento; no mesmo dia, pela descrição. */
export function sortEntries(entries: EntryView[]): EntryView[] {
  return [...entries].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description, "pt-BR"));
}

/** Fatura pronta para a tela: com as compras daquele vencimento e o atraso calculado. */
export type InvoiceView = FinInvoice & { overdue: boolean; charges: CardCharge[] };

/** Junta cada fatura às suas compras; ordem por vencimento e, no mesmo dia, pelo nome do cartão. */
export function buildInvoices(invoices: FinInvoice[], charges: CardCharge[], today: CivilDate): InvoiceView[] {
  const byInvoice = new Map<string, CardCharge[]>();
  for (const charge of charges) byInvoice.set(charge.invoiceId, [...(byInvoice.get(charge.invoiceId) ?? []), charge]);
  return invoices
    .map((invoice) => ({ ...invoice, overdue: invoice.status === "pendente" && invoice.dueDate < today, charges: byInvoice.get(invoice.id) ?? [] }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.cardName.localeCompare(b.cardName, "pt-BR"));
}

/** Parte da fatura sem compra cadastrada (total − compras). Negativa quando o total é menor que as compras. */
export const invoiceRemainder = (invoice: Pick<FinInvoice, "totalCents" | "detailedCents">) => invoice.totalCents - invoice.detailedCents;

export type MonthTotals = {
  /** Pago + A pagar (só valores conhecidos). */
  total: bigint;
  pago: bigint;
  aPagar: bigint;
  /** Parte de "A pagar" com vencimento antes de hoje. */
  atrasado: bigint;
  atrasadoCount: number;
  /** Contas com valor a informar (fora dos totais). */
  unknownCount: number;
  count: number;
};

/**
 * Totais do mês. Com `areaId`, entra só o que é daquela área: as contas dela e, de cada fatura, as
 * compras dela (a parte da fatura sem compra cadastrada não tem área e fica fora do recorte).
 */
export function monthTotals(entries: EntryView[], invoices: InvoiceView[], areaId: string | null = null): MonthTotals {
  const t: MonthTotals = { total: 0n, pago: 0n, aPagar: 0n, atrasado: 0n, atrasadoCount: 0, unknownCount: 0, count: 0 };
  const add = (cents: number, paid: boolean, overdue: boolean) => {
    if (paid) t.pago += BigInt(cents);
    else {
      t.aPagar += BigInt(cents);
      if (overdue) t.atrasado += BigInt(cents);
    }
  };
  for (const entry of entries) {
    if (areaId && entry.areaId !== areaId) continue;
    t.count++;
    if (entry.status === "pendente" && entry.overdue) t.atrasadoCount++;
    if (entry.amountCents === null) t.unknownCount++;
    else add(entry.amountCents, entry.status === "pago", entry.overdue);
  }
  for (const group of cardGroups(invoices, areaId)) {
    t.count++;
    if (group.invoice.overdue) t.atrasadoCount++;
    add(group.cents, group.invoice.status === "pago", group.invoice.overdue);
  }
  t.total = t.pago + t.aPagar;
  return t;
}

export type AreaGroup = { areaId: string; area: FinArea | undefined; entries: EntryView[]; totals: MonthTotals };

/** Separa as contas por área, na ordem das áreas (ativas e depois arquivadas, por nome); área desconhecida por último. */
export function groupByArea(entries: EntryView[], areas: FinArea[]): AreaGroup[] {
  const byArea = new Map<string, EntryView[]>();
  for (const entry of sortEntries(entries)) byArea.set(entry.areaId, [...(byArea.get(entry.areaId) ?? []), entry]);
  const order = new Map(areas.map((a, i) => [a.id, i]));
  return [...byArea.entries()]
    .sort(([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER))
    .map(([areaId, list]) => ({ areaId, area: areas.find((a) => a.id === areaId), entries: list, totals: monthTotals(list, []) }));
}

/** Bloco de um cartão no mês: a linha da fatura (onde se paga) e as compras abaixo dela. */
export type CardGroup = {
  invoice: InvoiceView;
  /** Compras mostradas (com filtro de área, só as dela). */
  charges: CardCharge[];
  /** Valor da linha do cartão: o total da fatura ou, com filtro de área, a soma das compras da área. */
  cents: number;
  /** Parte sem compra cadastrada; null com filtro de área ou quando o total bate com as compras. */
  remainderCents: number | null;
  /** Compras de outras áreas, fora do filtro. */
  hiddenCount: number;
  /** Recorte de uma área: o valor da linha é só das compras dela (o pagamento continua sendo da fatura inteira). */
  scoped: boolean;
};

/** Um bloco por fatura. Com filtro de área, só as faturas com compra da área, mostrando o que é dela. */
export function cardGroups(invoices: InvoiceView[], areaId: string | null): CardGroup[] {
  if (!areaId) {
    return invoices.map((invoice) => {
      const remainder = invoiceRemainder(invoice);
      return { invoice, charges: invoice.charges, cents: invoice.totalCents, remainderCents: remainder === 0 ? null : remainder, hiddenCount: 0, scoped: false };
    });
  }
  return invoices.flatMap((invoice) => {
    const charges = invoice.charges.filter((c) => c.areaId === areaId);
    if (charges.length === 0) return [];
    return [{ invoice, charges, cents: charges.reduce((sum, c) => sum + c.amountCents, 0), remainderCents: null, hiddenCount: invoice.charges.length - charges.length, scoped: true }];
  });
}
