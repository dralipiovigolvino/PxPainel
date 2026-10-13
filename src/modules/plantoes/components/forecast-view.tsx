import Link from "next/link";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { amountBreakdown } from "@/lib/tax";
import { cn } from "@/lib/utils";
import { sumsTotal, type ForecastGroup, type KindSums } from "../domain/payment";

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
const weekday = (d: CivilDate) => WEEKDAY.format(new Date(`${d}T12:00:00Z`));
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Total previsto do grupo e, se houver, a parte recebida por CNPJ com o imposto estimado dela. */
function Sums({ sums }: { sums: KindSums }) {
  return (
    <p className="flex flex-wrap gap-x-3 text-sm tabular-nums" data-forecast-sums="">
      <span className="font-medium" data-sum="total">
        {formatCents(sumsTotal(sums))}
      </span>
      {sums.grossCount > 0 && (
        <span className="text-muted-foreground" data-sum="cnpj">
          por CNPJ {formatCents(sums.gross)} · imposto estimado <span data-sum="tax">{formatCents(sums.grossTax)}</span>
        </span>
      )}
    </p>
  );
}

export function ForecastView({ groups, today, withoutForecast }: { groups: ForecastGroup[]; today: CivilDate; withoutForecast: number }) {
  const overdue = groups.filter((g) => g.overdue);
  const upcoming = groups.filter((g) => !g.overdue);

  const group = (g: ForecastGroup) => (
    <li key={g.date} className="flex flex-col gap-3 px-4 py-3" data-forecast-group={g.date} data-overdue={g.overdue ? "" : undefined}>
      <div className="flex flex-col gap-1">
        <h3 className="flex flex-wrap items-center gap-2 font-semibold">
          <time dateTime={g.date} className="tabular-nums">
            {formatCivilDate(g.date)}
          </time>
          <span className="text-sm font-normal text-muted-foreground">{weekday(g.date)}</span>
          {g.date === today && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-950">Hoje</span>}
          {g.overdue && <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">Vencida</span>}
        </h3>
        <Sums sums={g.sums} />
      </div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {g.shifts.map((s) => {
          const b = amountBreakdown(s.amountCents, s.amountKind, s.taxRateBp);
          return (
            <li key={s.id} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between" data-forecast-shift={s.id}>
              <span className="flex min-w-0 flex-col">
                <Link href={`/plantoes?mes=${s.date.slice(0, 7)}&plantao=${s.id}`} className="inline-flex min-h-6 items-center font-medium break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  {s.typeName} · {formatCivilDate(s.date)}
                </Link>
                <span className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span>{s.status === "realizado" ? "Realizado" : s.date < today ? "A confirmar" : "Agendado"}</span>
                  {s.expectedPayManual && <span>· data ajustada</span>}
                </span>
              </span>
              <span className="flex flex-col tabular-nums sm:items-end">
                <span className="font-medium">{formatCents(s.amountCents)}</span>
                {b.kind === "bruto" && b.taxCents !== null && <span className="text-muted-foreground">por CNPJ · imposto est. {formatCents(b.taxCents)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </li>
  );

  const section = (id: string, title: string, list: ForecastGroup[], danger = false) => (
    <section aria-labelledby={id} className={cn("rounded-xl border bg-card shadow-xs", danger && "border-destructive/40")} data-forecast-section={id}>
      <h2 id={id} className={cn("border-b px-4 py-2.5 font-semibold", danger && "text-destructive")}>
        {title} <span className="font-normal text-muted-foreground">{list.reduce((n, g) => n + g.shifts.length, 0)}</span>
      </h2>
      <ul className="divide-y">{list.map(group)}</ul>
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      {overdue.length > 0 && section("previsao-vencida", "Previsão vencida, sem recebimento", overdue, true)}
      {upcoming.length > 0 ? (
        section("previsao-proximas", "Próximos recebimentos", upcoming)
      ) : (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs" data-forecast-section="previsao-proximas">
          Nenhum recebimento previsto.
        </p>
      )}
      {withoutForecast > 0 && (
        <p className="text-sm text-muted-foreground" data-forecast-without="">
          {plural(withoutForecast, "plantão a receber está", "plantões a receber estão")} sem data prevista: defina o dia de pagamento em{" "}
          <Link href="/plantoes/tipos" className="underline">
            Tipos
          </Link>
          .
        </p>
      )}
    </div>
  );
}
