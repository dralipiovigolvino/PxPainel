import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireUser } from "@/lib/auth/session";
import { addDays, addMonths, formatCivilDate, formatMonthLabel, formatYearMonth, todayInSaoPaulo, yearMonthOf } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { listCnpjOptions } from "@/modules/cnpj/data";
import { taxDues } from "@/modules/cnpj/domain/tax";
import { listCards } from "@/modules/financas/cards-data";
import { GenerationSync } from "@/modules/financas/components/generation-sync";
import { OverviewFilters } from "@/modules/financas/components/overview-filters";
import { OverviewView, type OverviewData } from "@/modules/financas/components/overview-view";
import { listAreas } from "@/modules/financas/data";
import {
  applyScope,
  breakdown,
  dataRange,
  evolutionMonths,
  foldTail,
  inRange,
  monthly,
  overviewHref,
  parseOverviewFilters,
  percentChange,
  periodLabel,
  periodRange,
  previousLabel,
  shiftPeriod,
  summarize,
  TAX,
  topItems,
  UNDETAILED,
} from "@/modules/financas/domain/analytics";
import { incomeInRange, incomeMonthly, incomeSources, incomeTotals, taxItems, upcoming, upcomingTotals } from "@/modules/financas/domain/cashflow";
import { isUuid, monthRange } from "@/modules/financas/domain/filters";
import { paymentKeyLabel } from "@/modules/financas/domain/payment";
import { generationWindow } from "@/modules/financas/domain/recurrence";
import { listCategories, listOverviewItems } from "@/modules/financas/overview-data";
import { needsGeneration } from "@/modules/financas/series-data";
import { listExamWork } from "@/modules/pericias/work-data";
import { PlGenerationSync } from "@/modules/plantoes/components/pl-generation-sync";
import { needsGeneration as needsShiftGeneration, plGenerationWindow } from "@/modules/plantoes/series-data";
import { listShiftWork } from "@/modules/plantoes/work-data";

export const metadata: Metadata = { title: "Finanças" };

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** Parte da fatura do cartão sem compra cadastrada: aparece identificada, sem categoria nem área inventadas. */
const UNDETAILED_LABEL = "Cartão, sem detalhe";
/** Imposto estimado do CNPJ: não é conta, não tem categoria, área nem forma de pagamento. */
const TAX_LABEL = "Imposto estimado (CNPJ)";
/** Linhas da lista "Próximos 30 dias". */
const UPCOMING_ROWS = 8;

const monthName = (label: string) => label.split(" de ")[0].toLowerCase();

export default async function VisaoGeralPage({ searchParams }: PageProps<"/financas">) {
  const user = await requireUser();
  const today = todayInSaoPaulo();
  const filters = parseOverviewFilters(await searchParams, today);
  const range = dataRange(filters.period);
  const period = periodRange(filters.period);
  // "Próximos 30 dias" só aparece quando o período exibido é o de hoje.
  const soon = today >= period.from && today <= period.to ? { from: today, to: addDays(today, 30) } : null;
  const to = soon && soon.to > range.to ? soon.to : range.to;
  // O imposto estimado de um mês vem do trabalho do mês anterior.
  const workFrom = monthRange(addMonths(yearMonthOf(range.from), -1)).from;

  let loaded;
  try {
    const [areas, cards, categories, items, cnpjs, shifts, exams] = await Promise.all([
      listAreas(user),
      listCards(user),
      listCategories(user),
      listOverviewItems(user, range.from, to),
      listCnpjOptions(user),
      listShiftWork(user, workFrom, to),
      listExamWork(user, workFrom, to),
    ]);
    // Somente leitura: se faltar gerar recorrências (contas ou plantões) até o fim do gráfico, o navegador pede a geração.
    const window = generationWindow(to, today);
    const shiftWindow = plGenerationWindow(to, today);
    const [pending, shiftsPending] = await Promise.all([needsGeneration(user, window.target), needsShiftGeneration(user, shiftWindow.target)]);
    loaded = { areas, cards, categories, items, cnpjs, work: [...shifts, ...exams], generationTarget: pending ? window.target : null, shiftGenerationTarget: shiftsPending ? shiftWindow.target : null };
  } catch {
    return <LoadError />;
  }
  const { areas, cards, categories, items, cnpjs, work } = loaded;
  // Ids desconhecidos na URL (apagados ou de outra conta) viram "todos".
  if (filters.areaId && !areas.some((a) => a.id === filters.areaId)) filters.areaId = null;
  if (filters.payment && isUuid(filters.payment) && !cards.some((c) => c.id === filters.payment)) filters.payment = null;
  // Com filtro de área, forma ou categoria a tela mostra só as contas que combinam; entradas e
  // resultado só aparecem sem filtro e quando há plantões ou perícias lançados.
  const filtered = Boolean(filters.areaId || filters.payment || filters.category);
  const withIncome = !filtered && work.length > 0;

  // O imposto estimado entra como saída (e some sozinho com filtro: não tem área, forma nem categoria).
  const all = [...items, ...taxItems(taxDues(work), new Map(cnpjs.map((c) => [c.id, c])))];
  const scoped = applyScope(all, filters);
  const current = inRange(scoped, period);
  const totals = summarize(current, today);
  const previousPeriod = periodRange(shiftPeriod(filters.period, -1));
  const previous = summarize(inRange(scoped, previousPeriod), today);
  const against = previousLabel(filters.period);
  const cardNames = new Map(cards.map((c) => [c.id, c.name]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const share = (cents: bigint, total: bigint) => (total > 0n ? Number((cents * 1000n) / total) / 10 : 0);
  const selectedKey = filters.period.kind === "mes" ? formatYearMonth(filters.period.month) : null;
  const currentKey = formatYearMonth(yearMonthOf(today));

  const incomeNow = incomeInRange(work, period);
  const income = incomeTotals(incomeNow);
  const incomeBefore = incomeTotals(incomeInRange(work, previousPeriod));
  const result = income.total - totals.total;
  const months = evolutionMonths(filters.period);
  const expenseBars = monthly(scoped, months);
  const incomeBars = incomeMonthly(work, months);
  const next = soon && !filtered ? upcoming(all, work, soon, cardNames) : [];
  const nextTotals = upcomingTotals(next);

  const data: OverviewData = {
    periodLabel: periodLabel(filters.period),
    filtered,
    income: withIncome
      ? {
          total: formatCents(income.total),
          cents: Number(income.total),
          recebido: formatCents(income.recebido),
          recebidoCents: Number(income.recebido),
          aReceber: formatCents(income.aReceber),
          aReceberCents: Number(income.aReceber),
          count: income.count,
          change: { percent: percentChange(income.total, incomeBefore.total), against },
        }
      : null,
    expenses: {
      total: formatCents(totals.total),
      cents: Number(totals.total),
      pago: formatCents(totals.pago),
      pagoCents: Number(totals.pago),
      aPagar: formatCents(totals.aPagar),
      aPagarCents: Number(totals.aPagar),
      imposto: totals.imposto > 0n ? formatCents(totals.imposto) : null,
      impostoCents: Number(totals.imposto),
      atrasado: formatCents(totals.atrasado),
      atrasadoCount: totals.atrasadoCount,
      unknownCount: totals.unknownCount,
      count: totals.count,
      change: { percent: percentChange(totals.total, previous.total), against },
    },
    result: withIncome ? { value: result === 0n ? formatCents(0n) : `${result < 0n ? "−" : "+"} ${formatCents(result < 0n ? -result : result)}`, negative: result < 0n } : null,
    evolution: months.map((month, i) => {
      const key = formatYearMonth(month);
      return {
        key,
        short: MONTH_SHORT[month.month - 1],
        label: formatMonthLabel(month),
        income: withIncome ? Number(incomeBars[i].total) : 0,
        expenses: Number(expenseBars[i].total),
        selected: key === selectedKey,
        future: key > currentKey,
        href: overviewHref(filters, { period: { kind: "mes", month } }),
      };
    }),
    sources: withIncome
      ? foldTail(
          incomeSources(incomeNow).map((r) => ({ key: r.key, label: `${r.source === "plantao" ? "Plantões" : "Perícias"} · ${r.label}`, cents: r.cents })),
          8,
        ).map((r) => ({ key: r.key ?? "?", label: r.label ?? "", value: formatCents(r.cents), cents: Number(r.cents), share: share(r.cents, income.total) }))
      : null,
    byCategory: foldTail(breakdown(current, "category"), 8).map((r) => ({
      key: r.key ?? "sem",
      label: r.key === TAX ? TAX_LABEL : r.key === UNDETAILED ? UNDETAILED_LABEL : (r.label ?? "Sem categoria"),
      value: formatCents(r.cents),
      cents: Number(r.cents),
      share: share(r.cents, totals.total),
    })),
    byArea:
      filters.areaId || areas.length < 2
        ? null
        : breakdown(current, "area").map((r) => {
            const area = r.key ? areaById.get(r.key) : undefined;
            return {
              key: r.key ?? "?",
              label: r.key === TAX ? TAX_LABEL : r.key === UNDETAILED ? UNDETAILED_LABEL : (area?.name ?? "Área"),
              dot: area?.color,
              value: formatCents(r.cents),
              cents: Number(r.cents),
              share: share(r.cents, totals.total),
            };
          }),
    byPayment: filters.payment
      ? null
      : breakdown(current, "payment").map((r) => ({
          key: r.key ?? "?",
          label: r.key === TAX ? TAX_LABEL : paymentKeyLabel(r.key ?? "", cardNames),
          value: formatCents(r.cents),
          cents: Number(r.cents),
          share: share(r.cents, totals.total),
        })),
    top: topItems(current, 5).map((i) => ({
      key: `${i.source}:${i.id}`,
      description: i.description,
      detail:
        i.source === "imposto"
          ? `${formatCivilDate(i.dueDate)} · sobre o trabalho de ${monthName(formatMonthLabel(addMonths(yearMonthOf(i.dueDate), -1)))}`
          : [formatCivilDate(i.dueDate), paymentKeyLabel(i.cardId ?? i.paymentMethod ?? "nenhuma", cardNames)].join(" · "),
      value: formatCents(i.cents!),
    })),
    upcoming:
      next.length > 0
        ? {
            receive: formatCents(nextTotals.entradas),
            pay: formatCents(nextTotals.saidas),
            items: next.slice(0, UPCOMING_ROWS).map((i) => ({
              key: i.key,
              date: formatCivilDate(i.date),
              label: i.kind === "plantao" ? `Plantão · ${i.label}` : i.kind === "pericia" ? `Perícia · ${i.label}` : i.label,
              detail: i.count > 1 ? `${i.count} ${i.kind === "pericia" ? "perícias" : "plantões"}` : null,
              value: formatCents(i.cents),
              direction: i.direction,
            })),
            more: Math.max(next.length - UPCOMING_ROWS, 0),
          }
        : null,
  };

  return (
    <div className="flex flex-col gap-4">
      <GenerationSync target={loaded.generationTarget} />
      <PlGenerationSync target={loaded.shiftGenerationTarget} />
      <OverviewFilters
        filters={filters}
        today={today}
        areas={areas.filter((a) => !a.archived || a.id === filters.areaId).map((a) => ({ id: a.id, name: a.name, color: a.color }))}
        payments={[
          { key: "pix", label: "Pix" },
          { key: "boleto", label: "Boleto" },
          ...cards.filter((c) => !c.archived || c.id === filters.payment).map((c) => ({ key: c.id, label: c.name })),
          { key: "nenhuma", label: "Forma não informada" },
        ]}
        categories={categories}
      />
      <OverviewView data={data} />
    </div>
  );
}
