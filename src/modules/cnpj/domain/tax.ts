import { addMonths, clampedDate, formatYearMonth, yearMonthOf, type CivilDate, type YearMonth } from "@/lib/dates";
import { estimateTax } from "@/lib/tax";
import type { WorkRecord } from "../contract";

/**
 * Imposto estimado do CNPJ (puro, sem banco). O imposto do trabalho de um mês é pago no mês SEGUINTE:
 * o que se paga em novembro é a estimativa sobre os plantões e as perícias por CNPJ de outubro.
 * Cada registro usa a alíquota gravada nele, e a soma é feita registro a registro (o mesmo
 * arredondamento que aparece nos detalhes de cada plantão e de cada perícia).
 * São estimativas: não representam imposto apurado nem recolhido.
 */

/** Dia sugerido para o pagamento do imposto, no mês seguinte ao do trabalho. */
export const DEFAULT_TAX_DUE_DAY = 20;

/** Mês em que se paga o imposto do trabalho feito em `workDate`. */
export const taxPayMonth = (workDate: CivilDate): YearMonth => addMonths(yearMonthOf(workDate), 1);

/** Dia do pagamento no mês de pagamento; dia que não existe no mês vira o último dia dele. */
export const taxDueDate = (payMonth: YearMonth, dueDay: number): CivilDate => clampedDate(payMonth, dueDay);

export type TaxDue = {
  cnpjId: string;
  /** Mês do pagamento: o seguinte ao do trabalho. */
  payMonth: YearMonth;
  workMonth: YearMonth;
  /** Soma dos valores recebidos por CNPJ no mês do trabalho. */
  baseCents: bigint;
  taxCents: bigint;
  shifts: number;
  exams: number;
};

/** Imposto estimado por CNPJ e mês de trabalho, do mais antigo para o mais recente. Registros sem CNPJ ficam fora. */
export function taxDues(records: WorkRecord[]): TaxDue[] {
  const byKey = new Map<string, TaxDue>();
  for (const r of records) {
    if (r.cnpjId === null || r.taxRateBp === null) continue;
    const workMonth = yearMonthOf(r.workDate);
    const key = `${formatYearMonth(workMonth)}|${r.cnpjId}`;
    let due = byKey.get(key);
    if (!due) {
      due = { cnpjId: r.cnpjId, payMonth: addMonths(workMonth, 1), workMonth, baseCents: 0n, taxCents: 0n, shifts: 0, exams: 0 };
      byKey.set(key, due);
    }
    due.baseCents += BigInt(r.amountCents);
    due.taxCents += BigInt(estimateTax(r.amountCents, r.taxRateBp).taxCents);
    if (r.source === "plantao") due.shifts++;
    else due.exams++;
  }
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, due]) => due);
}
