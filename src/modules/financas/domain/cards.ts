import { addMonths, clampedDate, formatYearMonth, parseCivilDate, parseYearMonth, type CivilDate, type YearMonth } from "@/lib/dates";

export const MAX_CARD_INSTALLMENTS = 48;

/** Referência do ciclo = mês em que a fatura FECHA (guardada como AAAA-MM). */
export type InvoiceCycle = { reference: string; closingDate: CivilDate; dueDate: CivilDate };

/** Datas concretas de um ciclo, pelos dias padrão do cartão (dias inexistentes → último dia). */
export function cycleDates(reference: YearMonth, closingDay: number, dueDay: number): InvoiceCycle {
  const closingDate = clampedDate(reference, closingDay);
  // Vencimento menor ou igual ao fechamento cai no mês seguinte ao fechamento.
  const dueMonth = dueDay <= closingDay ? addMonths(reference, 1) : reference;
  return { reference: formatYearMonth(reference), closingDate, dueDate: clampedDate(dueMonth, dueDay) };
}

/**
 * Fatura de uma compra (regra padrão):
 * - antes do fechamento do mês da compra → fatura que fecha naquele mês;
 * - no dia do fechamento ou depois → fatura seguinte.
 */
export function cycleForPurchase(purchaseDate: CivilDate, closingDay: number, dueDay: number): InvoiceCycle {
  const parts = parseCivilDate(purchaseDate);
  if (!parts) throw new RangeError(`Data inválida: ${purchaseDate}`);
  const month = { year: parts.year, month: parts.month };
  const closingThisMonth = clampedDate(month, closingDay);
  const reference = purchaseDate < closingThisMonth ? month : addMonths(month, 1);
  return cycleDates(reference, closingDay, dueDay);
}

/** Ciclo do cartão cujo VENCIMENTO cai no mês indicado (pelos dias atuais do cartão). */
export function cycleDueIn(dueMonth: YearMonth, closingDay: number, dueDay: number): InvoiceCycle {
  return cycleDates(dueDay <= closingDay ? addMonths(dueMonth, -1) : dueMonth, closingDay, dueDay);
}

/**
 * Valor que conta para a fatura: o que foi pago (se paga); senão o total informado pelo usuário;
 * senão a soma das compras cadastradas. As compras nunca são somadas por fora da fatura.
 */
export function invoiceTotal(invoice: { status: "pendente" | "pago"; paidTotalCents: number | null; statedCents: number | null; detailedCents: number }): number {
  if (invoice.status === "pago" && invoice.paidTotalCents !== null) return invoice.paidTotalCents;
  return invoice.statedCents ?? invoice.detailedCents;
}

/** Ciclos consecutivos de uma compra parcelada a partir da primeira referência. */
export function chargeReferences(firstReference: string, count: number): string[] {
  const first = parseYearMonth(firstReference);
  if (!first) throw new RangeError(`Referência inválida: ${firstReference}`);
  return Array.from({ length: count }, (_, i) => formatYearMonth(addMonths(first, i)));
}

export const referenceToDate = (reference: string): CivilDate => `${reference}-01`;
