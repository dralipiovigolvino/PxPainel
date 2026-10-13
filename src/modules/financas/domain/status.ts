import type { CivilDate } from "@/lib/dates";

/**
 * Status persistido. "Atrasado" NÃO é status: é calculado (ver isOverdue).
 * "cancelado" (parcelas canceladas) não entra em listas do mês, totais nem projeções.
 */
export type EntryStatus = "pendente" | "pago" | "cancelado";

type StatusLike = { status: EntryStatus; dueDate: CivilDate };

/**
 * Atrasada = pendente com vencimento ANTES de hoje (São Paulo).
 * Vencendo hoje não está atrasada. Datas YYYY-MM-DD comparam como texto.
 */
export function isOverdue(entry: StatusLike, today: CivilDate): boolean {
  return entry.status === "pendente" && entry.dueDate < today;
}
