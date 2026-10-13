import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupAreas, TAG, testUsers } from "../../../test/integration-helpers";
import {
  createCard,
  createPurchase,
  deleteCard,
  deletePurchase,
  listCardCharges,
  listCards,
  listInvoices,
  payInvoice,
  previewPurchase,
  setCardArchived,
  setInvoiceTotal,
  unpayInvoice,
  updateCard,
  updatePurchase,
  type PurchaseInput,
} from "./cards-data";
import { createArea, listAreas, setAreaArchived } from "./data";
import { buildInvoices, cardGroups, monthTotals } from "./domain/month";

const { A, B } = testUsers();
const createdAreas: string[] = [];
const createdCards: string[] = [];
/** Compras excluídas pelo próprio teste: o histórico delas é limpo pelo ID (a compra já não existe para a junção). */
const deletedPurchases: string[] = [];
/** Faturas com histórico (total, pagamento, reabertura) que o próprio teste pode remover: limpas pelo ID. */
const touchedInvoices: string[] = [];

async function newArea(user = A, name = "Área"): Promise<string> {
  const full = `${TAG} ${name}`;
  expect(await createArea(user, { name: full, color: "#2563eb" })).toEqual({ ok: true });
  const id = (await listAreas(user)).find((a) => a.name === full)!.id;
  createdAreas.push(id);
  return id;
}

async function newCard(user = A, name = "Cartão", closingDay = 10, dueDay = 17): Promise<string> {
  const full = `${TAG} ${name}`;
  expect(await createCard(user, { name: full, closingDay, dueDay, notes: null, defaultAreaId: null })).toEqual({ ok: true });
  const id = (await listCards(user)).find((c) => c.name === full)!.id;
  createdCards.push(id);
  return id;
}

const buy = (cardId: string, areaId: string, partial: Partial<PurchaseInput> & { purchaseDate: string; totalCents: number }, user = A) =>
  createPurchase(user, {
    cardId,
    areaId,
    description: `${TAG} compra`,
    category: null,
    notes: null,
    count: 1,
    firstReference: null,
    requestId: randomUUID(),
    ...partial,
  });

const invoicesOf = (cardId: string, user = A) =>
  asUser<{ ref: string; closing: string; due: string; status: string; total: string; paid_total: string | null }>(
    user.id,
    `select to_char(i.reference_month, 'YYYY-MM') as ref, to_char(i.closing_date, 'YYYY-MM-DD') as closing, to_char(i.due_date, 'YYYY-MM-DD') as due,
            i.status, coalesce((select sum(c.amount_cents) from public.fin_card_charges c where c.invoice_id = i.id), 0)::text as total,
            i.paid_total_cents::text as paid_total
       from public.fin_invoices i where i.card_id = $1 order by i.reference_month`,
    [cardId],
  );

afterAll(async () => {
  // Faturas pagas bloqueiam a exclusão de cobranças: a limpeza (dono) reabre antes de apagar.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  try {
    await pool.query("update public.fin_invoices set status = 'pendente', paid_on = null where card_id = any($1::uuid[])", [createdCards]);
    await pool.query("delete from public.fin_events where entity_id in (select id from public.fin_invoices where card_id = any($1::uuid[]))", [createdCards]);
    await pool.query("delete from public.fin_events where entity_id in (select id from public.fin_card_purchases where card_id = any($1::uuid[]))", [createdCards]);
    await pool.query("delete from public.fin_events where entity_type = 'compra' and entity_id = any($1::uuid[])", [deletedPurchases]);
    await pool.query("delete from public.fin_events where entity_type = 'fatura' and entity_id = any($1::uuid[])", [touchedInvoices]);
    await pool.query("delete from public.fin_card_charges where card_id = any($1::uuid[])", [createdCards]);
    await pool.query("delete from public.fin_card_purchases where card_id = any($1::uuid[])", [createdCards]);
    await pool.query("delete from public.fin_invoices where card_id = any($1::uuid[])", [createdCards]);
    await pool.query("delete from public.fin_cards where id = any($1::uuid[])", [createdCards]);
  } finally {
    await pool.end();
  }
  await cleanupAreas(createdAreas);
});

describe("Cartões: ciclos e parcelas no Neon real", () => {
  it("antes, no dia e depois do fechamento; vencimento no mês seguinte; virada de ano", async () => {
    const areaId = await newArea(A, "Ciclos");
    const card = await newCard(A, "Ciclos", 10, 17);
    expect(await buy(card, areaId, { purchaseDate: "2026-09-09", totalCents: 1000 })).toMatchObject({ ok: true, count: 1 });
    expect(await buy(card, areaId, { purchaseDate: "2026-09-10", totalCents: 2000 })).toMatchObject({ ok: true, count: 1 });
    expect(await buy(card, areaId, { purchaseDate: "2026-09-25", totalCents: 3000 })).toMatchObject({ ok: true, count: 1 });
    expect(await invoicesOf(card)).toEqual([
      { ref: "2026-09", closing: "2026-09-10", due: "2026-09-17", status: "pendente", total: "1000", paid_total: null },
      { ref: "2026-10", closing: "2026-10-10", due: "2026-10-17", status: "pendente", total: "5000", paid_total: null },
    ]);
    const late = await newCard(A, "Fecha 25 vence 5", 25, 5);
    expect(await buy(late, areaId, { purchaseDate: "2026-12-28", totalCents: 700 })).toMatchObject({ ok: true, count: 1 });
    expect(await invoicesOf(late)).toEqual([{ ref: "2027-01", closing: "2027-01-25", due: "2027-02-05", status: "pendente", total: "700", paid_total: null }]);
    // Nenhuma compra de cartão vira conta comum.
    const entries = await asUser<{ n: number }>(A.id, "select count(*)::int as n from public.fin_entries where area_id = $1", [areaId]);
    expect(entries[0].n).toBe(0);
  });

  it("fevereiro e dias 29–31; parcelas em ciclos consecutivos com resto nas primeiras", async () => {
    const areaId = await newArea(A, "Fevereiro");
    const card = await newCard(A, "Dia 31", 31, 10);
    expect(await buy(card, areaId, { purchaseDate: "2026-02-28", totalCents: 100000, count: 3 })).toMatchObject({ ok: true, count: 3 });
    expect(await invoicesOf(card)).toEqual([
      { ref: "2026-03", closing: "2026-03-31", due: "2026-04-10", status: "pendente", total: "33334", paid_total: null },
      { ref: "2026-04", closing: "2026-04-30", due: "2026-05-10", status: "pendente", total: "33333", paid_total: null },
      { ref: "2026-05", closing: "2026-05-31", due: "2026-06-10", status: "pendente", total: "33333", paid_total: null },
    ]);
    expect(await buy(card, areaId, { purchaseDate: "2026-02-27", totalCents: 500 })).toMatchObject({ ok: true, count: 1 });
    expect((await invoicesOf(card))[0]).toMatchObject({ ref: "2026-02", closing: "2026-02-28", due: "2026-03-10" });
  });

  it("prévia e escolha explícita da primeira fatura", async () => {
    const areaId = await newArea(A, "Escolha");
    const card = await newCard(A, "Escolha", 10, 17);
    const preview = await previewPurchase(A, { cardId: card, purchaseDate: "2026-10-09", totalCents: 30000, count: 2, firstReference: null });
    expect(preview).toEqual({
      defaultReference: "2026-10",
      cycles: [
        { reference: "2026-10", closingDate: "2026-10-10", dueDate: "2026-10-17", existing: false, locked: false, amountCents: 15000 },
        { reference: "2026-11", closingDate: "2026-11-10", dueDate: "2026-11-17", existing: false, locked: false, amountCents: 15000 },
      ],
    });
    expect(await buy(card, areaId, { purchaseDate: "2026-10-09", totalCents: 30000, count: 2, firstReference: "2026-11" })).toMatchObject({ ok: true, count: 2 });
    expect((await invoicesOf(card)).map((i) => [i.ref, i.total])).toEqual([
      ["2026-11", "15000"],
      ["2026-12", "15000"],
    ]);
  });

  it("mudar os dias do cartão não altera faturas existentes; novos ciclos usam os novos dias", async () => {
    const areaId = await newArea(A, "Padrão");
    const card = await newCard(A, "Padrão", 10, 17);
    expect(await buy(card, areaId, { purchaseDate: "2026-10-01", totalCents: 12000, count: 2 })).toMatchObject({ ok: true, count: 2 });
    const before = await invoicesOf(card);
    expect(await updateCard(A, card, { name: `${TAG} Padrão`, closingDay: 5, dueDay: 12, notes: null, defaultAreaId: null })).toEqual({ ok: true });
    expect(await invoicesOf(card)).toEqual(before); // nada mudou silenciosamente
    expect(await buy(card, areaId, { purchaseDate: "2027-01-02", totalCents: 800 })).toMatchObject({ ok: true, count: 1 });
    const after = await invoicesOf(card);
    expect(after.at(-1)).toMatchObject({ ref: "2027-01", closing: "2027-01-05", due: "2027-01-12", total: "800" });
    // Compra na fatura existente (nov) continua com as datas antigas dessa fatura.
    expect(await buy(card, areaId, { purchaseDate: "2026-11-02", totalCents: 100, firstReference: "2026-11" })).toMatchObject({ ok: true, count: 1 });
    expect((await invoicesOf(card)).find((i) => i.ref === "2026-11")).toMatchObject({ closing: "2026-11-10", due: "2026-11-17", total: "6100" });
  });

  it("parcelas do mês: cada parcela pelo vencimento do cartão, com cartão, número e área; outro mês fica fora", async () => {
    const casa = await newArea(A, "Casa");
    const trabalho = await newArea(A, "Trabalho");
    const card = await newCard(A, "Misto", 10, 17);
    expect(await buy(card, casa, { purchaseDate: "2026-10-01", totalCents: 30000, count: 2, description: `${TAG} Sofá` })).toMatchObject({ ok: true, count: 2 });
    expect(await buy(card, trabalho, { purchaseDate: "2026-10-02", totalCents: 12050 })).toMatchObject({ ok: true, count: 1 });
    const october = (await listCardCharges(A, "2026-10-01", "2026-10-31")).filter((c) => c.cardId === card);
    expect(october.map((c) => [c.description, c.dueDate, c.number, c.count, c.amountCents, c.areaId])).toEqual([
      [`${TAG} Sofá`, "2026-10-17", 1, 2, 15000, casa],
      [`${TAG} compra`, "2026-10-17", 1, 1, 12050, trabalho],
    ]);
    expect(october[0]).toMatchObject({ cardName: `${TAG} Misto`, purchaseTotalCents: 30000, purchaseDate: "2026-10-01" });
    const november = (await listCardCharges(A, "2026-11-01", "2026-11-30")).filter((c) => c.cardId === card);
    expect(november.map((c) => [c.number, c.amountCents])).toEqual([[2, 15000]]);
  });

  it("editar a compra muda descrição, área, categoria e observação de todas as parcelas; excluir remove todas", async () => {
    const casa = await newArea(A, "Edição casa");
    const outra = await newArea(A, "Edição outra");
    const card = await newCard(A, "Edição", 10, 17);
    expect(await buy(card, casa, { purchaseDate: "2026-10-01", totalCents: 9000, count: 3 })).toMatchObject({ ok: true, count: 3 });
    const [first] = (await listCardCharges(A, "2026-10-01", "2027-12-31")).filter((c) => c.cardId === card);
    expect(await updatePurchase(A, first.purchaseId, { description: `${TAG} Geladeira`, areaId: outra, category: "Casa", notes: "nota" })).toEqual({ ok: true });
    const all = (await listCardCharges(A, "2026-10-01", "2027-12-31")).filter((c) => c.cardId === card);
    expect(all.map((c) => [c.description, c.areaId, c.category, c.notes])).toEqual(Array(3).fill([`${TAG} Geladeira`, outra, "Casa", "nota"]));
    // Área arquivada ou de outra conta é recusada.
    expect(await setAreaArchived(A, casa, true)).toEqual({ ok: true });
    expect(await updatePurchase(A, first.purchaseId, { description: `${TAG} Geladeira`, areaId: casa, category: null, notes: null })).toEqual({ ok: false, reason: "area_archived" });
    const areaB = await newArea(B, "Área de B (edição)");
    expect(await updatePurchase(A, first.purchaseId, { description: `${TAG} Geladeira`, areaId: areaB, category: null, notes: null })).toEqual({ ok: false, reason: "invalid_area" });
    deletedPurchases.push(first.purchaseId);
    expect(await deletePurchase(A, first.purchaseId)).toEqual({ ok: true });
    expect((await listCardCharges(A, "2026-10-01", "2027-12-31")).filter((c) => c.cardId === card)).toEqual([]);
    expect(await invoicesOf(card)).toEqual([]); // ciclos que ficaram vazios deixam de existir
  });

  it("cartão arquivado e área arquivada bloqueiam compras; cartão só é excluído sem vínculos", async () => {
    const areaId = await newArea(A, "Arquivos");
    const card = await newCard(A, "Arquivado", 10, 17);
    expect(await buy(card, areaId, { purchaseDate: "2026-10-01", totalCents: 1000 })).toMatchObject({ ok: true, count: 1 });
    expect(await deleteCard(A, card)).toEqual({ ok: false, reason: "has_entries" });
    expect(await setCardArchived(A, card, true)).toEqual({ ok: true });
    expect(await buy(card, areaId, { purchaseDate: "2026-10-02", totalCents: 1000 })).toEqual({ ok: false, reason: "card_archived" });
    expect((await listCardCharges(A, "2026-10-01", "2026-10-31")).filter((c) => c.cardId === card)).toHaveLength(1); // histórico acessível
    expect(await setCardArchived(A, card, false)).toEqual({ ok: true });
    const other = await newArea(A, "Área arquivada");
    expect(await setAreaArchived(A, other, true)).toEqual({ ok: true });
    expect(await buy(card, other, { purchaseDate: "2026-10-02", totalCents: 1000 })).toEqual({ ok: false, reason: "area_archived" });
    const empty = await newCard(A, "Sem vínculos", 1, 8);
    expect(await deleteCard(A, empty)).toEqual({ ok: true });
  });

  it("reenvio da mesma compra (requestId) não duplica cobranças", async () => {
    const areaId = await newArea(A, "Reenvio");
    const card = await newCard(A, "Reenvio", 10, 17);
    const requestId = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => buy(card, areaId, { purchaseDate: "2026-10-01", totalCents: 9000, count: 3, requestId })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await invoicesOf(card)).map((i) => i.total)).toEqual(["3000", "3000", "3000"]);
  });

  it("isolamento: B não vê, edita, exclui nem compra no cartão de A", async () => {
    const areaA = await newArea(A, "Iso A");
    const card = await newCard(A, "Iso", 10, 17);
    expect(await buy(card, areaA, { purchaseDate: "2026-10-01", totalCents: 5000 })).toMatchObject({ ok: true, count: 1 });
    const [charge] = (await listCardCharges(A, "2026-10-01", "2026-10-31")).filter((c) => c.cardId === card);
    expect((await listCards(B)).some((c) => c.id === card)).toBe(false);
    expect((await listCardCharges(B, "2026-01-01", "2027-12-31")).some((c) => c.id === charge.id)).toBe(false);
    expect(await updatePurchase(B, charge.purchaseId, { description: "x", areaId: areaA, category: null, notes: null })).toEqual({ ok: false, reason: "not_found" });
    expect(await deletePurchase(B, charge.purchaseId)).toEqual({ ok: false, reason: "not_found" });
    const areaB = await newArea(B, "Iso B");
    expect(await buy(card, areaB, { purchaseDate: "2026-10-02", totalCents: 100 }, B)).toEqual({ ok: false, reason: "invalid_card" });
    const cardB = await newCard(B, "Iso B", 10, 17);
    expect(await buy(cardB, areaA, { purchaseDate: "2026-10-02", totalCents: 100 }, B)).toEqual({ ok: false, reason: "invalid_area" });
    expect(await previewPurchase(B, { cardId: card, purchaseDate: "2026-10-02", totalCents: 100, count: 1, firstReference: null })).toBeNull();
    expect((await invoicesOf(card))[0]).toMatchObject({ total: "5000", status: "pendente" });
  });
});

describe("Cartão: área padrão e compra simplificada (Neon real)", () => {
  it("área padrão escolhida no cartão; área de outra conta é recusada; arquivar a área não some com o cartão", async () => {
    const area = await newArea(A, "Padrão do cartão");
    const full = `${TAG} Cartão com padrão`;
    expect(await createCard(A, { name: full, closingDay: 10, dueDay: 20, notes: null, defaultAreaId: area })).toEqual({ ok: true });
    const card = (await listCards(A)).find((c) => c.name === full)!;
    createdCards.push(card.id);
    expect(card.defaultAreaId).toBe(area);
    // Cartão antigo (sem padrão) continua sem padrão: nada é escolhido em silêncio.
    const plain = await newCard(A, "Cartão sem padrão");
    expect((await listCards(A)).find((c) => c.id === plain)?.defaultAreaId).toBeNull();
    // Área de B não pode ser padrão de um cartão de A (chave estrangeira composta com o usuário).
    const areaB = await newArea(B, "Área de B");
    expect(await updateCard(A, plain, { name: `${TAG} Cartão sem padrão`, closingDay: 10, dueDay: 17, notes: null, defaultAreaId: areaB })).toEqual({ ok: false, reason: "invalid_area" });
    expect(await updateCard(A, plain, { name: `${TAG} Cartão sem padrão`, closingDay: 10, dueDay: 17, notes: null, defaultAreaId: area })).toEqual({ ok: true });
    expect(await updateCard(A, plain, { name: `${TAG} Cartão sem padrão`, closingDay: 10, dueDay: 17, notes: null, defaultAreaId: null })).toEqual({ ok: true });
  });

  it("total + parcelas + cartão: parcelas e vencimentos pelas regras do cartão; descrição automática; sem conta separada", async () => {
    const area = await newArea(A, "Compras simplificadas");
    const card = await newCard(A, "Cartão simplificado", 10, 20);
    const entriesBefore = await asUser<{ n: number }>(A.id, "select count(*)::int as n from public.fin_entries where area_id = $1", [area]);
    // Compra em 04/10/2026, antes do fechamento (dia 10): 1ª parcela na fatura de outubro.
    const preview = await previewPurchase(A, { cardId: card, purchaseDate: "2026-10-04", totalCents: 10000, count: 3, firstReference: null });
    expect(preview?.cycles.map((c) => [c.reference, c.dueDate, c.amountCents])).toEqual([
      ["2026-10", "2026-10-20", 3334],
      ["2026-11", "2026-11-20", 3333],
      ["2026-12", "2026-12-20", 3333],
    ]);
    expect(await buy(card, area, { purchaseDate: "2026-10-04", totalCents: 10000, count: 3, description: "", setDefaultArea: true })).toMatchObject({ ok: true, count: 3, firstDue: "2026-10-20" });
    const invoices = await invoicesOf(card);
    expect(invoices.map((i) => [i.ref, i.due, i.total, i.status])).toEqual([
      ["2026-10", "2026-10-20", "3334", "pendente"],
      ["2026-11", "2026-11-20", "3333", "pendente"],
      ["2026-12", "2026-12-20", "3333", "pendente"],
    ]);
    expect(invoices.reduce((sum, i) => sum + Number(i.total), 0)).toBe(10000);
    const [purchase] = await asUser<{ description: string; installments_count: number }>(A.id, "select description, installments_count from public.fin_card_purchases where card_id = $1", [card]);
    expect(purchase).toEqual({ description: "Compra de 04/10/2026", installments_count: 3 });
    // A área da compra virou o padrão do cartão porque o formulário pediu.
    expect((await listCards(A)).find((c) => c.id === card)?.defaultAreaId).toBe(area);
    // Nenhuma conta independente foi criada para as parcelas.
    expect(await asUser<{ n: number }>(A.id, "select count(*)::int as n from public.fin_entries where area_id = $1", [area])).toEqual(entriesBefore);

    // Virada de ano e compra no dia do fechamento (vai para a fatura seguinte).
    expect(await buy(card, area, { purchaseDate: "2026-12-10", totalCents: 5000, count: 2 })).toMatchObject({ ok: true, count: 2 });
    const after = await invoicesOf(card);
    expect(after.map((i) => [i.ref, i.due, i.total])).toEqual([
      ["2026-10", "2026-10-20", "3334"],
      ["2026-11", "2026-11-20", "3333"],
      ["2026-12", "2026-12-20", "3333"],
      ["2027-01", "2027-01-20", "2500"],
      ["2027-02", "2027-02-20", "2500"],
    ]);
  });
});

/** Faturas de um cartão no intervalo, já com as compras (como a aba Mês monta). */
async function invoiceViews(cardId: string, from: string, to: string, user = A) {
  const invoices = (await listInvoices(user, from, to)).filter((i) => i.cardId === cardId);
  for (const i of invoices) if (!touchedInvoices.includes(i.id)) touchedInvoices.push(i.id);
  const charges = (await listCardCharges(user, from, to)).filter((c) => c.cardId === cardId);
  return buildInvoices(invoices, charges, "2026-10-15");
}

const invoiceEvents = (invoiceId: string) =>
  asUser<{ action: string; details: Record<string, string | null> }>(A.id, "select action, details from public.fin_events where entity_type = 'fatura' and entity_id = $1 order by created_at, id", [invoiceId]);

describe("Fatura do cartão: agrupamento, total informado e pagamento (Neon real)", () => {
  it("compras agrupadas por cartão e vencimento; cartões e vencimentos diferentes em blocos distintos; um cartão com duas áreas", async () => {
    const casa = await newArea(A, "Grupo casa");
    const trabalho = await newArea(A, "Grupo trabalho");
    const bb = await newCard(A, "Grupo BB", 10, 20);
    const nu = await newCard(A, "Grupo Nu", 5, 15);
    expect(await buy(bb, casa, { purchaseDate: "2026-10-01", totalCents: 100000, count: 2, description: `${TAG} Geladeira` })).toMatchObject({ ok: true, count: 2 });
    expect(await buy(bb, trabalho, { purchaseDate: "2026-10-02", totalCents: 50000, description: `${TAG} Monitor` })).toMatchObject({ ok: true, count: 1 });
    expect(await buy(nu, casa, { purchaseDate: "2026-10-01", totalCents: 30000, description: `${TAG} Tênis` })).toMatchObject({ ok: true, count: 1 });

    const bbViews = await invoiceViews(bb, "2026-10-01", "2026-11-30");
    expect(bbViews.map((i) => [i.dueDate, i.detailedCents, i.totalCents, i.statedCents, i.charges.map((c) => c.description)])).toEqual([
      ["2026-10-20", 100000, 100000, null, [`${TAG} Geladeira`, `${TAG} Monitor`]],
      ["2026-11-20", 50000, 50000, null, [`${TAG} Geladeira`]],
    ]);
    const nuViews = await invoiceViews(nu, "2026-10-01", "2026-11-30");
    expect(nuViews.map((i) => [i.cardName, i.dueDate, i.totalCents])).toEqual([[`${TAG} Grupo Nu`, "2026-10-15", 30000]]);

    // Um cartão com compras de duas áreas: um controle só por vencimento; o filtro de área mostra só as compras dela.
    const [outubro] = bbViews;
    expect(cardGroups([outubro], null)).toMatchObject([{ cents: 100000, remainderCents: null, hiddenCount: 0, scoped: false }]);
    const soTrabalho = cardGroups([outubro], trabalho);
    expect(soTrabalho).toMatchObject([{ cents: 50000, hiddenCount: 1, scoped: true }]);
    expect(soTrabalho[0].charges.map((c) => c.description)).toEqual([`${TAG} Monitor`]);
    expect(monthTotals([], [outubro], casa).total + monthTotals([], [outubro], trabalho).total).toBe(100000n); // nada repetido entre as áreas
  });

  it("total real maior, igual e menor que a soma; limpar volta à soma; as parcelas não mudam", async () => {
    const area = await newArea(A, "Total real");
    const card = await newCard(A, "Total real", 10, 20);
    expect(await buy(card, area, { purchaseDate: "2026-10-01", totalCents: 100000 })).toMatchObject({ ok: true });
    const load = async () => (await invoiceViews(card, "2026-10-01", "2026-10-31"))[0];
    const first = await load();
    expect([first.statedCents, first.detailedCents, first.totalCents]).toEqual([null, 100000, 100000]);

    // Exemplo de conferência: R$ 1.000,00 cadastrados e total real de R$ 2.500,00 → R$ 2.500,00 (nunca R$ 3.500,00).
    expect(await setInvoiceTotal(A, { invoiceId: first.id }, 250000)).toMatchObject({ ok: true, firstDue: "2026-10-20" });
    const maior = await load();
    expect([maior.statedCents, maior.detailedCents, maior.totalCents]).toEqual([250000, 100000, 250000]);
    expect(cardGroups([maior], null)[0].remainderCents).toBe(150000);
    expect(monthTotals([], [maior])).toMatchObject({ total: 250000n, aPagar: 250000n, pago: 0n });

    expect(await setInvoiceTotal(A, { invoiceId: first.id }, 100000)).toMatchObject({ ok: true });
    expect(cardGroups([await load()], null)[0]).toMatchObject({ cents: 100000, remainderCents: null });

    expect(await setInvoiceTotal(A, { invoiceId: first.id }, 70000)).toMatchObject({ ok: true });
    const menor = await load();
    expect([menor.totalCents, cardGroups([menor], null)[0].remainderCents]).toEqual([70000, -30000]);
    expect(menor.charges.map((c) => c.amountCents)).toEqual([100000]); // a compra continua inteira

    expect(await setInvoiceTotal(A, { invoiceId: first.id }, null)).toMatchObject({ ok: true });
    const limpo = await load();
    expect([limpo.statedCents, limpo.totalCents]).toEqual([null, 100000]);
    // O banco recusa zero e valor acima do limite mesmo sem passar pela validação do formulário.
    expect(await setInvoiceTotal(A, { invoiceId: first.id }, 0)).toEqual({ ok: false, reason: "error" });
  });

  it("total informado sem nenhuma compra cria a fatura do mês; limpar remove; não copia para outros meses", async () => {
    const card = await newCard(A, "Sem compras", 28, 5);
    expect(await invoiceViews(card, "2026-01-01", "2027-12-31")).toEqual([]);
    expect(await setInvoiceTotal(A, { cardId: card, dueMonth: { year: 2026, month: 11 } }, 80000)).toEqual({ ok: true, firstDue: "2026-11-05", count: 1 });
    const views = await invoiceViews(card, "2026-01-01", "2027-12-31");
    expect(views.map((i) => [i.dueDate, i.statedCents, i.detailedCents, i.totalCents, i.charges.length])).toEqual([["2026-11-05", 80000, 0, 80000, 0]]);
    expect(cardGroups(views, null)[0]).toMatchObject({ cents: 80000, remainderCents: 80000 });
    // Repetir para o mesmo mês atualiza a mesma fatura (não cria outra).
    expect(await setInvoiceTotal(A, { cardId: card, dueMonth: { year: 2026, month: 11 } }, 90000)).toMatchObject({ ok: true });
    expect((await invoiceViews(card, "2026-01-01", "2027-12-31")).map((i) => i.totalCents)).toEqual([90000]);
    expect(await deleteCard(A, card)).toEqual({ ok: false, reason: "has_entries" }); // a fatura informada impede excluir o cartão
    // Sem valor não há o que criar; limpar o total da fatura sem compras a remove.
    expect(await setInvoiceTotal(A, { cardId: card, dueMonth: { year: 2026, month: 12 } }, null)).toEqual({ ok: false, reason: "not_found" });
    expect(await setInvoiceTotal(A, { invoiceId: views[0].id }, null)).toMatchObject({ ok: true, count: 0 }); // removida
    expect(await invoiceViews(card, "2026-01-01", "2027-12-31")).toEqual([]);
    // Cartão arquivado não recebe fatura nova.
    expect(await setCardArchived(A, card, true)).toEqual({ ok: true });
    expect(await setInvoiceTotal(A, { cardId: card, dueMonth: { year: 2026, month: 11 } }, 1000)).toEqual({ ok: false, reason: "card_archived" });
  });

  it("compra lançada depois de informar o total: o total fica; a soma detalhada sobe e a diferença cai", async () => {
    const area = await newArea(A, "Depois do total");
    const card = await newCard(A, "Depois do total", 10, 20);
    expect(await buy(card, area, { purchaseDate: "2026-10-01", totalCents: 100000 })).toMatchObject({ ok: true });
    const load = async () => (await invoiceViews(card, "2026-10-01", "2026-10-31"))[0];
    expect(await setInvoiceTotal(A, { invoiceId: (await load()).id }, 250000)).toMatchObject({ ok: true });
    expect(await buy(card, area, { purchaseDate: "2026-10-03", totalCents: 30000 })).toMatchObject({ ok: true });
    const depois = await load();
    expect([depois.statedCents, depois.detailedCents, depois.totalCents, cardGroups([depois], null)[0].remainderCents]).toEqual([250000, 130000, 250000, 120000]);
    // Excluir a compra mantém a fatura e o total informado.
    const [, extra] = depois.charges;
    deletedPurchases.push(extra.purchaseId);
    expect(await deletePurchase(A, extra.purchaseId)).toEqual({ ok: true });
    expect([(await load()).detailedCents, (await load()).totalCents]).toEqual([100000, 250000]);
  });

  it("pagar um vencimento não altera os demais; o valor pago é o total informado; desfazer preserva o histórico", async () => {
    const area = await newArea(A, "Pagamento");
    const card = await newCard(A, "Pagamento", 10, 20);
    expect(await buy(card, area, { purchaseDate: "2026-10-01", totalCents: 200000, count: 2 })).toMatchObject({ ok: true, count: 2 });
    const load = () => invoiceViews(card, "2026-10-01", "2026-11-30");
    const [outubro, novembro] = await load();
    // Paga outubro informando o total no próprio pagamento (um pagamento só).
    expect(await payInvoice(A, outubro.id, "2026-10-14", 250000)).toEqual({ ok: true });
    const [pago, intacto] = await load();
    expect([pago.status, pago.paidOn, pago.statedCents, pago.totalCents]).toEqual(["pago", "2026-10-14", 250000, 250000]);
    expect([intacto.id, intacto.status, intacto.statedCents, intacto.totalCents]).toEqual([novembro.id, "pendente", null, 100000]);
    expect(pago.charges.map((c) => c.amountCents)).toEqual([100000]); // a parcela não muda
    expect(monthTotals([], [pago])).toMatchObject({ total: 250000n, pago: 250000n, aPagar: 0n });
    // Reenvio não registra um segundo pagamento.
    expect(await payInvoice(A, outubro.id, "2026-10-14", 250000)).toEqual({ ok: true });
    expect((await invoiceEvents(outubro.id)).map((e) => [e.action, e.details.total_cents, e.details.paid_on])).toEqual([["pagamento", "250000", "2026-10-14"]]);
    // Paga, o total não muda; nova compra no mês entra como detalhe e não mexe no valor pago.
    expect(await setInvoiceTotal(A, { invoiceId: outubro.id }, 300000)).toEqual({ ok: false, reason: "invoice_paid" });
    expect(await buy(card, area, { purchaseDate: "2026-10-05", totalCents: 40000 })).toMatchObject({ ok: true });
    const comNova = (await load())[0];
    expect([comNova.status, comNova.detailedCents, comNova.totalCents]).toEqual(["pago", 140000, 250000]);
    // Desfazer: volta para a pagar, mantém o total informado e guarda o pagamento anterior no histórico.
    expect(await unpayInvoice(A, outubro.id)).toEqual({ ok: true });
    expect(await unpayInvoice(A, outubro.id)).toEqual({ ok: true }); // repetir não muda nada
    const reaberta = (await load())[0];
    expect([reaberta.status, reaberta.paidOn, reaberta.statedCents, reaberta.totalCents]).toEqual(["pendente", null, 250000, 250000]);
    expect((await invoiceEvents(outubro.id)).map((e) => [e.action, e.details.total_cents])).toEqual([
      ["pagamento", "250000"],
      ["reabertura", "250000"],
    ]);
  });

  it("sem total informado: paga pela soma e o mês fica travado para compras; fatura vazia não é paga", async () => {
    const area = await newArea(A, "Pela soma");
    const card = await newCard(A, "Pela soma", 10, 20);
    expect(await buy(card, area, { purchaseDate: "2026-10-01", totalCents: 60000 })).toMatchObject({ ok: true });
    const load = async () => (await invoiceViews(card, "2026-10-01", "2026-10-31"))[0];
    const invoice = await load();
    expect(await payInvoice(A, invoice.id, "2026-10-14", null)).toEqual({ ok: true });
    const paga = await load();
    expect([paga.status, paga.statedCents, paga.totalCents]).toEqual(["pago", null, 60000]); // pagamento não vira "total informado"
    // Campo em branco no pagamento = pela soma, mesmo que antes houvesse um total informado (é o que a tela diz).
    expect(await unpayInvoice(A, invoice.id)).toEqual({ ok: true });
    expect(await setInvoiceTotal(A, { invoiceId: invoice.id }, 90000)).toMatchObject({ ok: true });
    expect(await payInvoice(A, invoice.id, "2026-10-14", null)).toEqual({ ok: true });
    expect([(await load()).statedCents, (await load()).totalCents]).toEqual([null, 60000]);
    // O valor pago veio da soma: mexer nas compras mudaria o que foi pago.
    expect(await buy(card, area, { purchaseDate: "2026-10-02", totalCents: 1000 })).toEqual({ ok: false, reason: "invoice_paid" });
    expect((await previewPurchase(A, { cardId: card, purchaseDate: "2026-10-02", totalCents: 1000, count: 1, firstReference: null }))?.cycles[0]).toMatchObject({ existing: true, locked: true });
    expect(await deletePurchase(A, paga.charges[0].purchaseId)).toEqual({ ok: false, reason: "invoice_paid" });
    expect(await unpayInvoice(A, invoice.id)).toEqual({ ok: true });
    expect(await buy(card, area, { purchaseDate: "2026-10-02", totalCents: 1000 })).toMatchObject({ ok: true });
    expect((await load()).totalCents).toBe(61000);
    // Ciclo sem compras e sem total (criado direto no banco): não há o que pagar.
    const [empty] = await asUser<{ id: string }>(A.id, "insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date) values ($1, $2, '2027-03-01', '2027-03-10', '2027-03-20') returning id", [A.id, card]);
    touchedInvoices.push(empty.id);
    expect(await payInvoice(A, empty.id, "2026-10-14", null)).toEqual({ ok: false, reason: "invoice_empty" });
    expect((await listInvoices(A, "2027-03-01", "2027-03-31")).some((i) => i.id === empty.id)).toBe(false); // ciclo vazio não é listado
  });

  it("isolamento: B não vê, não informa total, não paga e não reabre a fatura de A; nem cria fatura no cartão de A", async () => {
    const area = await newArea(A, "Iso fatura");
    const card = await newCard(A, "Iso fatura", 10, 20);
    expect(await buy(card, area, { purchaseDate: "2026-10-01", totalCents: 50000 })).toMatchObject({ ok: true });
    const [invoice] = await invoiceViews(card, "2026-10-01", "2026-10-31");
    expect((await listInvoices(B, "2026-01-01", "2027-12-31")).some((i) => i.id === invoice.id)).toBe(false);
    expect(await setInvoiceTotal(B, { invoiceId: invoice.id }, 99900)).toEqual({ ok: false, reason: "not_found" });
    expect(await setInvoiceTotal(B, { cardId: card, dueMonth: { year: 2026, month: 12 } }, 99900)).toEqual({ ok: false, reason: "invalid_card" });
    expect(await payInvoice(B, invoice.id, "2026-10-14", 99900)).toEqual({ ok: false, reason: "not_found" });
    expect(await payInvoice(A, invoice.id, "2026-10-14", 50000)).toEqual({ ok: true });
    expect(await unpayInvoice(B, invoice.id)).toEqual({ ok: false, reason: "not_found" });
    const [depois] = await invoiceViews(card, "2026-10-01", "2026-10-31");
    expect([depois.status, depois.statedCents, depois.totalCents]).toEqual(["pago", 50000, 50000]);
    expect((await invoiceViews(card, "2026-11-01", "2026-12-31")).length).toBe(0); // B não criou nada em dezembro
  });
});
