import { addMonths, formatMonthLabel, formatYearMonth, parseYearMonth, yearMonthOf, type CivilDate, type YearMonth } from "@/lib/dates";
import { isUuid, monthRange } from "./filters";
import { isPaymentMethod, NO_METHOD, paymentKey, type PaymentMethod } from "./payment";

/**
 * Visão geral de Finanças (pura, sem banco). Base: contas fora do cartão e faturas de cartão, no mês
 * em que vencem — a mesma base da aba Mês. Cada fatura entra pelo total considerado, decomposto em
 * suas compras cadastradas mais UM item com a parte sem compra cadastrada: a soma dos itens de uma
 * fatura é sempre o total dela, e nada é contado duas vezes.
 * Valores em centavos (bigint); "valor a informar" (null) fica fora das somas e é contado à parte.
 *
 * O imposto estimado do CNPJ entra como uma saída à parte: não é conta (não tem "pago" nem "atrasado"),
 * não tem área, categoria nem forma de pagamento, e some quando um desses filtros está ativo.
 */

/** Chave da parte da fatura sem compra cadastrada, nas divisões por categoria e por área. */
export const UNDETAILED = "__sem_detalhe";
/** Chave do imposto estimado do CNPJ, em todas as divisões. */
export const TAX = "__imposto";

export type AnalyticsItem = {
  source: "conta" | "cartao" | "imposto";
  id: string;
  description: string;
  dueDate: CivilDate;
  /** null só na parte da fatura sem compra cadastrada (não tem área). */
  areaId: string | null;
  category: string | null;
  /** null = valor a informar. Negativo só no ajuste de uma fatura cujo total é menor que as compras. */
  cents: bigint | null;
  /** Da conta ou, nas compras do cartão, da fatura em que estão. "estimado" = imposto do CNPJ. */
  status: "pago" | "pendente" | "estimado";
  paymentMethod: PaymentMethod | null;
  cardId: string | null;
  /** Parte da fatura sem compra cadastrada (total − compras). */
  undetailed?: boolean;
};

export type Period = { kind: "mes"; month: YearMonth } | { kind: "ano"; year: number };

export type OverviewFilters = {
  period: Period;
  areaId: string | null;
  /** "pix", "boleto", "nenhuma" (forma não informada) ou o id de um cartão; null = todas. */
  payment: string | null;
  category: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;
const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
const normCategory = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase("pt-BR");
/** Forma de pagamento do item; o imposto estimado tem a chave dele (não é "forma não informada"). */
const payKey = (item: AnalyticsItem) => (item.source === "imposto" ? TAX : paymentKey(item));

/** Lê os filtros da URL (?mes=AAAA-MM ou ?periodo=ano&ano=AAAA, área, forma, categoria). Inválidos viram o padrão. */
export function parseOverviewFilters(params: RawParams, today: CivilDate): OverviewFilters {
  const year = Number(single(params.ano));
  const period: Period =
    single(params.periodo) === "ano" && Number.isInteger(year) && year >= 2000 && year <= 2100
      ? { kind: "ano", year }
      : { kind: "mes", month: parseYearMonth(single(params.mes)) ?? yearMonthOf(today) };
  const area = single(params.area);
  const forma = single(params.forma);
  const category = single(params.categoria)?.trim();
  return {
    period,
    areaId: isUuid(area) ? area.toLowerCase() : null,
    payment: forma && (isPaymentMethod(forma) || forma === NO_METHOD) ? forma : isUuid(forma) ? forma.toLowerCase() : null,
    category: category ? category.slice(0, 80) : null,
  };
}

/** URL de /financas com os filtros (só códigos, ids e uma categoria escolhida numa lista). */
export function overviewHref(filters: OverviewFilters, overrides: Partial<OverviewFilters> = {}): string {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.period.kind === "ano") {
    params.set("periodo", "ano");
    params.set("ano", String(next.period.year));
  } else params.set("mes", formatYearMonth(next.period.month));
  if (next.areaId) params.set("area", next.areaId);
  if (next.payment) params.set("forma", next.payment);
  if (next.category) params.set("categoria", next.category);
  return `/financas?${params}`;
}

export function periodRange(period: Period): { from: CivilDate; to: CivilDate } {
  if (period.kind === "mes") return monthRange(period.month);
  return { from: `${period.year}-01-01`, to: `${period.year}-12-31` };
}

/** Mesmo tipo de período, deslocado (mês a mês ou ano a ano). */
export function shiftPeriod(period: Period, delta: number): Period {
  return period.kind === "mes" ? { kind: "mes", month: addMonths(period.month, delta) } : { kind: "ano", year: period.year + delta };
}

export function periodLabel(period: Period): string {
  return period.kind === "mes" ? formatMonthLabel(period.month) : String(period.year);
}

/** Rótulo curto do período anterior, para a comparação ("setembro", "2025"). */
export function previousLabel(period: Period): string {
  const prev = shiftPeriod(period, -1);
  return prev.kind === "mes" ? formatMonthLabel(prev.month).split(" de ")[0].toLowerCase() : String(prev.year);
}

/** Meses do gráfico de evolução: no mês, de 5 meses antes a 6 depois; no ano, os 12 meses do ano. */
export function evolutionMonths(period: Period): YearMonth[] {
  const first = period.kind === "mes" ? addMonths(period.month, -5) : { year: period.year, month: 1 };
  return Array.from({ length: 12 }, (_, i) => addMonths(first, i));
}

/** Intervalo de dados que a tela precisa: período anterior (comparação) até o fim da evolução. */
export function dataRange(period: Period): { from: CivilDate; to: CivilDate } {
  const months = evolutionMonths(period);
  const starts = [periodRange(shiftPeriod(period, -1)).from, monthRange(months[0]).from];
  const ends = [periodRange(period).to, monthRange(months[months.length - 1]).to];
  return { from: starts.sort()[0], to: ends.sort().at(-1)! };
}

export function inRange(items: AnalyticsItem[], range: { from: CivilDate; to: CivilDate }): AnalyticsItem[] {
  return items.filter((i) => i.dueDate >= range.from && i.dueDate <= range.to);
}

/** Área, forma de pagamento e categoria (o período é aplicado à parte). */
export function applyScope(items: AnalyticsItem[], filters: Pick<OverviewFilters, "areaId" | "payment" | "category">): AnalyticsItem[] {
  const wantCategory = filters.category ? normCategory(filters.category) : null;
  return items.filter(
    (i) =>
      (!filters.areaId || i.areaId === filters.areaId) &&
      (!filters.payment || payKey(i) === filters.payment) &&
      (wantCategory === null || normCategory(i.category) === wantCategory),
  );
}

export type Totals = {
  /** Pago + A pagar + imposto estimado (só valores conhecidos). */
  total: bigint;
  pago: bigint;
  aPagar: bigint;
  /** Imposto estimado do CNPJ no período (fora de Pago e de A pagar). */
  imposto: bigint;
  /** Parte de "A pagar" vencida antes de hoje. */
  atrasado: bigint;
  atrasadoCount: number;
  unknownCount: number;
  count: number;
};

export function summarize(items: AnalyticsItem[], today: CivilDate): Totals {
  const t: Totals = { total: 0n, pago: 0n, aPagar: 0n, imposto: 0n, atrasado: 0n, atrasadoCount: 0, unknownCount: 0, count: 0 };
  // Uma fatura atrasada conta uma vez, mesmo decomposta em várias compras.
  const overdueInvoices = new Set<string>();
  for (const item of items) {
    t.count++;
    const overdue = item.status === "pendente" && item.dueDate < today;
    if (overdue) {
      const invoice = item.source === "cartao" ? `${item.cardId}|${item.dueDate}` : null;
      if (invoice === null || !overdueInvoices.has(invoice)) t.atrasadoCount++;
      if (invoice !== null) overdueInvoices.add(invoice);
    }
    if (item.cents === null) {
      t.unknownCount++;
      continue;
    }
    if (item.status === "estimado") t.imposto += item.cents;
    else if (item.status === "pago") t.pago += item.cents;
    else {
      t.aPagar += item.cents;
      if (overdue) t.atrasado += item.cents;
    }
  }
  t.total = t.pago + t.aPagar + t.imposto;
  return t;
}

export type BreakdownRow = { key: string | null; label: string | null; cents: bigint };

/**
 * Soma por dimensão (só valores conhecidos), em ordem decrescente. Categorias são agrupadas sem
 * diferenciar maiúsculas (o rótulo é a primeira grafia vista); sem categoria = chave null.
 * A parte da fatura sem compra cadastrada fica numa linha própria (chave UNDETAILED) por categoria e
 * por área: não é distribuída nem ganha categoria inventada. Se for negativa (total menor que as
 * compras), aparece por último, com o sinal — assim a soma das linhas é sempre o total.
 * O imposto estimado também tem a linha dele (chave TAX), nas três divisões.
 */
export function breakdown(items: AnalyticsItem[], by: "category" | "area" | "payment"): BreakdownRow[] {
  const map = new Map<string | null, BreakdownRow>();
  for (const item of items) {
    if (item.cents === null) continue;
    const special = item.source === "imposto" ? TAX : item.undetailed ? UNDETAILED : null;
    const key = by === "payment" ? payKey(item) : (special ?? (by === "area" ? item.areaId : item.category === null ? null : normCategory(item.category)));
    const row = map.get(key) ?? { key, label: by === "category" && special === null ? item.category : null, cents: 0n };
    row.cents += item.cents;
    map.set(key, row);
  }
  return [...map.values()].filter((r) => r.cents !== 0n).sort((a, b) => (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : 0));
}

/** Mantém as `max - 1` maiores e junta o resto numa linha "Outras" (chave "__outras"). */
export function foldTail(rows: BreakdownRow[], max: number): BreakdownRow[] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1).reduce((sum, r) => sum + r.cents, 0n);
  return [...head, { key: "__outras", label: "Outras", cents: rest }];
}

export type MonthBar = { month: YearMonth; pago: bigint; aPagar: bigint; imposto: bigint; total: bigint };

/** Totais por mês de vencimento (pago, a pagar e imposto estimado). */
export function monthly(items: AnalyticsItem[], months: YearMonth[]): MonthBar[] {
  const bars = months.map((month) => ({ month, key: formatYearMonth(month), pago: 0n, aPagar: 0n, imposto: 0n, total: 0n }));
  const byKey = new Map(bars.map((b) => [b.key, b]));
  for (const item of items) {
    if (item.cents === null) continue;
    const bar = byKey.get(item.dueDate.slice(0, 7));
    if (!bar) continue;
    if (item.status === "estimado") bar.imposto += item.cents;
    else if (item.status === "pago") bar.pago += item.cents;
    else bar.aPagar += item.cents;
    bar.total += item.cents;
  }
  return bars.map(({ month, pago, aPagar, imposto, total }) => ({ month, pago, aPagar, imposto, total }));
}

/** Maiores valores do período (conhecidos e positivos), do maior para o menor. */
export function topItems(items: AnalyticsItem[], n: number): AnalyticsItem[] {
  return items
    .filter((i) => i.cents !== null && i.cents > 0n)
    .sort((a, b) => (b.cents! > a.cents! ? 1 : b.cents! < a.cents! ? -1 : a.dueDate.localeCompare(b.dueDate)))
    .slice(0, n);
}

/** Variação percentual (uma casa); null quando não há base para comparar. */
export function percentChange(current: bigint, previous: bigint): number | null {
  if (previous <= 0n) return null;
  return Number(((current - previous) * 1000n) / previous) / 10;
}
