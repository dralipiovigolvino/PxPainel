import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, cleanupAreas, cleanupFollowup, cleanupPlantoes, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, addMonths, formatYearMonth, todayInSaoPaulo, yearMonthOf } from "@/lib/dates";
import { createCard, createPurchase, listCards, payInvoice, setInvoiceTotal } from "@/modules/financas/cards-data";
import { financasDashboard } from "@/modules/financas/dashboard";
import { createArea, createEntry, listAreas, markEntryPaid } from "@/modules/financas/data";
import { createSeries as createFinSeries, ensureGeneratedThrough as ensureFin } from "@/modules/financas/series-data";
import { followupDashboard } from "@/modules/followup/dashboard";
import { createPatient, createTemplate, setPatientArchived } from "@/modules/followup/data";
import { patientSchema, templateSchema } from "@/modules/followup/domain/schemas";
import { cancelStep, createConsultationWithPlan, getPatientFollowups, markStepDone } from "@/modules/followup/plans-data";
import { plantoesDashboard } from "@/modules/plantoes/dashboard";
import { createShift, createType, setShiftCanceled, setShiftDone } from "@/modules/plantoes/data";
import { shiftSchema, typeSchema } from "@/modules/plantoes/domain/schemas";
import { ensureGeneratedThrough as ensurePl } from "@/modules/plantoes/series-data";
import { buildSections } from "./aggregate";
import type { DashboardItem, DashboardModuleData } from "./contract";

/**
 * Cenário fictício do dashboard com resultados esperados calculados À MÃO.
 * "Agora" fixado em hoje às 10:00 (São Paulo) para o plantão noturno em andamento ser determinístico.
 *
 * Hoje — pagamentos: conta R$ 100 + conta variável sem valor + fatura do cartão R$ 300 = 3 pendências;
 *   R$ 400 conhecidos; 1 a informar. As duas compras no cartão (R$ 120 + R$ 180, vencendo hoje) entram
 *   UMA vez, como a fatura do cartão (não uma pendência por compra).
 *   Conta paga hoje fica fora. Conta do mês anterior (R$ 50) em Atrasados.
 * Follow-up (D0, D1, D7, D30) da consulta de ontem: D0 atrasada, D1 hoje, D7 em Próximos (hoje + 6), D30 fora.
 *   Outro paciente (consulta hoje): D0 realizada e D1 cancelada → fora; D7 em Próximos (hoje + 7).
 *   Paciente arquivado com consulta de hoje: D0 hoje, D1 e D7 em Próximos (continuam aparecendo).
 * Plantões: hoje sem horário → Hoje; noturno de ontem 22:00 → 12:00 → Hoje "em andamento" (uma vez);
 *   daqui a 3 dias → Próximos; anteontem agendado → A confirmar; ontem cancelado → fora;
 *   ontem realizado → fora.
 */
const { A, B } = testUsers();
const today = todayInSaoPaulo();
const NOW = 10 * 60;
const areas: string[] = [];
const cards: string[] = [];
const patients: string[] = [];
const templates: string[] = [];
const plTypes: string[] = [];
const ids: Record<string, string> = {};

let fin: DashboardModuleData;
let fu: DashboardModuleData;
let pl: DashboardModuleData;

const mine = (data: DashboardModuleData, known: Set<string>) => ({ ...data, items: data.items.filter((i) => known.has(i.id)) });
const finIds = new Set<string>();
const fuIds = new Set<string>();
const plIds = new Set<string>();

beforeAll(async () => {
  // --- Finanças ---
  const areaName = `${TAG} Dash Casa`;
  await createArea(A, { name: areaName, color: "#2563eb" });
  const area = (await listAreas(A)).find((a) => a.name === areaName)!.id;
  areas.push(area);
  const entry = async (key: string, cents: number, due: string) => {
    await createEntry(A, { description: `${TAG} ${key}`, amountCents: cents, dueDate: due, areaId: area, category: null, notes: null });
    ids[key] = (await asUser<{ id: string }>(A.id, "select id from public.fin_entries where description = $1", [`${TAG} ${key}`]))[0].id;
    finIds.add(ids[key]);
  };
  await entry("Conta 100", 10000, today);
  await entry("Paga", 7000, today);
  await markEntryPaid(A, ids["Paga"], today);
  await entry("Mês anterior", 5000, addDays(today, -35));
  // Variável: ocorrência de hoje sem valor (série mensal variável que começa hoje).
  await createFinSeries(A, { areaId: area, description: `${TAG} Variável`, category: null, notes: null, amountKind: "variavel", amountCents: null, frequency: "mensal", intervalMonths: 1, startDate: today, endDate: null });
  ids["Variável"] = (await asUser<{ id: string }>(A.id, "select id from public.fin_entries where description = $1 and due_date = $2::date", [`${TAG} Variável`, today]))[0].id;
  finIds.add(ids["Variável"]);
  // Duas compras no cartão com vencimento hoje (o cartão vence no dia de hoje).
  const cardName = `${TAG} Dash Cartão`;
  const day = Number(today.slice(8, 10));
  await createCard(A, { name: cardName, closingDay: day, dueDay: day, notes: null, defaultAreaId: null });
  const card = (await listCards(A)).find((c) => c.name === cardName)!.id;
  cards.push(card);
  for (const cents of [12000, 18000]) {
    await createPurchase(A, { cardId: card, areaId: area, description: `${TAG} Compra`, category: null, notes: null, purchaseDate: addDays(today, -1), totalCents: cents, count: 1, firstReference: formatYearMonth(addMonths(yearMonthOf(today), -1)), requestId: randomUUID() });
  }
  const purchases = await asUser<{ id: string }>(A.id, "select id from public.fin_card_purchases where card_id = $1", [card]);
  for (const p of purchases) finIds.add(p.id);
  ids["Fatura"] = (await asUser<{ id: string }>(A.id, "select id from public.fin_invoices where card_id = $1", [card]))[0].id;
  finIds.add(ids["Fatura"]);

  // --- Follow-up ---
  const tpl = await createTemplate(A, templateSchema.parse({ name: `${TAG} Dash Modelo`, description: "", steps: JSON.stringify([0, 1, 7, 30].map((d) => ({ dayOffset: d, message: "Olá {nome}" }))) }));
  templates.push((tpl as { id: string }).id);
  const patient = async (name: string) => {
    const r = await createPatient(A, patientSchema.parse({ name: `${TAG} ${name}`, phone: "", notes: "" }));
    patients.push((r as { id: string }).id);
    return (r as { id: string }).id;
  };
  const consult = async (p: string, date: string) => {
    await createConsultationWithPlan(A, p, { consultDate: date, notes: null, requestId: randomUUID(), templateId: templates[0] });
    return (await getPatientFollowups(A, p)).plans.at(-1)!.steps;
  };
  const p1 = await patient("Paciente Um");
  for (const s of await consult(p1, addDays(today, -1))) {
    fuIds.add(s.id);
    ids[`p1-D${s.dayOffset}`] = s.id;
  }
  const p2 = await patient("Paciente Dois");
  const s2 = await consult(p2, today);
  for (const s of s2) {
    fuIds.add(s.id);
    ids[`p2-D${s.dayOffset}`] = s.id;
  }
  await markStepDone(A, ids["p2-D0"], null);
  await cancelStep(A, ids["p2-D1"], null);
  const p3 = await patient("Paciente Arquivado");
  for (const s of await consult(p3, today)) {
    fuIds.add(s.id);
    ids[`p3-D${s.dayOffset}`] = s.id;
  }
  await setPatientArchived(A, p3, true);

  // --- Plantões ---
  const t = await createType(A, typeSchema.parse({ name: `${TAG} Dash Plantão`, location: "", amount: "1.000,00", color: "#16a34a", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payDay: "" }));
  plTypes.push((t as { id: string }).id);
  const shift = async (key: string, date: string, extra: Record<string, string> = {}) => {
    const r = await createShift(A, plTypes[0], { ...shiftSchema.parse({ date, amount: "1.000,00", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payMode: "auto", payDate: "", ...extra }), requestId: randomUUID(), confirmOverlap: true });
    ids[key] = (r as { id: string }).id;
    plIds.add(ids[key]);
  };
  await shift("hoje", today);
  await shift("noturno", addDays(today, -1), { start: "22:00", end: "12:00", nextDay: "true" });
  await shift("futuro", addDays(today, 3));
  await shift("a confirmar", addDays(today, -2));
  await shift("cancelado", addDays(today, -1));
  await setShiftCanceled(A, ids["cancelado"], true);
  await shift("realizado", addDays(today, -1));
  await setShiftDone(A, ids["realizado"], true);

  fin = mine(await financasDashboard(A, today), finIds);
  fu = mine(await followupDashboard(A, today), fuIds);
  pl = mine((await plantoesDashboard(A, today, NOW)).data, plIds);
}, 180_000);

afterAll(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED, max: 1 });
  try {
    for (const c of cards) {
      // Fatura paga sem total informado trava as cobranças: a limpeza (dono) reabre antes de apagar.
      await pool.query("update public.fin_invoices set status = 'pendente', paid_on = null where card_id = $1", [c]);
      await pool.query("delete from public.fin_events where entity_id in (select id from public.fin_invoices where card_id = $1) or entity_id in (select id from public.fin_card_purchases where card_id = $1)", [c]);
      await pool.query("delete from public.fin_card_charges where card_id = $1", [c]);
      await pool.query("delete from public.fin_card_purchases where card_id = $1", [c]);
      await pool.query("delete from public.fin_invoices where card_id = $1", [c]);
      await pool.query("delete from public.fin_cards where id = $1", [c]);
    }
  } finally {
    await pool.end();
  }
  await cleanupAreas(areas);
  await cleanupFollowup(patients, templates);
  await cleanupPlantoes(plTypes);
});

const keysIn = (items: DashboardItem[], section: string) => items.filter((i) => i.section === section).map((i) => i.id).sort();

describe("Etapa 13 — dashboard com cenário fictício (Neon real)", () => {
  it("pagamentos de hoje: 2 contas + a fatura do cartão; R$ 400 conhecidos + 1 a informar; as compras não viram pendências separadas", async () => {
    const { sections } = buildSections([{ ok: true, data: fin }]);
    const hoje = sections.find((s) => s.section === "hoje")!;
    expect(hoje.summary.payments).toEqual({ count: 3, knownCents: 40000n, unknownCount: 1 });
    expect(keysIn(fin.items, "hoje")).toEqual([ids["Conta 100"], ids["Variável"], ids["Fatura"]].sort());
    // As duas compras vencem hoje (pelo ciclo do cartão) e entram uma vez, como a fatura do cartão.
    const due = await asUser<{ due: string }>(A.id, "select to_char(i.due_date, 'YYYY-MM-DD') as due from public.fin_card_charges ch join public.fin_invoices i on i.id = ch.invoice_id where ch.card_id = $1", [cards[0]]);
    expect(due.map((d) => d.due)).toEqual([today, today]);
    const fatura = fin.items.filter((i) => i.type === "fatura");
    expect(fatura).toHaveLength(1);
    expect(fatura[0]).toMatchObject({
      id: ids["Fatura"],
      key: `financas:fatura:${ids["Fatura"]}`,
      title: `${TAG} Dash Cartão`,
      detail: "Fatura do cartão · total não informado",
      amount: { kind: "known", cents: 30000 },
      href: `/financas/mes?mes=${today.slice(0, 7)}&fatura=${ids["Fatura"]}`,
      actions: [{ kind: "pagar_fatura", invoiceId: ids["Fatura"], cardName: `${TAG} Dash Cartão`, dueDate: today, statedCents: null, detailedCents: 30000 }],
    });
    expect(fin.items.find((i) => i.id === ids["Variável"])?.amount).toEqual({ kind: "unknown" });
    expect(fin.items.some((i) => i.id === ids["Paga"])).toBe(false);
  });

  it("atrasados incluem o mês anterior; link abre o mês certo", () => {
    expect(keysIn(fin.items, "atrasados")).toEqual([ids["Mês anterior"]]);
    const old = fin.items.find((i) => i.id === ids["Mês anterior"])!;
    expect(old.href).toBe(`/financas/mes?mes=${addDays(today, -35).slice(0, 7)}&conta=${ids["Mês anterior"]}`);
    expect(old.status).toBe("atrasado");
  });

  it("follow-up: hoje, atrasado e próximos; realizado, cancelado e D30 fora; paciente arquivado continua", () => {
    expect(keysIn(fu.items, "hoje")).toEqual([ids["p1-D1"], ids["p3-D0"]].sort());
    expect(keysIn(fu.items, "atrasados")).toEqual([ids["p1-D0"]]);
    expect(keysIn(fu.items, "proximos")).toEqual([ids["p1-D7"], ids["p2-D7"], ids["p3-D1"], ids["p3-D7"]].sort());
    for (const k of ["p2-D0", "p2-D1", "p1-D30"]) expect(fu.items.some((i) => i.id === ids[k])).toBe(false);
    const item = fu.items.find((i) => i.id === ids["p1-D1"])!;
    expect(item).toMatchObject({ title: `${TAG} Paciente Um`, detail: "D1", amount: { kind: "none" } });
    expect(JSON.stringify(item)).not.toMatch(/Olá|telefone|phone/);
  });

  it("plantões: hoje + noturno em andamento (uma vez), próximo, a confirmar; cancelado e realizado fora", () => {
    expect(keysIn(pl.items, "hoje")).toEqual([ids["hoje"], ids["noturno"]].sort());
    expect(pl.items.find((i) => i.id === ids["noturno"])?.status).toBe("em_andamento");
    expect(pl.items.filter((i) => i.id === ids["noturno"]).length).toBe(1);
    expect(keysIn(pl.items, "proximos")).toEqual([ids["futuro"]]);
    expect(keysIn(pl.items, "a_confirmar")).toEqual([ids["a confirmar"]]);
    expect(pl.items.every((i) => i.kind === "compromisso" && i.status !== "atrasado")).toBe(true);
  });

  it("acesso direto: recorrências retroativas sem geração são sinalizadas e, geradas, entram em Atrasados / A confirmar", async () => {
    await asUser(A.id, `insert into public.fin_series (user_id, area_id, description, amount_kind, amount_cents, frequency, interval_months, start_date)
      values ($1, $2, $3, 'fixo', 2500, 'mensal', 1, $4::date)`, [A.id, areas[0], `${TAG} Retroativa`, addDays(today, -40)]);
    await asUser(A.id, `insert into public.pl_series (user_id, type_id, weekday_mask, interval_weeks, start_date, amount_cents) values ($1, $2, 127, 1, $3::date, 1000)`, [A.id, plTypes[0], addDays(today, -3)]);
    const f1 = await financasDashboard(A, today);
    const p1 = await plantoesDashboard(A, today, NOW);
    expect(f1.coverage.generationTarget).not.toBeNull();
    expect(p1.data.coverage.generationTarget).not.toBeNull();
    await Promise.all([ensureFin(A, f1.coverage.generationTarget!), ensureFin(A, f1.coverage.generationTarget!), ensurePl(A, p1.data.coverage.generationTarget!)]);
    const f2 = await financasDashboard(A, today);
    const p2 = await plantoesDashboard(A, today, NOW);
    expect(f2.coverage.generationTarget).toBeNull();
    const retro = f2.items.filter((i) => i.title === `${TAG} Retroativa` && i.section === "atrasados");
    // Mensal desde hoje − 40: a primeira ocorrência (e a seguinte, se já venceu) ficam em Atrasados.
    expect(retro[0]?.date).toBe(addDays(today, -40));
    expect(retro.every((i) => i.date < today)).toBe(true);
    expect(new Set(f2.items.map((i) => i.key)).size).toBe(f2.items.length);
    const plRetro = p2.data.items.filter((i) => i.section === "a_confirmar" && i.title === `${TAG} Dash Plantão`);
    expect(plRetro.length).toBeGreaterThanOrEqual(3); // anteontem (avulso) + dias anteriores da série diária
  });

  it("fatura do cartão: com total real informado a pendência usa esse total; paga, sai das pendências", async () => {
    expect(await setInvoiceTotal(A, { invoiceId: ids["Fatura"] }, 45000)).toMatchObject({ ok: true });
    const informado = (await financasDashboard(A, today)).items.find((i) => i.id === ids["Fatura"]);
    expect(informado).toMatchObject({ detail: "Fatura do cartão", amount: { kind: "known", cents: 45000 } });
    expect(await payInvoice(A, ids["Fatura"], today, 45000)).toEqual({ ok: true });
    expect((await financasDashboard(A, today)).items.some((i) => i.id === ids["Fatura"])).toBe(false);
  });

  it("isolamento: B não recebe nenhum item de A", async () => {
    const all = new Set([...finIds, ...fuIds, ...plIds]);
    const [bf, bu, bp] = await Promise.all([financasDashboard(B, today), followupDashboard(B, today), plantoesDashboard(B, today, NOW)]);
    expect([...bf.items, ...bu.items, ...bp.data.items].some((i) => all.has(i.id))).toBe(false);
  });
});
