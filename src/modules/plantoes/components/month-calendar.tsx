import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  addMonths,
  formatMonthLabel,
  formatYearMonth,
  isSameYearMonth,
  yearMonthOf,
  type CivilDate,
  type YearMonth,
} from "@/lib/dates";
import { cn } from "@/lib/utils";
import { buildMonthGrid, type CalendarDay } from "../calendar-grid";

const WEEKDAYS = [
  { short: "Dom", full: "Domingo" },
  { short: "Seg", full: "Segunda-feira" },
  { short: "Ter", full: "Terça-feira" },
  { short: "Qua", full: "Quarta-feira" },
  { short: "Qui", full: "Quinta-feira" },
  { short: "Sex", full: "Sexta-feira" },
  { short: "Sáb", full: "Sábado" },
] as const;

const defaultHref = (month: YearMonth) => `/plantoes?mes=${formatYearMonth(month)}`;

type MonthCalendarProps = {
  month: YearMonth;
  today: CivilDate;
  /** Conteúdo extra do dia (só as bolinhas dos plantões). */
  renderDay?: (cell: CalendarDay) => ReactNode;
  /** Link de cada mês (mantém filtros na URL). */
  monthHref?: (month: YearMonth) => string;
  /** Rodapé (legenda). */
  footer?: ReactNode;
  /** Marca a célula de destino durante o arraste. */
  dropTarget?: CivilDate | null;
};

/**
 * Calendário mensal (semana começa no domingo). As células mostram o número do dia e,
 * via renderDay, SOMENTE as bolinhas coloridas dos plantões.
 */
export function MonthCalendar({ month, today, renderDay, monthHref = defaultHref, footer, dropTarget }: MonthCalendarProps) {
  const weeks = buildMonthGrid(month);
  const currentMonth = yearMonthOf(today);
  const isCurrentMonth = isSameYearMonth(month, currentMonth);
  const label = formatMonthLabel(month);

  return (
    <Card className="gap-0 py-0 shadow-xs ring-border" role="region" aria-labelledby="calendario-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id="calendario-titulo" className="text-lg font-semibold" aria-live="polite">
          {label}
        </h2>
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon" className="size-10">
            <Link href={monthHref(addMonths(month, -1))} aria-label="Mês anterior">
              <ChevronLeft aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            variant={isCurrentMonth ? "ghost" : "outline"}
            className="h-10 px-3"
          >
            <Link href={monthHref(currentMonth)}>Mês atual</Link>
          </Button>
          <Button asChild variant="outline" size="icon" className="size-10">
            <Link href={monthHref(addMonths(month, 1))} aria-label="Próximo mês">
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>

      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Calendário de plantões — {label}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map(({ short, full }) => (
              <th
                key={short}
                scope="col"
                abbr={full}
                className="py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((cell, dayIndex) => {
                if (!cell) {
                  return (
                    <td
                      key={`vazio-${dayIndex}`}
                      className="h-14 border-t border-l bg-muted/40 first:border-l-0 sm:h-20 lg:h-24"
                    />
                  );
                }
                const isToday = cell.date === today;
                return (
                  <td
                    key={cell.date}
                    data-date={cell.date}
                    className={cn(
                      "h-14 border-t border-l p-1 align-top first:border-l-0 sm:h-20 sm:p-1.5 lg:h-24",
                      dropTarget === cell.date && "bg-primary/10 ring-2 ring-primary ring-inset",
                    )}
                  >
                    {renderDay ? (
                      renderDay(cell)
                    ) : (
                    <time
                      dateTime={cell.date}
                      aria-current={isToday ? "date" : undefined}
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full text-sm tabular-nums",
                        isToday && "bg-primary/10 font-semibold text-primary ring-1 ring-primary/40",
                      )}
                    >
                      {cell.day}
                    </time>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {footer ?? (
        <p className="border-t px-4 py-3 text-sm text-muted-foreground">
          Nenhum plantão cadastrado. Os plantões aparecerão nos dias como bolinhas coloridas,
          conforme o tipo de plantão.
        </p>
      )}
    </Card>
  );
}
