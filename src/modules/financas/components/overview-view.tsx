import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CircleAlert } from "lucide-react";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type Bar = { key: string; label: string; dot?: string; value: string; cents: number; share: number };
type Change = { percent: number | null; against: string };

export type OverviewData = {
  periodLabel: string;
  /** Há filtro de área, forma ou categoria: só as contas que combinam, sem entradas, imposto e resultado. */
  filtered: boolean;
  /** Entradas do período pelo dia em que o dinheiro entra; null com filtro de contas ou sem plantões e perícias lançados. */
  income: { total: string; cents: number; recebido: string; recebidoCents: number; aReceber: string; aReceberCents: number; count: number; change: Change } | null;
  expenses: {
    total: string;
    cents: number;
    pago: string;
    pagoCents: number;
    aPagar: string;
    aPagarCents: number;
    /** Imposto estimado do CNPJ no período; null = nenhum. */
    imposto: string | null;
    impostoCents: number;
    atrasado: string;
    atrasadoCount: number;
    unknownCount: number;
    count: number;
    change: Change;
  };
  /** Entradas − Saídas; null quando não há entradas a mostrar. */
  result: { value: string; negative: boolean } | null;
  evolution: Array<{ key: string; short: string; label: string; income: number; expenses: number; selected: boolean; future: boolean; href: string }>;
  /** De onde veio: por tipo de plantão e por empresa de perícia; null quando não há entradas a mostrar. */
  sources: Bar[] | null;
  byCategory: Bar[];
  /** null = não se aplica (uma área filtrada ou uma área só). */
  byArea: Bar[] | null;
  /** null = forma de pagamento filtrada. */
  byPayment: Bar[] | null;
  top: Array<{ key: string; description: string; detail: string; value: string }>;
  /** O que ainda vai entrar e sair a partir de hoje; null fora do período atual, com filtro ou sem nada à frente. */
  upcoming: {
    receive: string;
    pay: string;
    items: Array<{ key: string; date: string; label: string; detail: string | null; value: string; direction: "entrada" | "saida" }>;
    more: number;
  } | null;
};

/** Cor segue a entidade: entradas numa cor, saídas na outra, em toda a tela. */
const IN = "var(--chart-1)";
const OUT = "var(--chart-2)";

const SERIES = [
  { key: "income", label: "Entradas", color: IN },
  { key: "expenses", label: "Saídas", color: OUT },
] as const;

function Card({ id, title, children, className }: { id: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("min-w-0 rounded-xl border bg-card p-4 shadow-xs", className)} data-chart={id}>
      <h3 id={id} className="mb-3 font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ChangeNote({ change }: { change: Change }) {
  if (change.percent === null) return null;
  return (
    <span className="flex items-center gap-0.5 text-xs font-normal text-muted-foreground" data-change="">
      {change.percent >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : <ArrowDownRight className="size-3.5" aria-hidden="true" />}
      {change.percent >= 0 ? "+" : ""}
      {change.percent.toLocaleString("pt-BR")}% vs {change.against}
    </span>
  );
}

type Segment = { key: string; label: string; value: string; cents: number; tone: number };

/**
 * Uma linha do resumo: total e uma barra na escala comum às duas linhas (dá para comparar entradas e
 * saídas pelo comprimento), dividida no que já aconteceu (cor cheia) e no que falta (mais clara).
 */
function Flow({ stat, label, total, change, color, scale, segments, children }: { stat: string; label: string; total: string; change: Change; color: string; scale: number; segments: Segment[]; children?: React.ReactNode }) {
  const sum = segments.reduce((n, s) => n + Math.max(s.cents, 0), 0);
  const width = scale > 0 && sum > 0 ? Math.max((sum / scale) * 100, 2) : 0;
  return (
    <div data-flow={stat}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm font-medium">{label}</dt>
        <dd className="text-xl font-semibold tabular-nums" data-stat={stat}>
          {total}
        </dd>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-[var(--chart-track)]" aria-hidden="true">
        <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" style={{ width: `${width}%` }}>
          {segments
            .filter((s) => s.cents > 0)
            .map((s) => (
              <span key={s.key} className="min-w-[3px] basis-0" style={{ flexGrow: s.cents, backgroundColor: color, opacity: s.tone }} />
            ))}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: color, opacity: s.tone }} />
              {s.label}
              <span className="font-medium text-foreground tabular-nums" data-stat={s.key}>
                {s.value}
              </span>
            </li>
          ))}
        </ul>
        <ChangeNote change={change} />
      </div>
      {children}
    </div>
  );
}

/** Uma série só: barras horizontais na mesma cor, valor e participação no fim. Valor negativo (ajuste de fatura) fica sem barra, com o sinal. */
function BarList({ rows, color }: { rows: Bar[]; color: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nada com valor informado.</p>;
  const max = Math.max(...rows.map((r) => r.cents), 0);
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key} data-bar={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              {r.dot && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.dot }} />}
              <span className="truncate">{r.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-medium">{r.value}</span> <span className="text-muted-foreground">{r.share.toLocaleString("pt-BR")}%</span>
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-[var(--chart-track)]" aria-hidden="true">
            {r.cents > 0 && <div className="h-2 rounded-full" style={{ width: `${max > 0 ? Math.max((r.cents / max) * 100, 1) : 0}%`, backgroundColor: color }} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

const signed = (cents: number) => `${cents < 0 ? "− " : ""}${formatCents(BigInt(Math.abs(cents)))}`;

/** Colunas lado a lado por mês (entradas e saídas, na mesma escala). Cada mês leva ao mês; dica ao passar ou focar. */
function Evolution({ months, full }: { months: OverviewData["evolution"]; full: boolean }) {
  // `full`: com entradas. Sem elas, só a série de saídas (e o título do cartão já diz o que é).
  const series = full ? SERIES : SERIES.slice(1);
  const max = Math.max(...months.flatMap((m) => series.map((s) => m[s.key])), 0);
  const HEIGHT = 140;
  return (
    <>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {max === 0 ? (
        <p className="text-sm text-muted-foreground">{full ? "Nada lançado nestes meses." : "Sem contas nestes meses."}</p>
      ) : (
        <div className="relative">
          <span className="absolute -top-1 left-0 text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">
            {formatCents(BigInt(max))}
          </span>
          <ol className="grid grid-cols-12 items-end border-b border-[var(--chart-grid)] pt-5" style={{ height: HEIGHT + 20 }} aria-label={full ? "Entradas e saídas por mês" : "Saídas por mês"}>
            {months.map((m, i) => {
              const align = i < 3 ? "left-0" : i > 8 ? "right-0" : "left-1/2 -translate-x-1/2";
              const result = m.income - m.expenses;
              return (
                <li key={m.key} className="flex h-full items-end justify-center">
                  <Link
                    href={m.href}
                    scroll={false}
                    className="group relative flex h-full w-full items-end justify-center gap-[2px] rounded-t outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    aria-label={`${m.label}: ${series.map((s) => `${s.label.toLowerCase()} ${formatCents(BigInt(m[s.key]))}`).join(", ")}${full ? `, resultado ${signed(result)}` : ""}`}
                    data-month={m.key}
                  >
                    {series.map((s) => (
                      <span
                        key={s.key}
                        className={cn("w-[calc(50%-3px)] max-w-3 rounded-t-[4px] md:max-w-5", series.length === 1 && "w-[calc(100%-6px)] max-w-6 md:max-w-8", m.future && "opacity-60")}
                        style={{ height: m[s.key] > 0 ? Math.max((m[s.key] / max) * HEIGHT, 2) : 0, backgroundColor: s.color }}
                        data-series={s.key}
                      />
                    ))}
                    <span
                      role="tooltip"
                      className={cn(
                        "pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max min-w-40 rounded-lg border bg-popover p-2 text-left text-xs shadow-md group-hover:block group-focus-visible:block",
                        align,
                      )}
                    >
                      <span className="block font-semibold">{m.label}</span>
                      {series.map((s) => (
                        <span key={s.key} className="mt-0.5 flex items-center gap-1.5">
                          <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ backgroundColor: s.color }} />
                          <span className="text-muted-foreground">{s.label}</span>
                          <span className="ml-auto pl-2 tabular-nums">{formatCents(BigInt(m[s.key]))}</span>
                        </span>
                      ))}
                      {full && (
                        <span className="mt-1 flex items-center gap-1.5 border-t pt-1">
                          <span className="text-muted-foreground">Resultado</span>
                          <span className="ml-auto pl-2 font-medium tabular-nums">{signed(result)}</span>
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <ol className="mt-1 grid grid-cols-12 text-center text-[11px] text-muted-foreground" aria-hidden="true">
            {months.map((m) => (
              <li key={m.key} className={cn(m.selected && "font-bold text-foreground")}>
                {m.short}
              </li>
            ))}
          </ol>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Ver valores</summary>
            <table className="mt-2 w-full text-right tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 text-left font-medium">
                    Mês
                  </th>
                  {series.map((s) => (
                    <th key={s.key} scope="col" className="py-1 font-medium">
                      {s.label}
                    </th>
                  ))}
                  {full && (
                    <th scope="col" className="py-1 font-medium">
                      Resultado
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.key} className={cn("border-t", m.selected && "font-semibold")}>
                    <th scope="row" className="py-1 text-left font-normal">
                      {m.label}
                    </th>
                    {series.map((s) => (
                      <td key={s.key}>{formatCents(BigInt(m[s.key]))}</td>
                    ))}
                    {full && <td className={cn(m.income - m.expenses < 0 && "text-destructive")}>{signed(m.income - m.expenses)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </>
  );
}

export function OverviewView({ data }: { data: OverviewData }) {
  const { income, expenses, result, upcoming } = data;
  const withIncome = income !== null;
  const empty = expenses.count === 0 && (income === null || income.count === 0);
  // Sem valores conhecidos (só contas "a informar"), os gráficos de participação não têm o que mostrar.
  const hasValues = data.byCategory.length > 0 || data.top.length > 0;
  const hasHistory = data.evolution.some((m) => m.income > 0 || m.expenses > 0);
  // As duas barras do resumo usam a mesma escala: a maior delas ocupa a largura toda.
  const scale = Math.max(income?.cents ?? 0, expenses.cents, 0);
  return (
    <div className="flex flex-col gap-4">
      {empty ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs" data-overview-empty="">
          {withIncome ? "Nada lançado neste período." : "Sem contas neste período."}
        </p>
      ) : (
        <section aria-label={`Resumo de ${data.periodLabel}`} className="rounded-xl border bg-card p-4 shadow-xs" data-summary="">
          <dl className="flex flex-col gap-4">
            {income && (
              <Flow
                stat="entradas"
                label="Entradas"
                total={income.total}
                change={income.change}
                color={IN}
                scale={scale}
                segments={[
                  { key: "recebido", label: "Recebido", value: income.recebido, cents: income.recebidoCents, tone: 1 },
                  { key: "a-receber", label: "A receber", value: income.aReceber, cents: income.aReceberCents, tone: 0.45 },
                ]}
              />
            )}
            <Flow
              stat="saidas"
              label="Saídas"
              total={expenses.total}
              change={expenses.change}
              color={OUT}
              scale={scale}
              segments={[
                { key: "pago", label: "Pago", value: expenses.pago, cents: expenses.pagoCents, tone: 1 },
                { key: "a-pagar", label: "A pagar", value: expenses.aPagar, cents: expenses.aPagarCents, tone: 0.55 },
                ...(expenses.imposto ? [{ key: "imposto", label: "Imposto estimado", value: expenses.imposto, cents: expenses.impostoCents, tone: 0.3 }] : []),
              ]}
            >
              {expenses.atrasadoCount > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive" data-overdue="">
                  <CircleAlert className="size-3.5" aria-hidden="true" />
                  {expenses.atrasado} atrasado{expenses.atrasadoCount > 1 ? "s" : ""}
                </p>
              )}
            </Flow>
          </dl>
          {result && (
            <p className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-3">
              <span className="text-sm font-medium">
                Resultado <span className="font-normal text-muted-foreground">{result.negative ? "(faltam)" : "(sobram)"}</span>
              </span>
              <span className={cn("text-xl font-semibold tabular-nums", result.negative && "text-destructive")} data-stat="resultado">
                {result.value}
              </span>
            </p>
          )}
          {data.filtered && (
            <p className="mt-3 text-xs text-muted-foreground" data-filtered-note="">
              Com filtro, aparecem só as contas que combinam. Entradas, imposto estimado e resultado ficam de fora.
            </p>
          )}
        </section>
      )}
      {expenses.unknownCount > 0 && (
        <p className="-mt-2 text-xs text-muted-foreground" data-unknown="">
          {expenses.unknownCount === 1 ? "1 conta com valor a informar ficou fora dos totais." : `${expenses.unknownCount} contas com valor a informar ficaram fora dos totais.`}
        </p>
      )}

      {(!empty || hasHistory) && (
        <Card id="grafico-evolucao" title={withIncome ? "Entradas e saídas por mês" : "Saídas por mês"}>
          <Evolution months={data.evolution} full={withIncome} />
          {data.evolution.some((m) => m.future && (m.income > 0 || m.expenses > 0)) && <p className="mt-2 text-xs text-muted-foreground">Meses futuros mostram só o que já está lançado.</p>}
        </Card>
      )}

      {(hasValues || (data.sources && data.sources.length > 0) || upcoming) && (
        // Uma coluna no celular; em telas largas, duas colunas que se equilibram (sem cartão esticado nem espaço vazio).
        <div className="flex flex-col gap-4 lg:block lg:columns-2 lg:gap-4 lg:[&>*]:mb-4 lg:[&>*]:break-inside-avoid">
          {data.sources && data.sources.length > 0 && (
            <Card id="grafico-entradas" title="De onde veio">
              <BarList rows={data.sources} color={IN} />
            </Card>
          )}
          {upcoming && (
            <Card id="proximos" title="Próximos 30 dias">
              <p className="mb-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span>
                  A receber{" "}
                  <span className="font-semibold text-foreground tabular-nums" data-upcoming="receber">
                    {upcoming.receive}
                  </span>
                </span>
                <span>
                  A pagar{" "}
                  <span className="font-semibold text-foreground tabular-nums" data-upcoming="pagar">
                    {upcoming.pay}
                  </span>
                </span>
              </p>
              <ol className="divide-y">
                {upcoming.items.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 py-2 text-sm last:pb-0" data-upcoming-item={item.direction}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.direction === "entrada" ? IN : OUT }} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {item.date} · {item.direction === "entrada" ? "a receber" : "a pagar"}
                          {item.detail ? ` · ${item.detail}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {item.direction === "entrada" ? "+" : "−"} {item.value}
                    </span>
                  </li>
                ))}
              </ol>
              {upcoming.more > 0 && <p className="mt-2 text-xs text-muted-foreground">… e mais {upcoming.more}.</p>}
            </Card>
          )}
          {hasValues && (
            <>
              <Card id="grafico-categorias" title="Saídas por categoria">
                <BarList rows={data.byCategory} color={OUT} />
              </Card>
              {data.byPayment && (
                <Card id="grafico-formas" title="Saídas por forma de pagamento">
                  <BarList rows={data.byPayment} color={OUT} />
                </Card>
              )}
              {data.byArea && (
                <Card id="grafico-areas" title="Saídas por área">
                  <BarList rows={data.byArea} color={OUT} />
                </Card>
              )}
              <Card id="maiores" title="Maiores saídas">
                <ol className="divide-y">
                  {data.top.map((t) => (
                    <li key={t.key} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0" data-top="">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{t.description}</span>
                        <span className="block text-xs text-muted-foreground">{t.detail}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{t.value}</span>
                    </li>
                  ))}
                </ol>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
