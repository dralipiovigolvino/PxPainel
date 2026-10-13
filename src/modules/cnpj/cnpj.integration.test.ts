import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupCnpjs, cleanupPericias, cleanupPlantoes, TAG, testUsers } from "../../../test/integration-helpers";
import { addMonths, formatYearMonth, todayInSaoPaulo, yearMonthOf } from "@/lib/dates";
import { summarize } from "@/modules/financas/domain/analytics";
import { incomeInRange, incomeSources, incomeTotals, taxItems, upcoming } from "@/modules/financas/domain/cashflow";
import { monthRange } from "@/modules/financas/domain/filters";
import { createCompany, createExam } from "@/modules/pericias/data";
import { companySchema, examSchema } from "@/modules/pericias/domain/schemas";
import { listExamWork } from "@/modules/pericias/work-data";
import { createShift, createType, receiveShift, setShiftCanceled } from "@/modules/plantoes/data";
import { shiftSchema, typeSchema } from "@/modules/plantoes/domain/schemas";
import { listShiftWork } from "@/modules/plantoes/work-data";
import { createCnpj, deleteCnpj, listCnpjOptions, listCnpjs, suggestedTaxRateBp, updateCnpj } from "./data";
import { cnpjSchema } from "./domain/schemas";
import { taxDues } from "./domain/tax";

/** Módulo CNPJ no Neon real (contas fictícias A e B): cadastro, imposto do mês seguinte e entradas. Dados fictícios. */
const { A, B } = testUsers();
const cnpjs: string[] = [];
const types: string[] = [];
const companies: string[] = [];
const today = todayInSaoPaulo();

afterAll(async () => {
  await cleanupPlantoes(types);
  await cleanupPericias(companies);
  await cleanupCnpjs(cnpjs);
});

async function newCnpj(name: string, extra: Partial<{ number: string; taxRate: string; taxDueDay: string }> = {}, user = A) {
  const r = await createCnpj(user, cnpjSchema.parse({ name: `${TAG} ${name}`, abbreviation: name.slice(0, 20), number: "", taxRate: "9", taxDueDay: "20", ...extra }));
  expect(r.ok).toBe(true);
  const id = (r as { id: string }).id;
  cnpjs.push(id);
  return id;
}

describe("CNPJ (Neon real)", () => {
  it("cadastro: número opcional sem pontuação, percentual e dia de pagamento; nome repetido recusado; editar e excluir", async () => {
    const id = await newCnpj("Clínica Exemplo", { number: "11.222.333/0001-81", taxRate: "9,5", taxDueDay: "15" });
    expect((await listCnpjs(A)).find((c) => c.id === id)).toEqual({ id, name: `${TAG} Clínica Exemplo`, abbreviation: "Clínica Exemplo", number: "11222333000181", taxRateBp: 950, taxDueDay: 15, links: 0 });
    expect((await listCnpjOptions(A)).find((c) => c.id === id)).toEqual({ id, name: `${TAG} Clínica Exemplo`, abbreviation: "Clínica Exemplo", taxRateBp: 950, taxDueDay: 15 });
    expect(await createCnpj(A, cnpjSchema.parse({ name: `${TAG} clínica exemplo`, abbreviation: "Clínica", number: "", taxRate: "9", taxDueDay: "20" }))).toEqual({ ok: false, reason: "duplicate_name" });
    // Número alfanumérico (formato de 2026) e sem número.
    const alpha = await newCnpj("Alfanumérico", { number: "12.abc.345/01de-35" });
    expect((await listCnpjs(A)).find((c) => c.id === alpha)?.number).toBe("12ABC34501DE35");
    expect(await updateCnpj(A, alpha, cnpjSchema.parse({ name: `${TAG} Alfanumérico`, abbreviation: "Alfa", number: "", taxRate: "6", taxDueDay: "31" }))).toEqual({ ok: true, id: alpha, applied: { rateBp: 600, from: `${today.slice(0, 7)}-01`, shifts: 0, exams: 0, series: 0 } });
    expect((await listCnpjs(A)).find((c) => c.id === alpha)).toMatchObject({ number: null, taxRateBp: 600, taxDueDay: 31 });
    expect(await updateCnpj(A, randomUUID(), cnpjSchema.parse({ name: "x", abbreviation: "x", number: "", taxRate: "6", taxDueDay: "20" }))).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteCnpj(A, alpha)).toEqual({ ok: true });
    expect(await deleteCnpj(A, alpha)).toEqual({ ok: false, reason: "not_found" });
    // Sugestão para um CNPJ novo: o percentual que a conta já usava nas estimativas.
    const [pref] = await asUser<{ tax_rate_bp: number }>(A.id, "select tax_rate_bp from public.user_preferences where user_id = $1", [A.id]);
    expect(await suggestedTaxRateBp(A)).toBe(pref?.tax_rate_bp ?? 900);
  });

  it("CNPJ em uso não é excluído; o cadastro conta onde ele está marcado", async () => {
    const id = await newCnpj("Em uso");
    const type = (await createType(A, typeSchema.parse({ name: `${TAG} Tipo em uso`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: id, payDay: "" }))) as { id: string };
    types.push(type.id);
    const company = (await createCompany(A, companySchema.parse({ name: `${TAG} Empresa em uso`, amount: "500,00", cnpjId: id }))) as { id: string };
    companies.push(company.id);
    await createShift(A, type.id, { ...shiftSchema.parse({ date: "2031-01-10", amount: "1.000,00", notes: "", start: "", end: "", nextDay: "false", cnpjId: id, payMode: "auto", payDate: "" }), requestId: randomUUID(), confirmOverlap: true });
    await createExam(A, { ...examSchema.parse({ companyId: company.id, date: "2031-01-11", time: "09:00", amount: "500,00", cnpjId: id, notes: "" }), requestId: randomUUID() });
    // Tipo + plantão + empresa + perícia.
    expect((await listCnpjs(A)).find((c) => c.id === id)?.links).toBe(4);
    expect(await deleteCnpj(A, id)).toEqual({ ok: false, reason: "has_links" });
    expect((await listCnpjs(A)).some((c) => c.id === id)).toBe(true);
  });

  it("imposto no mês seguinte ao do trabalho e entradas pelo dia em que o dinheiro entra", async () => {
    // Mês de trabalho M (três meses atrás, para poder registrar recebimento); pagamento e imposto em M+1.
    const M = addMonths(yearMonthOf(today), -3);
    const M1 = addMonths(M, 1);
    const day = (ym: typeof M, d: number) => `${formatYearMonth(ym)}-${String(d).padStart(2, "0")}`;
    const cnpj = await newCnpj("Fluxo", { taxDueDay: "20" });
    const typeName = `${TAG} Plantão fluxo`;
    const companyName = `${TAG} Empresa fluxo`;
    const type = (await createType(A, typeSchema.parse({ name: typeName, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: cnpj, payDay: "20" }))) as { id: string };
    types.push(type.id);
    const shift = async (date: string, amount: string, cnpjId: string) =>
      ((await createShift(A, type.id, { ...shiftSchema.parse({ date, amount, notes: "", start: "", end: "", nextDay: "false", cnpjId, payMode: "auto", payDate: "" }), requestId: randomUUID(), confirmOverlap: true })) as { id: string }).id;
    const received = await shift(day(M, 5), "1.000,00", cnpj);
    await receiveShift(A, received, day(M1, 10));
    await shift(day(M, 12), "1.000,00", cnpj);
    await shift(day(M, 19), "800,00", "");
    const canceled = await shift(day(M, 26), "700,00", cnpj);
    await setShiftCanceled(A, canceled, true);
    const company = (await createCompany(A, companySchema.parse({ name: companyName, amount: "500,00", cnpjId: cnpj }))) as { id: string };
    companies.push(company.id);
    await createExam(A, { ...examSchema.parse({ companyId: company.id, date: day(M, 10), time: "09:00", amount: "500,00", cnpjId: cnpj, notes: "" }), requestId: randomUUID() });

    const from = monthRange(M).from;
    const to = monthRange(M1).to;
    const mine = (label: string) => label === typeName || label === companyName;
    const work = [...(await listShiftWork(A, from, to)), ...(await listExamWork(A, from, to))].filter((r) => mine(r.label));
    // Cancelado fica fora; cada registro traz o dia do trabalho e o dia em que o valor entra.
    expect(work.map((r) => [r.source, r.workDate, r.cashDate, r.received, r.amountCents, r.cnpjId === cnpj, r.taxRateBp]).sort()).toEqual(
      [
        ["plantao", day(M, 5), day(M1, 10), true, 100000, true, 900],
        ["plantao", day(M, 12), day(M1, 20), false, 100000, true, 900],
        ["plantao", day(M, 19), day(M1, 20), false, 80000, false, null],
        ["pericia", day(M, 10), day(M, 10), false, 50000, true, 900],
      ].sort(),
    );

    // Imposto estimado: 9% de R$ 2.500,00 (dois plantões e uma perícia por CNPJ em M) = R$ 225,00, pago em M+1.
    const dues = taxDues(work);
    expect(dues).toEqual([{ cnpjId: cnpj, workMonth: M, payMonth: M1, baseCents: 250000n, taxCents: 22500n, shifts: 2, exams: 1 }]);
    const tax = taxItems(dues, new Map((await listCnpjOptions(A)).map((c) => [c.id, c])));
    expect(tax).toHaveLength(1);
    expect(tax[0]).toMatchObject({ source: "imposto", dueDate: day(M1, 20), cents: 22500n, status: "estimado", description: `Imposto estimado · ${TAG} Fluxo` });
    expect(summarize(tax, today)).toMatchObject({ imposto: 22500n, total: 22500n, pago: 0n, aPagar: 0n, atrasadoCount: 0 });

    // Entradas de M+1: o plantão recebido no dia 10 e os dois com pagamento previsto para o dia 20.
    const entradas = incomeInRange(work, monthRange(M1));
    expect(incomeTotals(entradas)).toEqual({ total: 280000n, recebido: 100000n, aReceber: 180000n, count: 3 });
    expect(incomeSources(entradas).map((r) => [r.source, r.cents, r.count])).toEqual([["plantao", 280000n, 3]]);
    // Entradas de M: só a perícia (sem recebimento registrado, conta no dia em que foi feita).
    expect(incomeTotals(incomeInRange(work, monthRange(M)))).toEqual({ total: 50000n, recebido: 0n, aReceber: 50000n, count: 1 });
    // Nada disso está à frente de hoje: a lista de próximos dias fica vazia.
    expect(upcoming(tax, work, { from: today, to: monthRange(addMonths(yearMonthOf(today), 1)).to }, new Map())).toEqual([]);

    // Quem só ENTRA no intervalo também é lido (trabalho de M, dinheiro em M+1).
    const onlyM1 = (await listShiftWork(A, monthRange(M1).from, monthRange(M1).to)).filter((r) => mine(r.label));
    expect(onlyM1.map((r) => r.workDate).sort()).toEqual([day(M, 5), day(M, 12), day(M, 19)]);
    // A conta B não lê nada disso.
    expect((await listShiftWork(B, from, to)).some((r) => mine(r.label))).toBe(false);
    expect((await listExamWork(B, from, to)).some((r) => mine(r.label))).toBe(false);
  });

  it("isolamento: B não vê, não altera e não apaga CNPJ de A", async () => {
    const id = await newCnpj("Isolado");
    expect((await listCnpjs(B)).some((c) => c.id === id)).toBe(false);
    expect((await listCnpjOptions(B)).some((c) => c.id === id)).toBe(false);
    expect(await updateCnpj(B, id, cnpjSchema.parse({ name: "x", abbreviation: "x", number: "", taxRate: "1", taxDueDay: "1" }))).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteCnpj(B, id)).toEqual({ ok: false, reason: "not_found" });
    expect((await listCnpjs(A)).find((c) => c.id === id)).toMatchObject({ taxRateBp: 900, taxDueDay: 20 });
    // No banco, com o papel do app: sem contexto nada aparece; B não grava em nome de A; o dono do registro não muda.
    expect(await asUser(null, "select id from public.cnpjs")).toEqual([]);
    expect(await asUser(B.id, "select id from public.cnpjs where id = $1", [id])).toEqual([]);
    await expect(asUser(B.id, "insert into public.cnpjs (user_id, name, abbreviation, tax_rate_bp) values ($1, 'x', 'x', 900)", [A.id])).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(A.id, "update public.cnpjs set user_id = $1 where id = $2", [B.id, id])).rejects.toMatchObject({ code: "42501" });
    // Mesmo nome em contas diferentes é permitido (a unicidade é por conta).
    const twin = await newCnpj("Isolado", {}, B);
    expect((await listCnpjs(B)).find((c) => c.id === twin)?.name).toBe(`${TAG} Isolado`);
  });
});
