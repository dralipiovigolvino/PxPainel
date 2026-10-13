import {
  daysInMonth,
  firstWeekdayOfMonth,
  toCivilDate,
  type CivilDate,
  type YearMonth,
} from "@/lib/dates";

export type CalendarDay = { date: CivilDate; day: number };

/** Célula vazia (`null`) completa as semanas antes do dia 1 e depois do último dia. */
export type CalendarCell = CalendarDay | null;

/** Semanas do mês, começando no domingo; cada semana tem 7 células. */
export function buildMonthGrid(yearMonth: YearMonth): CalendarCell[][] {
  const cells: CalendarCell[] = Array.from(
    { length: firstWeekdayOfMonth(yearMonth) },
    () => null,
  );

  const total = daysInMonth(yearMonth.year, yearMonth.month);
  for (let day = 1; day <= total; day++) {
    cells.push({ date: toCivilDate({ ...yearMonth, day }), day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
