import "server-only";

import type { AuthUser } from "@/lib/auth/session-user";
import { addDays, formatMonthLabel, yearMonthOf, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { DashboardItem, DashboardModuleData, ExamMonthSummary } from "@/modules/dashboard/contract";
import { monthRange } from "@/modules/financas/domain/filters";
import { listExams, listScheduledUntil } from "./data";
import { examTotals, needsConfirmation, type ExamGroupTotals } from "./domain/totals";

const formatGroup = (g: ExamGroupTotals) => ({ count: g.count, gross: formatCents(g.gross), tax: formatCents(g.tax), net: formatCents(g.net) });

/**
 * Perícias no dashboard (compromissos): agendadas de hoje e até hoje + 7, e "a confirmar" (agendadas
 * cujo horário já passou, de qualquer data). Nada é marcado como realizado automaticamente.
 * Valores ficam no resumo do mês, como estimativas, sem se misturar com contas a pagar.
 */
export async function periciasDashboard(user: AuthUser, today: CivilDate, nowMinutes: number): Promise<{ data: DashboardModuleData; summary: ExamMonthSummary }> {
  const until = addDays(today, 7);
  const month = yearMonthOf(today);
  const { from, to } = monthRange(month);
  const [scheduled, monthExams] = await Promise.all([listScheduledUntil(user, until), listExams(user, from, to)]);

  const items: DashboardItem[] = scheduled.map((e) => {
    const confirm = needsConfirmation(e, today, nowMinutes);
    const place = confirm
      ? ({ section: "a_confirmar", status: "a_confirmar" } as const)
      : e.date === today
        ? ({ section: "hoje", status: "hoje" } as const)
        : ({ section: "proximos", status: "proximo" } as const);
    return {
      key: `pericias:pericia:${e.id}`,
      source: "pericias",
      type: "pericia",
      id: e.id,
      kind: "compromisso",
      ...place,
      title: e.companyName,
      detail: `Perícia às ${e.time}`,
      date: e.date,
      amount: { kind: "none" },
      href: `/pericias?mes=${e.date.slice(0, 7)}&pericia=${e.id}`,
      actions: [],
    };
  });

  const t = examTotals(monthExams);
  return {
    data: { source: "pericias", items, coverage: { generationTarget: null, note: null } },
    summary: { monthLabel: formatMonthLabel(month), agendadas: formatGroup(t.agendadas), realizadas: formatGroup(t.realizadas), hasTax: t.total.tax > 0n, canceledCount: t.canceledCount },
  };
}
