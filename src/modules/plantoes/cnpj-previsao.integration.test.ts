import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, cleanupCnpjs, cleanupPericias, cleanupPlantoes, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, todayInSaoPaulo } from "@/lib/dates";
import { amountBreakdown } from "@/lib/tax";
import { createCnpj, updateCnpj } from "@/modules/cnpj/data";
import { createCompany, createExam, listExams, receiveExam, setExamDone } from "@/modules/pericias/data";
import { companySchema, examSchema } from "@/modules/pericias/domain/schemas";
import { createShift, createType, getShiftEvents, listShifts, listTypes, receiveShift, setShiftCanceled, setShiftDone, updateShift, updateType } from "./data";
import { expectedPayDate, groupForecast, sumsTotal } from "./domain/payment";
import { shiftSchema, typeSchema } from "./domain/schemas";
import { kindRows, shiftTotals } from "./domain/totals";
import { applyTypeRule, listForecast, typeRuleImpact } from "./forecast-data";
import { createSeries, endSeries, ensureGeneratedThrough, listSeries, moveShift } from "./series-data";

/** Plantões no Neon real: "recebo por CNPJ", previsão de pagamento, repetição semanal e mudança do percentual do CNPJ. */
const { A, B } = testUsers();
const types: string[] = [];
const companies: string[] = [];
const cnpjs: string[] = [];
const today = todayInSaoPaulo();
/** CNPJ fictício da conta A, a 9%. */
let CNPJ = "";

async function newCnpj(name: string, taxRate = 900, user = A) {
  const r = await createCnpj(user, { name: `${TAG} ${name}`, abbreviation: name.slice(0, 20), number: null, taxRate, taxDueDay: 20 });
  const id = (r as { id: string }).id;
  cnpjs.push(id);
  return id;
}

beforeAll(async () => {
  CNPJ = await newCnpj("CNPJ plantões");
});
afterAll(async () => {
  await cleanupPlantoes(types);
  await cleanupPericias(companies);
  await cleanupCnpjs(cnpjs);
});

async function newType(name: string, extra: { cnpjId?: string; payDay?: string; payMonthOffset?: string; amount?: string } = {}, user = A) {
  const r = await createType(user, typeSchema.parse({ name: `${TAG} ${name}`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: CNPJ, payDay: "20", ...extra }));
  const id = (r as { id: string }).id;
  types.push(id);
  return id;
}
const input = (date: string, extra: Record<string, string> = {}) =>
  shiftSchema.parse({ date, amount: "1.000,00", notes: "", start: "", end: "", nextDay: "false", cnpjId: CNPJ, payMode: "auto", payDate: "", ...extra });
async function add(typeId: string, date: string, extra: Record<string, string> = {}, user = A) {
  const r = await createShift(user, typeId, { ...input(date, extra), requestId: randomUUID(), confirmOverlap: true });
  return (r as { id: string }).id;
}
const get = async (id: string, date: string) => (await listShifts(A, date, date)).find((s) => s.id === id)!;
const edit = (date: string, extra: Record<string, string> = {}) => {
  const { date: _d, ...rest } = input(date, extra);
  void _d;
  return { ...rest, confirmOverlap: true };
};

describe("Plantões: recebo por CNPJ e previsão de pagamento (Neon real)", () => {
  it("persiste a escolha de pagamento neste mês e mantém mês seguinte como padrão", async () => {
    const sameMonth = await newType("Pagamento no mês", { payDay: "20", payMonthOffset: "0" });
    const nextMonth = await newType("Pagamento seguinte", { payDay: "20", payMonthOffset: "1" });
    const a = await add(sameMonth, "2026-10-08");
    const b = await add(nextMonth, "2026-10-08");
    expect(await get(a, "2026-10-08")).toMatchObject({ payDay: 20, payMonthOffset: 0, expectedPayDate: "2026-10-20" });
    expect(await get(b, "2026-10-08")).toMatchObject({ payDay: 20, payMonthOffset: 1, expectedPayDate: "2026-11-20" });
  });
  it("herda do tipo: por CNPJ com o percentual gravado e previsão no dia 20 do mês seguinte; sem CNPJ, sem imposto", async () => {
    const t = await newType("CNPJ dia 20");
    expect((await listTypes(A)).find((x) => x.id === t)).toMatchObject({ cnpjId: CNPJ, payDay: 20 });
    const byCnpj = await add(t, "2026-10-08");
    const s = await get(byCnpj, "2026-10-08");
    expect(s).toMatchObject({ amountCents: 100000, cnpjId: CNPJ, amountKind: "bruto", taxRateBp: 900, payDay: 20, expectedPayDate: "2026-11-20", expectedPayManual: false, receivedOn: null, status: "agendado" });
    expect(amountBreakdown(s.amountCents, s.amountKind, s.taxRateBp)).toMatchObject({ taxCents: 9000, netCents: 91000 });
    // Desmarcado só neste plantão: valor mantido, sem CNPJ, sem alíquota.
    const plain = await add(t, "2026-10-09", { cnpjId: "" });
    const n = await get(plain, "2026-10-09");
    expect(n).toMatchObject({ cnpjId: null, amountKind: "liquido", taxRateBp: null, expectedPayDate: "2026-11-20" });
    expect(amountBreakdown(n.amountCents, n.amountKind, n.taxRateBp)).toMatchObject({ taxCents: null, netCents: 100000 });
    // A previsão não marca recebimento.
    expect(s.receivedOn).toBeNull();
    expect((await getShiftEvents(A, byCnpj))[0].details).toMatchObject({ cnpj: true, aliquota_bp: 900 });
    expect((await getShiftEvents(A, plain))[0].details).toMatchObject({ cnpj: false, aliquota_bp: null });
  });

  it("tipo sem CNPJ: o plantão novo nasce sem CNPJ; mudar o padrão do tipo não mexe nos já criados", async () => {
    const t = await newType("Sem CNPJ", { cnpjId: "" });
    expect((await listTypes(A)).find((x) => x.id === t)?.cnpjId).toBeNull();
    const before = await add(t, "2026-10-12", { cnpjId: "" });
    const r = await updateType(A, t, typeSchema.parse({ name: `${TAG} Sem CNPJ`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: CNPJ, payDay: "20" }));
    // `detail` avisa a tela de que a marcação de CNPJ mudou (a regra de pagamento não mudou: count 0).
    expect(r).toMatchObject({ ok: true, count: 0, detail: "cnpj" });
    expect((await listTypes(A)).find((x) => x.id === t)?.cnpjId).toBe(CNPJ);
    expect(await get(before, "2026-10-12")).toMatchObject({ cnpjId: null, taxRateBp: null });
    // CNPJ inexistente (ou de outra conta) não é aceito.
    expect(await createShift(A, t, { ...input("2026-10-13", { cnpjId: randomUUID() }), requestId: randomUUID(), confirmOverlap: true })).toEqual({ ok: false, reason: "cnpj_not_found" });
    expect(await updateType(A, t, typeSchema.parse({ name: `${TAG} Sem CNPJ`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: randomUUID(), payDay: "20" }))).toEqual({ ok: false, reason: "cnpj_not_found" });
  });

  it("previsão no banco = regra pura: virada de ano e dias 29 a 31", async () => {
    for (const payDay of [1, 20, 29, 30, 31]) {
      for (const date of ["2026-10-01", "2026-10-31", "2026-11-30", "2026-12-15", "2026-12-31", "2027-01-10", "2027-01-31", "2028-01-31", "2026-03-05", "2026-04-05"]) {
        const [row] = await asUser<{ d: string }>(A.id, "select to_char(app_private.pl_expected_pay($1::date, $2), 'YYYY-MM-DD') as d", [date, payDay]);
        expect(`${date} dia ${payDay} → ${row.d}`).toBe(`${date} dia ${payDay} → ${expectedPayDate(date, payDay)}`);
      }
    }
    const t = await newType("Dia 31", { payDay: "31" });
    expect((await get(await add(t, "2026-12-15"), "2026-12-15")).expectedPayDate).toBe("2027-01-31");
    expect((await get(await add(t, "2027-01-10"), "2027-01-10")).expectedPayDate).toBe("2027-02-28");
    expect((await get(await add(t, "2028-01-10"), "2028-01-10")).expectedPayDate).toBe("2028-02-29");
  });

  it("mover recalcula a previsão automática; data manual e recebimento são preservados", async () => {
    const t = await newType("Mover");
    const auto = await add(t, "2026-10-30");
    expect((await get(auto, "2026-10-30")).expectedPayDate).toBe("2026-11-20");
    expect(await moveShift(A, auto, "2026-11-02", null)).toMatchObject({ ok: true });
    expect(await get(auto, "2026-11-02")).toMatchObject({ expectedPayDate: "2026-12-20", expectedPayManual: false });

    const manual = await add(t, "2026-10-29", { payMode: "manual", payDate: "2026-11-05" });
    expect(await get(manual, "2026-10-29")).toMatchObject({ expectedPayDate: "2026-11-05", expectedPayManual: true });
    expect(await moveShift(A, manual, "2026-11-03", null)).toMatchObject({ ok: true });
    expect(await get(manual, "2026-11-03")).toMatchObject({ expectedPayDate: "2026-11-05", expectedPayManual: true });
    // Voltar para a regra do tipo: a data passa a acompanhar o mês do plantão.
    expect(await updateShift(A, manual, edit("2026-11-03"))).toMatchObject({ ok: true });
    expect(await get(manual, "2026-11-03")).toMatchObject({ expectedPayDate: "2026-12-20", expectedPayManual: false });
    expect((await getShiftEvents(A, manual)).at(-1)?.details).toMatchObject({ previsao: { de: "2026-11-05", para: null } });

    const past = addDays(today, -40);
    const received = await add(t, past);
    await receiveShift(A, received, today);
    const before = await get(received, past);
    expect(await moveShift(A, received, addDays(past, 1), null)).toMatchObject({ ok: true });
    const after = await get(received, addDays(past, 1));
    expect(after.receivedOn).toBe(before.receivedOn);
    expect(after.receivedCents).toBe(before.receivedCents);
  });

  it("plantão recebido: o valor continua travado, mas a marcação de CNPJ pode ser corrigida", async () => {
    const t = await newType("Recebido");
    const date = addDays(today, -20);
    const id = await add(t, date);
    await receiveShift(A, id, today);
    expect(await updateShift(A, id, edit(date, { amount: "900,00" }))).toEqual({ ok: false, reason: "received" });
    // Desmarcar: deixa de ter imposto estimado; o recebimento não muda.
    expect(await updateShift(A, id, edit(date, { cnpjId: "" }))).toMatchObject({ ok: true });
    expect(await get(id, date)).toMatchObject({ cnpjId: null, amountKind: "liquido", taxRateBp: null, receivedOn: today, receivedCents: 100000 });
    expect((await getShiftEvents(A, id)).at(-1)?.details).toMatchObject({ cnpj: { de: true, para: false }, aliquota_bp: null });
    // Marcar de novo: usa o percentual atual do CNPJ.
    expect(await updateShift(A, id, edit(date))).toMatchObject({ ok: true });
    expect(await get(id, date)).toMatchObject({ cnpjId: CNPJ, amountKind: "bruto", taxRateBp: 900, receivedOn: today, receivedCents: 100000 });
  });

  it("mudar a regra do tipo respeita o histórico; aplicar aos futuros é explícito, com prévia", async () => {
    const t = await newType("Regra", { payDay: "20" });
    const future = addDays(today, 10);
    const pastDate = addDays(today, -10);
    const scheduled = await add(t, future);
    const manual = await add(t, addDays(future, 1), { payMode: "manual", payDate: addDays(future, 20) });
    const done = await add(t, pastDate);
    await setShiftDone(A, done, true);
    const paid = await add(t, addDays(pastDate, 1));
    await receiveShift(A, paid, today);
    const s = (await createSeries(A, { typeId: t, weekdays: [4], intervalWeeks: 1, startDate: future, endDate: addDays(future, 21), amount: 100000, cnpjId: CNPJ, hours: null, notes: null })) as { id: string };
    const generated = (await listShifts(A, future, addDays(future, 21))).filter((x) => x.seriesId === s.id);
    expect(generated.length).toBeGreaterThanOrEqual(3);
    expect(generated.every((x) => x.payDay === 20 && x.cnpjId === CNPJ && x.amountKind === "bruto" && x.taxRateBp === 900)).toBe(true);

    const r = await updateType(A, t, typeSchema.parse({ name: `${TAG} Regra`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: CNPJ, payDay: "5" }));
    expect(r).toMatchObject({ ok: true, count: 1 });
    expect((r as { detail?: string }).detail).toBeUndefined();
    // Nada mudou sozinho.
    expect((await get(scheduled, future)).expectedPayDate).toBe(expectedPayDate(future, 20));
    // Plantão novo já usa a regra nova.
    const fresh = await add(t, addDays(future, 2));
    expect((await get(fresh, addDays(future, 2))).expectedPayDate).toBe(expectedPayDate(addDays(future, 2), 5));

    const impact = await typeRuleImpact(A, t);
    expect(impact).toMatchObject({ payDay: 5, fill: 0, change: 1 + generated.length, series: 1 });
    // Preservados: manual, realizado (passado) e recebido.
    expect(impact?.preserved).toBe(3);
    expect(await typeRuleImpact(B, t)).toBeNull();
    expect(await applyTypeRule(B, t)).toEqual({ ok: false, reason: "not_found" });

    expect(await applyTypeRule(A, t)).toMatchObject({ ok: true, count: 1 + generated.length });
    expect((await get(scheduled, future)).expectedPayDate).toBe(expectedPayDate(future, 5));
    expect(await get(manual, addDays(future, 1))).toMatchObject({ expectedPayDate: addDays(future, 20), expectedPayManual: true, payDay: 20 });
    expect((await get(done, pastDate)).expectedPayDate).toBe(expectedPayDate(pastDate, 20));
    expect((await get(paid, addDays(pastDate, 1))).payDay).toBe(20);
    expect((await listSeries(A)).find((x) => x.id === s.id)?.payDay).toBe(5);
    expect(await applyTypeRule(A, t)).toEqual({ ok: false, reason: "nothing_to_do" });
  });

  it("tipo sem regra: aplicar preenche a previsão que falta, inclusive de plantões passados não recebidos", async () => {
    const t = await newType("Sem regra", { payDay: "" });
    const pastDate = addDays(today, -15);
    const past = await add(t, pastDate);
    expect(await get(past, pastDate)).toMatchObject({ payDay: null, expectedPayDate: null });
    await updateType(A, t, typeSchema.parse({ name: `${TAG} Sem regra`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: CNPJ, payDay: "10" }));
    expect(await typeRuleImpact(A, t)).toMatchObject({ payDay: 10, fill: 1, change: 0, preserved: 0 });
    expect(await applyTypeRule(A, t)).toMatchObject({ ok: true, count: 1 });
    expect((await get(past, pastDate)).expectedPayDate).toBe(expectedPayDate(pastDate, 10));
  });

  it("repetição semanal: toda quinta, sem duplicar, herdando CNPJ, percentual e previsão", async () => {
    const t = await newType("Quintas");
    const r = await createSeries(A, { typeId: t, weekdays: [4], intervalWeeks: 1, startDate: "2027-03-04", endDate: "2027-04-29", amount: 120000, cnpjId: CNPJ, hours: null, notes: null });
    expect(r.ok).toBe(true);
    expect((await listSeries(A)).find((x) => x.id === (r as { id: string }).id)).toMatchObject({ cnpjId: CNPJ, taxRateBp: 900 });
    await Promise.all([ensureGeneratedThrough(A, "2027-04-29"), ensureGeneratedThrough(A, "2027-04-29")]);
    const list = (await listShifts(A, "2027-03-01", "2027-04-30")).filter((s) => s.typeId === t);
    expect(list.map((s) => s.date)).toEqual(["2027-03-04", "2027-03-11", "2027-03-18", "2027-03-25", "2027-04-01", "2027-04-08", "2027-04-15", "2027-04-22", "2027-04-29"]);
    expect(new Set(list.map((s) => s.date)).size).toBe(list.length);
    expect(list.every((s) => s.cnpjId === CNPJ && s.amountKind === "bruto" && s.taxRateBp === 900 && s.amountCents === 120000)).toBe(true);
    // Todos os de março são pagos em 20/04; os de abril, em 20/05 — vários plantões na mesma data.
    expect(list.filter((s) => s.date < "2027-04-01").every((s) => s.expectedPayDate === "2027-04-20")).toBe(true);
    expect(list.filter((s) => s.date >= "2027-04-01").every((s) => s.expectedPayDate === "2027-05-20")).toBe(true);
    const groups = groupForecast(
      (await listForecast(A)).shifts.filter((s) => list.some((x) => x.id === s.id)),
      today,
    );
    expect(groups.map((g) => [g.date, g.shifts.length, sumsTotal(g.sums), g.sums.gross, g.sums.grossTax])).toEqual([
      ["2027-04-20", 4, 480000n, 480000n, 43200n],
      ["2027-05-20", 5, 600000n, 600000n, 54000n],
    ]);
    // Recebido sai da previsão; a previsão dos demais continua.
    await receiveShift(A, list[0].id, today);
    expect((await listForecast(A)).shifts.some((s) => s.id === list[0].id)).toBe(false);
    expect((await get(list[1].id, list[1].date)).receivedOn).toBeNull();
    // Recorrência sem CNPJ: os plantões nascem sem imposto estimado.
    const plain = (await createSeries(A, { typeId: t, weekdays: [2], intervalWeeks: 1, startDate: "2027-05-04", endDate: "2027-05-11", amount: 50000, cnpjId: null, hours: null, notes: null })) as { id: string };
    const plainShifts = (await listShifts(A, "2027-05-01", "2027-05-31")).filter((s) => s.seriesId === plain.id);
    expect(plainShifts).toHaveLength(2);
    expect(plainShifts.every((s) => s.cnpjId === null && s.amountKind === "liquido" && s.taxRateBp === null)).toBe(true);
  });

  it("registro antigo sem classificação: continua como está até ser marcado; o resumo separa o que é por CNPJ", async () => {
    const t = await newType("Antigo", { payDay: "" });
    const month = "2027-06";
    // Plantão anterior ao cadastro de CNPJ: sem classificação (o app de hoje não cria mais registros assim).
    const [legacy] = await asUser<{ id: string }>(A.id, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents) values ($1, $2, $3::date, 100000) returning id", [A.id, t, `${month}-01`]);
    await add(t, `${month}-02`);
    await add(t, `${month}-03`, { cnpjId: "", amount: "800,00" });
    const l = await get(legacy.id, `${month}-01`);
    expect(l).toMatchObject({ cnpjId: null, amountKind: null, taxRateBp: null, amountCents: 100000 });
    expect(amountBreakdown(l.amountCents, l.amountKind, l.taxRateBp)).toMatchObject({ kind: null, taxCents: null, netCents: null });
    const totals = shiftTotals((await listShifts(A, `${month}-01`, `${month}-30`)).filter((s) => s.typeId === t));
    expect(totals.programado).toBe(280000n);
    // Por CNPJ: R$ 1.000,00 com R$ 90,00 de imposto estimado. O restante (R$ 1.800,00) não tem imposto.
    expect(kindRows(totals)).toEqual([
      { key: "bruto", count: 1, programado: 100000n, recebidoDoMes: 0n, aReceber: 100000n, tax: 9000n, net: 91000n },
      { key: "liquido", count: 1, programado: 80000n, recebidoDoMes: 0n, aReceber: 80000n, tax: null, net: null },
      { key: "indefinido", count: 1, programado: 100000n, recebidoDoMes: 0n, aReceber: 100000n, tax: null, net: null },
    ]);
    // Salvar sem marcar não muda nada; alterar só o valor mantém o registro sem classificação.
    expect(await updateShift(A, legacy.id, edit(`${month}-01`, { cnpjId: "" }))).toEqual({ ok: false, reason: "nothing_to_do" });
    expect(await updateShift(A, legacy.id, edit(`${month}-01`, { cnpjId: "", amount: "1.100,00" }))).toMatchObject({ ok: true });
    expect(await get(legacy.id, `${month}-01`)).toMatchObject({ cnpjId: null, amountKind: null, taxRateBp: null, amountCents: 110000 });
    // Marcar depois, explicitamente: passa a ser por CNPJ com o percentual em vigor.
    expect(await updateShift(A, legacy.id, edit(`${month}-01`, { amount: "1.100,00" }))).toMatchObject({ ok: true });
    expect(await get(legacy.id, `${month}-01`)).toMatchObject({ cnpjId: CNPJ, amountKind: "bruto", taxRateBp: 900 });
  });

  it("percentual do CNPJ: a mudança vale para o trabalho do mês corrente em diante; meses anteriores e outros CNPJs não mudam", async () => {
    const own = await newCnpj("CNPJ percentual");
    const t = await newType("Percentual", { payDay: "", cnpjId: own });
    const monthStart = `${today.slice(0, 7)}-01`;
    const lastMonth = addDays(monthStart, -1);
    const future = addDays(today, 30);

    const before = await add(t, lastMonth, { cnpjId: own });
    await setShiftDone(A, before, true);
    const early = await add(t, monthStart, { cnpjId: own });
    await setShiftDone(A, early, true);
    await receiveShift(A, early, today);
    const plain = await add(t, future, { cnpjId: own });
    const canceled = await add(t, addDays(future, 1), { cnpjId: own });
    await setShiftCanceled(A, canceled, true);
    const noCnpj = await add(t, addDays(future, 2), { cnpjId: "" });
    const otherCnpj = await add(t, addDays(future, 3));
    const s = (await createSeries(A, { typeId: t, weekdays: [1], intervalWeeks: 1, startDate: addDays(future, 40), endDate: addDays(future, 54), amount: 100000, cnpjId: own, hours: null, notes: null })) as { id: string };
    const generated = (await listShifts(A, addDays(future, 40), addDays(future, 54))).filter((x) => x.seriesId === s.id);
    // Alteração individual de uma ocorrência da série: também acompanha o percentual (só o valor é dela).
    await updateShift(A, generated[0].id, edit(generated[0].date, { cnpjId: own, amount: "1.500,00" }));
    // Recorrência encerrada antes do mês corrente: fica com o percentual antigo.
    const ended = (await createSeries(A, { typeId: t, weekdays: [3], intervalWeeks: 1, startDate: addDays(lastMonth, -21), endDate: addDays(lastMonth, -1), amount: 100000, cnpjId: own, hours: null, notes: null })) as { id: string };
    await endSeries(A, ended.id, addDays(lastMonth, -1));

    const company = (await createCompany(A, companySchema.parse({ name: `${TAG} Empresa Percentual`, amount: "1.000,00", cnpjId: own }))) as { id: string };
    companies.push(company.id);
    const exam = (await createExam(A, { ...examSchema.parse({ companyId: company.id, date: today, time: "09:00", amount: "1.000,00", cnpjId: own, notes: "" }), requestId: randomUUID() })) as { id: string };
    await receiveExam(A, exam.id, today);
    const examBefore = (await createExam(A, { ...examSchema.parse({ companyId: company.id, date: lastMonth, time: "09:00", amount: "1.000,00", cnpjId: own, notes: "" }), requestId: randomUUID() })) as { id: string };
    await setExamDone(A, examBefore.id, true);

    // Só o nome mudou: nada é reaplicado.
    const renamed = await updateCnpj(A, own, { name: `${TAG} CNPJ percentual (novo nome)`, abbreviation: "Percentual", number: null, taxRate: 900, taxDueDay: 20 });
    expect(renamed).toEqual({ ok: true, id: own });
    expect((await get(plain, future)).taxRateBp).toBe(900);

    const changed = await updateCnpj(A, own, { name: `${TAG} CNPJ percentual (novo nome)`, abbreviation: "Percentual", number: null, taxRate: 1100, taxDueDay: 20 });
    // Deste mês em diante: o realizado e recebido do dia 1º, o futuro, o cancelado e as ocorrências da recorrência.
    expect(changed).toMatchObject({ ok: true, applied: { rateBp: 1100, from: monthStart, shifts: 3 + generated.length, exams: 1, series: 1 } });
    expect((await get(early, monthStart)).taxRateBp).toBe(1100);
    expect(await get(early, monthStart)).toMatchObject({ status: "realizado", receivedOn: today, receivedCents: 100000 });
    expect((await get(plain, future)).taxRateBp).toBe(1100);
    expect((await get(canceled, addDays(future, 1))).taxRateBp).toBe(1100);
    expect((await get(generated[0].id, generated[0].date)).taxRateBp).toBe(1100);
    expect((await getShiftEvents(A, plain)).at(-1)).toMatchObject({ action: "aliquota_atualizada", details: { aliquota_bp: { de: 900, para: 1100 } } });
    expect((await listExams(A, today, today)).find((e) => e.id === exam.id)).toMatchObject({ taxRateBp: 1100, receivedOn: today });
    expect((await listSeries(A)).find((x) => x.id === s.id)?.taxRateBp).toBe(1100);
    // Ficam como estavam: o mês anterior, o que não é por CNPJ, o de outro CNPJ e a recorrência encerrada.
    expect((await get(before, lastMonth)).taxRateBp).toBe(900);
    expect((await listExams(A, lastMonth, lastMonth)).find((e) => e.id === examBefore.id)?.taxRateBp).toBe(900);
    expect((await get(noCnpj, addDays(future, 2))).taxRateBp).toBeNull();
    expect((await get(otherCnpj, addDays(future, 3))).taxRateBp).toBe(900);
    expect((await listSeries(A)).find((x) => x.id === ended.id)?.taxRateBp).toBe(900);
    // Plantão novo usa 11%: R$ 1.000,00 → R$ 110,00 de imposto estimado.
    const fresh = await get(await add(t, addDays(future, 4), { cnpjId: own }), addDays(future, 4));
    expect(amountBreakdown(fresh.amountCents, fresh.amountKind, fresh.taxRateBp)).toMatchObject({ rateBp: 1100, taxCents: 11000, netCents: 89000 });
    // Repetir o mesmo percentual não reaplica nada.
    expect(await updateCnpj(A, own, { name: `${TAG} CNPJ percentual (novo nome)`, abbreviation: "Percentual", number: null, taxRate: 1100, taxDueDay: 20 })).toEqual({ ok: true, id: own });
  });

  it("isolamento e permissões das colunas", async () => {
    const t = await newType("Isolado");
    const id = await add(t, "2027-07-01");
    expect((await listForecast(B)).shifts.some((s) => s.id === id)).toBe(false);
    expect((await listTypes(B)).some((x) => x.id === t)).toBe(false);
    expect(await updateShift(B, id, edit("2027-07-01", { cnpjId: "" }))).toEqual({ ok: false, reason: "not_found" });
    // B não marca um plantão seu com o CNPJ de A.
    const typeB = (await createType(B, typeSchema.parse({ name: `${TAG} Tipo de B`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payDay: "" }))) as { id: string };
    types.push(typeB.id);
    expect(await createShift(B, typeB.id, { ...input("2027-07-02"), requestId: randomUUID(), confirmOverlap: true })).toEqual({ ok: false, reason: "cnpj_not_found" });
    await expect(asUser(B.id, "insert into public.pl_shifts (user_id, type_id, shift_date, amount_cents, amount_kind, tax_rate_bp, cnpj_id) values ($1, $2, '2027-07-03', 1000, 'bruto', 900, $3)", [B.id, typeB.id, CNPJ])).rejects.toMatchObject({ code: "23503" });
    // O banco não aceita combinações inconsistentes: por CNPJ sem alíquota, sem CNPJ com alíquota, CNPJ sem ser "bruto".
    await expect(asUser(A.id, "update public.pl_shifts set tax_rate_bp = null where id = $1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(asUser(A.id, "update public.pl_shifts set amount_kind = 'liquido' where id = $1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(asUser(A.id, "update public.pl_shifts set cnpj_id = null where id = $1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(asUser(A.id, "update public.pl_shifts set expected_pay_manual = true, expected_pay_date = null where id = $1", [id])).rejects.toMatchObject({ code: "23514" });
    // A recorrência não troca de CNPJ por UPDATE (só por nova recorrência a partir de uma data).
    await expect(asUser(A.id, "update public.pl_series set cnpj_id = null where user_id = $1", [A.id])).rejects.toMatchObject({ code: "42501" });
    expect(await asUser(B.id, "select id from public.pl_shifts where id = $1", [id])).toEqual([]);
  });
});
