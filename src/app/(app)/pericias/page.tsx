import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { addDays, nowInSaoPaulo, parseYearMonth, yearMonthOf } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { listCnpjOptions } from "@/modules/cnpj/data";
import { LoadError } from "@/components/load-error";
import { isUuid, monthRange } from "@/modules/financas/domain/filters";
import { PericiasView } from "@/modules/pericias/components/pericias-view";
import { listCompanies, listExams, listScheduledUntil } from "@/modules/pericias/data";
import { examTotals, matchesFilters, needsConfirmation, PER_SITUATIONS, type ExamGroupTotals, type PerSituation } from "@/modules/pericias/domain/totals";

export const metadata: Metadata = { title: "Perícias" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const formatGroup = (g: ExamGroupTotals) => ({ count: g.count, gross: formatCents(g.gross), tax: formatCents(g.tax), net: formatCents(g.net) });

export default async function PericiasPage({ searchParams }: PageProps<"/pericias">) {
  const user = await requireUser();
  const params = await searchParams;

  // Um único "agora" de São Paulo por requisição.
  const now = nowInSaoPaulo();
  const today = now.date;
  const month = parseYearMonth(one(params.mes)) ?? yearMonthOf(today);
  const { from, to } = monthRange(month);
  const situation = (PER_SITUATIONS as readonly string[]).includes(one(params.situacao) ?? "") ? (one(params.situacao) as PerSituation) : "todas";

  let loaded;
  try {
    const [companies, exams, scheduled, cnpjs] = await Promise.all([
      listCompanies(user),
      listExams(user, from, to),
      // Agendadas de qualquer mês: as passadas (a confirmar) e as de hoje em diante (até um ano).
      listScheduledUntil(user, addDays(today, 366)),
      listCnpjOptions(user),
    ]);
    loaded = { companies, exams, scheduled, cnpjs };
  } catch {
    return <LoadError />;
  }

  // Empresa desconhecida na URL (excluída ou de outra conta): volta para "todas".
  const empresa = one(params.empresa);
  const companyId = isUuid(empresa) && loaded.companies.some((c) => c.id === empresa) ? empresa : null;
  const filters = { companyId, situation };
  const exams = loaded.exams.filter((e) => matchesFilters(e, filters, today, now.minutes));
  const t = examTotals(exams);
  const scheduled = loaded.scheduled.filter((e) => !companyId || e.companyId === companyId);

  return (
    <PericiasView
        month={month}
        today={today}
        nowMinutes={now.minutes}
        companies={loaded.companies}
        exams={exams}
        upcoming={scheduled.filter((e) => e.date >= today && !needsConfirmation(e, today, now.minutes))}
        toConfirm={scheduled.filter((e) => needsConfirmation(e, today, now.minutes))}
        filters={filters}
        totals={{ agendadas: formatGroup(t.agendadas), realizadas: formatGroup(t.realizadas), total: formatGroup(t.total), canceledCount: t.canceledCount, hasTax: t.total.tax > 0n }}
        cnpjs={loaded.cnpjs}
        openExamId={isUuid(one(params.pericia)) ? one(params.pericia) : null}
      />
  );
}
