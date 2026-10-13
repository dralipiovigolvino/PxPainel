import { addDays, daysBetween, type CivilDate } from "@/lib/dates";
import { durationMinutes, toMinutes, type Hours } from "./hours";

/**
 * Classificação de um plantão AGENDADO para o dashboard (compromisso: nunca "atrasa").
 * - Começa depois de hoje (até hoje + 7): "proximo".
 * - Com horário: terminou → "a_confirmar"; começou e não terminou → "em_andamento" (aparece em Hoje,
 *   inclusive o noturno iniciado ontem); começa hoje mais tarde → "hoje".
 * - Sem horário: dia anterior a hoje → "a_confirmar"; hoje → "hoje".
 * A competência e a contagem continuam presas à data de INÍCIO (a ocorrência aparece uma vez só).
 * Nada é marcado como realizado automaticamente.
 */
export type ShiftDashboardClass = { section: "hoje" | "proximos" | "a_confirmar"; status: "hoje" | "proximo" | "em_andamento" | "a_confirmar" } | null;

export function classifyShift(shift: { date: CivilDate; hours: Hours }, today: CivilDate, nowMinutes: number): ShiftDashboardClass {
  if (shift.date > addDays(today, 7)) return null;
  if (shift.date > today) return { section: "proximos", status: "proximo" };
  if (!shift.hours) {
    return shift.date < today ? { section: "a_confirmar", status: "a_confirmar" } : { section: "hoje", status: "hoje" };
  }
  const start = daysBetween(today, shift.date) * 1440 + toMinutes(shift.hours.start);
  const end = start + durationMinutes(shift.hours);
  if (end <= nowMinutes) return { section: "a_confirmar", status: "a_confirmar" };
  if (start <= nowMinutes) return { section: "hoje", status: "em_andamento" };
  return { section: "hoje", status: "hoje" };
}
