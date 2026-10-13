import { describe, expect, it } from "vitest";
import type { WorkRecord } from "@/modules/cnpj/contract";
import { taxDues } from "@/modules/cnpj/domain/tax";
import { applyScope, breakdown, monthly, summarize, TAX, topItems, type AnalyticsItem } from "./analytics";
import { incomeInRange, incomeMonthly, incomeSources, incomeTotals, taxItems, upcoming, upcomingTotals } from "./cashflow";

const CNPJ = "00000000-0000-4000-8000-0000000000a1";
const CASA = "00000000-0000-4000-8000-00000000000a";
const CARD = "00000000-0000-4000-8000-0000000000c1";
const TODAY = "2026-10-15";
const OUTUBRO = { from: "2026-10-01", to: "2026-10-31" };

const work = (id: string, workDate: string, amountCents: number, extra: Partial<WorkRecord> = {}): WorkRecord => ({
  source: "plantao",
  id,
  label: "UPA",
  workDate,
  cashDate: workDate,
  received: false,
  amountCents,
  cnpjId: null,
  taxRateBp: null,
  ...extra,
});

const conta = (id: string, due: string, cents: bigint | null, extra: Partial<AnalyticsItem> = {}): AnalyticsItem => ({
  source: "conta",
  id,
  description: id,
  dueDate: due,
  areaId: CASA,
  category: null,
  cents,
  status: "pendente",
  paymentMethod: "pix",
  cardId: null,
  ...extra,
});

// Setembro trabalhado por CNPJ e pago em 20/10; outubro trabalhado e pago em 20/11; uma perícia recebida na hora.
const records: WorkRecord[] = [
  work("set-1", "2026-09-05", 120000, { cashDate: "2026-10-20", cnpjId: CNPJ, taxRateBp: 900 }),
  work("set-2", "2026-09-19", 120000, { cashDate: "2026-10-20", cnpjId: CNPJ, taxRateBp: 900 }),
  work("out-1", "2026-10-03", 150000, { cashDate: "2026-11-20", cnpjId: CNPJ, taxRateBp: 900 }),
  work("pericia", "2026-10-08", 40000, { source: "pericia", label: "Empresa X", cashDate: "2026-10-08", received: true }),
  work("adiantado", "2026-10-25", 100000, { label: "Hospital", cashDate: "2026-10-10", received: true }),
];

describe("entradas pelo dia em que o dinheiro entra", () => {
  it("o mês soma o que entrou e o que está previsto para entrar nele, não o que foi trabalhado", () => {
    const outubro = incomeInRange(records, OUTUBRO);
    expect(outubro.map((r) => r.id)).toEqual(["set-1", "set-2", "pericia", "adiantado"]);
    expect(incomeTotals(outubro)).toEqual({ total: 380000n, recebido: 140000n, aReceber: 240000n, count: 4 });
  });

  it("por mês, com recebido e a receber separados", () => {
    const bars = incomeMonthly(records, [
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
    ]);
    expect(bars.map((b) => [b.month.month, b.recebido, b.aReceber, b.total])).toEqual([
      [9, 0n, 0n, 0n],
      [10, 140000n, 240000n, 380000n],
      [11, 0n, 150000n, 150000n],
    ]);
  });

  it("de onde veio: por tipo de plantão e por empresa, da maior para a menor", () => {
    const rows = incomeSources(incomeInRange(records, OUTUBRO));
    expect(rows.map((r) => [r.source, r.label, r.cents, r.count])).toEqual([
      ["plantao", "UPA", 240000n, 2],
      ["plantao", "Hospital", 100000n, 1],
      ["pericia", "Empresa X", 40000n, 1],
    ]);
    expect(incomeSources([])).toEqual([]);
  });
});

describe("imposto estimado como saída", () => {
  const cnpjs = new Map([[CNPJ, { name: "Minha empresa", taxDueDay: 20 }]]);
  const tax = taxItems(taxDues(records), cnpjs);

  it("um item por CNPJ e mês de pagamento, no dia de pagamento do CNPJ", () => {
    expect(tax.map((t) => [t.dueDate, t.cents, t.description, t.status])).toEqual([
      ["2026-10-20", 21600n, "Imposto estimado · Minha empresa", "estimado"],
      ["2026-11-20", 13500n, "Imposto estimado · Minha empresa", "estimado"],
    ]);
  });

  it("estimativa zerada não vira item", () => {
    expect(taxItems(taxDues([work("zero", "2026-10-01", 100000, { cnpjId: CNPJ, taxRateBp: 0 })]), cnpjs)).toEqual([]);
  });

  it("entra no total das saídas, fora de Pago e de A pagar, e nunca fica atrasado", () => {
    const items = [conta("aluguel", "2026-10-10", 150000n), conta("luz", "2026-10-05", 20000n, { status: "pago" }), ...tax.filter((t) => t.dueDate.startsWith("2026-10"))];
    const t = summarize(items, "2026-10-25");
    expect(t).toMatchObject({ pago: 20000n, aPagar: 150000n, imposto: 21600n, total: 191600n, atrasado: 150000n, atrasadoCount: 1 });
  });

  it("tem a linha dele nas divisões e some com filtro de área, forma ou categoria", () => {
    const items = [conta("aluguel", "2026-10-10", 150000n, { category: "Moradia" }), ...tax];
    for (const by of ["category", "area", "payment"] as const) {
      expect(breakdown(items, by).find((r) => r.key === TAX)?.cents).toBe(35100n);
    }
    expect(applyScope(items, { areaId: CASA, payment: null, category: null }).map((i) => i.id)).toEqual(["aluguel"]);
    expect(applyScope(items, { areaId: null, payment: "nenhuma", category: null })).toEqual([]);
    expect(applyScope(items, { areaId: null, payment: null, category: "Moradia" }).map((i) => i.id)).toEqual(["aluguel"]);
  });

  it("aparece no gráfico por mês e entre os maiores valores", () => {
    const items = [conta("aluguel", "2026-10-10", 15000n), ...tax];
    const [out, nov] = monthly(items, [
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
    ]);
    expect([out.aPagar, out.imposto, out.total]).toEqual([15000n, 21600n, 36600n]);
    expect([nov.imposto, nov.total]).toEqual([13500n, 13500n]);
    expect(topItems(items, 1)[0].source).toBe("imposto");
  });
});

describe("próximos dias", () => {
  const range = { from: TODAY, to: "2026-11-14" };
  const cardNames = new Map([[CARD, "Banco X"]]);
  const expenses: AnalyticsItem[] = [
    conta("aluguel", "2026-10-20", 150000n),
    conta("atrasada", "2026-10-10", 9000n),
    conta("paga", "2026-10-22", 5000n, { status: "pago" }),
    conta("a-informar", "2026-10-23", null),
    conta("geladeira", "2026-11-05", 30000n, { source: "cartao", paymentMethod: null, cardId: CARD }),
    conta("resto", "2026-11-05", 20000n, { source: "cartao", paymentMethod: null, cardId: CARD, areaId: null, undetailed: true }),
    ...taxItems(taxDues(records), new Map([[CNPJ, { name: "Minha empresa", taxDueDay: 20 }]])),
  ];
  const list = upcoming(expenses, records, range, cardNames);

  it("junta em ordem de data o que ainda vai entrar e sair; o que já passou, já foi pago ou recebido fica fora", () => {
    expect(list.map((i) => [i.date, i.direction, i.kind, i.label, i.cents, i.count])).toEqual([
      ["2026-10-20", "entrada", "plantao", "UPA", 240000n, 2],
      ["2026-10-20", "saida", "conta", "aluguel", 150000n, 1],
      ["2026-10-20", "saida", "imposto", "Imposto estimado · Minha empresa", 21600n, 1],
      ["2026-11-05", "saida", "fatura", "Fatura do Banco X", 50000n, 1],
    ]);
  });

  it("soma entradas e saídas da lista", () => {
    expect(upcomingTotals(list)).toEqual({ entradas: 240000n, saidas: 221600n });
  });
});
