import { formatYearMonth, type CivilDate, type YearMonth } from "@/lib/dates";
import type { WorkRecord } from "@/modules/cnpj/contract";
import { DEFAULT_TAX_DUE_DAY, taxDueDate, type TaxDue } from "@/modules/cnpj/domain/tax";
import type { AnalyticsItem } from "./analytics";

/**
 * Entradas e fluxo da Visão geral (puro, sem banco).
 *
 * Entradas: plantões e perícias pelo dia em que o dinheiro entra — o recebimento registrado; sem ele,
 * a data prevista de pagamento; sem ela, o dia do trabalho. Valores como informados nos registros.
 * O imposto estimado do CNPJ não é descontado da entrada: é uma saída, no mês seguinte ao do trabalho.
 */

type Range = { from: CivilDate; to: CivilDate };

/** Registros cujo dinheiro entra no intervalo. */
export function incomeInRange(records: WorkRecord[], range: Range): WorkRecord[] {
  return records.filter((r) => r.cashDate >= range.from && r.cashDate <= range.to);
}

export type IncomeTotals = {
  /** Recebido + A receber. */
  total: bigint;
  recebido: bigint;
  aReceber: bigint;
  count: number;
};

export function incomeTotals(records: WorkRecord[]): IncomeTotals {
  const t: IncomeTotals = { total: 0n, recebido: 0n, aReceber: 0n, count: 0 };
  for (const r of records) {
    t.count++;
    if (r.received) t.recebido += BigInt(r.amountCents);
    else t.aReceber += BigInt(r.amountCents);
  }
  t.total = t.recebido + t.aReceber;
  return t;
}

export type IncomeBar = { month: YearMonth; recebido: bigint; aReceber: bigint; total: bigint };

/** Entradas por mês em que o dinheiro entra. */
export function incomeMonthly(records: WorkRecord[], months: YearMonth[]): IncomeBar[] {
  const bars = months.map((month) => ({ month, key: formatYearMonth(month), recebido: 0n, aReceber: 0n, total: 0n }));
  const byKey = new Map(bars.map((b) => [b.key, b]));
  for (const r of records) {
    const bar = byKey.get(r.cashDate.slice(0, 7));
    if (!bar) continue;
    const cents = BigInt(r.amountCents);
    if (r.received) bar.recebido += cents;
    else bar.aReceber += cents;
    bar.total += cents;
  }
  return bars.map(({ month, recebido, aReceber, total }) => ({ month, recebido, aReceber, total }));
}

export type IncomeSource = { key: string; source: WorkRecord["source"]; label: string; cents: bigint; count: number };

/** De onde veio: soma por tipo de plantão e por empresa de perícia, da maior para a menor. */
export function incomeSources(records: WorkRecord[]): IncomeSource[] {
  const map = new Map<string, IncomeSource>();
  for (const r of records) {
    const key = `${r.source}:${r.label.toLocaleLowerCase("pt-BR")}`;
    const row = map.get(key) ?? { key, source: r.source, label: r.label, cents: 0n, count: 0 };
    row.cents += BigInt(r.amountCents);
    row.count++;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : a.key.localeCompare(b.key)));
}

/**
 * Imposto estimado como saída: um item por CNPJ e mês de pagamento, no dia de pagamento do CNPJ.
 * Estimativa de valor zero não vira item.
 */
export function taxItems(dues: TaxDue[], cnpjs: ReadonlyMap<string, { name: string; taxDueDay: number }>): AnalyticsItem[] {
  return dues
    .filter((d) => d.taxCents > 0n)
    .map((d): AnalyticsItem => {
      const cnpj = cnpjs.get(d.cnpjId);
      return {
        source: "imposto",
        id: `${d.cnpjId}:${formatYearMonth(d.payMonth)}`,
        description: cnpj ? `Imposto estimado · ${cnpj.name}` : "Imposto estimado",
        dueDate: taxDueDate(d.payMonth, cnpj?.taxDueDay ?? DEFAULT_TAX_DUE_DAY),
        areaId: null,
        category: null,
        cents: d.taxCents,
        status: "estimado",
        paymentMethod: null,
        cardId: null,
      };
    });
}

export type UpcomingItem = {
  key: string;
  date: CivilDate;
  direction: "entrada" | "saida";
  kind: "plantao" | "pericia" | "conta" | "fatura" | "imposto";
  label: string;
  /** Registros que a linha junta (plantões do mesmo tipo pagos no mesmo dia, por exemplo). */
  count: number;
  cents: bigint;
};

/**
 * O que ainda vai entrar e sair no intervalo, em ordem de data: entradas ainda não recebidas (juntas
 * por dia e origem), contas a pagar, faturas de cartão a pagar (uma linha por fatura) e o imposto
 * estimado. Conta com valor a informar fica de fora: não há o que somar.
 */
export function upcoming(expenses: AnalyticsItem[], income: WorkRecord[], range: Range, cardNames: ReadonlyMap<string, string>): UpcomingItem[] {
  const inRange = (date: CivilDate) => date >= range.from && date <= range.to;
  const rows = new Map<string, UpcomingItem>();
  // `counts`: cada registro somado conta na linha (a fatura é uma só, mesmo com várias compras).
  const add = (row: UpcomingItem, counts = true) => {
    const current = rows.get(row.key);
    if (!current) rows.set(row.key, row);
    else {
      current.cents += row.cents;
      if (counts) current.count += row.count;
    }
  };
  for (const r of income) {
    if (r.received || !inRange(r.cashDate)) continue;
    add({ key: `${r.source}|${r.cashDate}|${r.label.toLocaleLowerCase("pt-BR")}`, date: r.cashDate, direction: "entrada", kind: r.source, label: r.label, count: 1, cents: BigInt(r.amountCents) });
  }
  for (const item of expenses) {
    if (item.status === "pago" || item.cents === null || !inRange(item.dueDate)) continue;
    if (item.source === "cartao") {
      // Compras e parte sem detalhe da mesma fatura viram uma linha só.
      add({ key: `fatura|${item.cardId}|${item.dueDate}`, date: item.dueDate, direction: "saida", kind: "fatura", label: `Fatura do ${cardNames.get(item.cardId ?? "") ?? "cartão"}`, count: 1, cents: item.cents }, false);
    } else {
      add({ key: `${item.source}|${item.id}`, date: item.dueDate, direction: "saida", kind: item.source === "imposto" ? "imposto" : "conta", label: item.description, count: 1, cents: item.cents });
    }
  }
  return [...rows.values()]
    .filter((row) => row.cents > 0n)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.direction === b.direction ? a.label.localeCompare(b.label, "pt-BR") : a.direction === "entrada" ? -1 : 1));
}

export function upcomingTotals(items: UpcomingItem[]): { entradas: bigint; saidas: bigint } {
  let entradas = 0n;
  let saidas = 0n;
  for (const item of items) {
    if (item.direction === "entrada") entradas += item.cents;
    else saidas += item.cents;
  }
  return { entradas, saidas };
}
