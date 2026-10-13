import { addMonthsAnchored, type CivilDate } from "@/lib/dates";
import { formatCents, MAX_AMOUNT_CENTS } from "@/lib/money";

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 120;

/**
 * Divide o total em N parcelas inteiras (centavos). O resto vai para as PRIMEIRAS parcelas:
 * R$ 100,00 em 3 = 33,34 + 33,33 + 33,33. A soma é sempre exatamente o total.
 */
export function splitCents(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || !Number.isInteger(count) || count < 1) throw new RangeError("Parcelamento inválido");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Vencimentos mensais ancorados no primeiro (dia 31 → último dia nos meses menores). */
export function installmentDates(firstDue: CivilDate, count: number): CivilDate[] {
  return Array.from({ length: count }, (_, i) => addMonthsAnchored(firstDue, i));
}

export type InstallmentCheck = { ok: true } | { ok: false; field: "total" | "count"; message: string };

export function validateInstallments(totalCents: number, count: number): InstallmentCheck {
  if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) {
    return { ok: false, field: "count", message: `Use de ${MIN_INSTALLMENTS} a ${MAX_INSTALLMENTS} parcelas.` };
  }
  if (totalCents > MAX_AMOUNT_CENTS) return { ok: false, field: "total", message: `O total máximo é ${formatCents(MAX_AMOUNT_CENTS)}.` };
  if (totalCents < count) return { ok: false, field: "total", message: "Com esse total, alguma parcela ficaria com valor zero." };
  return { ok: true };
}

/** Texto curto da distribuição: "1× R$ 33,34 + 2× R$ 33,33". */
export function describeSplit(parts: number[]): string {
  const groups: Array<{ value: number; n: number }> = [];
  for (const value of parts) {
    const last = groups.at(-1);
    if (last && last.value === value) last.n++;
    else groups.push({ value, n: 1 });
  }
  return groups.map((g) => `${g.n}× ${formatCents(g.value)}`).join(" + ");
}

export type PlanStats = {
  paidCount: number;
  paidCents: bigint;
  pendingCount: number;
  /** Saldo restante = soma das parcelas pendentes. */
  pendingCents: bigint;
  canceledCount: number;
  canceledCents: bigint;
};

export function planStats(parts: ReadonlyArray<{ amountCents: number; status: "pendente" | "pago" | "cancelado" }>): PlanStats {
  const stats: PlanStats = { paidCount: 0, paidCents: 0n, pendingCount: 0, pendingCents: 0n, canceledCount: 0, canceledCents: 0n };
  for (const p of parts) {
    const v = BigInt(p.amountCents);
    if (p.status === "pago") {
      stats.paidCount++;
      stats.paidCents += v;
    } else if (p.status === "pendente") {
      stats.pendingCount++;
      stats.pendingCents += v;
    } else {
      stats.canceledCount++;
      stats.canceledCents += v;
    }
  }
  return stats;
}
