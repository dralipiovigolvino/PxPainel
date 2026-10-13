import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { parseYearMonth, todayInSaoPaulo, yearMonthOf } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { listCnpjOptions } from "@/modules/cnpj/data";
import { LoadError } from "@/components/load-error";
import { isUuid, monthRange } from "@/modules/financas/domain/filters";
import { PlantoesView } from "@/modules/plantoes/components/plantoes-view";
import { listShifts, listToConfirm, listTypes, receivedInPeriod } from "@/modules/plantoes/data";
import { matchesFilters, PL_PAYMENTS, PL_SITUATIONS, shiftTotals, type PlPayment, type PlSituation } from "@/modules/plantoes/domain/totals";
import { listSeries, needsGeneration, plGenerationWindow } from "@/modules/plantoes/series-data";

export const metadata: Metadata = { title: "Plantões" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function PlantoesPage({ searchParams }: PageProps<"/plantoes">) {
  const user = await requireUser();
  const params = await searchParams;

  // Calculado no servidor a cada requisição, no fuso de São Paulo.
  const today = todayInSaoPaulo();
  const month = parseYearMonth(one(params.mes)) ?? yearMonthOf(today);
  const { from, to } = monthRange(month);
  const tipo = one(params.tipo);
  const situation = (PL_SITUATIONS as readonly string[]).includes(one(params.situacao) ?? "") ? (one(params.situacao) as PlSituation) : "todos";
  const payment = (PL_PAYMENTS as readonly string[]).includes(one(params.pagamento) ?? "") ? (one(params.pagamento) as PlPayment) : "todos";

  let loaded;
  try {
    // Somente leitura: se faltar gerar até o mês exibido (ou o horizonte), o navegador pede a geração.
    const window = plGenerationWindow(to, today);
    const [types, shifts, series, pending, toConfirm, cnpjs] = await Promise.all([
      listTypes(user),
      listShifts(user, from, to),
      listSeries(user),
      needsGeneration(user, window.target),
      listToConfirm(user, today),
      listCnpjOptions(user),
    ]);
    // Tipo desconhecido na URL (excluído ou de outra conta): volta para "todos".
    const typeId = isUuid(tipo) && types.some((t) => t.id === tipo) ? tipo : null;
    const received = await receivedInPeriod(user, from, to, typeId);
    loaded = { types, shifts, series, toConfirm, typeId, received, cnpjs, generationTarget: pending ? window.target : null, coverageLimit: window.truncated ? window.limit : null };
  } catch {
    return <LoadError />;
  }

  const filters = { typeId: loaded.typeId, situation, payment };
  // Conjunto completo do mês com os filtros (sem paginação): totais e calendário usam o mesmo recorte.
  const shifts = loaded.shifts.filter((s) => matchesFilters(s, filters, today));
  const t = shiftTotals(shifts);
  // No banco, "recebido por CNPJ" é o valor bruto: o imposto estimado do mês é pago no mês seguinte.
  const byCnpj = t.kinds.programado;

  return (
    <PlantoesView
        month={month}
        today={today}
        types={loaded.types}
        shifts={shifts}
        series={loaded.series}
        generationTarget={loaded.generationTarget}
        coverageLimit={loaded.coverageLimit}
        showCanceled={one(params.cancelados) === "1"}
        filters={filters}
        totals={{ programado: formatCents(t.programado), recebidoDoMes: formatCents(t.recebidoDoMes), aReceber: formatCents(t.aReceber), count: t.count }}
        receivedInMonth={{ total: formatCents(loaded.received.cents), count: loaded.received.count }}
        toConfirm={loaded.toConfirm.filter((s) => !loaded.typeId || s.typeId === loaded.typeId)}
        openShiftId={isUuid(one(params.plantao)) ? one(params.plantao) : null}
        cnpjs={loaded.cnpjs}
        cnpjTotal={
          byCnpj.grossCount > 0
            ? { count: byCnpj.grossCount, amount: formatCents(byCnpj.gross), tax: formatCents(byCnpj.grossTax), net: formatCents(t.programado - byCnpj.grossTax) }
            : null
        }
      />
  );
}
