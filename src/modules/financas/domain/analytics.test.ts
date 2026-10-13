import { describe, expect, it } from "vitest";
import {
  applyScope,
  breakdown,
  dataRange,
  evolutionMonths,
  foldTail,
  monthly,
  overviewHref,
  parseOverviewFilters,
  percentChange,
  previousLabel,
  summarize,
  topItems,
  UNDETAILED,
  type AnalyticsItem,
} from "./analytics";

const CASA = "00000000-0000-4000-8000-00000000000a";
const CLINICA = "00000000-0000-4000-8000-00000000000b";
const CARD = "00000000-0000-4000-8000-0000000000c1";
const TODAY = "2026-10-15";

const item = (id: string, due: string, cents: bigint | null, extra: Partial<AnalyticsItem> = {}): AnalyticsItem => ({
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
/** Compra do cartão: a situação é a da fatura em que está. */
const cartao = (id: string, due: string, cents: bigint, extra: Partial<AnalyticsItem> = {}) =>
  item(id, due, cents, { source: "cartao", paymentMethod: null, cardId: CARD, ...extra });
/** Parte da fatura sem compra cadastrada (total considerado − compras). */
const resto = (id: string, due: string, cents: bigint, extra: Partial<AnalyticsItem> = {}) =>
  cartao(id, due, cents, { areaId: null, category: null, undetailed: true, ...extra });

const items: AnalyticsItem[] = [
  item("aluguel", "2026-10-10", 150000n, { category: "Moradia" }),
  item("luz", "2026-10-05", 20000n, { status: "pago", category: "moradia", paymentMethod: "boleto" }),
  item("agua", "2026-10-02", 9000n, { category: "Moradia" }),
  item("gas", "2026-10-20", null, { category: "Moradia" }),
  item("material", "2026-10-11", 30000n, { areaId: CLINICA, category: "Consultório", paymentMethod: null }),
  cartao("geladeira", "2026-10-20", 50000n, { category: "Casa" }),
  cartao("geladeira-2", "2026-11-20", 50000n, { category: "Casa" }),
  item("aluguel-set", "2026-09-10", 150000n, { status: "pago", category: "Moradia" }),
];

describe("filtros pela URL", () => {
  it("mês padrão = mês de hoje; inválidos viram o padrão", () => {
    const f = parseOverviewFilters({ area: "x", forma: "dinheiro", categoria: "  " }, TODAY);
    expect(f).toEqual({ period: { kind: "mes", month: { year: 2026, month: 10 } }, areaId: null, payment: null, category: null });
  });

  it("ano, área, forma e categoria; ida e volta pela URL", () => {
    const f = parseOverviewFilters({ periodo: "ano", ano: "2026", area: CASA, forma: "boleto", categoria: "Moradia" }, TODAY);
    expect(f.period).toEqual({ kind: "ano", year: 2026 });
    expect(overviewHref(f)).toBe(`/financas?periodo=ano&ano=2026&area=${CASA}&forma=boleto&categoria=Moradia`);
    expect(parseOverviewFilters({ forma: CARD }, TODAY).payment).toBe(CARD);
    expect(parseOverviewFilters({ forma: "nenhuma" }, TODAY).payment).toBe("nenhuma");
  });
});

describe("resumo do período", () => {
  const outubro = items.filter((i) => i.dueDate.startsWith("2026-10"));

  it("total = pago + a pagar (o cartão entra pela situação da fatura); a informar contado à parte; atrasado é parte do a pagar", () => {
    const t = summarize(outubro, TODAY);
    expect(t.pago).toBe(20000n);
    expect(t.aPagar).toBe(239000n); // 189.000 de contas + 50.000 da fatura a pagar
    expect(t.total).toBe(259000n);
    expect(t.unknownCount).toBe(1);
    // aluguel (10/10), água (02/10) e material (11/10) vencem antes de hoje (15/10) e estão pendentes.
    expect(t.atrasado).toBe(189000n);
    expect(t.atrasadoCount).toBe(3);
  });

  it("filtros de área, forma (inclusive não informada e cartão) e categoria sem diferenciar maiúsculas", () => {
    expect(applyScope(outubro, { areaId: CLINICA, payment: null, category: null }).map((i) => i.id)).toEqual(["material"]);
    expect(applyScope(outubro, { areaId: null, payment: "nenhuma", category: null }).map((i) => i.id)).toEqual(["material"]);
    expect(applyScope(outubro, { areaId: null, payment: CARD, category: null }).map((i) => i.id)).toEqual(["geladeira"]);
    expect(applyScope(outubro, { areaId: null, payment: null, category: "MORADIA" }).map((i) => i.id)).toEqual(["aluguel", "luz", "agua", "gas"]);
  });

  it("por categoria, área e forma: só valores conhecidos, do maior para o menor", () => {
    expect(breakdown(outubro, "category").map((r) => [r.label, r.cents])).toEqual([
      ["Moradia", 179000n],
      ["Casa", 50000n],
      ["Consultório", 30000n],
    ]);
    expect(breakdown(outubro, "area").map((r) => [r.key, r.cents])).toEqual([
      [CASA, 229000n],
      [CLINICA, 30000n],
    ]);
    expect(breakdown(outubro, "payment").map((r) => [r.key, r.cents])).toEqual([
      ["pix", 159000n],
      [CARD, 50000n],
      ["nenhuma", 30000n],
      ["boleto", 20000n],
    ]);
  });

  it("junta a cauda em Outras", () => {
    const rows = breakdown(outubro, "payment");
    const folded = foldTail(rows, 3);
    expect(folded.map((r) => r.key)).toEqual(["pix", CARD, "__outras"]);
    expect(folded[2].cents).toBe(50000n);
    expect(foldTail(rows, 4)).toHaveLength(4);
  });

  it("maiores valores do período", () => {
    expect(topItems(outubro, 2).map((i) => i.id)).toEqual(["aluguel", "geladeira"]);
  });
});

describe("fatura com total real informado", () => {
  // R$ 1.000,00 em compras cadastradas (duas de R$ 500,00) e total real de R$ 2.500,00: sobra R$ 1.500,00 sem detalhe.
  const fatura = (status: "pendente" | "pago") => [
    cartao("geladeira", "2026-10-20", 50000n, { status, category: "Casa" }),
    cartao("notebook", "2026-10-20", 50000n, { status, areaId: CLINICA, category: "Consultório" }),
    resto("resto", "2026-10-20", 150000n, { status }),
  ];

  it("exemplo de conferência: R$ 2.500,00 de despesa do cartão, nunca R$ 3.500,00; ao pagar, passa de a pagar para pago", () => {
    expect(summarize(fatura("pendente"), TODAY)).toMatchObject({ total: 250000n, aPagar: 250000n, pago: 0n });
    expect(summarize(fatura("pago"), TODAY)).toMatchObject({ total: 250000n, aPagar: 0n, pago: 250000n });
  });

  it("por área e por categoria: as compras ficam onde estão e a parte sem detalhe aparece identificada; a soma é o total", () => {
    const porArea = breakdown(fatura("pendente"), "area");
    expect(porArea.map((r) => [r.key, r.cents])).toEqual([
      [UNDETAILED, 150000n],
      [CASA, 50000n],
      [CLINICA, 50000n],
    ]);
    const porCategoria = breakdown(fatura("pendente"), "category");
    expect(porCategoria.map((r) => [r.key, r.label, r.cents])).toEqual([
      [UNDETAILED, null, 150000n],
      ["casa", "Casa", 50000n],
      ["consultório", "Consultório", 50000n],
    ]);
    for (const rows of [porArea, porCategoria]) expect(rows.reduce((sum, r) => sum + r.cents, 0n)).toBe(250000n);
    expect(breakdown(fatura("pendente"), "payment").map((r) => [r.key, r.cents])).toEqual([[CARD, 250000n]]);
  });

  it("filtro de área ou de categoria mostra só o que foi atribuído; a parte sem detalhe fica fora do recorte", () => {
    expect(applyScope(fatura("pendente"), { areaId: CLINICA, payment: null, category: null }).map((i) => i.id)).toEqual(["notebook"]);
    expect(applyScope(fatura("pendente"), { areaId: null, payment: null, category: "casa" }).map((i) => i.id)).toEqual(["geladeira"]);
    expect(applyScope(fatura("pendente"), { areaId: null, payment: CARD, category: null })).toHaveLength(3);
  });

  it("total menor que as compras: ajuste negativo, com o sinal, por último e fora dos maiores valores", () => {
    const menor = [cartao("geladeira", "2026-10-20", 50000n), cartao("notebook", "2026-10-20", 50000n), resto("ajuste", "2026-10-20", -30000n)];
    expect(summarize(menor, TODAY).total).toBe(70000n);
    expect(breakdown(menor, "area").map((r) => [r.key, r.cents])).toEqual([
      [CASA, 100000n],
      [UNDETAILED, -30000n],
    ]);
    expect(topItems(menor, 5).map((i) => i.id)).toEqual(["geladeira", "notebook"]);
    expect(monthly(menor, [{ year: 2026, month: 10 }])[0]).toMatchObject({ aPagar: 70000n, total: 70000n });
  });

  it("fatura atrasada conta uma vez no número de atrasados, mesmo com várias compras", () => {
    const atrasada = [cartao("a", "2026-10-05", 100n), cartao("b", "2026-10-05", 200n), resto("r", "2026-10-05", 300n), item("conta", "2026-10-06", 50n)];
    expect(summarize(atrasada, TODAY)).toMatchObject({ atrasado: 650n, atrasadoCount: 2 });
  });
});

describe("evolução e comparação", () => {
  it("no mês: de 5 meses antes a 6 depois; no ano: janeiro a dezembro", () => {
    const meses = evolutionMonths({ kind: "mes", month: { year: 2026, month: 10 } });
    expect(meses[0]).toEqual({ year: 2026, month: 5 });
    expect(meses[11]).toEqual({ year: 2027, month: 4 });
    expect(evolutionMonths({ kind: "ano", year: 2026 }).map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("intervalo de dados cobre o período anterior e toda a evolução", () => {
    expect(dataRange({ kind: "mes", month: { year: 2026, month: 10 } })).toEqual({ from: "2026-05-01", to: "2027-04-30" });
    expect(dataRange({ kind: "ano", year: 2026 })).toEqual({ from: "2025-01-01", to: "2026-12-31" });
  });

  it("barras por mês separam pago e a pagar", () => {
    const bars = monthly(items, [
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
    ]);
    expect(bars.map((b) => [b.pago, b.aPagar, b.total])).toEqual([
      [150000n, 0n, 150000n],
      [20000n, 239000n, 259000n],
      [0n, 50000n, 50000n],
    ]);
  });

  it("variação percentual com uma casa; sem base, sem número", () => {
    expect(percentChange(259000n, 150000n)).toBe(72.6);
    expect(percentChange(100n, 0n)).toBeNull();
    expect(previousLabel({ kind: "mes", month: { year: 2026, month: 1 } })).toBe("dezembro");
    expect(previousLabel({ kind: "ano", year: 2026 })).toBe("2025");
  });
});
