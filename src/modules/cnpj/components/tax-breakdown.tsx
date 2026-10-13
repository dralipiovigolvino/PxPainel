import { formatMonthLabel, parseCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { estimateTax, formatRate } from "@/lib/tax";
import { cn } from "@/lib/utils";
import { taxPayMonth } from "../domain/tax";

type Props = {
  amountCents: number;
  /** Alíquota gravada no registro; null = não é recebido por CNPJ (nada aparece). */
  rateBp: number | null;
  /** Dia do trabalho: o imposto é pago no mês seguinte. */
  workDate: CivilDate;
  className?: string;
};

/**
 * Plantão ou perícia recebidos por CNPJ: valor, imposto ESTIMADO pela alíquota gravada no registro, o
 * que sobra depois dele e o mês em que o imposto é pago. Sem CNPJ não há imposto estimado nem quadro.
 */
export function TaxBreakdown({ amountCents, rateBp, workDate, className }: Props) {
  if (rateBp === null) return null;
  const { taxCents, netCents } = estimateTax(amountCents, rateBp);
  const month = parseCivilDate(workDate) ? formatMonthLabel(taxPayMonth(workDate)).split(" de ")[0].toLowerCase() : null;
  const rows: Array<[key: string, label: string, value: string]> = [
    ["gross", "Recebido por CNPJ", formatCents(amountCents)],
    ["tax", `Imposto estimado (${formatRate(rateBp)})`, formatCents(taxCents)],
    ["net", "Depois do imposto", formatCents(netCents)],
  ];
  return (
    <div className={cn("rounded-lg bg-muted/60 px-3 py-2 text-sm", className)} data-tax-breakdown="">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        {rows.map(([key, label, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("text-right tabular-nums", key === "net" && "font-semibold")} data-tax={key}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {month && (
        <p className="mt-1 text-xs text-muted-foreground" data-tax-month="">
          Imposto pago em {month}, o mês seguinte ao do trabalho.
        </p>
      )}
    </div>
  );
}
