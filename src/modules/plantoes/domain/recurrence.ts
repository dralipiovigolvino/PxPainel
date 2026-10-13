import { addDays, daysBetween, formatCivilDate, type CivilDate } from "@/lib/dates";

/**
 * Recorrência semanal de plantões: dias da semana a cada N semanas.
 * Âncora estável: as semanas são contadas a partir do DOMINGO da semana da data inicial, então
 * "a cada 2 semanas" não muda conforme o mês exibido nem conforme a data consultada.
 */
export const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
export const MAX_INTERVAL_WEEKS = 12;

export type WeeklyRule = { startDate: CivilDate; intervalWeeks: number; weekdays: number[]; endDate: CivilDate | null };

/** Dia da semana de uma data civil (0 = domingo). 2000-01-02 foi domingo. */
export const weekdayOf = (date: CivilDate) => ((daysBetween("2000-01-02", date) % 7) + 7) % 7;

export const sundayOf = (date: CivilDate) => addDays(date, -weekdayOf(date));

export const maskOf = (weekdays: number[]) => weekdays.reduce((m, d) => m | (1 << d), 0);
export const weekdaysOf = (mask: number) => [0, 1, 2, 3, 4, 5, 6].filter((d) => (mask & (1 << d)) !== 0);

/** Ocorrências da regra entre `from` e `to` (inclusive), em ordem. */
export function occurrencesBetween(rule: WeeklyRule, from: CivilDate, to: CivilDate): CivilDate[] {
  const start = from > rule.startDate ? from : rule.startDate;
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  if (start > end || rule.weekdays.length === 0) return [];
  const anchor = sundayOf(rule.startDate);
  const days = new Set(rule.weekdays);
  const out: CivilDate[] = [];
  // Percorre semana a semana a partir da semana de `start` que pertence ao ciclo.
  let week = sundayOf(start);
  const offset = (daysBetween(anchor, week) / 7) % rule.intervalWeeks;
  if (offset !== 0) week = addDays(week, (rule.intervalWeeks - offset) * 7);
  while (week <= end) {
    for (let d = 0; d < 7; d++) {
      if (!days.has(d)) continue;
      const date = addDays(week, d);
      if (date >= start && date <= end) out.push(date);
    }
    week = addDays(week, rule.intervalWeeks * 7);
  }
  return out;
}

export function describeRule(rule: Pick<WeeklyRule, "intervalWeeks" | "weekdays" | "startDate" | "endDate">): string {
  const days = rule.weekdays.map((d) => WEEKDAY_NAMES[d]);
  const list = days.length <= 1 ? days.join("") : `${days.slice(0, -1).join(", ")} e ${days.at(-1)}`;
  // "Todo domingo/sábado", "Toda quinta"; vários dias: "Toda semana: …".
  const single = rule.weekdays.length === 1 ? `${rule.weekdays[0] === 0 || rule.weekdays[0] === 6 ? "Todo" : "Toda"} ${list}` : `Toda semana: ${list}`;
  const every = rule.intervalWeeks === 1 ? single : `A cada ${rule.intervalWeeks} semanas: ${list}`;
  return `${every}, desde ${formatCivilDate(rule.startDate)}${rule.endDate ? ` até ${formatCivilDate(rule.endDate)}` : ""}`;
}

/** Dias da semana deslocados por `delta` dias (mover "este e os próximos"). */
export const shiftWeekdays = (weekdays: number[], delta: number) => [...new Set(weekdays.map((d) => (((d + delta) % 7) + 7) % 7))].sort((a, b) => a - b);
