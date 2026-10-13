import { describe, expect, it } from "vitest";
import type { CardCharge, EntryView, FinArea, FinInvoice } from "../types";
import { invoiceTotal } from "./cards";
import { buildInvoices, cardGroups, groupByArea, invoiceRemainder, matchesMonthSituation, monthTotals } from "./month";

const CASA = "00000000-0000-4000-8000-00000000000a";
const CLINICA = "00000000-0000-4000-8000-00000000000b";
const TODAY = "2026-10-15";

const area = (id: string, name: string): FinArea => ({ id, name, color: "#2563eb", archived: false, entryCount: 0, activeSeries: 0 });

const conta = (id: string, due: string, cents: number | null, extra: Partial<EntryView> = {}): EntryView => ({
  id,
  areaId: CASA,
  description: id,
  amountCents: cents,
  dueDate: due,
  category: null,
  notes: null,
  status: "pendente",
  paidOn: null,
  seriesId: null,
  occurrenceDate: null,
  isOverride: false,
  isVariable: false,
  installmentPlanId: null,
  installmentNumber: null,
  installmentCount: null,
  paymentMethod: "pix",
  overdue: false,
  kind: "unica",
  ...extra,
});

/** Fatura como vem do banco: o total considerado segue a regra de `invoiceTotal`. */
const fatura = (id: string, due: string, detailedCents: number, extra: Partial<FinInvoice> & { paidTotalCents?: number | null } = {}): FinInvoice => {
  const { paidTotalCents = null, ...rest } = extra;
  const base = { id, cardId: "c1", cardName: "Banco do Brasil", dueDate: due, status: "pendente" as const, paidOn: null, statedCents: null, detailedCents, ...rest };
  return { ...base, totalCents: invoiceTotal({ status: base.status, paidTotalCents, statedCents: base.statedCents, detailedCents }) };
};

const parcela = (id: string, invoiceId: string, cents: number, extra: Partial<CardCharge> = {}): CardCharge => ({
  id,
  purchaseId: `p-${id}`,
  invoiceId,
  cardId: "c1",
  cardName: "Banco do Brasil",
  areaId: CASA,
  description: id,
  category: null,
  notes: null,
  purchaseDate: "2026-09-04",
  dueDate: "2026-10-20",
  number: 1,
  count: 4,
  amountCents: cents,
  purchaseTotalCents: cents * 4,
  ...extra,
});

describe("compras agrupadas por cartão e vencimento", () => {
  const invoices = buildInvoices(
    [
      fatura("f-nu", "2026-10-25", 30000, { cardId: "c2", cardName: "Nubank" }),
      fatura("f-bb-20", "2026-10-20", 100000),
      fatura("f-bb-05", "2026-10-05", 20000),
    ],
    [
      parcela("geladeira", "f-bb-20", 50000),
      parcela("notebook", "f-bb-20", 50000, { areaId: CLINICA, number: 2, count: 5 }),
      parcela("tenis", "f-nu", 30000, { cardId: "c2", cardName: "Nubank" }),
      parcela("livro", "f-bb-05", 20000, { dueDate: "2026-10-05" }),
    ],
    TODAY,
  );

  it("cada fatura fica com as suas compras, na ordem dos vencimentos", () => {
    expect(invoices.map((i) => [i.id, i.charges.map((c) => c.id)])).toEqual([
      ["f-bb-05", ["livro"]],
      ["f-bb-20", ["geladeira", "notebook"]],
      ["f-nu", ["tenis"]],
    ]);
  });

  it("cartões diferentes e vencimentos diferentes do mesmo cartão viram blocos distintos", () => {
    const groups = cardGroups(invoices, null);
    expect(groups).toHaveLength(3);
    expect(groups.filter((g) => g.invoice.cardId === "c1").map((g) => g.invoice.dueDate)).toEqual(["2026-10-05", "2026-10-20"]);
  });

  it("fatura a pagar com vencimento antes de hoje está atrasada; no dia ou depois, não", () => {
    expect(invoices.map((i) => i.overdue)).toEqual([true, false, false]);
  });

  it("com filtro de área: só as faturas com compra da área, mostrando as compras dela e a soma delas", () => {
    const clinica = cardGroups(invoices, CLINICA);
    expect(clinica).toHaveLength(1);
    expect(clinica[0]).toMatchObject({ cents: 50000, remainderCents: null, hiddenCount: 1, scoped: true });
    expect(clinica[0].charges.map((c) => c.id)).toEqual(["notebook"]);
    expect(clinica[0].invoice.totalCents).toBe(100000); // o pagamento continua sendo da fatura inteira
  });
});

describe("total real da fatura", () => {
  const compras = [parcela("geladeira", "f", 50000), parcela("notebook", "f", 50000)];

  it("sem total informado vale a soma das compras cadastradas", () => {
    const [g] = cardGroups(buildInvoices([fatura("f", "2026-10-20", 100000)], compras, TODAY), null);
    expect(g).toMatchObject({ cents: 100000, remainderCents: null });
    expect(g.invoice.statedCents).toBeNull();
  });

  it("total informado maior: vale o informado; a diferença aparece como outros valores", () => {
    const [g] = cardGroups(buildInvoices([fatura("f", "2026-10-20", 100000, { statedCents: 250000 })], compras, TODAY), null);
    expect(g.cents).toBe(250000);
    expect(g.remainderCents).toBe(150000);
    expect(g.charges.map((c) => c.amountCents)).toEqual([50000, 50000]); // as parcelas não mudam
  });

  it("total informado igual à soma: sem diferença", () => {
    const [g] = cardGroups(buildInvoices([fatura("f", "2026-10-20", 100000, { statedCents: 100000 })], compras, TODAY), null);
    expect(g).toMatchObject({ cents: 100000, remainderCents: null });
  });

  it("total informado menor: vale o informado e a diferença é um ajuste negativo (nada é escondido)", () => {
    const [g] = cardGroups(buildInvoices([fatura("f", "2026-10-20", 100000, { statedCents: 70000 })], compras, TODAY), null);
    expect(g.cents).toBe(70000);
    expect(g.remainderCents).toBe(-30000);
    expect(g.charges).toHaveLength(2);
  });

  it("total informado sem nenhuma compra cadastrada", () => {
    const [g] = cardGroups(buildInvoices([fatura("f", "2026-10-20", 0, { statedCents: 80000 })], [], TODAY), null);
    expect(g).toMatchObject({ cents: 80000, remainderCents: 80000 });
    expect(g.charges).toEqual([]);
  });

  it("compra lançada depois de informar o total: o total fica; a soma detalhada sobe e a diferença cai", () => {
    const antes = fatura("f", "2026-10-20", 100000, { statedCents: 250000 });
    const depois = fatura("f", "2026-10-20", 130000, { statedCents: 250000 });
    expect([antes.totalCents, invoiceRemainder(antes)]).toEqual([250000, 150000]);
    expect([depois.totalCents, invoiceRemainder(depois)]).toEqual([250000, 120000]);
  });
});

describe("totais do mês", () => {
  const contas = [
    conta("aluguel", "2026-10-10", 150000, { overdue: true }),
    conta("luz", "2026-10-05", 20000, { status: "pago", paidOn: "2026-10-05" }),
    conta("gas", "2026-10-20", null, { isVariable: true, seriesId: "s", kind: "variavel" }),
    conta("material", "2026-10-21", 30000, { areaId: CLINICA }),
  ];
  const compras = [parcela("geladeira", "f", 50000), parcela("notebook", "f", 50000, { areaId: CLINICA })];

  it("exemplo de conferência: R$ 1.000,00 cadastrados com total real de R$ 2.500,00 = R$ 2.500,00 no cartão", () => {
    const aPagar = monthTotals([], buildInvoices([fatura("f", "2026-10-20", 100000, { statedCents: 250000 })], compras, TODAY));
    expect(aPagar).toMatchObject({ total: 250000n, pago: 0n, aPagar: 250000n });
    // Ao pagar, o valor passa de a pagar para pago; o total da despesa e as parcelas não mudam.
    const paga = buildInvoices([fatura("f", "2026-10-20", 100000, { statedCents: 250000, status: "pago", paidOn: "2026-10-20", paidTotalCents: 250000 })], compras, TODAY);
    expect(monthTotals([], paga)).toMatchObject({ total: 250000n, pago: 250000n, aPagar: 0n });
    expect(paga[0].charges.map((c) => c.amountCents)).toEqual([50000, 50000]);
  });

  it("total = pago + a pagar; a fatura entra uma vez (as compras não somam por fora); valor a informar fica fora", () => {
    const t = monthTotals(contas, buildInvoices([fatura("f", "2026-10-20", 100000, { statedCents: 250000 })], compras, TODAY));
    expect(t.pago).toBe(20000n);
    expect(t.aPagar).toBe(430000n); // 150.000 + 30.000 de contas + 250.000 do cartão
    expect(t.total).toBe(450000n);
    expect(t.unknownCount).toBe(1);
    expect(t.atrasado).toBe(150000n);
    expect(t.atrasadoCount).toBe(1);
    expect(t.count).toBe(5); // 4 contas + 1 fatura
  });

  it("fatura atrasada entra no atrasado pelo total considerado", () => {
    const t = monthTotals([], buildInvoices([fatura("f", "2026-10-05", 100000, { statedCents: 120000 })], compras, TODAY));
    expect(t).toMatchObject({ aPagar: 120000n, atrasado: 120000n, atrasadoCount: 1 });
  });

  it("com filtro de área: as contas dela e as compras dela no cartão; a parte sem compra cadastrada fica fora", () => {
    const invoices = buildInvoices([fatura("f", "2026-10-20", 100000, { statedCents: 250000 })], compras, TODAY);
    expect(monthTotals(contas, invoices, CLINICA)).toMatchObject({ total: 80000n, aPagar: 80000n, pago: 0n, count: 2 });
    expect(monthTotals(contas, invoices, CASA)).toMatchObject({ total: 220000n, aPagar: 200000n, pago: 20000n });
  });

  it("não perdem precisão acima do inteiro seguro; lista vazia soma zero", () => {
    const many = Array.from({ length: 1000 }, (_, i) => conta(`c${i}`, "2026-10-10", 9_999_999_999, { status: "pago" }));
    expect(monthTotals(many, []).pago).toBe(9_999_999_999_000n);
    expect(monthTotals([], [])).toMatchObject({ total: 0n, pago: 0n, aPagar: 0n, count: 0, unknownCount: 0 });
  });
});

describe("situação e separação por área", () => {
  it("a pagar e pagas valem para contas e para faturas", () => {
    const [pendente, paga] = buildInvoices(
      [fatura("f1", "2026-10-20", 100), fatura("f2", "2026-10-21", 100, { status: "pago", paidOn: "2026-10-21", paidTotalCents: 100 })],
      [],
      TODAY,
    );
    expect([matchesMonthSituation(pendente, "a-pagar"), matchesMonthSituation(pendente, "pagas"), matchesMonthSituation(pendente, "todas")]).toEqual([true, false, true]);
    expect([matchesMonthSituation(paga, "a-pagar"), matchesMonthSituation(paga, "pagas")]).toEqual([false, true]);
    expect(matchesMonthSituation(conta("x", "2026-10-01", 1, { status: "pago" }), "pagas")).toBe(true);
  });

  it("contas por área, na ordem das áreas e por vencimento; área desconhecida por último", () => {
    const groups = groupByArea(
      [conta("aluguel", "2026-10-10", 150000), conta("agua", "2026-10-02", 9000), conta("material", "2026-10-11", 30000, { areaId: CLINICA }), conta("x", "2026-10-12", 100, { areaId: "zz" })],
      [area(CLINICA, "Consultório"), area(CASA, "Casa")],
    );
    expect(groups.map((g) => g.areaId)).toEqual([CLINICA, CASA, "zz"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["agua", "aluguel"]);
    expect(groups[1].totals.total).toBe(159000n);
    expect(groups[2].area).toBeUndefined();
  });
});
