import { estimateTax } from "@/lib/tax";

/**
 * Totais de perícias de um período (canceladas fora). Valores em centavos (bigint).
 * Valor, imposto ESTIMADO (pela alíquota gravada em cada perícia; zero nas que não são por CNPJ) e o
 * que sobra depois dele, separados em agendadas e realizadas. Não indicam recebimento.
 */
export type TotalsExam = { status: "agendada" | "realizada" | "cancelada"; amountCents: number; taxRateBp: number };

export type ExamGroupTotals = { count: number; gross: bigint; tax: bigint; net: bigint };
export type ExamTotals = { agendadas: ExamGroupTotals; realizadas: ExamGroupTotals; total: ExamGroupTotals; canceledCount: number };

const empty = (): ExamGroupTotals => ({ count: 0, gross: 0n, tax: 0n, net: 0n });

export function examTotals(exams: TotalsExam[]): ExamTotals {
  const t: ExamTotals = { agendadas: empty(), realizadas: empty(), total: empty(), canceledCount: 0 };
  for (const e of exams) {
    if (e.status === "cancelada") {
      t.canceledCount++;
      continue;
    }
    const { taxCents, netCents } = estimateTax(e.amountCents, e.taxRateBp);
    for (const g of [e.status === "realizada" ? t.realizadas : t.agendadas, t.total]) {
      g.count++;
      g.gross += BigInt(e.amountCents);
      g.tax += BigInt(taxCents);
      g.net += BigInt(netCents);
    }
  }
  return t;
}

export const PER_SITUATIONS = ["todas", "agendada", "a-confirmar", "realizada", "cancelada"] as const;
export type PerSituation = (typeof PER_SITUATIONS)[number];
export const PER_SITUATION_LABELS: Record<PerSituation, string> = {
  todas: "Todas as situações",
  agendada: "Agendadas",
  "a-confirmar": "A confirmar (passadas agendadas)",
  realizada: "Realizadas",
  cancelada: "Canceladas",
};

/** Agendada cujo horário já passou: precisa de confirmação manual (nada é realizado automaticamente). */
export function needsConfirmation(e: { status: string; date: string; time: string }, today: string, nowMinutes: number): boolean {
  if (e.status !== "agendada") return false;
  if (e.date !== today) return e.date < today;
  const [h, m] = e.time.split(":").map(Number);
  return h * 60 + m < nowMinutes;
}

export function matchesFilters(
  e: { companyId: string; status: TotalsExam["status"]; date: string; time: string },
  f: { companyId: string | null; situation: PerSituation },
  today: string,
  nowMinutes: number,
): boolean {
  if (f.companyId && e.companyId !== f.companyId) return false;
  if (f.situation === "todas") return true;
  if (f.situation === "a-confirmar") return needsConfirmation(e, today, nowMinutes);
  return e.status === f.situation;
}
