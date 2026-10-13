import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, cleanupAreas, TAG, testUsers } from "../../../test/integration-helpers";
import { todayInSaoPaulo } from "@/lib/dates";
import { createCard, createPurchase, listCardCharges, listCards, listInvoices, payInvoice, setInvoiceTotal, unpayInvoice } from "./cards-data";
import { createArea, createEntry, listAreas, listMonthEntries, markEntryPaid, setOccurrenceAmount } from "./data";
import { applyScope, breakdown, inRange, monthly, percentChange, periodRange, summarize, topItems, UNDETAILED, type AnalyticsItem } from "./domain/analytics";
import { buildInvoices, cardGroups, groupByArea, monthTotals } from "./domain/month";
import { isOverdue } from "./domain/status";
import { createInstallmentPlan, listPlans, setPlanPaymentMethod } from "./installments-data";
import { listOverviewItems } from "./overview-data";
import { createSeries, ensureGeneratedThrough } from "./series-data";
import { entryKind } from "./types";

/**
 * Cenário fictício com resultados esperados calculados À MÃO (não pelo código testado).
 *
 * Áreas X (Casa) e Y (Trabalho). "Hoje" da visão fixado em 15/10/2026.
 * Outubro/2026:
 *   Aluguel   X  única      1.500,00  vence 10/10  pendente  Pix     → atrasada
 *   Luz       X  única        200,00  vence 05/10  paga      Boleto
 *   Água      X  variável   a informar vence 12/10 (série mensal sem forma; nov = 80,00 informado)
 *   Internet  Y  recorrente   100,00  vence 20/10 (série mensal fixa, Pix)
 *   Curso 1/3 Y  parcela      100,00  vence 25/10  paga   (plano 300,00 em 3, Boleto)
 *   Cartão (fecha 10, vence 20): Mercado X 250,00 (03/10, categoria Mercado) + Notebook 1/3 Y 300,00 (03/10) → vencem 20/10
 *     Farmácia X 50,00 (12/10, depois do fechamento) → vence 20/11
 * Esperado em outubro: pago 300; a pagar 1.600 de contas (+ 1 a informar) + 550 da fatura do cartão = 2.150;
 *   total 2.450; atrasado 1.500 (2 itens). Por forma: Pix 1.600, Boleto 300, cartão 550 (Água sem valor fica fora).
 *   Por área: X 1.950, Y 500.
 * Novembro: Internet 100 + Água 80 + Curso 2/3 100 = 280; fatura do cartão: Notebook 2/3 300 + Farmácia 50 = 350; total 630.
 * Depois (último bloco): total real da fatura de outubro informado como 1.000 (550 cadastrados + 450 sem detalhe):
 *   total de outubro 2.900; a pagar 2.600; ao pagar a fatura: pago 1.300 e a pagar 1.600, com o mesmo total.
 */

const { A, B } = testUsers();
const TODAY = "2026-10-15";
const createdAreas: string[] = [];
let cardId = "";
let X = "";
let Y = "";
let items: AnalyticsItem[] = [];

const reais = (value: bigint) => Number(value) / 100;

async function newArea(name: string): Promise<string> {
  const full = `${TAG} ${name}`;
  expect(await createArea(A, { name: full, color: "#2563eb" })).toEqual({ ok: true });
  const id = (await listAreas(A)).find((a) => a.name === full)!.id;
  createdAreas.push(id);
  return id;
}

const entryId = async (description: string, due: string) =>
  (await asUser<{ id: string }>(A.id, "select id from public.fin_entries where description = $1 and due_date = $2::date", [description, due]))[0].id;

beforeAll(async () => {
  X = await newArea("Casa");
  Y = await newArea("Trabalho");
  const base = { category: null, notes: null };
  expect(await createEntry(A, { ...base, areaId: X, description: `${TAG} Aluguel`, amountCents: 150000, dueDate: "2026-10-10", paymentMethod: "pix" })).toMatchObject({ ok: true });
  expect(await createEntry(A, { ...base, areaId: X, description: `${TAG} Luz`, amountCents: 20000, dueDate: "2026-10-05", paymentMethod: "boleto" })).toMatchObject({ ok: true });
  expect(await markEntryPaid(A, await entryId(`${TAG} Luz`, "2026-10-05"), todayInSaoPaulo())).toMatchObject({ ok: true });

  const series = { ...base, frequency: "mensal" as const, intervalMonths: 1, endDate: null };
  expect(await createSeries(A, { ...series, areaId: Y, description: `${TAG} Internet`, amountKind: "fixo", amountCents: 10000, startDate: "2026-10-20", paymentMethod: "pix" })).toEqual({ ok: true });
  expect(await createSeries(A, { ...series, areaId: X, description: `${TAG} Água`, amountKind: "variavel", amountCents: null, startDate: "2026-10-12" })).toEqual({ ok: true });
  await ensureGeneratedThrough(A, "2027-04-30");
  expect(await setOccurrenceAmount(A, await entryId(`${TAG} Água`, "2026-11-12"), 8000)).toMatchObject({ ok: true });

  expect(
    await createInstallmentPlan(A, { ...base, areaId: Y, description: `${TAG} Curso`, totalCents: 30000, count: 3, firstDueDate: "2026-10-25", requestId: randomUUID(), paymentMethod: "boleto" }),
  ).toMatchObject({ ok: true });
  expect(await markEntryPaid(A, await entryId(`${TAG} Curso`, "2026-10-25"), todayInSaoPaulo())).toMatchObject({ ok: true });

  const cardName = `${TAG} Visa`;
  expect(await createCard(A, { name: cardName, closingDay: 10, dueDay: 20, notes: null, defaultAreaId: null })).toEqual({ ok: true });
  cardId = (await listCards(A)).find((c) => c.name === cardName)!.id;
  const buy = (areaId: string, description: string, purchaseDate: string, totalCents: number, count = 1, category: string | null = null) =>
    createPurchase(A, { cardId, areaId, description: `${TAG} ${description}`, category, notes: null, purchaseDate, totalCents, count, firstReference: null, requestId: randomUUID() });
  expect(await buy(X, "Mercado", "2026-10-03", 25000, 1, "Mercado")).toMatchObject({ ok: true });
  expect(await buy(Y, "Notebook", "2026-10-03", 90000, 3)).toMatchObject({ ok: true });
  expect(await buy(X, "Farmácia", "2026-10-12", 5000)).toMatchObject({ ok: true });

  items = await scenarioItems();
}, 120_000);

/** Só os dados deste cenário (a conta de teste pode ter outros registros de testes paralelos). */
async function scenarioItems(): Promise<AnalyticsItem[]> {
  const all = await listOverviewItems(A, "2026-09-01", "2027-04-30");
  return all.filter((i) => (i.areaId !== null && createdAreas.includes(i.areaId)) || i.cardId === cardId);
}

afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  try {
    if (cardId) {
      await pool.query("delete from public.fin_events where entity_id in (select id from public.fin_card_purchases where card_id = $1) or entity_id in (select id from public.fin_invoices where card_id = $1)", [cardId]);
      await pool.query("delete from public.fin_card_charges where card_id = $1", [cardId]);
      await pool.query("delete from public.fin_card_purchases where card_id = $1", [cardId]);
      await pool.query("delete from public.fin_invoices where card_id = $1", [cardId]);
      await pool.query("delete from public.fin_cards where id = $1", [cardId]);
    }
  } finally {
    await pool.end();
  }
  await cleanupAreas(createdAreas);
});

const october = () => inRange(items, periodRange({ kind: "mes", month: { year: 2026, month: 10 } }));

describe("Visão geral e aba Mês — cenário fictício (Neon real)", () => {
  it("outubro: pago, a pagar (com a fatura do cartão), total, atrasado e a informar", () => {
    const t = summarize(october(), TODAY);
    expect({ total: reais(t.total), pago: reais(t.pago), aPagar: reais(t.aPagar), atrasado: reais(t.atrasado) }).toEqual({
      total: 2450,
      pago: 300,
      aPagar: 2150,
      atrasado: 1500,
    });
    expect(t.atrasadoCount).toBe(2);
    expect(t.unknownCount).toBe(1);
    expect(t.count).toBe(7);
  });

  it("compras do cartão entram uma vez, pelo vencimento da fatura, com a situação dela (a fatura não soma de novo)", () => {
    const cartao = october().filter((i) => i.source === "cartao");
    expect(cartao.map((i) => [i.description, i.dueDate, reais(i.cents!)]).sort()).toEqual([
      [`${TAG} Mercado`, "2026-10-20", 250],
      [`${TAG} Notebook`, "2026-10-20", 300],
    ]);
    expect(cartao.every((i) => i.status === "pendente" && !i.undetailed)).toBe(true); // sem total informado, não há parte sem detalhe
    expect(items.filter((i) => i.description === `${TAG} Farmácia`).map((i) => i.dueDate)).toEqual(["2026-11-20"]);
  });

  it("por forma de pagamento, área e categoria", () => {
    const o = october();
    expect(breakdown(o, "payment").map((r) => [r.key, reais(r.cents)])).toEqual([
      ["pix", 1600],
      [cardId, 550],
      ["boleto", 300],
    ]);
    expect(breakdown(o, "area").map((r) => [r.key, reais(r.cents)])).toEqual([
      [X, 1950],
      [Y, 500],
    ]);
    expect(breakdown(o, "category").map((r) => [r.label, reais(r.cents)])).toEqual([
      [null, 2200],
      ["Mercado", 250],
    ]);
    // Filtros: só a área Y; só o cartão; só sem forma informada (Água).
    expect(reais(summarize(applyScope(o, { areaId: Y, payment: null, category: null }), TODAY).total)).toBe(500);
    expect(reais(summarize(applyScope(o, { areaId: null, payment: cardId, category: null }), TODAY).total)).toBe(550);
    expect(applyScope(o, { areaId: null, payment: "nenhuma", category: null }).map((i) => i.description)).toEqual([`${TAG} Água`]);
  });

  it("evolução: outubro e novembro por situação; sem base em setembro", () => {
    const [out, nov] = monthly(items, [
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
    ]);
    expect([out, nov].map((b) => [reais(b.pago), reais(b.aPagar), reais(b.total)])).toEqual([
      [300, 2150, 2450],
      [0, 630, 630],
    ]);
    const setembro = summarize(inRange(items, periodRange({ kind: "mes", month: { year: 2026, month: 9 } })), TODAY);
    expect(percentChange(summarize(october(), TODAY).total, setembro.total)).toBeNull();
  });

  /** Aba Mês de outubro deste cenário: contas e faturas do cartão. */
  async function monthData() {
    const entries = (await listMonthEntries(A, { month: { year: 2026, month: 10 } })).filter((e) => createdAreas.includes(e.areaId)).map((e) => ({ ...e, overdue: isOverdue(e, TODAY), kind: entryKind(e) }));
    const invoices = (await listInvoices(A, "2026-10-01", "2026-10-31")).filter((i) => i.cardId === cardId);
    const charges = (await listCardCharges(A, "2026-10-01", "2026-10-31")).filter((c) => c.cardId === cardId);
    return { entries, invoices: buildInvoices(invoices, charges, TODAY) };
  }

  it("aba Mês: contas por área e um bloco por cartão, com os mesmos totais da Visão geral", async () => {
    const { entries, invoices } = await monthData();
    const t = monthTotals(entries, invoices);
    expect([reais(t.total), reais(t.pago), reais(t.aPagar), t.unknownCount]).toEqual([2450, 300, 2150, 1]);
    // Contas fora do cartão por área (a fatura não é repetida em cada área).
    const groups = groupByArea(entries, (await listAreas(A)).filter((a) => createdAreas.includes(a.id)));
    expect(groups.map((g) => [g.areaId, reais(g.totals.total)])).toEqual([
      [X, 1700],
      [Y, 200],
    ]);
    // Um bloco para o cartão naquele vencimento, com as compras das duas áreas e um pagamento só.
    const cards = cardGroups(invoices, null);
    expect(cards.map((g) => [g.invoice.dueDate, g.cents / 100, g.remainderCents, g.charges.map((c) => c.description).sort()])).toEqual([
      ["2026-10-20", 550, null, [`${TAG} Mercado`, `${TAG} Notebook`]],
    ]);
    // Filtro de área: contas e compras da área (os mesmos valores da divisão por área da Visão geral).
    expect([X, Y].map((id) => reais(monthTotals(entries, invoices, id).total))).toEqual([1950, 500]);
  });

  it("total real da fatura: conta uma vez, aparece identificado nas análises e, ao pagar, passa de a pagar para pago", async () => {
    const { invoices } = await monthData();
    const invoice = invoices[0];
    expect(await setInvoiceTotal(A, { invoiceId: invoice.id }, 100000)).toMatchObject({ ok: true });
    const informado = inRange(await scenarioItems(), periodRange({ kind: "mes", month: { year: 2026, month: 10 } }));
    const t1 = summarize(informado, TODAY);
    expect([reais(t1.total), reais(t1.pago), reais(t1.aPagar)]).toEqual([2900, 300, 2600]);
    // A parte sem compra cadastrada (450) fica identificada, sem área nem categoria inventadas; a soma fecha no total.
    expect(breakdown(informado, "area").map((r) => [r.key, reais(r.cents)])).toEqual([
      [X, 1950],
      [Y, 500],
      [UNDETAILED, 450],
    ]);
    expect(breakdown(informado, "category").map((r) => [r.key, reais(r.cents)])).toEqual([
      [null, 2200],
      [UNDETAILED, 450],
      ["mercado", 250],
    ]);
    expect(breakdown(informado, "payment").map((r) => [r.key, reais(r.cents)])).toEqual([
      ["pix", 1600],
      [cardId, 1000],
      ["boleto", 300],
    ]);
    expect(topItems(informado, 2).map((i) => [i.description, reais(i.cents!)])).toEqual([
      [`${TAG} Aluguel`, 1500],
      [`${TAG} Visa: outros valores da fatura`, 450],
    ]);
    // Filtro de área mostra só o que foi atribuído a ela; o do cartão mostra a fatura inteira.
    expect(reais(summarize(applyScope(informado, { areaId: Y, payment: null, category: null }), TODAY).total)).toBe(500);
    expect(reais(summarize(applyScope(informado, { areaId: null, payment: cardId, category: null }), TODAY).total)).toBe(1000);
    // Aba Mês com o mesmo total e a diferença à vista.
    const mes = await monthData();
    expect(reais(monthTotals(mes.entries, mes.invoices).total)).toBe(2900);
    expect(cardGroups(mes.invoices, null)[0]).toMatchObject({ cents: 100000, remainderCents: 45000 });

    expect(await payInvoice(A, invoice.id, todayInSaoPaulo(), 100000)).toEqual({ ok: true });
    const depoisDePagar = await scenarioItems();
    const pago = inRange(depoisDePagar, periodRange({ kind: "mes", month: { year: 2026, month: 10 } }));
    const t2 = summarize(pago, TODAY);
    expect([reais(t2.total), reais(t2.pago), reais(t2.aPagar)]).toEqual([2900, 1300, 1600]); // mesmo total; muda só a situação
    expect(pago.filter((i) => i.source === "cartao").map((i) => [i.status, reais(i.cents!)]).sort()).toEqual([
      ["pago", 250],
      ["pago", 300],
      ["pago", 450],
    ]);
    // Novembro não foi tocado: a fatura seguinte continua a pagar, pela soma das compras.
    const novembro = summarize(inRange(depoisDePagar, periodRange({ kind: "mes", month: { year: 2026, month: 11 } })), TODAY);
    expect([reais(novembro.total), reais(novembro.pago)]).toEqual([630, 0]);
    // Desfazer devolve o valor para a pagar.
    expect(await unpayInvoice(A, invoice.id)).toEqual({ ok: true });
    const t3 = summarize(inRange(await scenarioItems(), periodRange({ kind: "mes", month: { year: 2026, month: 10 } })), TODAY);
    expect([reais(t3.total), reais(t3.pago), reais(t3.aPagar)]).toEqual([2900, 300, 2600]);
  });

  it("forma de pagamento: recorrência passa às contas geradas; parcelamento muda só as pendentes", async () => {
    const internet = await asUser<{ m: string | null }>(A.id, "select payment_method as m from public.fin_entries where description = $1 order by due_date", [`${TAG} Internet`]);
    expect(internet.length).toBeGreaterThan(3);
    expect(internet.every((r) => r.m === "pix")).toBe(true);
    const agua = await asUser<{ m: string | null }>(A.id, "select payment_method as m from public.fin_entries where description = $1", [`${TAG} Água`]);
    expect(agua.every((r) => r.m === null)).toBe(true);
    const plan = (await listPlans(A)).find((p) => p.description === `${TAG} Curso`)!;
    expect(plan.paymentMethod).toBe("boleto");
    expect(await setPlanPaymentMethod(A, plan.id, "pix")).toEqual({ ok: true, count: 2 });
    const curso = await asUser<{ n: number; m: string; s: string }>(A.id, "select installment_number as n, payment_method as m, status as s from public.fin_entries where installment_plan_id = $1 order by 1", [plan.id]);
    expect(curso).toEqual([
      { n: 1, m: "boleto", s: "pago" },
      { n: 2, m: "pix", s: "pendente" },
      { n: 3, m: "pix", s: "pendente" },
    ]);
    expect((await listPlans(A)).find((p) => p.id === plan.id)?.paymentMethod).toBe("pix");
    // Outra conta não altera o parcelamento.
    expect(await setPlanPaymentMethod(B, plan.id, "boleto")).toEqual({ ok: false, reason: "not_found" });
  });

  it("isolamento: B não vê nada deste cenário", async () => {
    const b = await listOverviewItems(B, "2026-09-01", "2027-04-30");
    const ids = new Set(items.map((i) => i.id));
    expect(b.some((i) => ids.has(i.id))).toBe(false);
  });
});
