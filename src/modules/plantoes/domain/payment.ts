import { addMonths, clampedDate, formatCivilDate, yearMonthOf, type CivilDate } from "@/lib/dates";
import { amountBreakdown, type AmountKind } from "@/lib/tax";

/**
 * Previsão de pagamento: dia N do mês SEGUINTE ao mês em que o plantão COMEÇA.
 * Quando o dia não existe no mês de pagamento, usa o último dia desse mês.
 * (Mesma regra da função app_private.pl_expected_pay do banco.)
 */
export function expectedPayDate(shiftDate: CivilDate, payDay: number, monthOffset: 0 | 1 = 1): CivilDate {
  if (!Number.isInteger(payDay) || payDay < 1 || payDay > 31) throw new RangeError("Dia de pagamento inválido");
  return clampedDate(addMonths(yearMonthOf(shiftDate), monthOffset), payDay);
}

export const describePayRule = (payDay: number | null, monthOffset: 0 | 1 = 1) =>
  payDay === null ? "Sem previsão de pagamento" : `Pagamento no dia ${payDay} ${monthOffset === 0 ? "deste mês" : "do mês seguinte"}`;

export type ForecastShift = {
  id: string;
  typeName: string;
  date: CivilDate;
  status: "agendado" | "realizado";
  amountCents: number;
  amountKind: AmountKind | null;
  taxRateBp: number | null;
  expectedPayDate: CivilDate;
  expectedPayManual: boolean;
};

/**
 * Somas de um grupo. No banco, "recebido por CNPJ" é o valor bruto: `gross` é a parte por CNPJ, com o
 * imposto estimado dela; `net` e `undefinedKind` (registros antigos) são o que não é por CNPJ.
 */
export type KindSums = {
  count: number;
  /** Valores recebidos por CNPJ, o imposto estimado sobre eles e o que sobra depois do imposto. */
  gross: bigint;
  grossTax: bigint;
  grossNet: bigint;
  /** Valores informados como líquidos (sem novo desconto). */
  net: bigint;
  /** Valores sem classificação (registros antigos). */
  undefinedKind: bigint;
  grossCount: number;
  netCount: number;
  undefinedCount: number;
};

/** Tudo o que o grupo soma, por CNPJ ou não. */
export const sumsTotal = (sums: KindSums): bigint => sums.gross + sums.net + sums.undefinedKind;

export const emptyKindSums = (): KindSums => ({ count: 0, gross: 0n, grossTax: 0n, grossNet: 0n, net: 0n, undefinedKind: 0n, grossCount: 0, netCount: 0, undefinedCount: 0 });

export function addToKindSums(sums: KindSums, s: { amountCents: number; amountKind: AmountKind | null; taxRateBp: number | null }): void {
  const b = amountBreakdown(s.amountCents, s.amountKind, s.taxRateBp);
  sums.count++;
  if (b.kind === "bruto") {
    sums.grossCount++;
    sums.gross += BigInt(b.amountCents);
    sums.grossTax += BigInt(b.taxCents ?? 0);
    sums.grossNet += BigInt(b.netCents ?? 0);
  } else if (b.kind === "liquido") {
    sums.netCount++;
    sums.net += BigInt(b.amountCents);
  } else {
    sums.undefinedCount++;
    sums.undefinedKind += BigInt(b.amountCents);
  }
}

export type ForecastGroup = { date: CivilDate; overdue: boolean; shifts: ForecastShift[]; sums: KindSums };

/**
 * Recebimentos previstos agrupados pela data prevista (mais antiga primeiro). Vários plantões pagos
 * no mesmo dia formam um grupo. "Vencida" = data prevista anterior a hoje e ainda sem recebimento.
 */
export function groupForecast(shifts: ForecastShift[], today: CivilDate): ForecastGroup[] {
  const map = new Map<CivilDate, ForecastGroup>();
  for (const s of [...shifts].sort((a, b) => a.expectedPayDate.localeCompare(b.expectedPayDate) || a.date.localeCompare(b.date) || (a.id < b.id ? -1 : 1))) {
    let g = map.get(s.expectedPayDate);
    if (!g) {
      g = { date: s.expectedPayDate, overdue: s.expectedPayDate < today, shifts: [], sums: emptyKindSums() };
      map.set(s.expectedPayDate, g);
    }
    g.shifts.push(s);
    addToKindSums(g.sums, s);
  }
  return [...map.values()];
}

export const describeExpected = (date: CivilDate | null, manual: boolean) => (date === null ? "Sem previsão" : `${formatCivilDate(date)}${manual ? " (ajustada manualmente)" : ""}`);
