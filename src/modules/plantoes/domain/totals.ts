import type { AmountKind } from "@/lib/tax";
import { addToKindSums, emptyKindSums, type KindSums } from "./payment";

/**
 * Totais de plantões (competência = mês em que o plantão COMEÇA). Valores em centavos (bigint).
 * - Programado = agendados + realizados (cancelados fora) = Recebido dos plantões do mês + A receber.
 * - Realizado é indicador sobreposto (não somar aos demais).
 * - A receber inclui futuros agendados; dividido em realizados a receber e agendados a receber.
 * O "recebido no mês" pela data real do recebimento é calculado à parte (outra pergunta).
 *
 * Os totais acima somam os valores COMO INFORMADOS (brutos e líquidos juntos): não são "total bruto".
 * `kinds` separa cada total em bruto (com imposto estimado e valor após impostos), líquido e não definido.
 */
export type TotalsShift = {
  status: "agendado" | "realizado" | "cancelado";
  amountCents: number;
  receivedOn: string | null;
  amountKind?: AmountKind | null;
  taxRateBp?: number | null;
};

export type ShiftTotals = {
  programado: bigint;
  realizado: bigint;
  recebidoDoMes: bigint;
  aReceber: bigint;
  realizadosAReceber: bigint;
  agendadosAReceber: bigint;
  count: number;
  canceledCount: number;
  kinds: { programado: KindSums; recebidoDoMes: KindSums; aReceber: KindSums };
};

export function shiftTotals(shifts: TotalsShift[]): ShiftTotals {
  const t: ShiftTotals = { programado: 0n, realizado: 0n, recebidoDoMes: 0n, aReceber: 0n, realizadosAReceber: 0n, agendadosAReceber: 0n, count: 0, canceledCount: 0, kinds: { programado: emptyKindSums(), recebidoDoMes: emptyKindSums(), aReceber: emptyKindSums() } };
  for (const s of shifts) {
    if (s.status === "cancelado") {
      t.canceledCount++;
      continue;
    }
    const v = BigInt(s.amountCents);
    const kinded = { amountCents: s.amountCents, amountKind: s.amountKind ?? null, taxRateBp: s.taxRateBp ?? null };
    addToKindSums(t.kinds.programado, kinded);
    addToKindSums(s.receivedOn ? t.kinds.recebidoDoMes : t.kinds.aReceber, kinded);
    t.count++;
    t.programado += v;
    if (s.status === "realizado") t.realizado += v;
    if (s.receivedOn) t.recebidoDoMes += v;
    else {
      t.aReceber += v;
      if (s.status === "realizado") t.realizadosAReceber += v;
      else t.agendadosAReceber += v;
    }
  }
  return t;
}

/** Linhas do resumo por classificação (só as que têm plantões). Valores em centavos. */
export type KindRow = {
  key: "bruto" | "liquido" | "indefinido";
  count: number;
  programado: bigint;
  recebidoDoMes: bigint;
  aReceber: bigint;
  /** Só em valor bruto: imposto estimado e valor após impostos do programado. */
  tax: bigint | null;
  net: bigint | null;
};

export function kindRows(t: ShiftTotals): KindRow[] {
  const { programado: p, recebidoDoMes: r, aReceber: a } = t.kinds;
  const rows: KindRow[] = [
    { key: "bruto", count: p.grossCount, programado: p.gross, recebidoDoMes: r.gross, aReceber: a.gross, tax: p.grossTax, net: p.grossNet },
    { key: "liquido", count: p.netCount, programado: p.net, recebidoDoMes: r.net, aReceber: a.net, tax: null, net: null },
    { key: "indefinido", count: p.undefinedCount, programado: p.undefinedKind, recebidoDoMes: r.undefinedKind, aReceber: a.undefinedKind, tax: null, net: null },
  ];
  return rows.filter((row) => row.count > 0);
}

export const PL_SITUATIONS = ["todos", "agendado", "a-confirmar", "realizado", "cancelado"] as const;
export type PlSituation = (typeof PL_SITUATIONS)[number];
export const PL_SITUATION_LABELS: Record<PlSituation, string> = {
  todos: "Todas as situações",
  agendado: "Agendados",
  "a-confirmar": "A confirmar (passados agendados)",
  realizado: "Realizados",
  cancelado: "Cancelados",
};
export const PL_PAYMENTS = ["todos", "a-receber", "recebido"] as const;
export type PlPayment = (typeof PL_PAYMENTS)[number];
export const PL_PAYMENT_LABELS: Record<PlPayment, string> = { todos: "Todos os pagamentos", "a-receber": "A receber", recebido: "Recebidos" };

export function matchesFilters(
  s: { typeId: string; status: TotalsShift["status"]; date: string; receivedOn: string | null },
  f: { typeId: string | null; situation: PlSituation; payment: PlPayment },
  today: string,
): boolean {
  if (f.typeId && s.typeId !== f.typeId) return false;
  if (f.situation === "a-confirmar" ? !(s.status === "agendado" && s.date < today) : f.situation !== "todos" && s.status !== f.situation) return false;
  if (f.payment === "a-receber" && (s.receivedOn || s.status === "cancelado")) return false;
  if (f.payment === "recebido" && !s.receivedOn) return false;
  return true;
}
