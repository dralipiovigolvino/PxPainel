import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/session";
import { addMonths, formatCivilDate, formatMonthLabel, formatYearMonth, isSameYearMonth, todayInSaoPaulo, yearMonthOf } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { CnpjManager, type CnpjCard } from "@/modules/cnpj/components/cnpj-manager";
import { listCnpjs, suggestedTaxRateBp } from "@/modules/cnpj/data";
import { taxDueDate, taxDues } from "@/modules/cnpj/domain/tax";
import { monthRange } from "@/modules/financas/domain/filters";
import { listExamWork } from "@/modules/pericias/work-data";
import { PlGenerationSync } from "@/modules/plantoes/components/pl-generation-sync";
import { needsGeneration, plGenerationWindow } from "@/modules/plantoes/series-data";
import { listShiftWork } from "@/modules/plantoes/work-data";

export const metadata: Metadata = { title: "CNPJ" };

const monthName = (label: string) => label.split(" de ")[0].toLowerCase();
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export default async function CnpjPage() {
  const user = await requireUser();
  const today = todayInSaoPaulo();
  const current = yearMonthOf(today);
  // Meses de pagamento exibidos: o anterior, o atual e os dois seguintes (trabalho de dois meses atrás até o mês que vem).
  const payMonths = [-1, 0, 1, 2].map((delta) => addMonths(current, delta));
  const from = monthRange(addMonths(payMonths[0], -1)).from;
  const to = monthRange(addMonths(payMonths[payMonths.length - 1], -1)).to;

  let loaded;
  try {
    // Somente leitura: se faltar gerar plantões recorrentes até o fim do período, o navegador pede a geração.
    const window = plGenerationWindow(to, today);
    const [cnpjs, shifts, exams, suggestedRateBp, pending] = await Promise.all([
      listCnpjs(user),
      listShiftWork(user, from, to),
      listExamWork(user, from, to),
      suggestedTaxRateBp(user),
      needsGeneration(user, window.target),
    ]);
    loaded = { cnpjs, work: [...shifts, ...exams], suggestedRateBp, generationTarget: pending ? window.target : null };
  } catch {
    return <LoadError />;
  }

  // As leituras trazem também o que só ENTRA no período; o imposto conta pelo dia do trabalho.
  const dues = taxDues(loaded.work.filter((r) => r.workDate >= from && r.workDate <= to));
  const cards: CnpjCard[] = loaded.cnpjs.map((c) => ({
    ...c,
    rows: payMonths.map((payMonth) => {
      const due = dues.find((d) => d.cnpjId === c.id && isSameYearMonth(d.payMonth, payMonth));
      const parts = due ? [due.shifts > 0 && plural(due.shifts, "plantão", "plantões"), due.exams > 0 && plural(due.exams, "perícia", "perícias")].filter(Boolean) : [];
      return {
        key: formatYearMonth(payMonth),
        payMonth: formatMonthLabel(payMonth),
        dueDate: formatCivilDate(taxDueDate(payMonth, c.taxDueDay)),
        current: isSameYearMonth(payMonth, current),
        workMonth: monthName(formatMonthLabel(addMonths(payMonth, -1))),
        base: due ? formatCents(due.baseCents) : null,
        tax: due ? formatCents(due.taxCents) : null,
        detail: parts.length > 0 ? parts.join(" e ") : null,
      };
    }),
  }));

  return (
    <>
      <PageHeader title="CNPJ" />
      <div className="flex max-w-3xl flex-col gap-4">
        <PlGenerationSync target={loaded.generationTarget} />
        <CnpjManager cnpjs={cards} suggestedRateBp={loaded.suggestedRateBp} currentMonth={monthName(formatMonthLabel(current))} />
      </div>
    </>
  );
}
