"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FilterChips } from "@/components/filter-chips";
import { Button } from "@/components/ui/button";
import { yearMonthOf, type CivilDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { overviewHref, periodLabel, shiftPeriod, type OverviewFilters as Filters } from "../domain/analytics";
import { selectClass } from "./series-fields";

type Props = {
  filters: Filters;
  today: CivilDate;
  areas: Array<{ id: string; name: string; color: string }>;
  payments: Array<{ key: string; label: string }>;
  categories: string[];
};

/** Filtros da Visão geral, numa faixa acima dos gráficos: período, área, forma de pagamento e categoria. */
export function OverviewFilters({ filters, today, areas, payments, categories }: Props) {
  const router = useRouter();
  const go = (overrides: Partial<Filters>) => router.push(overviewHref(filters, overrides), { scroll: false });
  const thisMonth = yearMonthOf(today);
  const kinds = [
    { kind: "mes", label: "Mês", href: overviewHref(filters, { period: { kind: "mes", month: filters.period.kind === "mes" ? filters.period.month : thisMonth } }) },
    { kind: "ano", label: "Ano", href: overviewHref(filters, { period: { kind: "ano", year: filters.period.kind === "ano" ? filters.period.year : thisMonth.year } }) },
  ] as const;
  const isCurrent = filters.period.kind === "mes" ? filters.period.month.year === thisMonth.year && filters.period.month.month === thisMonth.month : filters.period.year === thisMonth.year;
  const current = overviewHref(filters, { period: filters.period.kind === "mes" ? { kind: "mes", month: thisMonth } : { kind: "ano", year: thisMonth.year } });
  const filtered = Boolean(filters.areaId || filters.payment || filters.category);

  return (
    <section aria-label="Filtros" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="group" aria-label="Período">
          {kinds.map((k) => (
            <Link
              key={k.kind}
              href={k.href}
              scroll={false}
              aria-current={filters.period.kind === k.kind ? "true" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filters.period.kind === k.kind ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="icon" className="size-10">
            <Link href={overviewHref(filters, { period: shiftPeriod(filters.period, -1) })} scroll={false} aria-label={filters.period.kind === "mes" ? "Mês anterior" : "Ano anterior"}>
              <ChevronLeft aria-hidden="true" />
            </Link>
          </Button>
          <h2 className="min-w-32 text-center font-semibold" aria-live="polite" data-period-label="">
            {periodLabel(filters.period)}
          </h2>
          <Button asChild variant="outline" size="icon" className="size-10">
            <Link href={overviewHref(filters, { period: shiftPeriod(filters.period, 1) })} scroll={false} aria-label={filters.period.kind === "mes" ? "Próximo mês" : "Próximo ano"}>
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
          {!isCurrent && (
            <Button asChild variant="ghost" className="h-10 px-3">
              <Link href={current} scroll={false}>
                Hoje
              </Link>
            </Button>
          )}
        </div>
      </div>

      {areas.length > 1 && (
        <FilterChips
          label="Área"
          items={[
            { key: "todas", href: overviewHref(filters, { areaId: null }), label: "Todas", active: !filters.areaId },
            ...areas.map((a) => ({ key: a.id, href: overviewHref(filters, { areaId: a.id }), label: a.name, active: filters.areaId === a.id, dot: a.color })),
          ]}
        />
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground sm:max-w-56">
          Forma de pagamento
          <select className={selectClass} value={filters.payment ?? ""} onChange={(e) => go({ payment: e.target.value || null })} data-filter="forma">
            <option value="">Todas</option>
            {payments.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground sm:max-w-56">
          Categoria
          <select className={selectClass} value={filters.category ?? ""} onChange={(e) => go({ category: e.target.value || null })} data-filter="categoria">
            <option value="">Todas</option>
            {filters.category && !categories.includes(filters.category) && <option value={filters.category}>{filters.category}</option>}
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <Button asChild variant="ghost" className="h-10 px-3">
            <Link href={overviewHref(filters, { areaId: null, payment: null, category: null })} scroll={false}>
              Limpar filtros
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}
