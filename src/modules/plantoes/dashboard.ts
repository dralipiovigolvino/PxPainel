import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import { addDays, formatMonthLabel, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { withUserContext } from "@/lib/db/user-context";
import type { DashboardItem, DashboardModuleData, ForecastSummaryRow, ShiftMonthSummary } from "@/modules/dashboard/contract";
import { monthRange } from "@/modules/financas/domain/filters";
import { listShifts, mapShift, receivedInPeriod, SHIFT_COLUMNS, type ShiftRow } from "./data";
import { classifyShift } from "./domain/dashboard";
import { describeHours } from "./domain/hours";
import { groupForecast, sumsTotal, type ForecastGroup } from "./domain/payment";
import { shiftTotals } from "./domain/totals";
import { listForecast } from "./forecast-data";
import { needsGeneration, plGenerationWindow } from "./series-data";

/**
 * Plantões no dashboard (compromissos): agendados de hoje e até hoje + 7, em andamento (inclusive o
 * noturno de ontem) e "a confirmar" (agendados já terminados, de qualquer data). Nada é marcado como
 * realizado automaticamente. Valores ficam no resumo do mês (não se misturam com contas a pagar).
 */
export async function plantoesDashboard(user: AuthUser, today: CivilDate, nowMinutes: number): Promise<{ data: DashboardModuleData; summary: ShiftMonthSummary }> {
  const until = addDays(today, 7);
  const month = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const { from, to } = monthRange(month);
  const window = plGenerationWindow(until, today);
  const [rows, monthShifts, received, pending, forecast] = await Promise.all([
    withUserContext(user, async (db) => {
      const { rows } = await db.query<ShiftRow & { type_name: string }>(
        `select ${SHIFT_COLUMNS}, t.name as type_name from public.pl_shifts s join public.pl_types t on t.id = s.type_id
          where s.status = 'agendado' and s.shift_date <= $1::date order by s.shift_date, s.start_time nulls last, s.id`,
        [until],
      );
      return rows;
    }),
    listShifts(user, from, to),
    receivedInPeriod(user, from, to, null),
    needsGeneration(user, window.target),
    listForecast(user),
  ]);

  const items: DashboardItem[] = [];
  for (const r of rows) {
    const shift = mapShift(r);
    const c = classifyShift(shift, today, nowMinutes);
    if (!c) continue;
    items.push({
      key: `plantoes:plantao:${shift.id}`,
      source: "plantoes",
      type: "plantao",
      id: shift.id,
      kind: "compromisso",
      section: c.section,
      status: c.status,
      title: r.type_name,
      // Rótulos explícitos: valor informado e previsão de pagamento não são recebimento.
      detail: shift.hours ? describeHours(shift.hours, shift.date) : "Sem horário definido",
      date: shift.date,
      amount: { kind: "none" },
      href: `/plantoes?mes=${shift.date.slice(0, 7)}&plantao=${shift.id}`,
      actions: [],
    });
  }

  const t = shiftTotals(monthShifts);
  const groups = groupForecast(forecast.shifts, today);
  const row = (g: ForecastGroup): ForecastSummaryRow => ({
    date: g.date,
    overdue: g.overdue,
    count: g.shifts.length,
    total: formatCents(sumsTotal(g.sums)),
  });
  return {
    data: { source: "plantoes", items, coverage: { generationTarget: pending ? window.target : null, note: null } },
    summary: {
      monthLabel: formatMonthLabel(month),
      programado: formatCents(t.programado),
      realizado: formatCents(t.realizado),
      recebidoDoMes: formatCents(t.recebidoDoMes),
      aReceber: formatCents(t.aReceber),
      recebidoNoMes: formatCents(received.cents),
      count: t.count,
      forecast: {
        overdue: groups.filter((g) => g.overdue).map(row),
        next: groups.filter((g) => !g.overdue).slice(0, 3).map(row),
        withoutForecast: forecast.withoutForecast,
      },
    },
  };
}
